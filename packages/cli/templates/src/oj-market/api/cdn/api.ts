// CDN 上传端点（Phase A v4 §二）：签名推送 + pair 约束 + DB 目录真源写行。
// POST /api/oj-market/cdn/upload?name=<file> —— 发布方（ojm market publish 远端模式）推
// .tgz + .sig 旁车；不经账号口令（企微用户无障碍），签名鉴权 = X-OJM-Key-Id / X-OJM-Signature
// 头 + 信任库 + Ed25519；无角色检查（信任库成员即发布身份）。
//
// 鉴权序（钉死）：① 验头（403 fail-fast：key 须在信任库，不消费 body）→ 限速（按 key_id）→
// registry_id 解析（缺失 503）→ ② 消费 body（MAX_PACKAGE_BYTES 显式 413；反代 body cap 兜底）
// → ③ 服务端从实收字节**重算 sha256** 重构 canonical `cdn-upload:<registry_id>:<name>:<sha256>`
// 验签（换字节/跨站重放 → 401；不取 .sig 声明值——防签名-字节重绑）。站内重放（无 timestamp/
// nonce）因内容哈希绑定退化为同字节幂等，无实害——不引入时间戳。
//
// 处理序（钉死）：查库比对（同 name+version：同字节 → 幂等 200 + 补缺文件〔自愈〕；异字节 →
// 409 **不碰盘**，防「文件先被换、DB 后拒」的字节持久损坏）→ staging 解包抽 manifest（R1 三步
// 范式 + REG-CS8 体积闸；manifest.name/version 与文件名逐字一致；summary/description 入库钳制）
// → 原子落盘（tmp+rename）→ db.tx 写行（唯一键并发仲裁：撞键重读比对 sha256 定幂等/冲突）。
// FS+DB 无同事务——db.tx 只包 DB 段；中断靠同字节重传自愈。任一步失败 CDN 零痕迹。
//
// name 所有权（v4 §一）：product → 首发 key_id 绑定不可改（C2-38 同源纪律）——既有行 key_id
// 非 NULL 且不符 → 409；NULL（syncReleases 遗留）不建立所有权，首个上传采用并绑定；
// 换主 = 站点 superadmin 操作（端点不提供）。
//
// 匿名面：config.yaml auth.anonymous_paths 增 /api/oj-market/cdn/upload（restart_pending
// 冻结段，重启生效，发版说明提醒）。审计：发布成败落 market_history（action=publish，
// operator = key_id）；验签前的请求（401/403/413/429/400 文件名）不是已知身份的发布行为，不留痕。

import type { ExecFace } from "#/_platform/_lifecycle/steps/extract";
import type { ParsedUploadFile } from "./shared";
import type { SignedAuthEnv } from "./signed-auth";
import { atomicWriteBytes, fsFace } from "#/_platform/_lifecycle/atomic";
import { recordHistory } from "#/_platform/_lifecycle/history";
import { MAX_PACKAGE_BYTES } from "#/_platform/_lifecycle/limits";

import { manifestOfUpload } from "#/_platform/_lifecycle/manifest-of-upload";
import { respond } from "#/_platform/_shared/respond";
import { clampManifest, fail, packageCanonicalOf, parseSidecarSig, parseUploadFile } from "./shared";
import { authenticateSignedKey, UPLOAD_RATE_LIMIT, verifyCanonicalSig } from "./signed-auth";

// 既有引用面兼容（tests/lifecycle/cdn-upload.spec.ts 等从本文件取）
export { UPLOAD_RATE_LIMIT };
export type { SignedAuthEnv };

/** 上传体积闸 = 分发包体积闸（单源 limits.ts，杜绝散落） */
export const MAX_UPLOAD_BYTES = MAX_PACKAGE_BYTES;

export interface CdnUploadEnv {
	/** cdn/ 字节仓库目录（站点挂载的静态目录；暂存与任务不留其内——失败零可见痕迹） */
	cdnDir: string
	/** 上传暂存目录（解包抽 manifest；与安装器 staging 分离，防并发互踩） */
	staging: string
	/** 宿主信任库（.solutions/trusted-keys.yaml） */
	trustPath: string
	/** 本站点 registry 身份（canonical 首段 = 站点身份，防跨站重放）；缺省读 config vars.registry_id */
	registryId?: string
	/** 站点 config.yaml 路径（vars.registry_id 读取处；缺省 config.yaml） */
	configPath?: string
	/** 注入面（DIP）：缺省回落 isolate 全局 exec / crypto.sha256Hex / crypto.verifyEd25519 */
	exec?: ExecFace
	sha256Hex?: (data: Uint8Array) => string
	verifyEd25519?: (publicKey: string, msg: string, sigBase64: string) => boolean
	/** 当前时刻（epoch 秒；published_at/first_seen_at；测试注入，缺省 Date.now） */
	now?: () => number
}

