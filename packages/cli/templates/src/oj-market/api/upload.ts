// 离线包上传端点主体（2026-11-10 round 3：内网手动上传升级——发布管理页「离线包上传」区数据面）。
// POST /api/oj-market/upload?name=<n>-<v>.tgz（superadmin 门禁，登录态 Bearer——匿名面零扩大）：
// 运维携带已签分发包（tgz + .sig 旁车）入库，发布方私钥不出安全区的内网场景。
//
// 与 cdn/upload 的分工：cdn 面鉴权锚 = 推送者私钥（X-OJM 头签名，sig 先行 pair 时序）；
// 本面鉴权锚 = 门禁人（superadmin）+ 包旁车与实收字节绑定验签——单请求双文件（multipart
// files 顺序 [tgz, sig]，oj http 面不透出文件名故 tgz 名走 query），无 pair 时序。
// **未审指纹放行入库**（trusted=false 如实返回）：目录 ≠ 信任，安装才是信任闸（verify 段
// unknown_key → needs_trust → 发布管理页审核闭环）；目录行写语义与 cdn 面逐字同源
// （同版本幂等 heal / 异字节 409 不碰盘 / name 所有权首发绑定 + 事务内复核 /
// manifestOfUpload 同一管线 / R1 三步 + REG-CS8 体积闸 / 审计落 market_history）。
// 实现落位纪律同 backfill.ts：非路由入口件，路由组挂 api.ts；行写语义与 cdn/api.ts
// 共享面（shared.ts 五字段/canonical/钳制）勿各写一遍。

import type { ExecFace } from "#/_platform/_lifecycle/steps/extract";
import { atomicWriteBytes, fsFace } from "#/_platform/_lifecycle/atomic";
import { recordHistory } from "#/_platform/_lifecycle/history";
import { MAX_PACKAGE_BYTES } from "#/_platform/_lifecycle/limits";
import { manifestOfUpload } from "#/_platform/_lifecycle/manifest-of-upload";
import { createTrustStore } from "#/_platform/_lifecycle/trust";

import { clampManifest, fail, fingerprintOf, packageCanonicalOf, parseSidecarSig, parseUploadFile } from "./cdn/shared";
import { verifyCanonicalSig } from "./cdn/signed-auth";

/** 上传体积闸 = 分发包体积闸（单源 limits.ts，与 cdn/upload 同款） */
export const MAX_UPLOAD_BYTES = MAX_PACKAGE_BYTES;

