// 企微代开发「服务商侧」部署常量（config `vars:` 段，不进 DB、不进 sys_setting）。
//
// 多租户动态性边界：**套件（suite）是部署级的**——一个部署 = 一个服务商账号下的一套代开发模板
// （suite_id/suite_secret/callback token/EncodingAESKey 全在这套模板的后台里）。
// 「哪个企业装了哪个应用」不写配置：企微 create_auth 回调推 AuthCode → 换 permanent_code →
// 落 wecom_app_profile，新增企业只需企业管理员扫码授权，**不改配置、不重启**。
// 同一企业两个应用（测试/正式）也无需改配置：profile 主键含 agent_id（D5）。
//
// 与 ldap 同口径：启用开关走 sys_setting（`wecom.enabled`），凭据走部署常量。

import { b64ToBytes } from "./crypt";

/**
 * 回调引导配置（Tier A）：echostr URL 验证 + 永久码落库加密所需的全部凭据。
 * 这四项**全部由部署方在本地生成**，与企业微信无关——所以可以在「创建代开发模版 / 拿到
 * suite_id」之前就配齐并启动服务、响应企微的 URL 验证。这是打破「先有 suite 还是先有回调」
 * 死锁的关键（见 plan §18）：鸡生蛋问题里，这四项属于「蛋还没孵出来前就能自己备齐的料」。
 */
export interface WecomCallbackConfig {
	/** 回调签名 token（企微后台「Token」） */
	token: string
	/** 回调加密密钥（43 字符 EncodingAESKey） */
	encodingAesKey: string
	/** AES-GCM 落库密钥（hex/base64，16 或 32 字节）：加密 permanent_code/secret */
	encKey: string
	/**
	 * 连接器基址（绝对地址，无尾斜杠），如 `https://site.example.com/api/auth/wecom`。
	 * 两个派生地址都由它拼出，避免「同一件事配两处、改一处漏一处」：
	 *   · 指令回调 URL = `<base>/event` → **原样填进企微后台**（须逐字一致，含协议与路径）
	 *   · 网页授权 redirect_uri = `<base>/callback`
	 */
	baseUrl: string
}

/**
 * 完整配置（Tier A + Tier B）：login/callback/create_auth 等 suite 流程额外需要
 * `suiteId` 与 `suiteSecret`——它们由企业微信在「代开发模版创建成功」后下发（模版详情页可见），
 * 缺失只影响 suite 流程，不影响回调 URL 验证（后者只需 Tier A）。
 */
export interface WecomConfig extends WecomCallbackConfig {
	/** 代开发应用模版 id（企微侧即 suite_id），也是回调明文里的 receiveid */
	suiteId: string
	suiteSecret: string
	/**
	 * 服务商 corpid（不是企业 corpid，是「服务商」自己的 corpid）。
	 * 代开发「生成授权链接」走 `get_customized_auth_url`，该接口只认 provider_access_token，
	 * 而 provider_access_token 由服务商 corpid + provider_secret 换得——与 suite 凭证不同源。
	 */
	providerId: string
	/** 服务商 provider_secret（在服务商后台「通用开发参数」页拿，别和 suite_secret 搞混） */
	providerSecret: string
}

// Tier A：部署方本地生成，创建模版前即可配齐（token / EncodingAESKey / 落库密钥 / 基址）。
const REQUIRED_CALLBACK: Array<[keyof WecomCallbackConfig, string]> = [
	["token", "wecom_callback_token"],
	["encodingAesKey", "wecom_encoding_aes_key"],
	["encKey", "wecom_enc_key"],
	["baseUrl", "wecom_base_url"],
];

// Tier B：suite 凭据，企业微信在「代开发模版创建成功」后下发（模版详情页可查）。
const REQUIRED_SUITE: Array<[keyof WecomConfig, string]> = [
	["suiteId", "wecom_suite_id"],
	["suiteSecret", "wecom_suite_secret"],
];

// Tier C：服务商凭证（provider_access_token 源）。**仅「生成授权链接」需要**，不影响
// login/callback/create_auth 等 suite 流程，故不进 readWecomConfig 的必填集合（readWecomConfig
// 被登录链路复用，缺 provider 凭证不该让登录 400）。createInstall 单独校验。
const REQUIRED_PROVIDER: Array<[keyof WecomConfig, string]> = [
	["providerId", "wecom_provider_id"],
	["providerSecret", "wecom_provider_secret"],
];

/** 一次性读出六处部署常量（未 trim 的尾斜杠在此归一） */
function readWecomVars(): WecomConfig {
	return {
		token: vars.get("wecom_callback_token") ?? "",
		encodingAesKey: vars.get("wecom_encoding_aes_key") ?? "",
		encKey: vars.get("wecom_enc_key") ?? "",
		baseUrl: (vars.get("wecom_base_url") ?? "").replace(/\/+$/, ""),
		suiteId: vars.get("wecom_suite_id") ?? "",
		suiteSecret: vars.get("wecom_suite_secret") ?? "",
		providerId: vars.get("wecom_provider_id") ?? "",
		providerSecret: vars.get("wecom_provider_secret") ?? "",
	};
}

/**
 * 落库密钥格式校验（fail-fast 在**读配置**处，而不是等 create_auth 时在 crypto 里炸）：
 * oj 的 aesGcmEncrypt 只收「16 或 32 字节的 hex/base64」，AES-192（24 字节）明确不支持。
 * 最常见的配置事故是把 32 个「随意字符」当密钥——它按 base64 解出 24 字节，加密时才报错，
 * 而那时已经是企业授权回调，排查成本最高。
 */
