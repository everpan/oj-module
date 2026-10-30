import type { WecomConfig } from "../_shared/wecom/config";
// GET  /api/auth/wecom/login?corp=&agent=&env=  —— 发起企微授权（企微内静默 / 浏览器扫码）
// GET  /api/auth/wecom/callback?code=&state=     —— 企微回跳：code→userid→JIT→一次性票据→302 SPA
// POST /api/auth/wecom/ticket  {ticket}          —— 一次性票据换 TokenBundle（token 不进 URL）
// GET  /api/auth/wecom/event                     —— 企微回调 URL 验证（echostr 解出后原样回）
// POST /api/auth/wecom/event                     —— 企微指令回调（suite_ticket / 授权 / 解绑）
//
// 三处纪律：
//   1. 两个 302 端点**不能**用 respond（它末尾无脑 json.ok，会把 302 覆盖成 200 信封）——
//      异常统一交 failWith（respond.ts 同一个信封收口）。
//   2. 企微事件端点必须回**纯文本** `success` / 解出的 `echostr`（信封会被企微判成失败并重推三次），
//      故走 json.stream 的 text/plain 通道（json.raw 是 JSON 通道，会把 echostr 加引号）。
//   3. 这四个端点都在 `auth.anonymous_paths`（无 Bearer）与 `tenant.anonymous_paths`（浏览器带不了
//      `X-TENANT-ID`）里：租户只能由服务端从 profile / 票据推导（db.asTenant，见 store.ts::ensureTenant）。
import { failWith, respond } from "#/_platform/_shared/respond";
import { clientIp, guardLoginThrottle, noteLoginFailed, noteLoginSucceeded } from "../_shared/login-throttle";
import { createSession } from "../_shared/session";
import { createWecomClient, runtimeCache, runtimeHttp } from "../_shared/wecom/client";
import { loginRedirectOf, readWecomConfig, siteOriginOf } from "../_shared/wecom/config";
import { unwrapWecomMessage, wecomSignature } from "../_shared/wecom/crypt";
import { handleSuiteEvent } from "../_shared/wecom/events";
import {
	assertUserActive,
	buildAuthorizeUrl,
	ensureWecomUser,
	LOGIN_TICKET_TTL_SECS,
	loginLandingUrl,
	putLoginState,
	takeLoginState,
} from "../_shared/wecom/login";
import { claimLoginTicket, ensureTenant, findProfile, issueLoginTicket, runtimeStoreDeps, tenantOfCorp } from "../_shared/wecom/store";
import { xmlField } from "../_shared/wecom/xml";

// 模块级禁止 readWecomConfig()/createSession()/runtimeHttp()：oj build 的 introspect 在空沙箱里
// 评估模块（无 vars/jwt/fetch），一律在 handler 内按需构造（§9.4）。

/** 请求头的读取按大小写不敏感处理（http.headers 的键大小写随客户端） */
function header(name: string): string {
	const all = (http.headers ?? {}) as Record<string, string>;
	const key = Object.keys(all).find(k => k.toLowerCase() === name);
	return key ? String(all[key] ?? "") : "";
}

function query(name: string): string {
	return String(((http.query ?? {}) as Record<string, unknown>)[name] ?? "").trim();
}

/** 纯文本 200（企微事件回执专用；信封会被判失败并触发重推） */
function plainText(body: string): void {
	const stream = json.stream({ contentType: "text/plain; charset=utf-8" });
	stream.write(body);
	stream.end();
}

function badRequest(message: string): Error {
	return Object.assign(new Error(message), { status: 400 });
}

/**
 * 校验企微回调签名并解出明文。签名不合法 → 400（不是 401：调用方是企微服务器，
 * 401 会被当成「本站需要鉴权」误导排查）；信封里的原文不回显，避免给探测者提供比对材料。
 */
function decryptVerified(encrypted: string): { cfg: WecomConfig, plain: string } {
	const cfg = readWecomConfig();
	const expected = wecomSignature(cfg.token, query("timestamp"), query("nonce"), encrypted);
	if (expected !== query("msg_signature"))
		throw badRequest("回调签名校验失败");
	try {
		return { cfg, plain: unwrapWecomMessage(encrypted, cfg.encodingAesKey, cfg.suiteId) };
	}
	catch (e) {
		// 解密失败只透出「失败」：错钥/错套件/被篡改三者不可区分，也不该让外部据此判断哪一环配错
		log.warn("wecom callback decrypt failed", "reason", (e as Error).message);
		throw badRequest("回调消息解密失败");
	}
}

