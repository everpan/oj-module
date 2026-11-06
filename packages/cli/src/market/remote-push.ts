/**
 * 市场远端推送（A6，计划 v4 §五）：`ojm market publish` 缺省链路。
 *
 * 远端 = oj 模板站点（纯站点无 ojm CLI）：签名制推送（不经账号口令；企微用户无障碍）——
 * X-OJM-Key-Id / X-OJM-Signature 头 + 站点信任库 + Ed25519，canonical 由**站点**从实收字节
 * 重算 sha256 重构（`cdn-upload:<站点 registry_id>:<file>:<sha256>`）——换字节即 401。
 *
 * 顺序（pair 约束，钉死）：先推 `.sig` 旁车再推 `.tgz`——服务端 tgz 未配对不入库（409）。
 * 半成功（sig 已推、tgz 被拒）：报错文案带「重跑本命令幂等补齐」——同字节重传幂等（服务端
 * 查库仲裁），无人工清场负担。退出码 1 由命令层置（本库以抛错表达失败）。
 *
 * 站点身份发现：推送前先 GET catalog（匿名）——响应顶层 registry_id（A6 新增发现面）；
 * 同请求兼作 2×2 兼容矩阵探测：旧站点无 catalog API → 404 → 「站点版本过旧」人话。
 */

import type { MarketPublishOptions } from "./publish";
import { createHash } from "node:crypto";

import process from "node:process";
import { signCanonical } from "../lifecycle/sign";
import { unwrapEnvelope } from "../site";
import { buildSignedPackage, resolveSigningIdentity } from "./publish";

/** 站点目录探测结果（catalog 响应顶层字段） */
export interface MarketDiscovery {
	apiVersion: string | null
	/** 站点身份（= 上传/yank canonical 首段）；缺失在发现期即人话拒，故此后恒非空 */
	registryId: string
}

/** 去掉尾斜杠的站点基址（env 回落与 resolveSite 同序：flag > OJM_SITE_URL） */
export function resolvePushTarget(siteUrl?: string): string {
	const base = (siteUrl ?? process.env.OJM_SITE_URL ?? "").replace(/\/+$/, "");
	if (base === "")
		throw new Error("[ojm] 远端发布须指定目标站点：--site-url <https://your-site>（或环境变量 OJM_SITE_URL）");
	return base;
}

/**
 * GET /api/oj-market/catalog 探测（page=1&size=1 最小请求）：发现 registry_id +
 * 旧站点人话分流（404 → 「站点版本过旧」+ 迁移指向；网络层失败 → 人话不抛原生错）。
 */
export async function discoverMarket(fetchFn: typeof fetch, base: string): Promise<MarketDiscovery> {
	let res: Response;
	try {
		res = await fetchFn(`${base}/api/oj-market/catalog?page=1&size=1`, { method: "GET" });
	}
	catch (error) {
		throw new Error(`[ojm] 连不上站点 ${base}（${(error as Error).message}）——核对 --site-url / 网络后重试`);
	}
	if (res.status === 404)
		throw new Error(`[ojm] 站点 ${base} 版本过旧（无 /api/oj-market/catalog 目录 API）——目标站点须先升级到 DB 目录版本；迁移指南见 docs/migration/ 市场远程发布篇`);
	if (!res.ok)
		throw new Error(`[ojm] 站点目录探测被拒（HTTP ${res.status}）——匿名可读端点不应要求凭据，核对站点配置`);
	const raw = await res.json() as { code?: number, data?: unknown };
	// 站点统一信封 {code,msg,data}（AC-D16）；匿名读端点 code!==0 时按无目录处理
	if (typeof raw.code === "number" && raw.code !== 0)
		throw new Error(`[ojm] 站点目录探测失败（code=${raw.code}）——目标站点须为 DB 目录版本；迁移指南见 docs/migration/ 市场远程发布篇`);
	const body = (typeof raw.code === "number" ? raw.data : raw) as { api_version?: unknown, registry_id?: unknown };
	const registryId = typeof body.registry_id === "string" && body.registry_id !== "" ? body.registry_id : null;
	if (registryId === null)
		throw new Error(`[ojm] 站点 ${base} 未配置 registry_id（签名推送 canonical 首段 = 站点身份）——请站点管理员在 config.yaml vars 增加 registry_id 后重试`);
	return { apiVersion: typeof body.api_version === "string" ? body.api_version : null, registryId };
}

