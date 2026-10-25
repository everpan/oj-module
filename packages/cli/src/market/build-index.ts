/**
 * `ojm market build-index`（T4 + REG-CS5 三级化）：扫描 `cdn/*.tgz` → 提取内嵌 manifest →
 * 全量重建三级索引并签名。
 *
 * 三级形态（REG-CS5，需求 §5.1）：
 * - `catalog.yaml`——`{seq, issued_at, expires_at, shards: {<片号>: <该片代次>}, solutions: [{name, shards}]}`：
 *   包名 → 片号，**无版本明细**；唯一带 seq+时效的正文，代次真源。
 * - `shards/<n>.yaml`——`{solutions: [{name, latest, versions: [Form B 条目]}]}`：纯内容、无元字段；
 *   版本条目即 Form B manifest（原 manifests.yaml 聚合清单并入分片），装一个包只拉 1 catalog + 1 shard。
 * - 每片 ≤ `SHARD_MAX_VERSIONS`（1000）个版本，装箱见 `sharding.ts`。
 *
 * 为什么不增量合并：索引是**共享可变产物**，多人发布时读-改-写天然 TOCTOU，且索引签名会被
 * 后发者覆盖。而 `market/api.ts verifyIndexSig` 注释已写明「索引签名只做完整性，信任由 TOFU/
 * 信任库承载」——索引本就不是信任锚，那就把它降级为派生产物：谁都能重建，重建结果只取决于目录内容。
 *
 * 原子落盘（红队 F2 / 计划子任务 6）：
 * - 每个索引文件都走 `<路径>.tmp.<pid>.<rand>` → `rename`（全仓唯一写入口 `writeIndexFile`，
 *   `grep writeFileSync` 可证没有直写索引的路径）；临时文件后缀非 `.yaml`，读取器永不将其当索引。
 * - **内容匹配编号**：字节一致的片保留原片号与代次、连签名都不重写（缓存热、ETag 稳定）；
 *   内容变了的片取**全新片号**（maxExistingNo+1 起），旧代文件在 catalog 提交前原样留在盘上。
 * - **顺序固定「先分片 → 再 catalog」**：catalog 是提交点。写完分片还没写 catalog 时进程被杀，
 *   旧 catalog 仍指向旧代文件、安装照常；新片是全新号、旧 catalog 看不见，不构成半文件。
 */

import type { IndexedPackage } from "./index-builder";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { verifyCanonical } from "../lifecycle/sign";
import { indexCanonical, indexMetaOf, recomputeIndex, signIndex, stampIndexMeta, writeIndexFile } from "../publish";
import { resolveCdnLayout } from "./cdn-layout";
import { buildIndexData, compareSemver } from "./index-builder";
import { readEmbeddedManifest } from "./scan";
import { packShards } from "./sharding";
import { readYankLedger } from "./yank-ledger";

export interface BuildIndexOptions {
	projectRoot?: string
	id?: string
	key?: string
	privateKeyPem?: string
	/** 重建时刻（epoch 秒；REG-CS2 时效基准，测试注入用，缺省当前时刻） */
	now?: number
	/** 重建后离线自检（verifyCanonical 复核 catalog 与各分片签名） */
	check?: boolean
	/**
	 * 测试注入（半写回归，计划 BDD ③）：分片写完、catalog 提交前触发。抛错即中止本次重建，
	 * 已写文件按「从未发生」回滚（删除本次写入的全部文件），旧代保持可读。
	 */
	afterShards?: () => void
}

export interface BuildIndexResult {
	catalogPath: string
	catalogSigPath: string
	/** 本次重建涉及的片文件（含未重写的沿用片；按片号升序） */
	shardPaths: string[]
	/** 入索引的方案数 */
	solutions: number
	/** 片总数（含未重写的沿用片） */
	shards: number
	/** 因缺内嵌 manifest 等原因被跳过的文件名 */
	skipped: string[]
	/** 本次重建的索引代次（REG-CS2 单调 seq） */
	seq: number
	/** 盖章进索引的时效（REG-CS2；读方 now > expiresAt 即拒） */
	issuedAt: number
	expiresAt: number
	checkPassed?: boolean
}

