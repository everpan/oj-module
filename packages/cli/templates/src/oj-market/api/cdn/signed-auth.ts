// 签名请求共享「验面」（上传端点与 market yank 端点同一鉴权序，勿各写一遍）。
// 独立成非入口文件：api.ts / cdn/api.ts 都是路由入口（oj S 规则：路由入口不可被模块内 import）。
//
// 顺序即计划钉死的 fail-fast 序：头 → 信任库（403，不消费 body）→ 限速（按 key_id）→
// registry_id（503）。验签（verifyCanonicalSig）由调用方在拿到 canonical 后执行——
// 上传端点的 canonical 依赖实收字节 sha256（body 后），yank 的 canonical 不依赖 body。

import { createTrustStore } from "#/_platform/_lifecycle/trust";
import { rateLimit } from "#/_platform/_shared/service/infra/rate";
import { readSiteVar } from "#/_platform/_shared/site-facade";

/** 上传/推送限速：每 key_id 每 60s 30 次（发布是低频操作；防凭证泄漏后被刷爆磁盘/库） */
export const UPLOAD_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export interface SignedAuthEnv {
	trustPath: string
	/** 本站点 registry 身份；缺省读 config vars.registry_id */
	registryId?: string
	configPath?: string
	verifyEd25519?: (publicKey: string, msg: string, sigBase64: string) => boolean
}

/** 带 status 的可读失败（respond 收口成 json.fail，D14/B5 同通道） */
function fail(status: number, msg: string): never {
	throw Object.assign(new Error(msg), { status });
}

/** 请求头读取（大小写不敏感——http.headers 键大小写随客户端，wecom/api.ts 同款） */
function headerOf(headers: Record<string, unknown>, name: string): string {
	const lower = name.toLowerCase();
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() === lower)
			return String(v).trim();
	}
	return "";
}

/**
 * 签名请求鉴权（pre-canonical）：返回签名身份三要素。错误口径：
 * 缺头 401（签名制不经账号口令）；key 不受信 403（附 trust add 指引）；限速 429；
 * registry_id 未配置 503（指向 vars.registry_id 设置项）。canonical 验签不在此——
 * 调用方持 canonical 后调 verifyCanonicalSig。
 */
export async function authenticateSignedKey(env: SignedAuthEnv, rateBucket: string): Promise<{ keyId: string, publicKey: string, registryId: string, signature: string }> {
	const headers = ((http as { headers?: Record<string, unknown> }).headers ?? {}) as Record<string, unknown>;
	const keyId = headerOf(headers, "x-ojm-key-id");
	const signature = headerOf(headers, "x-ojm-signature");
	if (keyId === "" || signature === "")
		fail(401, "缺 X-OJM-Key-Id / X-OJM-Signature 请求头——签名推送须经 ojm keygen --credential 兑换的发布身份（不经账号口令；403 指引的前提是手上已有 key_id）");
	const publicKey = await createTrustStore(env.trustPath).get(keyId);
	if (publicKey === null)
		fail(403, `发布 key「${keyId}」不在本站点信任库——请站点 superadmin 经市场信任确认（或 ojm trust add）入录后重试`);
	await rateLimit(`${rateBucket}:${keyId}`, UPLOAD_RATE_LIMIT.limit, UPLOAD_RATE_LIMIT.windowMs);
	const registryId = await resolveRegistryId(env);
	if (registryId === null)
		fail(503, "站点未配置 registry_id（签名 canonical 首段 = 站点身份，防跨站重放）：请在 config.yaml vars 增加 registry_id: <站点身份> 后重试");
	return { keyId, publicKey, registryId, signature };
}

/** canonical 验签（Ed25519；verifyEd25519 面注入优先，缺省 isolate 全局） */
export function verifyCanonicalSig(env: { verifyEd25519?: SignedAuthEnv["verifyEd25519"] }, publicKey: string, canonical: string, signature: string): boolean {
	return verifyEd25519Of({ verifyEd25519: env.verifyEd25519 })(publicKey, canonical, signature);
}

function verifyEd25519Of(env: { verifyEd25519?: SignedAuthEnv["verifyEd25519"] }): (publicKey: string, msg: string, sigBase64: string) => boolean {
	const g = globalThis as { crypto?: { verifyEd25519?: (pk: string, msg: string, sig: string) => boolean } };
	return env.verifyEd25519 ?? ((pk, msg, sig) => g.crypto!.verifyEd25519!(pk, msg, sig));
}

/**
 * registry_id 解析：注入优先，缺省 config 文件名无关的 vars 全局（oj 按真实加载配置文件注入），
 * 回落旧 readSiteVar（依赖硬编码 configPath，文件名非 config.yaml 时读不到）；俱缺 → null（调用方 503）
 */
async function resolveRegistryId(env: SignedAuthEnv): Promise<string | null> {
	if (env.registryId !== undefined)
		return env.registryId;
	// 优先 config 文件名无关的 vars 全局（`oj serve -c config-release.yaml` 之类任意命名也能读到）。
	const fromVars = (globalThis as { vars?: { get?: (k: string) => string | null } }).vars?.get?.("registry_id") ?? null;
	if (fromVars !== null)
		return fromVars;
	return await readSiteVar(env.configPath, "registry_id");
}
