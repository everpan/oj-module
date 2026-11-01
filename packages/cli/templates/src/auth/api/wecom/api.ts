import type { CallbackCreds, WecomKind } from "../_shared/wecom/config";
import type { SelfApp } from "../_shared/wecom/login";
import type { CallbackFields } from "../_shared/wecom/payload";
import type { ReplayClaim } from "../_shared/wecom/replay";
import type { WecomStoreDeps } from "../_shared/wecom/store";
// GET  /api/auth/wecom/login?corp=&agent=&env=  —— 发起企微授权（企微内静默 / 浏览器扫码）
// GET  /api/auth/wecom/callback?code=&state=     —— 企微回跳：code→userid→JIT→一次性票据→302 SPA
// POST /api/auth/wecom/ticket  {ticket}          —— 一次性票据换 TokenBundle（token 不进 URL）
// GET  /api/auth/wecom/event                     —— 企微回调 URL 验证（echostr 解出后原样回）
// POST /api/auth/wecom/event                     —— 企微回调（代开发指令事件 / 自建应用通讯录变更）
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
import {

	callbackCreds,
	loginRedirectOf,
	readBase,
	readCorpConfig,
	readSuiteConfig,
	siteRootOf,
	wecomKinds,
} from "../_shared/wecom/config";
import { handleContactChange } from "../_shared/wecom/contacts";
import { sha1Hex, unwrapWecomMessage, wecomSignature } from "../_shared/wecom/crypt";
import { handleSuiteEvent } from "../_shared/wecom/events";
import {
	assertUserActive,
	buildAuthorizeUrl,
	ensureWecomUser,
	LOGIN_TICKET_TTL_SECS,
	loginLandingUrl,
	putLoginState,
	resolveWecomProfile,

	selfUpdate,
	takeLoginState,
} from "../_shared/wecom/login";
import { callbackFields, field } from "../_shared/wecom/payload";
import { guardReplay, markApplied, ReplayAlreadyApplied, runtimeReplayGate } from "../_shared/wecom/replay";
import { claimLoginTicket, ensureTenant, findProfile, issueLoginTicket, runtimeStoreDeps, tenantOfCorp } from "../_shared/wecom/store";

// 模块级禁止 readBase()/createSession()/runtimeHttp()：oj build 的 introspect 在空沙箱里
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
	const stream = json.stream({ contentType: "text/plain; charset=utf-8", status: 200 });
	stream.write(body);
	stream.end();
}

function badRequest(message: string): Error {
	return Object.assign(new Error(message), { status: 400 });
}

/**
 * 本部署自己那家企业内部应用（配了 `wecom_corp_*` 才有）。
 *
 * 作用是给登录入口一个**确定的默认目标**，而不是去猜档案里哪一行是「本站自己」：共存部署里
 * 档案表还有别家企业通过代开发装进来的行，猜的代价是本站 `/login` 反过来回 400。
 */
function corpSelf(): SelfApp | undefined {
	if (!wecomKinds().includes("corp"))
		return undefined;
	const c = readCorpConfig();
	return { corpId: c.corpId, agentId: c.agentId };
}

/**
 * 解不开时把「哪一侧配错」记进日志——只回一句 `pkcs7: bad padding` 等于没给线索。
 *
 * 能先验签通过才走到解密，说明后台 Token 与本部署一致；于是解不开只剩两类：
 *   · `bad padding` → **钥匙不对**：EncodingAESKey 与后台不一致（后台点过「随机生成」、或抄错/抄漏
 *     一个字符），或这条推送其实来自另一个套件/模板（那把钥匙解不开这份密文）。
 *     `aesKeyFp` 是本进程**实际加载**那把钥匙的指纹：改完 config 对不上就说明没生效（没重启/改错文件）。
 *   · `receiver mismatch` → **钥匙对、身份不对**。`receiveid` 已按候选试过（见 unwrapAccepting：
 *     凭据自己的 receiver + 信封 `ToUserName`），两边都对不上只剩两种：信封里没有 `ToUserName`，
 *     或这条推送既不属本部署、receiveid 也不是它自己声称的身份（伪造/转发）。
 *
 * `kind` 必须记：共存部署里有两套钥匙，日志不写「这次用的是哪套」，排障就退化成猜。
 * 注意 `envelopeToUser` **不等于** `configuredReceiver` 是正常的：数据回调的 `ToUserName` 是 corpid。
 */
function noteDecryptFailure(e: unknown, envelope: CallbackFields | null, creds: CallbackCreds): void {
	log.warn(
		"wecom callback decrypt failed",
		"reason",
		(e as Error).message,
		"kind",
		creds.kind,
		"envelopeToUser",
		// URL 验证（GET）只有 query 里的 echostr，没有报文信封——那一侧记空串
		envelope ? field(envelope, "ToUserName") : "",
		"configuredReceiver",
		creds.receiver,
		"aesKeyFp",
		sha1Hex(creds.encodingAesKey).slice(0, 8),
	);
}