/** 盘上既有代次的一片（内容 + 其被 catalog 钉住的代次） */
interface ExistingShard {
	no: number
	seq: number
	/** 归一化后的正文（与新建片同口径比对） */
	body: string
}

export async function buildIndex(opts: BuildIndexOptions = {}): Promise<BuildIndexResult> {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const layout = resolveCdnLayout(projectRoot);
	if (!fs.existsSync(layout.dir))
		throw new Error(`[ojm] CDN 目录不存在：${layout.dir}（先跑 ojm market publish，或检查 config 的 /cdn 挂载）`);

	const files = fs.readdirSync(layout.dir).filter(f => f.endsWith(".tgz")).sort();
	const packages: IndexedPackage[] = [];
	const skipped: string[] = [];
	for (const file of files) {
		const abs = path.join(layout.dir, file);
		const bytes = new Uint8Array(fs.readFileSync(abs));
		let manifest: Record<string, unknown> | null = null;
		try {
			manifest = readEmbeddedManifest(bytes);
		}
		catch (error) {
			console.warn(`[ojm] 跳过 ${file}：${(error as Error).message}`);
		}
		const name = typeof manifest?.name === "string" ? manifest.name as string : "";
		const version = typeof manifest?.version === "string" ? manifest.version as string : "";
		if (manifest === null || name === "" || version === "") {
			skipped.push(file);
			console.warn(`[ojm] 跳过 ${file}：包内缺 manifest.yaml 或缺少 name/version`);
			continue;
		}
		packages.push({
			name,
			version,
			file,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			size: bytes.byteLength,
			manifest,
			signature: readSidecarSig(abs),
		});
	}

	const yanked = readYankLedger(projectRoot);
	const data = buildIndexData(packages, yanked);
	const { slots, assignment } = packShards(data.solutions);

	const catalogPath = path.join(layout.dir, "catalog.yaml");
	const shardsDir = path.join(layout.dir, "shards");
	const existing = readExistingGeneration(catalogPath, shardsDir);

	// 装箱槽位 → 片号：内容一致的片沿用旧号与旧代次（不重写），变了的片取全新号
	const bodies = slots.map(slot => normalizeYaml({ solutions: slot.solutions }));
	const usedNos = new Set<number>([...existing.pins.keys(), ...existing.onDiskNos]);
	const byBody = new Map<string, ExistingShard>();
	for (const shard of existing.shards.values())
		byBody.set(shard.body, shard);

	/** 每个槽位的编号归属：fresh = 新片（本次写），reuse = 沿用旧片（不写） */
	type SlotRef = { kind: "fresh", no: number } | { kind: "reuse", shard: ExistingShard };
	const refs: SlotRef[] = [];
	let nextFresh = usedNos.size === 0 ? 1 : Math.max(...usedNos) + 1;
	const claimed = new Set<number>();
	for (const body of bodies) {
		const hit = byBody.get(body);
		if (hit !== undefined && !claimed.has(hit.no)) {
			// 内容未变：保留片号与代次，正文与签名都不重写（缓存/ETag 稳定）
			claimed.add(hit.no);
			refs.push({ kind: "reuse", shard: hit });
			continue;
		}
		refs.push({ kind: "fresh", no: nextFresh++ });
	}
	const nos = refs.map(ref => ref.kind === "reuse" ? ref.shard.no : ref.no);
	const freshCount = refs.filter(ref => ref.kind === "fresh").length;
	// 装箱槽位号 → 落盘片号：两者在「沿用旧号 / 新片让位」时并不相等（槽位 2 可能落到文件 3），
	// catalog 的映射与同代判定都必须用文件号——记槽位号会让 catalog 指向被清扫的旧片。
	const fileNosOf = (slotNos: number[]): number[] => slotNos.map(slot => nos[slot - 1]!);

	// 代次：catalog 正文（片钉 + 映射）变了才 +1；无变化的重建幂等（重复跑不漂移）
	const newMapping = new Map([...assignment.entries()].map(([name, list]) => [name, fileNosOf(list)]));
	const sameMapping = sameMappingAs(existing.mapping, newMapping);
	const seq = existing.seq === null || freshCount > 0 || !sameMapping ? (existing.seq ?? 0) + 1 : existing.seq;

	// REG-CS2 `latest` 单调不降（同名方案的新 latest 不得低于盘上旧值）
	assertLatestMonotonic(existing, bodies, yanked);

	// catalog：片钉（未变片 = 旧代次，新片 = 本次代次）+ 映射；正文只此一处带 seq 与时效
	const pins = new Map<number, number>();
	refs.forEach((ref, i) => {
		const no = nos[i]!;
		pins.set(no, ref.kind === "reuse" ? ref.shard.seq : seq);
	});
	const catalogDoc = {
		shards: Object.fromEntries([...pins.entries()].map(([no, s]) => [String(no), s])),
		solutions: [...newMapping.entries()].map(([name, list]) => ({ name, shards: list })),
	};
	const meta = indexMetaOf(seq, opts.now ?? Math.floor(Date.now() / 1000));
	const catalogText = stampIndexMeta(normalizeYaml(catalogDoc), meta);

	const pem = opts.privateKeyPem ?? readPemFrom(opts.id, opts.key);
	const keyId = opts.id ?? "";
	if (keyId === "")
		throw new Error("[ojm] 重建索引须给签名身份：--id <publisher.id>（.sig 的发布方标识；C2-37 命名空间）");

	const catalogSig = signIndex("catalog", seq, catalogText, pem, keyId);
	const shardSigs = new Map<number, ReturnType<typeof signIndex>>();
	refs.forEach((ref, i) => {
		if (ref.kind === "fresh")
			shardSigs.set(ref.no, signIndex("shard", pins.get(ref.no)!, bodies[i]!, pem, keyId));
	});

	fs.mkdirSync(shardsDir, { recursive: true });
	const written: string[] = [];
	// catalog 是提交点：覆盖前先留旧代字节，万一两个 rename 之间出事可原样恢复（fail-closed 之外的
	// 最后一道——正常路径永远走不到这里）
	const prevCatalog = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, "utf-8") : null;
	const prevCatalogSig = fs.existsSync(`${catalogPath}.sig`) ? fs.readFileSync(`${catalogPath}.sig`, "utf-8") : null;
	const catalogSigPath = `${catalogPath}.sig`;
	try {
		// 先分片（新片体 → 新片签），全部落地后再提交 catalog
		refs.forEach((ref, i) => {
			if (ref.kind !== "fresh")
				return;
			const shardPath = path.join(shardsDir, `${ref.no}.yaml`);
			writeIndexFile(shardPath, bodies[i]!);
			written.push(shardPath);
			const sigPath = `${shardPath}.sig`;
			writeIndexFile(sigPath, `${JSON.stringify(shardSigs.get(ref.no)!, null, 2)}\n`);
			written.push(sigPath);
		});
		opts.afterShards?.();
		// catalog 是提交点：正文先行、签名紧随（两个 rename 之间的微秒级窗口内新旧混搭，
		// 读取器按签名不符拒载——fail-closed，不会把中间态当有效索引用）
		writeIndexFile(catalogPath, catalogText);
		written.push(catalogPath);
		writeIndexFile(catalogSigPath, `${JSON.stringify(catalogSig, null, 2)}\n`);
		written.push(catalogSigPath);
	}
	catch (error) {
		// 本次写入的全部文件按「从未发生」回滚；tmp 残片一并扫掉。旧代原样可读。
		for (const file of written) {
			try {
				fs.rmSync(file, { force: true });
			}
			catch {}
		}
		// catalog 若已覆盖旧代：尽力恢复旧字节（无旧代 = 当时还没有索引，删掉即可）
		if (written.includes(catalogPath))
			restoreFile(catalogPath, prevCatalog);
		if (written.includes(catalogSigPath))
			restoreFile(catalogSigPath, prevCatalogSig);
		sweepTmpFiles(shardsDir);
		sweepTmpFiles(layout.dir);
		throw error;
	}

	// 提交后清场：不被新 catalog 引用的片（旧代残留 + 历史孤儿）与 tmp 残片
	const referenced = new Set(pins.keys());
	for (const no of fs.readdirSync(shardsDir)) {
		if (/^\d+\.yaml(?:\.sig)?$/.test(no)) {
			const fileNo = Number.parseInt(no, 10);
			if (!referenced.has(fileNo)) {
				try {
					fs.rmSync(path.join(shardsDir, no), { force: true });
				}
				catch {}
			}
		}
	}
	sweepTmpFiles(shardsDir);
	sweepTmpFiles(layout.dir);

	// 离线自检：catalog + 各片签名都能用公钥复核（含未重写的沿用片——它们也必须在盘上可验）
	let checkPassed: boolean | undefined;
	if (opts.check === true) {
		const shardsOk = [...pins.entries()].every(([no]) => {
			const text = fs.readFileSync(path.join(shardsDir, `${no}.yaml`), "utf-8");
			const sig = JSON.parse(fs.readFileSync(path.join(shardsDir, `${no}.yaml.sig`), "utf-8")) as { public_key: string, value: string, seq: number };
			return sig.seq === pins.get(no) && verifyCanonical(sig.public_key, indexCanonical("shard", sig.seq, text), sig.value);
		});
		const catalogOk = verifyCanonical(catalogSig.public_key, indexCanonical("catalog", seq, catalogText), catalogSig.value);
		checkPassed = catalogOk && shardsOk;
		console.log(checkPassed ? "[ojm] 自检通过：索引签名与内容匹配" : "[ojm] 自检失败：索引签名与内容不匹配——请检查私钥与索引后重试");
		if (!checkPassed)
			process.exitCode = 1;
	}

	const shardPaths = [...pins.keys()].sort((a, b) => a - b).map(no => path.join(shardsDir, `${no}.yaml`));
	console.log(`[ojm] 索引已重建：${data.solutions.length} 个方案 / ${packages.length} 个版本 → catalog（第 ${seq} 代）+ ${pins.size} 片（来源 ${files.length} 个 tgz，${freshCount} 片重写）`);
	if (skipped.length > 0)
		console.warn(`[ojm] ${skipped.length} 个包被跳过：${skipped.join(", ")}`);

	return {
		catalogPath,
		catalogSigPath: `${catalogPath}.sig`,
		shardPaths,
		solutions: data.solutions.length,
		shards: pins.size,
		skipped,
		seq,
		issuedAt: meta.issued_at,
		expiresAt: meta.expires_at,
		checkPassed,
	};
}

