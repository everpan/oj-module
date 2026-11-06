// 站点侧目录回填（计划 v4 §六——三用：回填=恢复=对账）。POST /api/oj-market/backfill
// （superadmin，R9）触发；远端纯站点可用（无 ojm CLI 依赖，一次 HTTP 调用）。
//
// 语义：扫 cdn/ 存量 `<name>-<version>.tgz` → 内嵌 manifest 抽取（与上传端点同一
// manifestOfUpload 管线，勿各写一遍）+ 旁车 .sig → upsert market_release。
//   · 新行：published_at_source='file'（与上传通道 'upload' 区分）；yanked=0。
//   · 已存在行（对账/灾备重放）：只重写内容列（key_id/sha256/size/sig 四列/manifest），
//     published_at/published_at_source/first_seen_at/yanked 原样保留——审计连续、yank 不回魂。
//   · 幂等可重入：重复跑行数不变，报告 unchanged 供对账。
// 降级（数据表）：.sig 缺失/不可解析 → 行照落库但 sig 四列 NULL（安装验签 sig_missing
// fail-closed），文件名进 sigMissing；坏包（解不开/manifest 名实不符）进 skipped 带
// reason，不阻断其它文件；孤立 .sig（tgz 缺失）容忍不加 GC（须受信 key 才能制造）。

import type { FsFace } from "#/_platform/_lifecycle/atomic";
import type { ExecFace } from "#/_platform/_lifecycle/steps/extract";
import { fsFace } from "#/_platform/_lifecycle/atomic";
import { manifestOfUpload } from "#/_platform/_lifecycle/manifest-of-upload";

import { clampManifest, parseSidecarSig, parseUploadFile } from "./cdn/shared";

export interface BackfillEnv {
	/** cdn/ 字节仓库目录（扫描源） */
	cdnDir: string
	/** 暂存目录（manifestOfUpload 解包用；常量名 staging，与上传端点分离防并发互踩） */
	staging: string
	/** 注入面（DIP）：缺省回落 isolate 全局 exec / crypto.sha256Hex */
	exec?: ExecFace
	sha256Hex?: (data: Uint8Array) => string
	/** 当前时刻（epoch 秒；新行 published_at/first_seen_at；缺省 Date.now） */
	now?: () => number
}

export interface BackfillReport {
	/** cdn/ 下识别为 `<name>-<version>.tgz` 的包数（孤立 .sig 不计） */
	scanned: number
	/** 新建行 + 内容列被重写的行 */
	upserted: number
	/** 已存在且内容列无变化（幂等对账锚） */
	unchanged: number
	/** 坏包：解不开 / manifest 名实不符 / 缺 name·version */
	skipped: Array<{ file: string, reason: string }>
	/** .sig 缺失或不可解析（行已落库，sig 四列 NULL） */
	sigMissing: string[]
}

/** 单包扫描结果（行内容列集，upsert 判定与写入共用） */
interface RowContent {
	key_id: string | null
	sha256: string
	size: number
	sig_alg: string | null
	sig_value: string | null
	sig_public_key: string | null
	sig_registry_id: string | null
	manifest: string
}

function sha256Of(env: BackfillEnv): (data: Uint8Array) => string {
	const g = globalThis as { crypto?: { sha256Hex?: (data: Uint8Array) => string } };
	return env.sha256Hex ?? ((data: Uint8Array) => g.crypto!.sha256Hex!(data));
}

function execOf(env: BackfillEnv): ExecFace {
	const g = globalThis as { exec?: { run: ExecFace["run"] } };
	return env.exec ?? { run: (argv, opts) => g.exec!.run(argv, opts) };
}

async function readFileOrNull(f: FsFace, path: string): Promise<Uint8Array | null> {
	try {
		return await f.readFile(path);
	}
	catch {
		return null;
	}
}

