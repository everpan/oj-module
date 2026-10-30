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

export interface WecomConfig {
	/** 代开发应用模版 id（企微侧即 suite_id），也是回调明文里的 receiveid */
	suiteId: string
	suiteSecret: string
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

const REQUIRED: Array<[keyof WecomConfig, string]> = [
	["suiteId", "wecom_suite_id"],
	["suiteSecret", "wecom_suite_secret"],
	["token", "wecom_callback_token"],
	["encodingAesKey", "wecom_encoding_aes_key"],
	["encKey", "wecom_enc_key"],
	["baseUrl", "wecom_base_url"],
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

/**
 * 读部署常量。缺任一必需项即 400（「未配置」是运维事实，不是服务端缺陷）：
 * 前半段（suite 凭据）缺失 → 企微登录整体不可用；encKey 缺失则 permanent_code 无法安全落库，
 * 宁可拒服务，也不退化成明文存储（§7.5 数据合规红线）。
 */
export function readWecomConfig(): WecomConfig {
	const cfg: WecomConfig = {
		suiteId: vars.get("wecom_suite_id") ?? "",
		suiteSecret: vars.get("wecom_suite_secret") ?? "",
		token: vars.get("wecom_callback_token") ?? "",
		encodingAesKey: vars.get("wecom_encoding_aes_key") ?? "",
		encKey: vars.get("wecom_enc_key") ?? "",
		baseUrl: (vars.get("wecom_base_url") ?? "").replace(/\/+$/, ""),
	};
	const missing = REQUIRED.filter(([field]) => !cfg[field]).map(([, name]) => name);
	if (missing.length)
		throw Object.assign(new Error(`企业微信未配置：config vars 缺少 ${missing.join(" / ")}`), { status: 400 });
	if (!/^https?:\/\//.test(cfg.baseUrl))
		throw Object.assign(new Error("企业微信配置错误：wecom_base_url 必须是绝对地址（企微回调与 redirect_uri 都要求）"), { status: 400 });
	assertEncKey(cfg.encKey);
	return cfg;
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

/**
 * 代开发「开通入口」：企业管理员点开 → 企微授权安装页。
 * `redirect_uri` 落在站点根下的登录页（安装完回站点，指令回调已把 profile 落好）。
 */
export function installUrlOf(cfg: WecomConfig, preAuthCode: string, state: string): string {
	const redirect = `${siteRootOf(cfg)}/login?wecom_installed=1`;
	const q = new URLSearchParams({
		suite_id: cfg.suiteId,
		pre_auth_code: preAuthCode,
		redirect_uri: redirect,
	});
	if (state)
		q.set("state", state);
	return `https://open.work.weixin.qq.com/3rdapp/install?${q.toString()}`;
}

/** 登录方式发现用：只看开关，不读凭据（登录页要先知道「有没有这个方式」） */
export async function wecomEnabled(): Promise<boolean> {
	const rows = await db.table("sys_setting").select(["value"]).where({ field: "key", op: "eq", value: "wecom.enabled" }).all() as Array<{ value: string | null }>;
	return rows[0]?.value === "1";
}
