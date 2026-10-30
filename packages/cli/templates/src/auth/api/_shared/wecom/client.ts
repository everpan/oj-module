// 企微 API 客户端（代开发三级凭证链 + 网页授权换 userid）。
//
// 凭证链（devkit 未覆盖，见 docs/plans/20261030-1845-wecom-daikaifa-login-plan.md §5.4）：
//   suite_ticket(企微推) + suite_secret → suite_access_token（套件级，2h）
//   suite_access_token + auth_code → permanent_code（= 代开发应用的 secret，属于 (suite, corp)）
//   permanent_code + corpid  → corp access_token（**与自建应用同一个 gettoken 接口**，2h）
//   corp access_token + code → userid（网页授权 snsapi_base，与自建应用同一个 auth/getuserinfo）
// 代开发与第三方应用的分叉点只有两处：取永久授权码走 `/service/v2/get_permanent_code`；
// 企业 token 走 `gettoken` 而不是 `service/get_corp_token`。
//
// 缓存：两段 token 都进 kv（oj 有 Redis 就跨进程，没有就进程内），TTL = expires_in-300。
// 失效：40001/42001 视为 token 失效 → 删缓存重取一次（企微侧提前失效是常态，不重试会把登录打成 502）。
// 错误两态红线（与 ldap-login 同）：上游网络/协议/企微错误码 → 502（可重试语义）；
// 用户凭据层面（code 无效/不在可见范围）→ 401（不区分原因，防探测）。

const API_BASE = "https://qyapi.weixin.qq.com";
const TIMEOUT_MS = 5000;
const TOKEN_SKEW_SECS = 300;

export interface WecomHttp {
	getJson: (url: string) => Promise<Record<string, unknown>>
	postJson: (url: string, body: unknown) => Promise<Record<string, unknown>>
}

export interface WecomCache {
	get: (key: string) => Promise<string | null>
	set: (key: string, value: string, ttlSecs: number) => Promise<unknown>
	del: (key: string) => Promise<unknown>
}

export interface WecomClientDeps {
	http: WecomHttp
	cache: WecomCache
}

export function runtimeHttp(): WecomHttp {
	async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
		let res: Response;
		try {
			res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
		}
		catch (e) {
			throw upstream(`企微接口不可达：${(e as Error).message}`);
		}
		if (!res.ok)
			throw upstream(`企微接口 HTTP ${res.status}`);
		try {
			return await res.json() as Record<string, unknown>;
		}
		catch {
			throw upstream("企微接口返回非 JSON");
		}
	}
	return {
		getJson: url => call(url, { method: "GET" }),
		postJson: (url, body) => call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
	};
}

export function runtimeCache(): WecomCache {
	return {
		get: key => kv.get(key),
		// kv 没有「带 TTL 的写」，只能写值再设过期——两步之间进程退出、或 expire 失败，
		// 这个键就变成「永不过期」：corp secret 轮换后旧 token 仍被当作新鲜的，
		// 表现是长时间 502 而日志一片安静。故显式兜底：设不上过期就删键（宁可每请求回源）。
		set: async (key, value, ttlSecs) => {
			await kv.set(key, value);
			if (!(await kv.expire(key, ttlSecs))) {
				log.warn("wecom token cached without ttl", "key", key);
				await kv.del(key);
			}
		},
		del: key => kv.del(key),
	};
}

function upstream(message: string): Error {
	return Object.assign(new Error(message), { status: 502 });
}

/** code 无效 / 不在应用可见范围 / 非企业成员：统一 401（不泄露具体原因，§5.3 枚举风险） */
function rejectCode(): never {
	throw Object.assign(new Error("登录凭据无效或不在应用可见范围内"), { status: 401 });
}

/** 企微错误码 → 异常。`errcode` 缺失视为成功（get_permanent_code 的历史行为）。 */
function assertOk(res: Record<string, unknown>, what: string): void {
	const code = res.errcode;
	if (code == null || Number(code) === 0)
		return;
	throw upstream(`企微 ${what} 失败：errcode=${String(code)} ${String(res.errmsg ?? "")}`.trimEnd());
}

const TOKEN_EXPIRED = new Set([40001, 40014, 42001]);