/**
 * 读盘上既有代次：catalog（seq + 片钉 + 映射）与各被钉住片的正文。
 *
 * 只在「catalog 可解析、seq 合法、片文件与 .sig 俱在且 .sig.seq == 钉值」时认一片——
 * 缺任一片都只少一次内容匹配机会（该槽位按新片重写），不影响其余片沿用。
 * catalog 整体不可信 → 空代次（seq=1 全量重来，与旧版「索引丢了就重建」同语义）。
 */
function readExistingGeneration(catalogPath: string, shardsDir: string): {
	seq: number | null
	pins: Map<number, number>
	shards: Map<number, ExistingShard>
	mapping: Map<string, number[]> | null
	onDiskNos: number[]
} {
	const empty = { seq: null, pins: new Map<number, number>(), shards: new Map<number, ExistingShard>(), mapping: null, onDiskNos: [] as number[] };
	if (!fs.existsSync(catalogPath))
		return { ...empty, onDiskNos: onDiskShardNos(shardsDir) };
	let doc: unknown;
	try {
		doc = yamlParse(fs.readFileSync(catalogPath, "utf-8"));
	}
	catch {
		return { ...empty, onDiskNos: onDiskShardNos(shardsDir) };
	}
	if (!isObj(doc))
		return { ...empty, onDiskNos: onDiskShardNos(shardsDir) };
	const seq = (doc as Record<string, unknown>).seq;
	if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1)
		return { ...empty, onDiskNos: onDiskShardNos(shardsDir) };

	const pins = new Map<number, number>();
	const rawPins = (doc as Record<string, unknown>).shards;
	if (isObj(rawPins)) {
		for (const [k, v] of Object.entries(rawPins)) {
			const no = Number.parseInt(k, 10);
			if (Number.isInteger(no) && no >= 1 && typeof v === "number" && Number.isInteger(v) && v >= 1)
				pins.set(no, v);
		}
	}
	const mapping = new Map<string, number[]>();
	const rawSolutions = (doc as Record<string, unknown>).solutions;
	if (Array.isArray(rawSolutions)) {
		for (const s of rawSolutions) {
			if (!isObj(s))
				continue;
			const name = s.name;
			const list = s.shards;
			if (typeof name !== "string" || !Array.isArray(list))
				continue;
			mapping.set(name, list.filter((n): n is number => typeof n === "number" && Number.isInteger(n)));
		}
	}

	const shards = new Map<number, ExistingShard>();
	for (const [no, pinSeq] of pins) {
		const shardPath = path.join(shardsDir, `${no}.yaml`);
		const sigPath = `${shardPath}.sig`;
		if (!fs.existsSync(shardPath) || !fs.existsSync(sigPath))
			continue;
		let sig: { seq?: unknown };
		try {
			sig = JSON.parse(fs.readFileSync(sigPath, "utf-8")) as { seq?: unknown };
		}
		catch {
			continue;
		}
		// .sig 代次与 catalog 钉值不一致 = 盘上已是中间态，该片不可沿用
		if (sig?.seq !== pinSeq)
			continue;
		try {
			shards.set(no, { no, seq: pinSeq, body: recomputeIndex(fs.readFileSync(shardPath, "utf-8")) });
		}
		catch {
			// 正文不可解析：不可比对，按新片重写
		}
	}
	return { seq, pins, shards, mapping, onDiskNos: onDiskShardNos(shardsDir) };
}