/** 生产缺省（全字段可注入覆盖，测试 stub 同款）；路径相对 fs jail 根（= config.yaml 所在目录） */
export function cdnEnv(): CdnUploadEnv {
	return {
		cdnDir: "cdn",
		staging: "modules/.staging-upload",
		trustPath: ".solutions/trusted-keys.yaml",
		configPath: "config.yaml",
	};
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── 注入面缺省回落 ─────────────────────────────────────────────────────────────────────────
function execOf(env: CdnUploadEnv): ExecFace {
	const g = globalThis as { exec?: { run: ExecFace["run"] } };
	return env.exec ?? { run: (argv, opts) => g.exec!.run(argv, opts) };
}

function sha256Of(env: CdnUploadEnv): (data: Uint8Array) => string {
	const g = globalThis as { crypto?: { sha256Hex?: (data: Uint8Array) => string } };
	return env.sha256Hex ?? ((data: Uint8Array) => g.crypto!.sha256Hex!(data));
}

function nowOf(env: CdnUploadEnv): number {
	return env.now?.() ?? Math.floor(Date.now() / 1000);
}

/** 上传载荷字节（upload/api.ts 先例双路径：小文件字节在手，大文件已流式落 blob 须走 blob.get） */
async function uploadBytes(): Promise<Uint8Array | null> {
	const h = http as { files?: Array<{ key?: string }>, file?: (i: number) => Promise<Uint8Array> };
	if (!Array.isArray(h.files) || h.files.length === 0)
		return null;
	const meta = h.files[0]!;
	return meta.key ? await blob.get(meta.key) : await h.file!(0);
}

async function readFileOrNull(path: string): Promise<Uint8Array | null> {
	try {
		return await fsFace().readFile(path);
	}
	catch {
		return null;
	}
}

/** 幂等自愈：盘上缺失才补写（存在即不动——绝不改写既有字节） */
async function healIfMissing(path: string, bytes: Uint8Array): Promise<void> {
	if (await readFileOrNull(path) === null)
		await atomicWriteBytes(path, bytes);
}

/** 发布审计（成败俱记 market_history；守卫式 insert，留痕失败不阻断主流程——history.ts 同语义） */
async function auditPublish(row: { name: string, version: string, keyId: string, status: "success" | "failed", message: string }): Promise<void> {
	await recordHistory({
		solution: row.name,
		version: row.version,
		action: "publish",
		status: row.status,
		operator: row.keyId,
		message: row.message,
	});
}

// ── 主体 ────────────────────────────────────────────────────────────────────────────────────
async function sigUploadBody(env: CdnUploadEnv, file: ParsedUploadFile, rawName: string, bytes: Uint8Array, sha256: string, keyId: string): Promise<Record<string, unknown>> {
	const sigPath = `${env.cdnDir}/${rawName}`;
	const existing = await readFileOrNull(sigPath);
	if (existing !== null && sha256Of(env)(existing) === sha256) {
		// 幂等重推留痕（minor M3）：重推不是发布动作，但发布留痕口径成败俱记——补一条 success 审计
		await auditPublish({ name: file.name, version: file.version, keyId, status: "success", message: `幂等重推 .sig 旁车（${rawName} 内容未变，行未动）` });
		return { ok: true, name: rawName, kind: "sig", sha256, idempotent: true };
	}
	parseSidecarSig(new TextDecoder().decode(bytes)); // 结构校验（400 人话分流）；内容列在 tgz pair 时从盘上旁车读取
	// 已配对（market_release 行在）后禁止换签：pair 完整是已发布事实，签名与 tgz 绑定不可拆换
	const paired = await db.table("market_release").select(["id"]).where({ field: "product", op: "eq", value: file.name }).where({ field: "version", op: "eq", value: file.version }).limit(1).all() as unknown[];
	if (paired.length > 0 && existing !== null && sha256Of(env)(existing) !== sha256)
		fail(409, `「${file.name}@${file.version}」的 .sig 已与 tgz 配对入库，不接受换签——请升 version 重发`);
	await atomicWriteBytes(sigPath, bytes);
	return { ok: true, name: rawName, kind: "sig", sha256 };
}

async function tgzUploadBody(env: CdnUploadEnv, file: ParsedUploadFile, rawName: string, bytes: Uint8Array, sha256: string, keyId: string): Promise<Record<string, unknown>> {
	const tgzPath = `${env.cdnDir}/${rawName}`;
	const sigPath = `${tgzPath}.sig`;

	// pair 约束：sig 先 tgz 后——旁车缺失/损坏都不进解包
	const sigBytes = await readFileOrNull(sigPath);
	if (sigBytes === null)
		fail(409, `pair 约束（sig 先 tgz 后）：请先上传 ${rawName}.sig 旁车，再推 ${rawName}——tgz 未配对不入库`);
	const sig = parseSidecarSig(new TextDecoder().decode(sigBytes));
	// pair 验签（终审 I2）：旁车必须与实收字节密码学绑定——受信 key 也可能作恶，预推
	// 「形全实毒」旁车会让受害方 tgz 配对错签、该版本全部安装 fail-closed。验签在 pair
	// 时做（sig 先行时 tgz 字节尚不存在，无法绑定）；包级 canonical 首段 = 旁车自带签发方
	// 身份（跨站签发合法），与上传鉴权用的站点 canonical 是两串。
	if (!verifyCanonicalSig(env, sig.public_key, packageCanonicalOf(sig.registry_id, file.name, file.version, sha256), sig.value)) {
		await auditPublish({ name: file.name, version: file.version, keyId, status: "failed", message: "409 旁车验签失败：签名与实收字节不绑定" });
		fail(409, `「${file.name}@${file.version}」的 .sig 旁车验签失败——签名与实收字节不绑定（cdn/ 若残留他人旁车，须站点 superadmin 清理后重推）`);
	}
	if (sig.key_id !== keyId) {
		await auditPublish({ name: file.name, version: file.version, keyId, status: "failed", message: `409 旁车 key 不符：${sig.key_id} ≠ 推送身份 ${keyId}` });
		fail(409, `「${file.name}@${file.version}」的 .sig 旁车 key_id「${sig.key_id}」与推送身份「${keyId}」不符——旁车与包体须同一把发布 key（一行一锚）`);
	}

	// ① 查库比对（不碰盘仲裁：异字节在此被拒，CDN 字节绝无被持久损坏的窗口）
	const prior = (await db.table("market_release")
		.select(["id", "sha256"])
		.where({ field: "product", op: "eq", value: file.name })
		.where({ field: "version", op: "eq", value: file.version })
		.limit(1)
		.all()) as Array<{ id: unknown, sha256: unknown }>;
	if (prior.length > 0) {
		if (String(prior[0]!.sha256) === sha256) {
			// 同字节幂等 + 补缺文件自愈（sig 先行缺失也一并补）
			await healIfMissing(tgzPath, bytes);
			await healIfMissing(sigPath, sigBytes);
			return { ok: true, name: file.name, version: file.version, sha256, size: bytes.byteLength, key_id: keyId, idempotent: true };
		}
		await auditPublish({ name: file.name, version: file.version, keyId, status: "failed", message: "409 异字节同版本：同一版本号只允许一份字节" });
		fail(409, `「${file.name}@${file.version}」已存在且字节不一致——同一版本号只允许一份字节，请升 version 重发（确需覆盖须站点侧删行，superadmin 操作）`);
	}

	// ② name 所有权：既有行（key_id 非 NULL）锁定首发 key；NULL（遗留行）不建立所有权
	const ownerRows = await db.table("market_release").select(["key_id"]).where({ field: "product", op: "eq", value: file.name }).limit(1).all() as Array<{ key_id: unknown }>;
	const owner = ownerRows[0]?.key_id;
	if (typeof owner === "string" && owner !== "" && owner !== keyId) {
		await auditPublish({ name: file.name, version: file.version, keyId, status: "failed", message: `409 name 所有权：${file.name} 已由 ${owner} 首发绑定` });
		fail(409, `name 所有权：「${file.name}」已由 key「${owner}」首发绑定，key「${keyId}」不得发布——换主 = 站点 superadmin 操作`);
	}

	// ③ staging 解包抽 manifest（查库后的第一碰盘动作；体积闸/zip-slip/坏包全在此拒）
	const manifest = await manifestOfUpload({ stagingDir: env.staging, bytes, exec: execOf(env) });
	const m = isObj(manifest) ? manifest : {};
	if (m.name !== file.name || m.version !== file.version)
		fail(400, `包内 manifest「${String(m.name)}@${String(m.version)}」与上传文件名「${file.name}@${file.version}」不一致——请核对分发包`);
	const stored = clampManifest(m);

	// ④ 原子落盘（tmp+rename；此后任一步失败尽力回收本方字节，绝不改写他人文件）
	await atomicWriteBytes(tgzPath, bytes);
	const now = nowOf(env);
	try {
		// ⑤ db.tx 写行（只包 DB 段；FS+DB 无同事务，中断靠同字节重传自愈）
		await db.tx(async (t) => {
			await t.table("market_release").insert({
				product: file.name,
				version: file.version,
				key_id: keyId,
				sha256,
				size: bytes.byteLength,
				published_at: now,
				published_at_source: "upload",
				yanked: 0,
				first_seen_at: now,
				sig_alg: sig.alg,
				sig_value: sig.value,
				sig_public_key: sig.public_key,
				sig_registry_id: sig.registry_id,
				manifest: JSON.stringify(stored),
			}).run();
		});
	}
	catch (e) {
		// 唯一键并发仲裁：撞键 = 并发同版本上传先落一方——重读比对 sha256 定幂等/冲突
		const again = (await db.table("market_release")
			.select(["sha256"])
			.where({ field: "product", op: "eq", value: file.name })
			.where({ field: "version", op: "eq", value: file.version })
			.limit(1)
			.all()) as Array<{ sha256: unknown }>;
		if (again.length > 0 && String(again[0]!.sha256) === sha256) {
			await healIfMissing(tgzPath, bytes);
			return { ok: true, name: file.name, version: file.version, sha256, size: bytes.byteLength, key_id: keyId, idempotent: true };
		}
		// 仲裁失败：回收本方字节（盘上若已是他方字节则不动——按 sha256 判别）
		const onDisk = await readFileOrNull(tgzPath);
		if (onDisk !== null && sha256Of(env)(onDisk) === sha256)
			await fsFace().remove(tgzPath, { force: true }).catch(() => {});
		await auditPublish({ name: file.name, version: file.version, keyId, status: "failed", message: `写库失败/冲突：${String(e)}` });
		throw e;
	}
	await auditPublish({ name: file.name, version: file.version, keyId, status: "success", message: `签名推送发布成功（${rawName}，${bytes.byteLength} 字节）` });
	return { ok: true, name: file.name, version: file.version, sha256, size: bytes.byteLength, key_id: keyId };
}

async function uploadBody(env: CdnUploadEnv): Promise<Record<string, unknown>> {
	const q = (http as { query?: Record<string, unknown> }).query ?? {};
	const rawName = String(q.name ?? "").trim();
	const file = parseUploadFile(rawName);
	if (file === null)
		fail(400, `文件名非法：「${rawName}」——须为 <name>-<version>.tgz 或其 .sig 旁车（name ^[a-z][a-z0-9-]{0,63}$ 全小写、版本数字开头）；路径逃逸/绝对路径/反斜杠/错扩展名一律拒`);

	// ① 验面（403 fail-fast：信任库成员判定不消费 body）——共享序见 authenticateSignedKey
	const { keyId, publicKey, registryId, signature } = await authenticateSignedKey(env, "cdn-upload");

	// ② 消费 body（显式 413；反代 body cap 兜底是部署面责任）
	const bytes = await uploadBytes();
	if (bytes === null)
		fail(400, "须随 multipart 上传文件字节（http.files）");
	if (bytes.byteLength > MAX_UPLOAD_BYTES)
		fail(413, `上传体积 ${bytes.byteLength} 字节超过上限 ${MAX_UPLOAD_BYTES}（与分发包体积闸同源）——请缩减包体；部署面请配反代 body cap 兜底`);

	// ③ 服务端重算 sha256 重构 canonical 验签（硬约束：不取 .sig 声明值——防签名-字节重绑）
	const sha256 = sha256Of(env)(bytes);
	const canonical = `cdn-upload:${registryId}:${rawName}:${sha256}`;
	if (!verifyCanonicalSig(env, publicKey, canonical, signature))
		fail(401, "签名验签失败：服务端按实收字节重算 sha256 重构 canonical 验签——字节被换、registry 身份不符或签名无效，已拒（401）");

	if (file.sig)
		return await sigUploadBody(env, file, rawName, bytes, sha256, keyId);
	return await tgzUploadBody(env, file, rawName, bytes, sha256, keyId);
}

/** 单端点组（oj 嵌套组：组名 = 路径段）→ POST /api/oj-market/cdn/upload */
export function createCdnUploadApi(env: CdnUploadEnv) {
	return {
		upload: {
			async post() {
				await respond(async () => {
					return await uploadBody(env);
				});
			},
		},
	};
}

const cdnUploadApi = createCdnUploadApi(cdnEnv());

// 契约 I/O（schema-first，oj v0.1.72+）：入参对齐 query 收口（name 必填），出参宽松。
cdnUploadApi.upload.post.schema = {
	query: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
};
cdnUploadApi.upload.post.response = { type: "object", additionalProperties: true };

export default cdnUploadApi;