export function createWecomClient(deps: WecomClientDeps) {
	const { http, cache } = deps;

	async function cachedToken(key: string, load: () => Promise<{ token: string, expiresIn: number }>): Promise<string> {
		const hit = await cache.get(key);
		if (hit)
			return hit;
		const { token, expiresIn } = await load();
		const ttl = Math.max(60, Math.floor(expiresIn) - TOKEN_SKEW_SECS);
		await cache.set(key, token, ttl);
		return token;
	}

	/** 套件 access_token：需要 suite_ticket（过期/缺失由调用方先拦） */
	async function suiteAccessToken(suiteId: string, suiteSecret: string, suiteTicket: string): Promise<string> {
		return cachedToken(`wecom:suite_token:${suiteId}`, async () => {
			const res = await http.postJson(`${API_BASE}/cgi-bin/service/get_suite_token`, {
				suite_id: suiteId,
				suite_secret: suiteSecret,
				suite_ticket: suiteTicket,
			});
			assertOk(res, "get_suite_token");
			if (!res.suite_access_token)
				throw upstream("企微 get_suite_token 未返回 suite_access_token");
			return { token: String(res.suite_access_token), expiresIn: Number(res.expires_in ?? 7200) };
		});
	}

	/**
	 * auth_code → permanent_code（+ 企业信息 + 应用列表）。
	 * 代开发用 `/service/v2/get_permanent_code`：返回 is_customized_app=true，且**不返回 access_token**。
	 * auth_code 一次有效（10 分钟内），重放只会拿到企微错误码 → 502，由调用方丢弃本条事件。
	 */
	async function permanentCodeByAuthCode(suiteAccessToken: string, authCode: string): Promise<{
		permanentCode: string
		corpId: string
		corpName: string | null
		agentIds: string[]
		state: string | null
	}> {
		const res = await http.postJson(`${API_BASE}/cgi-bin/service/v2/get_permanent_code?suite_access_token=${encodeURIComponent(suiteAccessToken)}`, { auth_code: authCode });
		assertOk(res, "get_permanent_code");
		const authCorp = (res.auth_corp_info ?? {}) as Record<string, unknown>;
		const agentList = ((res.auth_info ?? {}) as Record<string, unknown>).agent;
		const agentIds = Array.isArray(agentList)
			? agentList.map(a => String((a as Record<string, unknown>).agentid)).filter(Boolean)
			: [];
		if (!res.permanent_code || !authCorp.corpid)
			throw upstream("企微 get_permanent_code 返回缺少 permanent_code / corpid");
		if (agentIds.length === 0)
			throw upstream("企微 get_permanent_code 未返回授权应用（auth_info.agent 为空）");
		return {
			permanentCode: String(res.permanent_code),
			corpId: String(authCorp.corpid),
			corpName: authCorp.corp_name == null ? null : String(authCorp.corp_name),
			agentIds,
			state: res.state == null ? null : String(res.state),
		};
	}

	/**
	 * 预授权码（开通入口用）：套件级、10 分钟、一次有效，拼进 install URL 交给企业管理员点开。
	 * 与 permanent_code 无关——它只换「安装向导里那一屏同意」，真正的永久码仍由 create_auth 回调给。
	 */
	async function preAuthCode(suiteAccessToken: string): Promise<{ code: string, expiresIn: number }> {
		const res = await http.postJson(`${API_BASE}/cgi-bin/service/get_pre_auth_code?suite_access_token=${encodeURIComponent(suiteAccessToken)}`, {});
		assertOk(res, "get_pre_auth_code");
		if (!res.pre_auth_code)
			throw upstream("企微 get_pre_auth_code 未返回 pre_auth_code");
		return { code: String(res.pre_auth_code), expiresIn: Number(res.expires_in ?? 600) };
	}

	/** 企业 access_token（代开发 = 自建应用的 gettoken，corpsecret 就是 permanent_code） */
	async function corpAccessToken(corpId: string, agentId: string, secret: string): Promise<string> {
		return cachedToken(`wecom:corp_token:${corpId}:${agentId}`, async () => {
			const res = await http.getJson(`${API_BASE}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`);
			assertOk(res, "gettoken");
			if (!res.access_token)
				throw upstream("企微 gettoken 未返回 access_token");
			return { token: String(res.access_token), expiresIn: Number(res.expires_in ?? 7200) };
		});
	}

	async function invalidateCorpToken(corpId: string, agentId: string): Promise<void> {
		await cache.del(`wecom:corp_token:${corpId}:${agentId}`);
	}

	/**
	 * 成员姓名（best-effort）：只用于把 JIT 号的 `display_name` 从工号变成真名。
	 *
	 * 三类失败一律返回 null，绝不抛出：套件没有通讯录读权限（60011/48002）、成员不在可见范围、
	 * 上游抖动。补名是体验优化，不能因为拿不到名字把登录打成 5xx——
	 * 调用方拿到 null 就用工号兜底。
	 * token 复用 `userIdByCode` 刚取的那份缓存（同请求内通常 0 次额外换票）。
	 */
	async function userNameById(corpId: string, agentId: string, secret: string, userid: string): Promise<string | null> {
		for (let attempt = 0; attempt < 2; attempt++) {
			let token: string;
			try {
				token = await corpAccessToken(corpId, agentId, secret);
			}
			catch {
				return null;
			}
			let res: Record<string, unknown>;
			try {
				res = await http.getJson(`${API_BASE}/cgi-bin/user/get?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(userid)}`);
			}
			catch {
				return null;
			}
			const errcode = Number(res.errcode ?? 0);
			if (TOKEN_EXPIRED.has(errcode) && attempt === 0) {
				await invalidateCorpToken(corpId, agentId);
				continue;
			}
			if (errcode !== 0)
				return null;
			const name = res.name == null ? "" : String(res.name).trim();
			return name || null;
		}
		return null;
	}

	/** 网页授权 code → userid（snsapi_base；非企业成员/超出可见范围 → 401） */
	async function userIdByCode(corpId: string, agentId: string, secret: string, code: string): Promise<string> {
		for (let attempt = 0; attempt < 2; attempt++) {
			const token = await corpAccessToken(corpId, agentId, secret);
			const res = await http.getJson(`${API_BASE}/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`);
			const errcode = Number(res.errcode ?? 0);
			if (TOKEN_EXPIRED.has(errcode) && attempt === 0) {
				await invalidateCorpToken(corpId, agentId);
				continue;
			}
			if (errcode !== 0)
				rejectCode();
			const userid = res.userid == null ? "" : String(res.userid);
			if (!userid)
				rejectCode(); // 非企业成员（外部联系人）时企微只给 openid，不认作本应用用户
			return userid;
		}
		throw upstream("企微 token 反复失效（40001/42001）");
	}

	return { suiteAccessToken, permanentCodeByAuthCode, preAuthCode, corpAccessToken, invalidateCorpToken, userIdByCode, userNameById };
}

export type WecomClient = ReturnType<typeof createWecomClient>;