/** 盘上 `shards/` 里现存的片号（含历史孤儿——新片号必须避开它们，防 rename 踩掉正在被读的文件） */
function onDiskShardNos(shardsDir: string): number[] {
	if (!fs.existsSync(shardsDir))
		return [];
	return fs.readdirSync(shardsDir)
		.filter(f => /^\d+\.yaml$/.test(f))
		.map(f => Number.parseInt(f, 10))
		.filter(n => Number.isInteger(n) && n >= 1)
		.sort((a, b) => a - b);
}

/**
 * 新旧 catalog 映射是否逐字一致（键集合同、每键片号列表同序同值）——一致即「本次重建没有
 * 改变 catalog 正文」，代次不 +1（重复跑不漂移）。布尔式保持函数式单行返回值：本仓
 * indent-binary-ops 与 no-mixed-spaces-and-tabs 对续行缩进的要求互相打架，见 verify.ts 同款注释。
 */
function sameMappingAs(prev: Map<string, number[]> | null, next: Map<string, number[]>): boolean {
	if (prev === null || prev.size !== next.size)
		return false;
	return [...next.entries()].every(([name, list]) => {
		const before = prev.get(name);
		return before !== undefined && before.length === list.length && before.every((no, i) => no === list[i]);
	});
}

/**
 * REG-CS2 `latest` 单调不降：同名方案的新 `latest` 不得低于盘上旧值。
 *
 * 丢包、误删版本目录、拿回旧快照重建都会让 latest 往回走——读者据此把「更旧」当「有更新」装上，
 * 而已装实例还停在更高的版本上，回滚与升级判定全线错位。宁可拒建，也不产出一个往回走的索引。
 * 旧值取自既有代次的分片正文（三级化后 latest 住在片里，不在 catalog）。
 */