/** 推送失败：带阶段（sig/tgz）与 HTTP 语义的人话错（命令层据此置 exitCode 1） */
export class RemotePushError extends Error {
	constructor(
		public readonly stage: "sig" | "tgz",
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "RemotePushError";
	}
}

/**
 * 单文件签名推送：canonical `cdn-upload:<站点 registry_id>:<文件名>:<实收字节 sha256>`
 * 由发布方私钥签名（与服务端重算口径逐字一致——本函数按同一公式构造）。
 */
async function pushSignedFile(
	fetchFn: typeof fetch,
	base: string,
	registryId: string,
	fileName: string,
	bytes: Uint8Array,
	keyId: string,
	privateKeyPem: string,
): Promise<unknown> {
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const signature = signCanonical(privateKeyPem, `cdn-upload:${registryId}:${fileName}:${sha256}`);
	const form = new FormData();
	form.append("file", new Blob([bytes.slice()]), fileName);
	const res = await fetchFn(`${base}/api/oj-market/cdn/upload?name=${encodeURIComponent(fileName)}`, {
		method: "POST",
		headers: { "x-ojm-key-id": keyId, "x-ojm-signature": signature },
		body: form,
	});
	// unwrapEnvelope 的人话已含服务端指引（403 附 trust add、409 附升 version 指引）；
	// 这里包阶段上下文 + 下一步（错误文案数据表面）
	const text = await res.text();
	let env: { code?: number, msg?: string } | null = null;
	try {
		env = JSON.parse(text) as { code?: number, msg?: string };
	}
	catch {}
	const status = typeof env?.code === "number" && env.code !== 0 ? res.status : res.status;
	if (!res.ok || (typeof env?.code === "number" && env.code !== 0)) {
		const msg = env?.msg ?? text.slice(0, 200);
		throw new RemotePushError(fileName.endsWith(".sig") ? "sig" : "tgz", status, `[ojm] 推送 ${fileName} 被拒（HTTP ${res.status}）：${msg}`);
	}
	return env?.code === 0 ? (env as { data?: unknown }).data : env;
}

export interface RemotePublishOptions extends MarketPublishOptions {
	/** 目标站点基址（缺省 OJM_SITE_URL；无则人话报错——不猜默认站点） */
	siteUrl?: string
	/** 测试注入 fetch；缺省全局 fetch */
	fetchFn?: typeof fetch
	/** 日志旁路（测试收集用） */
	onLog?: (line: string) => void
}

export interface RemotePublishResult {
	name: string
	version: string
	sha256: string
	size: number
	keyId: string
	fingerprint: string
	/** 站点身份（= 上传 canonical 首段） */
	registryId: string
	siteUrl: string
}

/**
 * 远端发布主链：构建 + 包级签名（buildSignedPackage）→ catalog 探测（registry_id）→
 * sig→tgz 顺序推送。半成功（sig 成 tgz 败）时错误文案追加「重跑本命令幂等补齐」。
 */
