// 企微连接器的部署常量（config `vars:` 段，不进 DB、不进 sys_setting）。
//
// **两种应用来源，可同时启用**（docs/plans/20261101-2044-wecom-internal-app-plan.md §4.10）：
//   · suite（代开发）：一个部署 = 一个服务商账号下的一套代开发模板。凭据是 suite_id/suite_secret，
//     「哪个企业装了哪个应用」不写配置：create_auth 回调推 AuthCode → 换 permanent_code →
//     落 wecom_app_profile，新增企业只需扫码授权，**不改配置、不重启**。
//   · corp（企业内部应用 / 自建应用）：一套部署 = 一家企业，凭据是 corpid + 应用 Secret + AgentId。
//     没有套件流程，也没有开通链接；档案行由后台「验证并接入」写入。
//
// 两套的来源不同但**企业侧数据链路完全相同**：代开发的 permanent_code 就是当 corpsecret 用的，
// 所以下面凡是「拿企业 token / 读通讯录 / 换 userid」的代码都只有一份实现。
//
// 回声（业务上最容易混）：
//   · `wecom_callback_token` / `wecom_encoding_aes_key` = 代开发**指令回调**那一组（服务商后台填）；
//   · `wecom_corp_callback_token` / `wecom_corp_encoding_aes_key` = 自建应用**通讯录同步 → 接收事件服务器**
//     那一组（企业管理员在自己后台填）。两组不同源，不能互相顶替。
//
// 与 ldap 同口径：启用开关走 sys_setting（`wecom.enabled`），凭据走部署常量。

import { b64ToBytes } from "./crypt";

/** 应用来源：代开发（套件） / 企业内部应用（自建） */
export type WecomKind = "suite" | "corp";

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
	/** AES-GCM 落库密钥（hex/base64，16 或 32 字节）：加密永久码 / 应用 Secret */
	encKey: string
	/**
	 * 连接器基址（绝对地址，无尾斜杠），如 `https://site.example.com/api/auth/wecom`。
	 * 两个派生地址都由它拼出，避免「同一件事配两处、改一处漏一处」：
	 *   · 回调 URL = `<base>/event` → **原样填进企微后台**（须逐字一致，含协议与路径）
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

/**
 * 企业内部应用（自建应用）的部署常量。
 *
 * 一套部署只服务一家企业——这是产品定位而非技术妥协：凭据是「企业 × 应用」维度的，
 * 进配置就意味着单企业；多企业共用一套部署的需求由代开发承担（扫码即装）。
 */
export interface WecomCorpConfig {
	/** 企业 ID（企微后台「我的企业 → 企业信息 → 企业ID」），同时是租户键 */
	corpId: string
	/** 应用 Secret（应用详情页）——换过必须重新走「验证并接入」 */
	corpSecret: string
	/** 应用 AgentId（应用详情页） */
	agentId: string
	/** 通讯录同步「接收事件服务器」的 Token（不配 = 不做事件增量） */
	callbackToken: string
	/** 同上 → EncodingAESKey */
	encodingAesKey: string
	encKey: string
	baseUrl: string
}

/** 与来源无关的两项：登录/同步/回跳都只需要它们 */
export interface WecomBase {
	encKey: string
	baseUrl: string
}

/** 一次性读出全部部署常量（未 trim 的尾斜杠在此归一） */
function readWecomVars() {
	return {
		token: vars.get("wecom_callback_token") ?? "",
		encodingAesKey: vars.get("wecom_encoding_aes_key") ?? "",
		encKey: vars.get("wecom_enc_key") ?? "",
		baseUrl: (vars.get("wecom_base_url") ?? "").replace(/\/+$/, ""),
		suiteId: vars.get("wecom_suite_id") ?? "",
		suiteSecret: vars.get("wecom_suite_secret") ?? "",
		providerId: vars.get("wecom_provider_id") ?? "",
		providerSecret: vars.get("wecom_provider_secret") ?? "",
		corpId: vars.get("wecom_corp_id") ?? "",
		corpSecret: vars.get("wecom_corp_secret") ?? "",
		agentId: vars.get("wecom_corp_agent_id") ?? "",
		corpCallbackToken: vars.get("wecom_corp_callback_token") ?? "",
		corpEncodingAesKey: vars.get("wecom_corp_encoding_aes_key") ?? "",
		allowCoexist: vars.get("wecom_allow_coexist") ?? "",
	};
}