/**
 * 按「可能合法的 receiveid」依次尝试解密。
 *
 * receiveid 的含义随场景变（90968 附注）：**第三方事件的回调是 suiteid**（suite_ticket / create_auth
 * / cancel_auth），**企业应用（含代开发应用的数据回调、自建应用的通讯录事件）是 corpid**。
 * 我们一个端点吃两种，只认 suiteid 会把所有数据回调判成「解密失败」——而真正的错是「比错了值」。
 *
 * 只对 `receiver mismatch` 换下一个候选：`bad padding` 说明密钥就不对，换谁都解不开，直接抛。
 */
function unwrapAccepting(encrypted: string, creds: CallbackCreds, candidates: string[]): string {
	let lastErr: unknown;
	const tried = new Set<string>();
	for (const receiver of candidates) {
		if (!receiver || tried.has(receiver))
			continue;
		tried.add(receiver);
		try {
			return unwrapWecomMessage(encrypted, creds.encodingAesKey, receiver);
		}
		catch (e) {
			if (!/receiver mismatch/.test((e as Error).message))
				throw e;
			lastErr = e;
		}
	}
	throw lastErr ?? new Error("wecom: 没有可比对的 receiveid（suite_id 未配置？）");
}

/** 用哪一把钥匙能验过签名：**逐个试**（SHA1 一次，成本可忽略），命中即用它的钥匙解密 */
function matchCreds(encrypted: string): CallbackCreds | null {
	const sig = query("msg_signature");
	const ts = query("timestamp");
	const nonce = query("nonce");
	return callbackCreds().find(c => wecomSignature(c.token, ts, nonce, encrypted) === sig) ?? null;
}

/**
 * 校验企微回调签名并解出明文。签名不合法 → 400（不是 401：调用方是企微服务器，
 * 401 会被当成「本站需要鉴权」误导排查）；信封里的原文不回显，避免给探测者提供比对材料。
 *
 * 三道顺序不可换：先验签（不给未鉴权请求写 kv）→ 再拦重放（省一次解密，也让
 * cancel_auth 这种危险性最高的报文止步在落库之前）→ 最后解密。
 */
async function decryptVerified(encrypted: string, envelope: CallbackFields): Promise<{ kind: WecomKind, plain: string, claim: ReplayClaim }> {
	const creds = matchCreds(encrypted);
	if (!creds)
		throw badRequest("回调签名校验失败");
	const claim = await guardReplay(query("timestamp"), query("nonce"), runtimeReplayGate());
	try {
		// 信封的 ToUserName 就是这条报文的身份：套件事件里是 suiteid，应用数据回调里是 corpid，
		// 与 receiver 必然一致（两者在同一份密文/明文里，签名已经覆盖）。
		return { kind: creds.kind, plain: unwrapAccepting(encrypted, creds, [creds.receiver, field(envelope, "ToUserName")]), claim };
	}
	catch (e) {
		// 解不开的这一条不能占住 nonce：企微重推是它唯一的恢复路径，占住就把重推挡成 400
		await claim.release();
		// 解密失败只对外透出「失败」：错钥/错套件/被篡改三者不可区分，也不该让外部据此判断哪一环配错
		noteDecryptFailure(e, envelope, creds);
		throw badRequest("回调消息解密失败");
	}
}

/** 放回一次 nonce 占用；放回失败只告警——它不该盖住真正的失败原因 */
async function releaseClaim(claim: ReplayClaim | undefined): Promise<void> {
	if (!claim)
		return;
	try {
		await claim.release();
	}
	catch (e) {
		log.warn("wecom replay nonce release failed", "reason", (e as Error).message);
	}
}