export async function remotePublish(opts: RemotePublishOptions = {}): Promise<RemotePublishResult> {
	const log = opts.onLog ?? ((line: string) => console.log(line));
	const base = resolvePushTarget(opts.siteUrl);
	const fetchFn = opts.fetchFn ?? fetch;

	log(`[ojm] 远端发布目标 ${base}：构建发布包…`);
	const built = await buildSignedPackage(opts);
	log(`[ojm] 包已构建并签名：${built.name}@${built.version}（${built.size} 字节，发布方 ${built.keyId}）`);

	const discovery = await discoverMarket(fetchFn, base);
	log(`[ojm] 站点目录就绪（api_version ${discovery.apiVersion ?? "?"}，registry_id ${discovery.registryId}）——先推 .sig 旁车`);

	let sigPushed = false;
	try {
		await pushSignedFile(fetchFn, base, discovery.registryId, `${built.name}-${built.version}.tgz.sig`, built.sigBytes, built.keyId, built.privateKeyPem);
		sigPushed = true;
		log(`[ojm] .sig 旁车已推送（key_id ${built.keyId}）`);
		await pushSignedFile(fetchFn, base, discovery.registryId, `${built.name}-${built.version}.tgz`, built.tgzBytes, built.keyId, built.privateKeyPem);
	}
	catch (error) {
		// 半成功：sig 已落、tgz 未至——服务端 pair 约束下重跑本命令同字节幂等补齐，无清场负担
		if (sigPushed && error instanceof RemotePushError && error.stage === "tgz")
			throw new RemotePushError(error.stage, error.status, `${error.message}\n[ojm] .sig 旁车已推送成功——重跑本命令幂等补齐（同字节重传幂等，pair 自动完成）`);
		throw error;
	}
	log(`[ojm] 发布完成：${built.name}@${built.version} 已进 ${base} 市场目录（DB 目录行 + cdn/ 字节）`);

	return {
		name: built.name,
		version: built.version,
		sha256: built.sha256,
		size: built.size,
		keyId: built.keyId,
		fingerprint: built.fingerprint,
		registryId: discovery.registryId,
		siteUrl: base,
	};
}

export interface RemoteYankOptions {
	/** 目标站点基址（缺省 OJM_SITE_URL） */
	siteUrl?: string
	/** 方案名（product） */
	name: string
	/** 版本 */
	version: string
	/** 恢复（unyank）；缺省 = 下线 */
	restore?: boolean
	/** 下线原因（审计留痕；可选） */
	reason?: string
	/** 操作人（审计留痕；缺省由站点记 key_id） */
	by?: string
	id?: string
	key?: string
	privateKeyPem?: string
	/** 测试注入 fetch；缺省全局 fetch */
	fetchFn?: typeof fetch
}

export interface RemoteYankResult {
	product: string
	version: string
	yanked: boolean
	idempotent: boolean
}

/**
 * 远端 yank（计划 v4 §五）：POST /api/oj-market/yank，canonical
 * `market-yank:<站点 registry_id>:<product>:<version>`（无内容哈希——重放退化为幂等，
 * 与服务端口径一致）。仅发布者本人可下线/恢复（服务端按行 key_id 授权，不符 403）。
 */
export async function remoteYank(opts: RemoteYankOptions): Promise<RemoteYankResult> {
	const base = resolvePushTarget(opts.siteUrl);
	const fetchFn = opts.fetchFn ?? fetch;
	const discovery = await discoverMarket(fetchFn, base);
	const { keyId, privateKeyPem } = resolveSigningIdentity({ id: opts.id, key: opts.key, privateKeyPem: opts.privateKeyPem });
	const signature = signCanonical(privateKeyPem, `market-yank:${discovery.registryId}:${opts.name}:${opts.version}`);
	const res = await fetchFn(`${base}/api/oj-market/yank`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-ojm-key-id": keyId, "x-ojm-signature": signature },
		body: JSON.stringify({
			product: opts.name,
			version: opts.version,
			...(opts.restore === true ? { restore: true } : {}),
			...(opts.reason !== undefined ? { reason: opts.reason } : {}),
			...(opts.by !== undefined ? { by: opts.by } : {}),
		}),
	});
	const data = await unwrapEnvelope(res) as { product?: string, version?: string, yanked?: boolean, idempotent?: boolean };
	return {
		product: String(data.product ?? opts.name),
		version: String(data.version ?? opts.version),
		yanked: data.yanked === true,
		idempotent: data.idempotent === true,
	};
}