function assertLatestMonotonic(existing: { shards: Map<number, ExistingShard>, mapping: Map<string, number[]> | null }, bodies: string[], yanked?: Map<string, { name: string, version: string, at: number, by: string, reason?: string }>): void {
	if (existing.mapping === null)
		return;
	const before = latestMapOf(existing.shards, existing.mapping);
	const after = new Map<string, string>();
	for (const body of bodies) {
		for (const [name, latest] of latestMapOfBody(body)) {
			if (!after.has(name))
				after.set(name, latest);
		}
	}
	for (const [name, version] of after) {
		const prev = before.get(name);
		// 例外：旧 latest 此刻已被 yank（REG-CS4）——合法的下线会让 latest 主动下降，不算回退。
		// 只有「非 yank 驱动的下降」才判回退（误删版本 / 拿回旧索引）。
		if (prev !== undefined && compareSemver(version, prev) < 0 && yanked?.has(`${name}@${prev}`) !== true)
			throw new Error(`[ojm] ${name} 的 latest 回退（${prev} → ${version}）：REG-CS2 要求 latest 单调不降——检查是否有版本被误删或拿回了旧索引`);
	}
}

/** 既有代次的 `方案 → latest`（按 catalog 映射找到每个包所在片，取片内条目） */
function latestMapOf(shards: Map<number, ExistingShard>, mapping: Map<string, number[]>): Map<string, string> {
	const out = new Map<string, string>();
	for (const [name, list] of mapping) {
		for (const no of list) {
			const shard = shards.get(no);
			if (shard === undefined)
				continue;
			for (const [n, latest] of latestMapOfBody(shard.body)) {
				if (n === name && !out.has(name))
					out.set(name, latest);
			}
		}
	}
	return out;
}