type WecomVars = ReturnType<typeof readWecomVars>;

/** 与来源无关的两项：登录 / 回跳 / 同步 / 回调验签之外的一切路径都只认它 */
const REQUIRED_BASE: Array<[keyof WecomBase, string]> = [
	["encKey", "wecom_enc_key"],
	["baseUrl", "wecom_base_url"],
];

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
// login/callback/create_auth 等 suite 流程，故不进 readSuiteConfig 的必填集合（readSuiteConfig
// 被登录链路复用，缺 provider 凭证不该让登录 400）。createInstall 单独校验。
const REQUIRED_PROVIDER: Array<[keyof WecomConfig, string]> = [
	["providerId", "wecom_provider_id"],
	["providerSecret", "wecom_provider_secret"],
];

// 自建应用：三项缺一不可（Secret 换 token，AgentId 既进授权 URL 也进 token 缓存键）。
// 类型按「变量名」而不是按配置接口来标：`WecomCorpConfig.encodingAesKey` 是**自建应用回调**那把，
// 而变量里同名字段 `wecom_encoding_aes_key` 是**代开发**那把——按接口标会在这两者之间打错。
const REQUIRED_CORP: Array<[keyof WecomVars, string]> = [
	["corpId", "wecom_corp_id"],
	["corpSecret", "wecom_corp_secret"],
	["agentId", "wecom_corp_agent_id"],
];

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

/** 缺项文案：一次报全，省掉逐轮补配置的往返 */
function missingError(names: string[], hint: string): Error {
	return Object.assign(new Error(`企业微信未配置：config vars 缺少 ${names.join(" / ")}${hint}`), { status: 400 });
}