/** 扫描单文件：解包抽 manifest + 旁车 .sig → 行内容列；不可回填的错误以 reason 抛出（调用方计入 skipped） */
async function scanPackage(f: FsFace, env: BackfillEnv, file: string, parsed: { name: string, version: string }): Promise<{ content: RowContent, sigMissing: boolean }> {
	const bytes = await f.readFile(`${env.cdnDir}/${file}`);
	const manifest = await manifestOfUpload({ stagingDir: `${env.staging}/backfill`, bytes, exec: execOf(env) });
	const m = typeof manifest === "object" && manifest !== null && !Array.isArray(manifest) ? manifest as Record<string, unknown> : {};
	if (typeof m.name !== "string" || m.name === "" || typeof m.version !== "string" || m.version === "")
		throw new Error("包内 manifest 缺 name/version");
	if (m.name !== parsed.name || m.version !== parsed.version)
		throw new Error(`名实不符：文件名 ${parsed.name}-${parsed.version}，包内 manifest ${String(m.name)}-${String(m.version)}`);

	// 旁车 .sig：缺失/损坏降级（sig 四列 NULL），不阻断落库
	let sigMissing = false;
	let sig: ReturnType<typeof parseSidecarSig> | null = null;
	const sigBytes = await readFileOrNull(f, `${env.cdnDir}/${file}.sig`);
	if (sigBytes === null) {
		sigMissing = true;
	}
	else {
		try {
			sig = parseSidecarSig(new TextDecoder().decode(sigBytes));
		}
		catch {
			sigMissing = true;
		}
	}
	return {
		content: {
			key_id: sig?.key_id ?? null,
			sha256: sha256Of(env)(bytes),
			size: bytes.byteLength,
			sig_alg: sig?.alg ?? null,
			sig_value: sig?.value ?? null,
			sig_public_key: sig?.public_key ?? null,
			sig_registry_id: sig?.registry_id ?? null,
			manifest: JSON.stringify(clampManifest(m)),
		},
		sigMissing,
	};
}

/** 内容列集合相等判定（幂等对账：一字不差才算 unchanged） */
function contentEqual(row: Record<string, unknown>, c: RowContent): boolean {
	const pairs: Array<[unknown, unknown]> = [
		[row.sha256, c.sha256],
		[Number(row.size), c.size],
		[row.key_id ?? null, c.key_id],
		[row.sig_alg ?? null, c.sig_alg],
		[row.sig_value ?? null, c.sig_value],
		[row.sig_public_key ?? null, c.sig_public_key],
		[row.sig_registry_id ?? null, c.sig_registry_id],
		[String(row.manifest ?? ""), c.manifest],
	];
	return pairs.every(([a, b]) => a === b);
}

/**
 * 回填主链：列目录 → 逐包扫描 → select 后 insert/update（审计列保留）。
 * db 面走 oj 构造器全局（与上传端点同纪律）；FS 失败（单文件读坏）按坏包计入 skipped。
 */
export async function backfillReleases(env: BackfillEnv): Promise<BackfillReport> {
	const f = fsFace();
	const report: BackfillReport = { scanned: 0, upserted: 0, unchanged: 0, skipped: [], sigMissing: [] };
	const names = await f.readdir(env.cdnDir);
	for (const file of names.sort()) {
		if (!file.endsWith(".tgz"))
			continue; // 孤立 .sig 与杂文件容忍忽略
		const parsed = parseUploadFile(file);
		if (parsed === null || parsed.sig) {
			report.skipped.push({ file, reason: "文件名不属于 <name>-<version>.tgz 形态" });
			continue;
		}
		let scanned: Awaited<ReturnType<typeof scanPackage>>;
		try {
			scanned = await scanPackage(f, env, file, parsed);
		}
		catch (e) {
			report.skipped.push({ file, reason: (e as Error).message });
			continue;
		}
		report.scanned++;
		if (scanned.sigMissing)
			report.sigMissing.push(file);
		const { content } = scanned;

		const existing = (await db.table("market_release")
			.select(["id", "sha256", "size", "key_id", "sig_alg", "sig_value", "sig_public_key", "sig_registry_id", "manifest"])
			.where({ field: "product", op: "eq", value: parsed.name })
			.where({ field: "version", op: "eq", value: parsed.version })
			.limit(1)
			.all()) as Array<Record<string, unknown>>;
		const prior = existing[0];
		if (prior !== undefined && contentEqual(prior, content)) {
			report.unchanged++;
			continue;
		}
		if (prior === undefined) {
			const now = env.now?.() ?? Math.floor(Date.now() / 1000);
			await db.table("market_release").insert({
				product: parsed.name,
				version: parsed.version,
				...content,
				published_at: now,
				published_at_source: "file",
				yanked: 0,
				first_seen_at: now,
			}).run();
		}
		else {
			// 对账/灾备重放：只重写内容列；published_at/published_at_source/first_seen_at/yanked 保留
			await db.table("market_release").update({ ...content }).where({ field: "id", op: "eq", value: prior.id }).run();
		}
		report.upserted++;
	}
	return report;
}