/** 一片正文的 `方案 → latest`（解析失败 → 空表） */
function latestMapOfBody(body: string): Map<string, string> {
	const out = new Map<string, string>();
	let doc: unknown;
	try {
		doc = yamlParse(body);
	}
	catch {
		return out;
	}
	const solutions = (isObj(doc) ? doc.solutions : undefined) as unknown;
	for (const s of Array.isArray(solutions) ? solutions : []) {
		if (!isObj(s))
			continue;
		const { name, latest } = s as { name?: unknown, latest?: unknown };
		if (typeof name === "string" && typeof latest === "string")
			out.set(name, latest);
	}
	return out;
}

/**
 * 读包级 detached 签名侧车（`<tgz>.sig`），转成 Form B `archive.signature`。
 *
 * 为什么非读不可：安装器 verifying 段只认 Form B 的 archive.signature（同目录侧车不参与判定），
 * 没有它一律 `sig_missing` 硬 fail-closed——索引是「包 + 签名」的聚合视图，少带签名等于把包报成不可装。
 */
function readSidecarSig(tgzPath: string): Record<string, unknown> | undefined {
	const sigPath = `${tgzPath}.sig`;
	if (!fs.existsSync(sigPath))
		return undefined;
	try {
		const parsed = JSON.parse(fs.readFileSync(sigPath, "utf-8")) as unknown;
		return isObj(parsed) ? parsed as Record<string, unknown> : undefined;
	}
	catch {
		console.warn(`[ojm] ${sigPath} 不是合法 JSON，已按无签名处理（该包会被安装器以 sig_missing 拒装）`);
		return undefined;
	}
}

function isObj(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 确定性 stringify：键序归一 + 无软换行，和既有 publish 的索引口径逐字一致 */
function normalizeYaml(value: unknown): string {
	return recomputeIndex(yamlStringify(value, { lineWidth: 0 }));
}

/** 扫掉目录里的 tmp 残片（历史崩溃遗留；不可读为索引，但没必要留在读面目录） */
function sweepTmpFiles(dir: string): void {
	if (!fs.existsSync(dir))
		return;
	for (const f of fs.readdirSync(dir)) {
		if (f.includes(".tmp.")) {
			try {
				fs.rmSync(path.join(dir, f), { force: true });
			}
			catch {}
		}
	}
}

/** 回滚恢复：写回旧代字节（无旧代 = 删除）。只用于 catalog 提交窗口内的异常恢复 */
function restoreFile(file: string, prev: string | null): void {
	try {
		if (prev === null)
			fs.rmSync(file, { force: true });
		else
			writeIndexFile(file, prev);
	}
	catch {}
}

/** 从身份目录或私钥文件读出 PEM（磁盘路径是常规场景；隔离场景应直接传内存 PEM） */
function readPemFrom(id?: string, key?: string): string {
	const fsKey = key ?? (id === undefined ? undefined : path.join(os.homedir(), ".ojm", "keys", id, "private.pem"));
	if (fsKey === undefined)
		throw new Error("[ojm] 缺少签名身份：--id <publisher.id> 或 --key <pem 路径>");
	if (!fs.existsSync(fsKey))
		throw new Error(`[ojm] 私钥文件不存在：${fsKey}（用 ojm keygen --id ${id} 生成）`);
	return fs.readFileSync(fsKey, "utf-8");
}