const login = {
	// 企微内打开（UA 含 wxwork）→ oauth2 静默授权；普通浏览器 → qrConnect 扫码。
	// corp 必填（D10：企业代码 = corp_id，服务商后台可生成带码的专属登录链接）。
	async get() {
		try {
			const cfg = readWecomConfig();
			const corp = query("corp");
			const agent = query("agent");
			if (!corp)
				throw badRequest("缺少企业代码（corp）：请使用企业管理员收到的登录链接，或在登录页填写企业代码");

			// 企业代码解析是**未登录可调的枚举面**（§5.3）：复用登录节流，维度 (IP, 企业代码)
			const ip = await clientIp();
			await guardLoginThrottle(ip, corp);

			const deps = runtimeStoreDeps(cfg);
			const profile = await findProfile(corp, agent || null, deps).catch(async (e: Error & { status?: number }) => {
				// 只有「企业代码无效/多应用未指定」计失败；配置类错误（缺 vars）不该污染节流计数
				if (e.status === 400)
					await noteLoginFailed(ip, corp);
				throw e;
			});

			const state = crypto.randomHex(16);
			await putLoginState(state, { corpId: profile.corpId, agentId: profile.agentId, env: profile.env }, runtimeCache());
			const url = buildAuthorizeUrl({
				corpId: profile.corpId,
				agentId: profile.agentId,
				redirectUri: loginRedirectOf(cfg),
				state,
				inWecom: /wxwork/i.test(header("user-agent")),
			});
			json.redirect.found(url);
		}
		catch (e) {
			failWith(e); // 302 不在错误通道里：异常同样走统一信封，不能让浏览器看到裸 500
		}
	},
};

const callback = {
	// 企微回跳：state 一次性（kv 取即删）→ profile → 绑租户 → code 换 userid → JIT 建档 → 发票 → 302。
	async get() {
		try {
			const cfg = readWecomConfig();
			const code = query("code");
			const state = query("state");
			// 用户在企业微信里点了「拒绝」时企微不回 code，只回 state
			if (!code)
				throw badRequest("授权未完成：企业微信未返回 code（可能已在授权页取消）");
			if (!state)
				throw badRequest("登录状态缺失：请从企业微信重新进入");

			const deps = runtimeStoreDeps(cfg);
			const pending = await takeLoginState(state, runtimeCache());
			const profile = await findProfile(pending.corpId, pending.agentId, deps);
			// 顺序刚性：先绑租户再碰 users（JIT 建号是租户表写入，守卫 deny 下缺上下文即拒）
			ensureTenant(tenantOfCorp(profile.corpId));

			const client = createWecomClient({ http: runtimeHttp(), cache: runtimeCache() });
			const userid = await client.userIdByCode(profile.corpId, profile.agentId, profile.permanentCode, code);
			const { uid, forbidden } = await ensureWecomUser(profile.corpId, userid);
			if (forbidden)
				throw Object.assign(new Error("账号已被停用，请联系管理员"), { status: 403 });

			// 票据而不是 token 进 URL：token 会留在浏览器历史/Referer/反代日志里
			const ticket = crypto.randomHex(32);
			const tenant = tenantOfCorp(profile.corpId);
			await issueLoginTicket(crypto.sha256Hex(ticket), uid, tenant, LOGIN_TICKET_TTL_SECS, deps);
			await noteLoginSucceeded(await clientIp(), profile.corpId);
			log.info("wecom login ok", "tenant", tenant, "agentId", profile.agentId);
			json.redirect.found(loginLandingUrl({ origin: siteOriginOf(cfg), ticket, tenant }));
		}
		catch (e) {
			failWith(e);
		}
	},
};

const ticket = {
	// 一次性票据换会话。票据即凭证：先抢所有权（原子 used 0→1）再校验过期，重放与并发双花都只会成功一次。
	async post() {
		await respond(async () => {
			const cfg = readWecomConfig();
			const raw = String((http.body as { ticket?: string } | null)?.ticket ?? "");
			if (!raw)
				throw badRequest("缺少 ticket");
			const claimed = await claimLoginTicket(crypto.sha256Hex(raw), runtimeStoreDeps(cfg));
			// 票据里的租户是权威：前端落地页必须先 bootstrapTenant（`?tenant=` 由 callback 的 302 带上），
			// 否则这里拿到的是默认租户头，ensureTenant 会以 403 明确拒绝（而不是悄悄落到 default）
			ensureTenant(claimed.ownerTenant);
			await assertUserActive(claimed.uid);
			return createSession().issueExternal(claimed.uid);
		});
	},
};
ticket.post.schema = {
	body: {
		type: "object",
		required: ["ticket"],
		properties: {
			ticket: { type: "string", minLength: 32, maxLength: 128 },
		},
	},
};

const event = {
	// 企微后台「保存回调 URL」时会 GET 一次：解出 echostr 后**原样明文回**（不套信封、不加引号）
	async get() {
		try {
			const { plain } = decryptVerified(query("echostr"));
			plainText(plain);
		}
		catch (e) {
			failWith(e);
		}
	},

	// 指令回调：验签 → 解密 → 分发（suite_ticket / create_auth / change_auth / cancel_auth /
	// reset_permanent_code）。回 `success` 才算收下，否则企微 5 秒后重推三次。
	async post() {
		try {
			const xml = typeof http.body === "string" ? http.body : "";
			const encrypted = xmlField(xml, "Encrypt");
			if (!encrypted)
				throw badRequest("回调报文缺少 Encrypt");
			const { cfg, plain } = decryptVerified(encrypted);
			const client = createWecomClient({ http: runtimeHttp(), cache: runtimeCache() });
			await handleSuiteEvent(plain, { cfg, client, store: runtimeStoreDeps(cfg) });
			plainText("success");
		}
		catch (e) {
			// 失败必须让企微看到非 success：它重推三次，正好覆盖「suite_ticket 未到/上游抖」这类瞬态
			failWith(e);
		}
	},
};

export default { login, callback, ticket, event };