const login = {
	// 企微内打开（UA 含 wxwork）→ oauth2 静默授权；普通浏览器 → qrConnect 扫码。
	// corp 必填（D10：企业代码 = corp_id，服务商后台可生成带码的专属登录链接）。
	async get() {
		try {
			// 登录只用「与来源无关」的两项（落库密钥 + 基址）：自建模式没有 suite 凭据，
			// 在这里读整套 suite 配置会把一条正常的登录打成 400。
			const base = readBase();
			const deps = runtimeStoreDeps(base);

			const corp = query("corp");
			const agent = query("agent");

			const ip = await clientIp();
			// 企业代码解析是**未登录可调的枚举面**（§5.3）：复用登录节流，维度 (IP, 企业代码）。
			// corp 缺省时（代开发模板常只服务一家企业）自动从已安装档案解析，省去手动填企业代码，
			// 也让「应用主页」可直接填 https://<域名>/login（无需 ${corpid} 占位符，企微后台会因非法 URL 字符拒收）。
			let profile: { corpId: string, agentId: string, env: string };
			if (corp) {
				await guardLoginThrottle(ip, corp);
				profile = await findProfile(corp, agent || null, deps).catch(async (e: Error & { status?: number }) => {
					// 只有「企业代码无效/多应用未指定」计失败；配置类错误（缺 vars）不该污染节流计数
					if (e.status === 400)
						await noteLoginFailed(ip, corp);
					throw e;
				});
			}
			else {
				profile = await resolveWecomProfile(agent || null, corpSelf());
				await guardLoginThrottle(ip, profile.corpId);
			}

			const state = crypto.randomHex(16);
			await putLoginState(state, { corpId: profile.corpId, agentId: profile.agentId, env: profile.env }, runtimeCache());
			const url = buildAuthorizeUrl({
				corpId: profile.corpId,
				agentId: profile.agentId,
				redirectUri: loginRedirectOf(base),
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
			const base = readBase();
			const code = query("code");
			const state = query("state");
			// 用户在企业微信里点了「拒绝」时企微不回 code，只回 state
			if (!code)
				throw badRequest("授权未完成：企业微信未返回 code（可能已在授权页取消）");
			if (!state)
				throw badRequest("登录状态缺失：请从企业微信重新进入");

			const deps = runtimeStoreDeps(base);
			const cache = runtimeCache();
			const pending = await takeLoginState(state, cache);
			const profile = await findProfile(pending.corpId, pending.agentId, deps);
			// 顺序刚性：先绑租户再碰 users（JIT 建号是租户表写入，守卫 deny 下缺上下文即拒）
			ensureTenant(tenantOfCorp(profile.corpId));

			const client = createWecomClient({ http: runtimeHttp(), cache });
			const userid = await client.userIdByCode(profile.corpId, profile.agentId, profile.permanentCode, code);
			// 名字是惰性取的：只有首次建档才多打一次 user/get（老用户零开销），拿不到就用工号兜底
			const { uid, forbidden } = await ensureWecomUser(profile.corpId, userid, () =>
				client.userNameById(profile.corpId, profile.agentId, profile.permanentCode, userid));
			if (forbidden)
				throw Object.assign(new Error("账号已被停用，请联系管理员"), { status: 403 });

			// 轨一：登录自更新（方案 §6.1）。节流 24h、失败不影响登录；但企微侧已离职/禁用的
			// 账号必须在这里拦下——本站的 is_forbidden 永远以管理员为准，不能被 IdP 反向覆盖。
			const self = await selfUpdate(
				{ uid, userid, corpId: profile.corpId, agentId: profile.agentId, permanentCode: profile.permanentCode },
				{ client, cache, store: deps },
			);
			if (self.blocked)
				throw Object.assign(new Error("账号在企业微信中已被停用或已退出企业，请联系企业管理员"), { status: 403 });

			// 票据而不是 token 进 URL：token 会留在浏览器历史/Referer/反代日志里
			const ticket = crypto.randomHex(32);
			const tenant = tenantOfCorp(profile.corpId);
			await issueLoginTicket(crypto.sha256Hex(ticket), uid, tenant, LOGIN_TICKET_TTL_SECS, deps);
			await noteLoginSucceeded(await clientIp(), profile.corpId);
			log.info("wecom login ok", "tenant", tenant, "agentId", profile.agentId);
			json.redirect.found(loginLandingUrl({ origin: siteRootOf(base), ticket, tenant }));
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
			const raw = String((http.body as { ticket?: string } | null)?.ticket ?? "");
			if (!raw)
				throw badRequest("缺少 ticket");
			// 换票只碰 DB 与会话：**不读部署凭据**——加解密在这条路径上用不到，而套件凭据没配好
			// 时把「已签发的票」判成登录失败，等于把配置事故伪装成票据失效（admin 的 status 同处理）。
			const storeDeps: WecomStoreDeps = { encrypt: () => "", decrypt: () => "", now: () => Math.floor(Date.now() / 1000) };
			const claimed = await claimLoginTicket(crypto.sha256Hex(raw), storeDeps);
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
	// 企微后台「保存回调 URL」时会 GET 一次：解出 echostr 后**原样明文回**（不套信封、不加引号）。
	//
	// 只依赖回调凭据（`callbackCreds()`）：token/aeskey 由部署方与企微后台成对填写，不需要 suite_id——
	// 因此「配齐即可响应验证」，**不必等代开发模版创建、拿到 suite_id 之后**。这正是打破鸡生蛋死锁
	// （plan §18）的落点：先有可验证的回调，才能创建模版、拿到 suite 凭据。
	//
	// 共存部署有**两套**回调凭据（代开发的指令回调 / 自建应用的通讯录同步回调），企微用哪一套签名
	// 取决于管理员在哪个后台点「保存」→ 逐个试签，命中哪套就用哪套钥匙解密。两套都没配才报错。
	//
	// URL 验证可能发生在拿到 suite_id 之前（创建表单内联校验），加上「应用回调 URL 验证时 receiveid
	// 是 corpid」这一层，GET 根本无从挑一个值来比 → 一律 tolerant，见下面 try 里的说明
	// （签名是唯一闸门，本端点不落状态）。
	async get() {
		try {
			const encrypted = query("echostr");
			const creds = matchCreds(encrypted);
			if (!creds)
				throw badRequest("回调签名校验失败");
			const claim = await guardReplay(query("timestamp"), query("nonce"), runtimeReplayGate());
			try {
				// receiveid 一律不比对：GET 只有 echostr、没有报文信封，无从知道该比哪一个——
				// 「模板/指令回调 URL」验证时 receiveid 是 suiteid，「应用回调 URL / 通讯录同步」验证时是 corpid。
				// 放宽是安全的：签名已过（token 只有本部署与企微知道），回包只是把解出的 echostr 原样返回，
				// 不写任何状态；真正的 receiveid 比对在 POST 那条路径上（见 unwrapAccepting）。
				plainText(unwrapWecomMessage(encrypted, creds.encodingAesKey, creds.receiver, true));
			}
			catch (e) {
				// 验证没通过就放回 nonce：企微后台点「保存」会连着验几次，占住会把后几次都挡成 400
				await claim.release();
				// 解密失败只透出「失败」：错钥/未下发套件/被篡改三者不可区分，也不该让外部据此判断哪一环配错
				noteDecryptFailure(e, null, creds);
				throw badRequest("回调消息解密失败");
			}
		}
		catch (e) {
			failWith(e);
		}
	},

	// 回调（指令 + 应用数据 + 通讯录同步）：验签 → 解密 → 按**命中凭据的来源**分发。
	// 回 `success` 才算收下，否则企微 5 秒后重推三次。
	//
	// 来源分派是共存的关键：suite 凭据只可能收到套件事件（suite_ticket / create_auth / change_auth /
	// cancel_auth）；corp 凭据只可能收到通讯录变更（企业管理员在「通讯录同步 → 接收事件服务器」填的本 URL），
	// **没有**套件事件这回事，所以直接进 change_contact 分支，不进 handleSuiteEvent 的 switch。
	//
	// 包体形态按官方文档是 XML（见 payload.ts 的开头），但归一化那一层两种都认，
	// 所以本函数只认字段名，不认格式。
	async post() {
		let claim: ReplayClaim | undefined;
		try {
			const envelope = callbackFields(http.body);
			const encrypted = field(envelope, "Encrypt");
			if (!encrypted)
				throw badRequest("回调报文缺少 Encrypt（不是企微回调，或中间件改写了请求体）");
			const verified = await decryptVerified(encrypted, envelope);
			claim = verified.claim;

			const client = createWecomClient({ http: runtimeHttp(), cache: runtimeCache() });
			if (verified.kind === "corp") {
				// 自建应用没有套件流程：报文只可能是 change_contact（其余形态由 contacts.ts 记账后放过）
				await handleContactChange(callbackFields(verified.plain), {
					client,
					store: runtimeStoreDeps(readBase()),
					credentialKind: "corp",
				});
			}
			else {
				const cfg = readSuiteConfig();
				await handleSuiteEvent(verified.plain, { cfg, client, store: runtimeStoreDeps(cfg) });
			}
			// 处理成功即标记 nonce 已落库：企微重推时命中即幂等回 success，解开「首推偏慢被企微判超时、
			// 重推又被重放守卫挡 400」的死局——管理员端不再卡在「应用安装失败」。
			await markApplied(query("nonce"), runtimeReplayGate()).catch(() => {});
			plainText("success");
		}
		catch (e) {
			// 重推且首推已成功落库：幂等回 success，管理员端不再卡在「应用安装失败」。
			if (e instanceof ReplayAlreadyApplied) {
				plainText("success");
				return;
			}
			// 处理失败必须放回 nonce：企微只在「拿不到 success」时重推，而那正是需要重推的时刻；
			// 占住不放，重推会被自己的重放守卫判成 400，瞬态故障的恢复路径当场断掉。
			await releaseClaim(claim);
			// 企微侧只会显示「应用安装失败，联系服务商」，原因一概不透露——这里是唯一能查到
			// 「哪一环拒了这条事件」的地方（缺这一行，这场失败在运维视角是零信息）。
			const err = e as Error & { status?: number };
			log.error("wecom event failed", "status", err.status ?? 500, "reason", err.message);
			// 失败必须让企微看到非 success：它重推三次，正好覆盖「suite_ticket 未到/上游抖」这类瞬态
			failWith(e);
		}
	},
};

export default { login, callback, ticket, event };
