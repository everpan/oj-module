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

/**
 * 软超时：服务端 isolate 无 `setTimeout` / `AbortSignal` 全局，不能用 `AbortSignal.timeout`。
 * 这里用运行时注入的 `tasks.sleep(ms)` 起一个「到点就 reject」的竞态；fetch 不被真正 abort，
 * 只是不再等它（后台连接最终由 OS/池回收）。`tasks` 不可用时降级为原 promise（无超时）。
 * 输家 promise 在 race 结束后仍可能 reject，挂 `.catch` 防 unhandled rejection。
 */
function withSoftTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	const g = globalThis as unknown as { tasks?: { sleep?: (ms: number) => Promise<void> } };
	const sleep = g.tasks?.sleep;
	if (typeof sleep !== "function")
		return p;
	const timeout = sleep(ms).then(
		() => { throw new Error(`超时 ${ms}ms`); },
		() => undefined as never, // sleep 自身异常不中断主链路（返回 never 以免 race 结果退化为 void | T）
	);
	return Promise.race([p, timeout]).finally(() => {
		// 输家 promise 在 race 结束后仍可能 reject，挂 catch 防 unhandled rejection
		timeout.catch(() => {});
	});
}

export function runtimeHttp(): WecomHttp {
	async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
		let res: Response;
		try {
			// 服务端 isolate 无 `AbortSignal` / `setTimeout` 全局（见 oj-api-dev global.d.ts：
			// 「本运行时无 timer 全局」），`AbortSignal.timeout()` 直接 ReferenceError。
			// 用运行时提供的 `tasks.sleep` 做软超时（到点 reject；fetch 仍在后台跑、不 abort），
			// 拿不到 tasks 时降级为「不超时」——网络层失败仍会被下面 catch 转成 502。
			res = await withSoftTimeout(fetch(url, init), TIMEOUT_MS);
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

/**
 * 错码三分类（方案 §5.1）。同步器按 kind 决定处置，**不再一律当 502**：
 *   · permission：该部门不在应用权限/可见范围内 → 跳过并计数，本轮不判失败（否则一个部门无权限就整轮 failed）；
 *   · ratelimit：指数退避重试（企微每企业 ≤1 万次/分、15 万次/小时，正常量级撞不到，撞到就是并发高了）；
 *   · fatal：60020（出口 IP 未白名单）/ 46004（成员已删）/ 网络等——重试无用，计入熔断。
 */
export type WecomErrorKind = "permission" | "ratelimit" | "fatal";

const PERMISSION_CODES = new Set([48002, 60011]);
const RATELIMIT_CODES = new Set([45009, 45033]);

export class WecomApiError extends Error {
	readonly kind: WecomErrorKind;
	readonly errcode: number;
	constructor(what: string, errcode: number, errmsg: string) {
		super(`企微 ${what} 失败：errcode=${errcode} ${errmsg}`.trimEnd());
		this.name = "WecomApiError";
		this.errcode = errcode;
		this.kind = PERMISSION_CODES.has(errcode) ? "permission" : RATELIMIT_CODES.has(errcode) ? "ratelimit" : "fatal";
		// 502：对上层仍是「上游出错」，路由信封口径不变；kind 只给同步器分流用
		Object.assign(this, { status: 502 });
	}
}

/** 退避用的软 sleep：isolate 无 timer 全局，拿不到 tasks 就退化成「不等待直接重试」 */
function softSleep(ms: number): Promise<void> {
	const g = globalThis as unknown as { tasks?: { sleep?: (ms: number) => Promise<void> } };
	const sleep = g.tasks?.sleep;
	if (typeof sleep !== "function")
		return Promise.resolve();
	return sleep(ms).catch(() => undefined);
}

/** 通讯录部门（simplelist/list 的公共形态）：企微部门 id 是数字，这里统一按字符串处理（§4.1 origin_id） */
export interface WecomDept {
	id: string
	parentId: string
	name: string | null
	nameEn: string | null
	order: number
}

/** 通讯录成员（user/list 的形态）：`department` / `order` / `is_leader_in_dept` 逐位对应 */
export interface WecomMember {
	userid: string
	name: string | null
	departments: string[]
	orders: number[]
	leaderInDept: number[]
	mainDepartment: number | null
	position: string | null
	/** 1=已激活 2=已禁用 4=未激活 5=退出企业（§4.3，只存快照不改 is_forbidden） */
	status: number | null
}

/**
 * 授权信息里的应用列表（`auth_info.agent`）——`get_permanent_code` 与 `get_auth_info` 同形，
 * 抽出来是为了两处对 auth_mode 的读法永远一致（同步闸门认的就是这个值）。
 *
 * **数组与单对象都认**：官方示例是数组，但 2026-11-01 的生产回包在代开发 v2 上给的是空列表
 * （见 permanentCodeByAuthCode 的回源兜底）。单对象形态认下来没有代价，少一次「明明有应用却
 * 判成没授权」的误杀。
 */
function agentListOf(authInfo: unknown): Array<Record<string, unknown>> {
	const list = (authInfo as Record<string, unknown> | undefined)?.agent;
	if (Array.isArray(list))
		return list.map(a => a as Record<string, unknown>);
	if (list && typeof list === "object")
		return [list as Record<string, unknown>];
	return [];
}

/**
 * agent_id → auth_mode。auth_mode 在 agent 项上（每个应用各自一条）；老回包里偶尔只在
 * auth_info 顶层给，故两级都读，缺省按 0（管理员授权）——成员授权会导致同步 100% 60011，
 * 不能靠猜成 1。
 */
function readAuthModes(authInfo: unknown): Record<string, number> {
	const top = (authInfo as Record<string, unknown> | undefined)?.auth_mode;
	const modes: Record<string, number> = {};
	for (const a of agentListOf(authInfo)) {
		const agentId = String(a.agentid ?? "");
		if (!agentId)
			continue;
		const mode = Number(a.auth_mode ?? top ?? 0);
		modes[agentId] = Number.isFinite(mode) ? mode : 0;
	}
	return modes;
}

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
		/** agent_id → auth_mode（0=管理员授权 / 1=成员授权）；成员授权下应用无任何部门权限（§2.3） */
		authModes: Record<string, number>
		state: string | null
	}> {
		const res = await http.postJson(`${API_BASE}/cgi-bin/service/v2/get_permanent_code?suite_access_token=${encodeURIComponent(suiteAccessToken)}`, { auth_code: authCode });
		assertOk(res, "get_permanent_code");
		const authCorp = (res.auth_corp_info ?? {}) as Record<string, unknown>;
		if (!res.permanent_code || !authCorp.corpid)
			throw upstream("企微 get_permanent_code 返回缺少 permanent_code / corpid");
		let authInfo = res.auth_info;
		let agents = agentListOf(authInfo);
		if (agents.length === 0) {
			// 代开发 v2 出现过「永久码拿到了、auth_info.agent 却是空的」（2026-11-01 生产日志）。
			// 此时别急着判死：永久码已经在手，`get_auth_info` 是同形的复核接口，能补回应用列表。
			// 只记字段名，不记值——回包里没有任何可公开的东西。
			log.warn(
				"wecom agent list missing in get_permanent_code",
				"keys",
				Object.keys(res).join(","),
				"authInfoKeys",
				authInfo && typeof authInfo === "object" ? Object.keys(authInfo as Record<string, unknown>).join(",") : typeof authInfo,
			);
			try {
				authInfo = await authInfoByPermanentCode(suiteAccessToken, String(authCorp.corpid), String(res.permanent_code));
				agents = agentListOf(authInfo);
			}
			catch (e) {
				log.warn("wecom get_auth_info fallback failed", "reason", (e as Error).message);
			}
		}
		const agentIds = agents.map(a => String(a.agentid)).filter(Boolean);
		// 列表有元素却取不到 agentid：字段被改名的信号，记下键名（不记值）省下一次盲猜
		if (agents.length > 0 && agentIds.length === 0)
			log.warn("wecom agent item has no agentid", "keys", Object.keys(agents[0]!).join(","));
		if (agentIds.length === 0)
			throw upstream("企微 get_permanent_code 未返回授权应用（auth_info.agent 为空，get_auth_info 复核也没有）");
		return {
			permanentCode: String(res.permanent_code),
			corpId: String(authCorp.corpid),
			corpName: authCorp.corp_name == null ? null : String(authCorp.corp_name),
			agentIds,
			authModes: readAuthModes(authInfo),
			state: res.state == null ? null : String(res.state),
		};
	}

	/**
	 * 复核授权模式（`get_auth_info`）：`change_auth` 事件只带 AuthCorpId、**不带 AuthCode**，
	 * 所以刷新 auth_mode 只能拿已存的 permanent_code 反查。企业管理员在后台把「管理员授权」
	 * 切成「成员授权」（或反向）就靠这条路径同步——切过去以后部门接口一律 60011，
	 * 不刷新就会一直按「可同步」对待。
	 */
	async function authModesByPermanentCode(suiteAccessToken: string, corpId: string, permanentCode: string): Promise<Record<string, number>> {
		return readAuthModes(await authInfoByPermanentCode(suiteAccessToken, corpId, permanentCode));
	}

	/** `get_auth_info` 的原始 `auth_info`：授权模式刷新与「永久码回包缺 agent」的回源兜底共用 */
	async function authInfoByPermanentCode(suiteAccessToken: string, corpId: string, permanentCode: string): Promise<unknown> {
		const res = await http.postJson(`${API_BASE}/cgi-bin/service/get_auth_info?suite_access_token=${encodeURIComponent(suiteAccessToken)}`, {
			auth_corpid: corpId,
			permanent_code: permanentCode,
		});
		assertOk(res, "get_auth_info");
		return res.auth_info;
	}

	/**
	 * 服务商级 token（provider_access_token）：代开发「生成授权链接」用，与套件 token 不同源。
	 * 由服务商 corpid + provider_secret 换得，全部署共享一份（不限 suite）。
	 * 注意：这是**服务商**凭证，不是 suite 凭证——代开发的 `get_customized_auth_url`
	 * 只认 provider_access_token（用 suite_access_token 调会报 token 无效类错误）。
	 */
	async function providerAccessToken(providerId: string, providerSecret: string): Promise<string> {
		return cachedToken("wecom:provider_token", async () => {
			const res = await http.postJson(`${API_BASE}/cgi-bin/service/get_provider_token`, {
				corpid: providerId,
				provider_secret: providerSecret,
			});
			assertOk(res, "get_provider_token");
			if (!res.provider_access_token)
				throw upstream("企微 get_provider_token 未返回 provider_access_token");
			return { token: String(res.provider_access_token), expiresIn: Number(res.expires_in ?? 7200) };
		});
	}

	/**
	 * 代开发授权链接（get_customized_auth_url）：返回 `qrcode_url`（即企业管理员要扫/开的开通链接，
	 * 运营侧常称 auth_url）。**代开发明确不支持**第三方应用那个 `get_pre_auth_code`（errcode 48002），
	 * 必须用本接口。链接有效期以企微返回为准（可达 10 天），state 透传给授权成功回调原样回传。
	 * `templateid_list` 填代开发模板 ID（本系统即 suite_id，代开发模板与 suite 同标识）。
	 */
	async function customizedAuthUrl(providerAccessToken: string, templateIds: string[], state: string): Promise<{ url: string, expiresIn: number }> {
		// state 必填（errcode 40058 state missing），限 ≤32 字节；调用方没传（前端目前不传）就给默认常量。
		// 注：本系统开通链接不靠 state 携带 env（env 走登录链接），故空时给固定默认值即可。
		const st = state ? state.slice(0, 32) : "ojmdaikaifa";
		const res = await http.postJson(`${API_BASE}/cgi-bin/service/get_customized_auth_url?provider_access_token=${encodeURIComponent(providerAccessToken)}`, {
			state: st,
			templateid_list: templateIds,
		});
		// 842002 = 代开发模板未上架/上线：模板创建成功 ≠ 上线，必须到服务商后台
		// 「应用管理 → 代开发应用上线」提交审核、审核通过后再手动「提交上线」，
		// 模板正式上线后 get_customized_auth_url 才会生成 qrcode_url。这是后台运营前置动作，
		// 与代码/参数/凭证无关（否则会先报 40058/60020/40001 之类）。单独挑出给可操作提示。
		if (Number(res.errcode ?? 0) === 842002)
			throw upstream("企微 get_customized_auth_url 失败：errcode=842002 代开发模板尚未上架/上线——请到服务商后台「应用管理 → 代开发应用上线」提交模板上线审核，审核通过后手动点「提交上线」，模板正式上线后再生成开通链接");
		assertOk(res, "get_customized_auth_url");
		const url = res.qrcode_url ?? res.auth_url;
		if (!url)
			throw upstream("企微 get_customized_auth_url 未返回 qrcode_url");
		return { url: String(url), expiresIn: Number(res.expires_in ?? 7200) };
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
	 * 通讯录类 GET 的公共通道：token 失效重取 + 三类错码分流。
	 *
	 * 重试上限是有意的：token 失效最多换两次（企微侧提前失效是常态），限流退避最多三次
	 * （500ms/1s/2s），其余错码立即抛——同步器靠 kind 决定「跳过并计数」还是「计入熔断」，
	 * 所以**必须把 errcode 带出去**，不能像 assertOk 那样拍平成一句中文。
	 */
	async function corpGet(
		corpId: string,
		agentId: string,
		secret: string,
		path: string,
		params: Record<string, string | number | undefined>,
		what: string,
	): Promise<Record<string, unknown>> {
		const qs = Object.entries(params)
			.filter(([, v]) => v != null && v !== "")
			.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
			.join("&");
		for (let attempt = 0; ; attempt++) {
			const token = await corpAccessToken(corpId, agentId, secret);
			const res = await http.getJson(`${API_BASE}${path}?access_token=${encodeURIComponent(token)}${qs ? `&${qs}` : ""}`);
			const errcode = Number(res.errcode ?? 0);
			if (!errcode)
				return res;
			if (TOKEN_EXPIRED.has(errcode) && attempt < 2) {
				await invalidateCorpToken(corpId, agentId);
				continue;
			}
			const err = new WecomApiError(what, errcode, String(res.errmsg ?? ""));
			if (err.kind === "ratelimit" && attempt < 2) {
				await softSleep(500 * 2 ** attempt);
				continue;
			}
			throw err;
		}
	}

	function toDept(raw: Record<string, unknown>): WecomDept {
		return {
			id: String(raw.id ?? ""),
			parentId: raw.parentid == null ? "" : String(raw.parentid),
			name: raw.name == null ? null : String(raw.name),
			nameEn: raw.name_en == null ? null : String(raw.name_en),
			order: Number(raw.order ?? 0),
		};
	}

	/**
	 * 子部门 id 列表（接口 1）：全量同步的**主路径**——官方 90208 明写 `department/list` 性能低。
	 * `parentOriginId` 缺省时企微返回「应用可见范围内所有部门」，这既是 BFS 的起点，也是兜底路径。
	 */
	async function departmentChildren(corpId: string, agentId: string, secret: string, parentOriginId?: string): Promise<WecomDept[]> {
		const res = await corpGet(corpId, agentId, secret, "/cgi-bin/department/simplelist", { id: parentOriginId }, "department/simplelist");
		const list = Array.isArray(res.department_id) ? res.department_id as Array<Record<string, unknown>> : [];
		return list.filter(d => d && d.id != null).map(toDept);
	}

	/** 单部门详情（接口 2）：simplelist 不带名字，名字只能从这里取（未授权时 name 为空） */
	async function departmentDetail(corpId: string, agentId: string, secret: string, originId: string): Promise<WecomDept> {
		const res = await corpGet(corpId, agentId, secret, "/cgi-bin/department/get", { id: originId }, "department/get");
		const d = res.department as Record<string, unknown> | undefined;
		if (!d || d.id == null)
			throw upstream("企微 department/get 未返回部门详情");
		return toDept(d);
	}

	/** 一次拿全量部门（接口 3）：降级兜底，1/2 因权限拿不到时用 */
	async function departmentList(corpId: string, agentId: string, secret: string, parentOriginId?: string): Promise<WecomDept[]> {
		const res = await corpGet(corpId, agentId, secret, "/cgi-bin/department/list", { id: parentOriginId }, "department/list");
		const list = Array.isArray(res.department) ? res.department as Array<Record<string, unknown>> : [];
		return list.filter(d => d && d.id != null).map(toDept);
	}

	function toMember(raw: Record<string, unknown>, detail: boolean): WecomMember {
		const departments = Array.isArray(raw.department) ? raw.department.map(d => String(d)) : [];
		const orders = detail && Array.isArray(raw.order) ? raw.order.map(o => Number(o)) : [];
		const leader = detail && Array.isArray(raw.is_leader_in_dept) ? raw.is_leader_in_dept.map(o => Number(o)) : [];
		return {
			userid: String(raw.userid ?? ""),
			name: raw.name == null ? null : String(raw.name),
			departments,
			orders,
			leaderInDept: leader,
			mainDepartment: detail && raw.main_department != null ? Number(raw.main_department) : null,
			position: detail && raw.position != null ? String(raw.position) : null,
			status: detail && raw.status != null ? Number(raw.status) : null,
		};
	}

	/** 部门成员（接口 4，轻量）：`user/simplelist` 无 fetch_child，子部门要调用方自己递归 */
	async function deptMembers(corpId: string, agentId: string, secret: string, deptOriginId: string): Promise<WecomMember[]> {
		const res = await corpGet(corpId, agentId, secret, "/cgi-bin/user/simplelist", { department_id: deptOriginId }, "user/simplelist");
		const list = Array.isArray(res.userlist) ? res.userlist as Array<Record<string, unknown>> : [];
		return list.filter(u => u && u.userid != null).map(u => toMember(u, false));
	}

	/** 部门成员详情（接口 5，重量）：职务 / 排序 / 主部门 / 在职状态只有这里有；同一部门只该调一次 */
	async function deptMembersDetail(corpId: string, agentId: string, secret: string, deptOriginId: string): Promise<WecomMember[]> {
		const res = await corpGet(corpId, agentId, secret, "/cgi-bin/user/list", { department_id: deptOriginId }, "user/list");
		const list = Array.isArray(res.userlist) ? res.userlist as Array<Record<string, unknown>> : [];
		return list.filter(u => u && u.userid != null).map(u => toMember(u, true));
	}

	/**
	 * 单成员详情（接口 6）：**登录自更新**用它，四次/次调用就够。
	 *
	 * best-effort：任何失败（无权限 / 不在可见范围 / 上游抖）返回 null，绝不抛出——
	 * 补资料是体验优化，不能因为拿不到把登录打成 5xx。调用方拿到 null 就保留兜底值。
	 */
	async function userDetail(corpId: string, agentId: string, secret: string, userid: string): Promise<WecomMember | null> {
		try {
			const res = await corpGet(corpId, agentId, secret, "/cgi-bin/user/get", { userid }, "user/get");
			// 回包偶尔不带 userid（老接口/精简回包）：入参就是权威，用入参补
			return toMember({ ...res, userid: res.userid ?? userid }, true);
		}
		catch {
			return null;
		}
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
		const detail = await userDetail(corpId, agentId, secret, userid);
		const name = detail?.name?.trim();
		return name || null;
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
			if (errcode !== 0) {
				// 部署侧错误（IP 白名单 / 限流）不是用户凭据问题：按 502 抛，避免被统一成 401 把排查带偏
				log.warn("wecom getuserinfo rejected", "errcode", String(errcode), "errmsg", String(res.errmsg ?? ""));
				if (errcode === 60020 || errcode === 45009)
					throw upstream(`企微 auth/getuserinfo 失败：errcode=${errcode} ${String(res.errmsg ?? "")}`.trim());
				rejectCode();
			}
			const userid = res.userid == null ? "" : String(res.userid);
			if (!userid) {
				log.warn("wecom getuserinfo no userid", "keys", Object.keys(res).join(","));
				rejectCode(); // 非企业成员（外部联系人）时企微只给 openid，不认作本应用用户
			}
			return userid;
		}
		throw upstream("企微 token 反复失效（40001/42001）");
	}

	return {
		suiteAccessToken,
		permanentCodeByAuthCode,
		authModesByPermanentCode,
		providerAccessToken,
		customizedAuthUrl,
		corpAccessToken,
		invalidateCorpToken,
		userIdByCode,
		userNameById,
		userDetail,
		departmentChildren,
		departmentDetail,
		departmentList,
		deptMembers,
		deptMembersDetail,
	};
}

export type WecomClient = ReturnType<typeof createWecomClient>;