function assertBaseUrl(baseUrl: string): void {
	if (!/^https?:\/\//.test(baseUrl))
		throw Object.assign(new Error("企业微信配置错误：wecom_base_url 必须是绝对地址（企微回调与 redirect_uri 都要求）"), { status: 400 });
}

/**
 * 读与来源无关的两项（落库密钥 + 基址）。
 *
 * 登录 / 302 回跳 / 同步只用到这两项，**不该要求 suite 或 corp 的凭据**——这正是两种来源
 * 能共存的前提：否则自建应用的部署会在「读 wecom_suite_id」处直接 400。
 */
export function readBase(): WecomBase {
	const v = readWecomVars();
	const missing = REQUIRED_BASE.filter(([field]) => !v[field]).map(([, name]) => name);
	if (missing.length)
		throw missingError(missing, "");
	assertBaseUrl(v.baseUrl);
	assertEncKey(v.encKey);
	return { encKey: v.encKey, baseUrl: v.baseUrl };
}

/**
 * 读 Tier A 凭据（**代开发**的回调 token / aeskey / 落库密钥 / 基址）。**不依赖 suite 凭据**：
 * 这是 echostr URL 验证与永久码落库加密所需的全部东西，部署方本地即可生成。引导期（suite_id
 * 尚未下发）服务也能靠它启动并响应企微的回调验证（plan §18）。
 *
 * 缺项校验**不复用 readBase**：那样只会报出最先撞上的那一项，运维得逐轮补配置
 * （「缺项一次报全」是这套配置体系的既有纪律）。
 */
export function readCallbackConfig(): WecomCallbackConfig {
	const v = readWecomVars();
	const missing = REQUIRED_CALLBACK.filter(([field]) => !v[field]).map(([, name]) => name);
	if (missing.length)
		throw missingError(missing, "");
	assertBaseUrl(v.baseUrl);
	assertEncKey(v.encKey);
	return { token: v.token, encodingAesKey: v.encodingAesKey, encKey: v.encKey, baseUrl: v.baseUrl };
}

/**
 * 读完整 suite 配置（代开发）。缺任一必需项即 400（「未配置」是运维事实，不是服务端缺陷）。
 * 一次报全 Tier A + Tier B 所有缺失项；suite 凭据（Tier B）缺失时文案点明「由代开发模版创建成功后
 * 下发」，避免运维误以为是本地漏配。
 *
 * 注：Tier B 缺失只影响 login/callback/create_auth 等 suite 流程；echostr 验证走
 * `readCallbackConfig()`，不受此约束。
 */
export function readSuiteConfig(): WecomConfig {
	const v = readWecomVars();
	const missing = [...REQUIRED_CALLBACK, ...REQUIRED_SUITE].filter(([field]) => !v[field]).map(([, name]) => name);
	if (missing.length)
		throw missingError(missing, "（suite 凭据由代开发模版创建成功后下发）");
	assertBaseUrl(v.baseUrl);
	assertEncKey(v.encKey);
	return {
		token: v.token,
		encodingAesKey: v.encodingAesKey,
		encKey: v.encKey,
		baseUrl: v.baseUrl,
		suiteId: v.suiteId,
		suiteSecret: v.suiteSecret,
		providerId: v.providerId,
		providerSecret: v.providerSecret,
	};
}

/**
 * 读自建应用配置。回调那两项**不在必填集合**：不配只是没有事件增量，
 * 全量同步与登录照样能用（见 contacts 的「加速器不是权威」定位）。
 */
export function readCorpConfig(): WecomCorpConfig {
	const v = readWecomVars();
	const missing = REQUIRED_CORP.filter(([field]) => !v[field]).map(([, name]) => name);
	if (missing.length)
		throw missingError(missing, "（自建应用：企业ID / 应用Secret / AgentId，均在企微管理后台取）");
	assertBaseUrl(v.baseUrl);
	assertEncKey(v.encKey);
	return {
		corpId: v.corpId,
		corpSecret: v.corpSecret,
		agentId: v.agentId,
		callbackToken: v.corpCallbackToken,
		encodingAesKey: v.corpEncodingAesKey,
		encKey: v.encKey,
		baseUrl: v.baseUrl,
	};
}

/** 是否显式允许两种来源同时生效 */
function coexistAllowed(v: WecomVars): boolean {
	return /^(?:1|true|yes)$/i.test(v.allowCoexist.trim());
}

/**
 * 只看「哪套凭据填齐了」，**不做共存校验、不抛错**。
 * 后台页要能展示「配了什么、还差什么」——配置事故恰恰是最需要它显示清楚的时刻。
 */
export function configuredKinds(): WecomKind[] {
	const v = readWecomVars();
	const kinds: WecomKind[] = [];
	if (v.suiteId && v.suiteSecret)
		kinds.push("suite");
	if (v.corpId && v.corpSecret && v.agentId)
		kinds.push("corp");
	return kinds;
}

/** 本部署自建应用的三项（后台页展示用；未配齐时为 null） */
export function corpIdentity(): { corpId: string, agentId: string, hasCallback: boolean } | null {
	const v = readWecomVars();
	if (!v.corpId || !v.corpSecret || !v.agentId)
		return null;
	return { corpId: v.corpId, agentId: v.agentId, hasCallback: Boolean(v.corpCallbackToken && v.corpEncodingAesKey) };
}

/**
 * 本部署已配置的**来源**（凭据齐 = 启用）。这是唯一判定口径，不另设 `wecom_mode`：
 * 「变量填了没有」是客观事实，不会与运行期实际能力漂移。
 *
 * 两种来源都配齐时必须显式 `wecom_allow_coexist: 'true'`——否则 fail-fast。这条不是洁癖：
 * 两套凭据同时生效会让回调验签多一次尝试、档案里多一类行，配置事故（比如从代开发迁到自建
 * 却忘了清旧变量）应当被看见，而不是被静默择一。
 */
export function wecomKinds(): WecomKind[] {
	const v = readWecomVars();
	const kinds = configuredKinds();
	if (kinds.length === 0) {
		throw missingError(
			["wecom_suite_id / wecom_suite_secret", "wecom_corp_id / wecom_corp_secret / wecom_corp_agent_id"],
			"（二选一：代开发填 suite 两项，企业内部应用填 corp 三项）",
		);
	}
	if (kinds.length > 1 && !coexistAllowed(v))
		throw missingError(["wecom_allow_coexist: 'true'"], "（检测到代开发与自建应用两套凭据同时配置；确认要共存请显式开启）");
	return kinds;
}

/** 一套可用于回调验签的凭据。`receiver` 是明文里的 receiveid（suite=suite_id，corp=corpid） */
export interface CallbackCreds {
	kind: WecomKind
	token: string
	encodingAesKey: string
	receiver: string
}

/**
 * 列出可用于回调验签的凭据，**按代开发优先**（存量部署行为不变）。
 *
 * 两套的 Token/EncodingAESKey 不同源，而验签必须发生在解密之前——所以入口只能逐个试签
 * （SHA1 一次，成本可忽略），用命中的那把钥匙解密。这比给两种来源各开一条路由更省：
 * 少一个端点、少一份重复的「验签→重放→解密」接线，且回调地址只有 `/event` 一个。
 *
 * **刻意不经过 `wecomKinds()`**：这里列的是「回调钥匙」，不是「启用了哪几种来源」。两者在引导期
 * 不重合——代开发模版还没建、`suite_id`/`suite_secret` 一项未填，但 Token/EncodingAESKey 已经能填，
 * 企微正在该 URL 上做保存校验。要是按来源过滤，验证立刻 400，死锁（plan §18）就又回来了。
 * 所以判据只有一条：**这一组的 token 与 aeskey 是否都填了**。
 *
 * 共存守卫单独做：只有**两套身份凭据都齐**（`configuredKinds().length > 1`）才算配置事故，
 * 引导期的「只有回调钥匙」不算。
 */
export function callbackCreds(): CallbackCreds[] {
	const v = readWecomVars();
	if (configuredKinds().length > 1 && !coexistAllowed(v))
		throw missingError(["wecom_allow_coexist: 'true'"], "（检测到代开发与自建应用两套凭据同时配置；确认要共存请显式开启）");
	const list: CallbackCreds[] = [];
	if (v.token && v.encodingAesKey)
		list.push({ kind: "suite", token: v.token, encodingAesKey: v.encodingAesKey, receiver: v.suiteId });
	if (v.corpCallbackToken && v.corpEncodingAesKey)
		list.push({ kind: "corp", token: v.corpCallbackToken, encodingAesKey: v.corpEncodingAesKey, receiver: v.corpId });
	if (list.length === 0) {
		throw missingError(
			["wecom_callback_token / wecom_encoding_aes_key", "wecom_corp_callback_token / wecom_corp_encoding_aes_key"],
			"（回调验签凭据一组都没配；自建应用填「通讯录同步 → 接收事件服务器」那一组）",
		);
	}
	return list;
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
 * 企微后台「指令回调 URL / 通讯录同步接收事件服务器」：原样填这个（base + `/event`）。
 *
 * **不带 `?callback_format=json`**——查过官方文档才这么定的：该参数只在「对外收款」的指令回调
 * 文档（97478）里有说明，而代开发 / 第三方应用所属的**通用回调配置**（96238 §3.2）至今只写
 * XML 外层信封（`<ToUserName><AgentID><Encrypt>`），全文没有这个参数；「部门通知事件」（92655）
 * 虽给了 JSON 示例，但示例地址同样不带它，也没说怎么切过去。
 *
 * 也就是说：给我们这类回调加上它，是**文档未覆盖**的行为。省下的只是服务端一次正则，
 * 代价却是把「企业管理员扫码能否装成功」押在上游实现上。服务端两种包体都认（payload.ts），
 * 上游哪天默认改 JSON 也不用动这里。
 */
export function eventUrlOf(cfg: { baseUrl: string }): string {
	return `${cfg.baseUrl}/event`;
}

/** 网页授权 redirect_uri（base + /callback） */
export function loginRedirectOf(cfg: { baseUrl: string }): string {
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
export function siteRootOf(cfg: { baseUrl: string }): string {
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