export function assertEncKey(encKey: string): void {
	const hex = /^[0-9a-f]+$/i.test(encKey) && [32, 64].includes(encKey.length);
	let ok = hex;
	if (!ok) {
		try {
			ok = [16, 32].includes(b64ToBytes(encKey).length);
		}
		catch {
			ok = false;
		}
	}
	if (!ok)
		throw Object.assign(new Error("企业微信配置错误：wecom_enc_key 必须是 16 或 32 字节的 hex（32/64 字符）或 base64"), { status: 400 });
}

/**
 * 校验服务商凭证（生成授权链接必需）。缺任一即 400 并点名缺哪两项——
 * 区分于 suite 凭证：那是「模版创建后下发」，provider 凭证是「服务商后台通用开发参数」里拿的。
 */
export function assertProviderConfig(cfg: WecomConfig): void {
	const missing = REQUIRED_PROVIDER.filter(([field]) => !cfg[field]).map(([, name]) => name);
	if (missing.length)
		throw Object.assign(new Error(`企业微信未配置：生成授权链接需要 ${missing.join(" / ")}（服务商后台「通用开发参数」页获取，与 suite 凭证不同源）`), { status: 400 });
}

/**
 * 读 Tier A 凭据（token / aeskey / encKey / baseUrl）。**不依赖 suite 凭据**：这是 echostr
 * URL 验证与永久码落库加密所需的全部东西，部署方本地即可生成。引导期（suite_id 尚未下发）
 * 服务也能靠它启动并响应企微的回调验证（plan §18）。
 */
export function readCallbackConfig(): WecomCallbackConfig {
	const v = readWecomVars();
	const missing = REQUIRED_CALLBACK.filter(([field]) => !v[field]).map(([, name]) => name);
	if (missing.length)
		throw Object.assign(new Error(`企业微信未配置：config vars 缺少 ${missing.join(" / ")}`), { status: 400 });
	if (!/^https?:\/\//.test(v.baseUrl))
		throw Object.assign(new Error("企业微信配置错误：wecom_base_url 必须是绝对地址（企微回调与 redirect_uri 都要求）"), { status: 400 });
	assertEncKey(v.encKey);
	return { token: v.token, encodingAesKey: v.encodingAesKey, encKey: v.encKey, baseUrl: v.baseUrl };
}

/**
 * 读完整部署常量。缺任一必需项即 400（「未配置」是运维事实，不是服务端缺陷）。
 * 一次报全 Tier A + Tier B 所有缺失项，省掉逐轮补配置的往返；suite 凭据（Tier B）缺失时
 * 文案点明「由代开发模版创建成功后下发」，避免运维误以为是本地漏配。
 *
 * 注：Tier B 缺失只影响 login/callback/create_auth 等 suite 流程；echostr 验证走
 * `readCallbackConfig()`，不受此约束（见 api.ts::event.get）。
 */
export function readWecomConfig(): WecomConfig {
	const v = readWecomVars();
	const missing = [...REQUIRED_CALLBACK, ...REQUIRED_SUITE].filter(([field]) => !v[field]).map(([, name]) => name);
	if (missing.length)
		throw Object.assign(new Error(`企业微信未配置：config vars 缺少 ${missing.join(" / ")}（suite 凭据由代开发模版创建成功后下发）`), { status: 400 });
	if (!/^https?:\/\//.test(v.baseUrl))
		throw Object.assign(new Error("企业微信配置错误：wecom_base_url 必须是绝对地址（企微回调与 redirect_uri 都要求）"), { status: 400 });
	assertEncKey(v.encKey);
	return v;
}

/** 企微后台「指令回调 URL」：原样填这个（base + /event） */
export function eventUrlOf(cfg: WecomConfig): string {
	return `${cfg.baseUrl}/event`;
}

/** 网页授权 redirect_uri（base + /callback） */
export function loginRedirectOf(cfg: WecomConfig): string {
	return `${cfg.baseUrl}/callback`;
}

/** 连接器在站点里的固定挂载后缀（模块 apiPrefix `/auth` + 平台 API 前缀 `/api`）：`siteRootOf` 靠它剥离 */
const CONNECTOR_SUFFIX = "/api/auth/wecom";

/**
 * 站点根（origin + 子路径前缀，无尾斜杠）：302 回跳落到 SPA 时用。
 *
 * 不能只取 origin：子路径部署（oj `mounts: [{ prefix: /oj }]`）时 SPA 的登录页在 `/oj/login`，
 * 回跳到 `/login` 会打到宿主机根的别的应用（或 404）。前缀不另配一个变量——它就等于
 * `wecom_base_url` 去掉本连接器的固定后缀，配一处即可，且不匹配时**报错**而不是猜。
 */
export function siteRootOf(cfg: WecomConfig): string {
	const url = new URL(cfg.baseUrl);
	const path = url.pathname.replace(/\/+$/, "");
	if (!path.endsWith(CONNECTOR_SUFFIX))
		throw Object.assign(new Error(`企业微信配置错误：wecom_base_url 必须以 ${CONNECTOR_SUFFIX} 结尾（如 https://site.example.com/oj${CONNECTOR_SUFFIX}）`), { status: 400 });
	return `${url.origin}${path.slice(0, -CONNECTOR_SUFFIX.length)}`;
}

/** 登录方式发现用：只看开关，不读凭据（登录页要先知道「有没有这个方式」） */
export async function wecomEnabled(): Promise<boolean> {
	const rows = await db.table("sys_setting").select(["value"]).where({ field: "key", op: "eq", value: "wecom.enabled" }).all() as Array<{ value: string | null }>;
	return rows[0]?.value === "1";
}