export interface OfflineUploadEnv {
	/** cdn/ 字节仓库目录（tgz + .sig 双文件落位处） */
	cdnDir: string
	/** 暂存目录（manifestOfUpload 解包抽 manifest；与安装器 staging 同纪律） */
	staging: string
	/** 宿主信任库（.solutions/trusted-keys.yaml；trusted 探测源，未审放行） */
	trustPath: string
	/** 审计 operator（登录人；缺省 unknown） */
	operator?: string
	/** 注入面（DIP）：缺省回落 isolate 全局 exec / crypto.sha256Hex / crypto.verifyEd25519（backfill 同款） */
	exec?: ExecFace
	sha256Hex?: (data: Uint8Array) => string
	verifyEd25519?: (publicKey: string, msg: string, sigBase64: string) => boolean
	/** 当前时刻（epoch 秒；published_at/first_seen_at；测试注入，缺省 Date.now） */
	now?: () => number
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── 注入面缺省回落（cdn/api.ts 同款）───────────────────────────────────────────────────────
function execOf(env: OfflineUploadEnv): ExecFace {
	const g = globalThis as { exec?: { run: ExecFace["run"] } };
	return env.exec ?? { run: (argv, opts) => g.exec!.run(argv, opts) };
}

function sha256Of(env: OfflineUploadEnv): (data: Uint8Array) => string {
	const g = globalThis as { crypto?: { sha256Hex?: (data: Uint8Array) => string } };
	return env.sha256Hex ?? ((data: Uint8Array) => g.crypto!.sha256Hex!(data));
}

function nowOf(env: OfflineUploadEnv): number {
	return env.now?.() ?? Math.floor(Date.now() / 1000);
}

async function readFileOrNull(path: string): Promise<Uint8Array | null> {
	try {
		return await fsFace().readFile(path);
	}
	catch {
		return null;
	}
}

/** 幂等自愈：盘上缺失才补写（存在即不动——绝不改写既有字节；cdn 同款） */
async function healIfMissing(path: string, bytes: Uint8Array): Promise<void> {
	if (await readFileOrNull(path) === null)
		await atomicWriteBytes(path, bytes);
}

/** 发布审计（operator = 门禁登录人——动作执行者；发布方 key_id 进 message） */
async function audit(env: OfflineUploadEnv, name: string, version: string, keyId: string, status: "success" | "failed", message: string): Promise<void> {
	await recordHistory({
		solution: name,
		version,
		action: "publish",
		status,
		operator: env.operator ?? "unknown",
		message: `${message}（发布方 ${keyId}，superadmin ${env.operator ?? "unknown"}）`,
	});
}

/** 双文件字节（upload/api.ts 先例双路径：小文件字节在手 file(i)，大文件流式落 blob 走 blob.get） */
async function uploadPairBytes(): Promise<{ tgz: Uint8Array, sig: Uint8Array } | null> {
	const h = http as { files?: Array<{ key?: string }>, file?: (i: number) => Promise<Uint8Array> };
	if (!Array.isArray(h.files) || h.files.length < 2)
		return null;
	const a = h.files[0]!;
	const b = h.files[1]!;
	return {
		tgz: a.key ? await blob.get(a.key) : await h.file!(0),
		sig: b.key ? await blob.get(b.key) : await h.file!(1),
	};
}

// ── 主体（处理序钉死，见文件头）────────────────────────────────────────────────────────────
export async function uploadPackageBody(env: OfflineUploadEnv): Promise<Record<string, unknown>> {
	const q = (http as { query?: Record<string, unknown> }).query ?? {};
	const rawName = String(q.name ?? "").trim();
	const file = parseUploadFile(rawName);
	if (file === null || file.sig)
		fail(400, `文件名非法：「${rawName}」——须为 <name>-<version>.tgz（name ^[a-z][a-z0-9-]{0,63}$ 全小写、版本数字开头）；路径逃逸/绝对路径/反斜杠/错扩展名一律拒`);

	// ① 双文件闸 + 体积闸（oj http 面不透出文件名：tgz 名走 query，files 顺序 [tgz, sig] 即协议）
	const bytes = await uploadPairBytes();
	if (bytes === null)
		fail(400, "须随 multipart 上传两个文件：tgz 包体与 .sig 旁车（缺一不可）——离线上传要求同批携带、服务端即时配对验签");
	if (bytes.tgz.byteLength > MAX_UPLOAD_BYTES)
		fail(413, `上传体积 ${bytes.tgz.byteLength} 字节超过上限 ${MAX_UPLOAD_BYTES}（与分发包体积闸同源）——请缩减包体；部署面请调 server.max_upload_bytes 与反代 body cap 兜底`);

	// ② 旁车五字段结构校验（400 人话分流；密码学绑定在 ③）
	const sig = parseSidecarSig(new TextDecoder().decode(bytes.sig));

	// ③ 服务端重算 sha256 重构包级 canonical 验签（终审 I2 同语义：不采信任何声明值；
	// canonical 首段 = 旁车自带签发方 registry 身份，跨站签发合法）
	const sha256 = sha256Of(env)(bytes.tgz);
	if (!verifyCanonicalSig(env, sig.public_key, packageCanonicalOf(sig.registry_id, file.name, file.version, sha256), sig.value)) {
		await audit(env, file.name, file.version, sig.key_id, "failed", "409 旁车验签失败：签名与实收字节不绑定");
		fail(409, `「${file.name}@${file.version}」的 .sig 旁车验签失败——签名与实收字节不绑定（请重新导出分发包与签名，tgz 与 .sig 须同批字节）`);
	}

	// ③½ 指纹 / trusted 一次计算（幂等与成功两条返回路径同源；幂等短路径也要如实返回）
	const fingerprint = fingerprintOf(sha256Of(env))(sig.public_key);
	const trusted = Boolean(await createTrustStore(env.trustPath).get(sig.key_id));

	// ④ 查库比对（不碰盘仲裁：异字节在此被拒，cdn 字节绝无被持久损坏的窗口）
	const tgzPath = `${env.cdnDir}/${rawName}`;
	const sigPath = `${tgzPath}.sig`;
	const prior = (await db.table("market_release")
		.select(["id", "sha256"])
		.where({ field: "product", op: "eq", value: file.name })
		.where({ field: "version", op: "eq", value: file.version })
		.limit(1)
		.all()) as Array<{ id: unknown, sha256: unknown }>;
	if (prior.length > 0) {
		if (String(prior[0]!.sha256) === sha256) {
			await healIfMissing(tgzPath, bytes.tgz);
			await healIfMissing(sigPath, bytes.sig);
			return { ok: true, name: file.name, version: file.version, sha256, size: bytes.tgz.byteLength, key_id: sig.key_id, fingerprint, trusted, idempotent: true };
		}
		await audit(env, file.name, file.version, sig.key_id, "failed", "409 异字节同版本：同一版本号只允许一份字节");
		fail(409, `「${file.name}@${file.version}」已存在且字节不一致——同一版本号只允许一份字节，请升 version 重发（确需覆盖须站点侧删行，superadmin 操作）`);
	}

	// ⑤ name 所有权：既有行（key_id 非 NULL）锁定首发 key；NULL（遗留行）不建立所有权
	const ownerRows = await db.table("market_release").select(["key_id"]).where({ field: "product", op: "eq", value: file.name }).limit(1).all() as Array<{ key_id: unknown }>;
	const owner = ownerRows[0]?.key_id;
	if (typeof owner === "string" && owner !== "" && owner !== sig.key_id) {
		await audit(env, file.name, file.version, sig.key_id, "failed", `409 name 所有权：${file.name} 已由 ${owner} 首发绑定`);
		fail(409, `name 所有权：「${file.name}」已由 key「${owner}」首发绑定，key「${sig.key_id}」不得发布——换主 = 站点 superadmin 操作`);
	}

	// ⑥ staging 解包抽 manifest（查库后的第一碰盘动作；体积闸/zip-slip/坏包全在此拒）
	const manifest = await manifestOfUpload({ stagingDir: env.staging, bytes: bytes.tgz, exec: execOf(env) });
	const m = isObj(manifest) ? manifest : {};
	if (m.name !== file.name || m.version !== file.version)
		fail(400, `包内 manifest「${String(m.name)}@${String(m.version)}」与上传文件名「${file.name}@${file.version}」不一致——请核对分发包`);

	// ⑦ 原子落盘双文件（tmp+rename；此后任一步失败尽力回收本方字节，绝不改写他人文件）
	await atomicWriteBytes(tgzPath, bytes.tgz);
	await atomicWriteBytes(sigPath, bytes.sig);
	const now = nowOf(env);
	try {
		// ⑧ db.tx 写行（只包 DB 段；所有权事务内复核——并发竞态窗口由写事务内重读仲裁）
		await db.tx(async (t) => {
			const ownersNow = await t.table("market_release").select(["key_id"]).where({ field: "product", op: "eq", value: file.name }).limit(1).all() as Array<{ key_id: unknown }>;
			const ownerNow = ownersNow[0]?.key_id;
			if (typeof ownerNow === "string" && ownerNow !== "" && ownerNow !== sig.key_id)
				fail(409, `name 所有权：「${file.name}」已由 key「${ownerNow}」首发绑定（并发复核），key「${sig.key_id}」不得发布——换主 = 站点 superadmin 操作`);
			await t.table("market_release").insert({
				product: file.name,
				version: file.version,
				key_id: sig.key_id,
				sha256,
				size: bytes.tgz.byteLength,
				published_at: now,
				published_at_source: "upload",
				yanked: 0,
				first_seen_at: now,
				sig_alg: sig.alg,
				sig_value: sig.value,
				sig_public_key: sig.public_key,
				sig_registry_id: sig.registry_id,
				manifest: JSON.stringify(clampManifest(m)),
			}).run();
		});
	}
	catch (e) {
		// 唯一键并发仲裁：撞键 = 并发同版本上传先落一方——重读比对 sha256 定幂等/冲突
		// （cdn/api.ts M1/M4 同款；业务 fail 带 status 原样重抛，底层错误人话出口细节进审计）
		const status = (e as { status?: number }).status;
		const again = (await db.table("market_release")
			.select(["sha256"])
			.where({ field: "product", op: "eq", value: file.name })
			.where({ field: "version", op: "eq", value: file.version })
			.limit(1)
			.all()) as Array<{ sha256: unknown }>;
		if (status === undefined && again.length > 0 && String(again[0]!.sha256) === sha256) {
			await healIfMissing(tgzPath, bytes.tgz);
			await healIfMissing(sigPath, bytes.sig);
			return { ok: true, name: file.name, version: file.version, sha256, size: bytes.tgz.byteLength, key_id: sig.key_id, fingerprint, trusted, idempotent: true };
		}
		const f = fsFace();
		// 双文件都按字节身份守卫后回收：并发败方绝不删除他人已落位的字节（否则胜方目录行指向无旁车包）
		const onDisk = await readFileOrNull(tgzPath);
		if (onDisk !== null && sha256Of(env)(onDisk) === sha256)
			await f.remove(tgzPath, { force: true }).catch(() => {});
		const onDiskSig = await readFileOrNull(sigPath);
		if (onDiskSig !== null && sha256Of(env)(onDiskSig) === sha256Of(env)(bytes.sig))
			await f.remove(sigPath, { force: true }).catch(() => {});
		if (typeof status === "number") {
			await audit(env, file.name, file.version, sig.key_id, "failed", `409 并发复核拒绝：${(e as Error).message}`);
			throw e;
		}
		await audit(env, file.name, file.version, sig.key_id, "failed", `写库失败/冲突：${String(e)}`);
		fail(500, `「${file.name}@${file.version}」写库失败（已回收本次字节，cdn/ 无残留）——请重试；持续失败请查 market_history 审计明细`);
	}

	await audit(env, file.name, file.version, sig.key_id, "success", `离线上传成功（${rawName}，${bytes.tgz.byteLength} 字节${trusted ? "" : "；发布方未入库，安装时将停待信任确认"}）`);
	return { ok: true, name: file.name, version: file.version, sha256, size: bytes.tgz.byteLength, key_id: sig.key_id, fingerprint, trusted, idempotent: false };
}
