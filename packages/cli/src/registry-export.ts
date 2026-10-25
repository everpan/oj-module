// ojm registry export（REG-R11 离线包的**产出端**）：从一个 registry 站点的读面把一个可直接
// `ojm registry import` 吃的离线包拉下来。
//
// 为什么需要它：离线包的消费端（import）早就有了，产出端一直靠手工拼——public 站点能拿
// `<cdn>/registry/` 整个拷，private 站点（REG-R8 的 `private` 载体）压根没有那个静态目录，
// 只能照着格式一个文件一个文件 curl。这条命令就是把「照着格式 curl」自动化，并把最容易拼错的
// 三件事（分片代数与钉值一致、包体 sha 与索引一致、吊销清单必须有签名）当场判掉。
//
// 走的是**读面**（`/api/oj-registry/cdn/...`），不是静态目录：读面在两种载体下行为一致，
// 而且正文与 `.sig` 侧车是分开取的（拆开取才保住「两种载体正文逐字节一致」，REG-R8）。
//
// 校验口径**只到自洽**，判三件事：
//   ① catalog / 各分片 / revocations 的正文与各自 `.sig` 对得上（`registry-sidecar`，与 import 同一函数）；
//   ② 分片签名声明的代次 = catalog 钉值（`index_generation_mismatch`）——不一致说明源正在重建，抓到的是半代索引；
//   ③ 每个包体的 sha256 / size 与索引条目声明的一致（`package_sha_mismatch`）——下载被截断/串包当场暴露。
// **信任不在这里判**：这把公钥是不是本站登记的 active 索引 key，只有 import（有本地信任库）能判。
// 导出侧若拿源自己给的公钥去验源自己给的签名，等于没验——所以本命令不产出 index-keys.json，
// 也不写本地信任库（那是 TOFU 的入口，不能由「导出」这种批量动作顺手完成）。
//
// 产物结构（与 `ojm registry import` 逐字对齐）：
//   <out>/source.json                    ← origin / 代次 / 导出时间（import 用它给 seq 账本分桶）
//   <out>/registry/catalog.yaml(+.sig)
//   <out>/registry/shards/<n>.yaml(+.sig)
//   <out>/registry/revocations.yaml(+.sig)
//   <out>/registry/<slug>-<version>.tgz(+.sig)   ← 平铺，文件名按 slug 构造（不信 archive.file，防路径穿越）
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse as yamlParse } from "yaml";
import { UsageError } from "./exit-codes";
import { indexCanonical, revocationCanonical, shardPinsOf } from "./publish";
import { REGISTRY_SUBDIR } from "./registry-import";
import { inspectSidecar } from "./registry-sidecar";

/** registry 读面路由前缀（与 oj-registry 的模块路由逐字一致） */
export const CDN_ROUTE_PREFIX = "/api/oj-registry/cdn";

/** 默认并发下载数：串行在大仓上慢到不可用，太高又把小站点打满 */
const DEFAULT_CONCURRENCY = 4;

/** 文件名安全字符集：slug 与 version 都会进文件名与 URL，不允许路径分隔符 */
const SLUG_RE = /^[a-z0-9][\w.-]*$/i;
const VERSION_RE = /^[0-9A-Z][0-9A-Z.+-]*$/i;

export class RegistryExportError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "RegistryExportError";
	}
}

export interface RegistryExportOptions {
	/** registry 站点根地址（该站的 canonical_origin），如 https://site.example.com */
	siteUrl: string
	/** 产物根目录；离线包落 `<out>/registry/`。缺省当前目录 */
	out?: string
	/** 只验索引 + 列出本应写入的文件（不下载包体），零落盘 */
	dryRun?: boolean
	/** 机器可读输出（真正的信封在 cli.ts，这里只影响调用方） */
	json?: boolean
	/** 测试注入；缺省 process.cwd() */
	cwd?: string
	/** 测试注入 fetch */
	fetchFn?: typeof fetch
	/** 并发下载上限（缺省 4） */
	concurrency?: number
}

export interface RegistryExportResult {
	/** 站点地址（归一化后，写进 source.json 的 origin） */
	siteUrl: string
	/** 产物根目录 */
	outDir: string
	/** 离线包的 registry 子目录（`<out>/registry`） */
	target: string
	/** 总目录代次（来自 catalog 的签名侧车） */
	catalogSeq: number
	/** 吊销清单代次 */
	revocationSeq: number
	/** 本次导出的分片号（升序） */
	shards: number[]
	/** 索引里声明的版本数（= 包体文件数） */
	packages: number
	/** 验签扫过的索引类文件数（catalog + 各分片 + revocations） */
	verified: number
	/** 实际写入 / 本应写入的文件（相对 <out>；`--dry-run` 下是计划） */
	written: string[]
	/** 包体总字节数（`--dry-run` 下为索引声明值之和） */
	bytes: number
	dryRun: boolean
}

/** 一个待下载的包体（从分片条目里抽出来的最小事实集） */
interface PackageRef {
	slug: string
	version: string
	/** 平铺文件名：`<slug>-<version>.tgz` */
	file: string
	sha256: string
	size: number
}

interface RawResponse {
	status: number
	bytes: Uint8Array
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function textOf(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

/** 站点地址归一：去尾斜杠、只收 http(s)（与 `--registry` 同口径，别让人传个裸域名） */
function normalizeSiteUrl(raw: unknown): string {
	const url = String(raw ?? "").trim().replace(/\/+$/, "");
	if (url === "")
		throw new UsageError("[ojm] 用法：ojm registry export --site-url <registry 站点地址> [--out <目录>] [--dry-run] [--json]\n  --site-url 形如 https://site.example.com（该站的 canonical_origin）");
	if (!/^https?:\/\/\S+$/i.test(url))
		throw new UsageError(`[ojm] --site-url 只接受 http(s) 地址，收到「${url}」（形如 https://site.example.com）`);
	return url;
}

async function fetchRaw(fetchFn: typeof fetch, url: string, what: string): Promise<RawResponse> {
	let res: Response;
	try {
		res = await fetchFn(url);
	}
	catch (error) {
		throw new RegistryExportError("export_fetch_failed", `取${what}失败（${url}）：${(error as Error).message}——检查站点地址、网络与证书`);
	}
	if (!res.ok && res.status !== 404)
		throw new RegistryExportError("export_fetch_failed", `取${what}失败（${url}）：HTTP ${res.status}`);
	return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** 取索引类正文（必须 200；404 也按失败报，错误消息里带上补的命令名） */
async function fetchBody(fetchFn: typeof fetch, url: string, what: string): Promise<string> {
	const res = await fetchRaw(fetchFn, url, what);
	if (res.status === 404)
		throw new RegistryExportError("export_fetch_failed", `站点没有${what}（${url} 返回 404）——确认站点已启用 oj-registry 且索引已生成（POST /index/static 或 /index/signature）`);
	return textOf(res.bytes);
}

/** 取 `index` / `shards/<n>` 的侧车；缺侧车是 fail-closed（REG-CS1），不降级成「没有签名也能用」 */
async function fetchIndexSig(fetchFn: typeof fetch, url: string, what: string): Promise<string> {
	const res = await fetchRaw(fetchFn, url, what);
	if (res.status === 404)
		throw new RegistryExportError("index_sig_missing", `站点没有${what}的签名侧车（${url} 返回 404）——完整性无保障，已停止导出`);
	const text = textOf(res.bytes);
	if (text.trim() === "")
		throw new RegistryExportError("index_sig_missing", `${what}的签名侧车是空正文（${url}）——完整性无保障，已停止导出`);
	return text;
}

/** 取吊销清单侧车；没有签名就不产离线包（空清单也必须签，REG-R10） */
async function fetchRevocationSig(fetchFn: typeof fetch, url: string): Promise<string> {
	const res = await fetchRaw(fetchFn, url, "吊销清单签名");
	if (res.status === 404)
		throw new RegistryExportError("revocations_sig_missing", `站点还没给吊销清单签过名（${url} 返回 404）——装不上也导不出：先走 POST /revocations/signature 签一次`);
	const text = textOf(res.bytes);
	if (text.trim() === "")
		throw new RegistryExportError("revocations_sig_missing", `吊销清单签名侧车是空正文（${url}）——完整性无保障，已停止导出`);
	return text;
}

/** 从分片正文抽出包体清单；形状不对按 `offline_format`（源的数据坏了，不是用法问题） */
function packagesOf(shardNo: number, text: string): PackageRef[] {
	const where = `分片 shards/${shardNo}.yaml`;
	let doc: unknown;
	try {
		doc = yamlParse(text);
	}
	catch {
		throw new RegistryExportError("offline_format", `${where} 不是合法 YAML——源正在重建索引或读到半份文件，稍后重试`);
	}
	const solutions = (doc !== null && typeof doc === "object" && !Array.isArray(doc))
		? (doc as Record<string, unknown>).solutions
		: undefined;
	if (!Array.isArray(solutions))
		throw new RegistryExportError("offline_format", `${where} 缺 solutions 数组——结构破损，无法确定要下载哪些包体`);

	const out: PackageRef[] = [];
	for (const entry of solutions as unknown[]) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry))
			throw new RegistryExportError("offline_format", `${where} 的方案条目不是对象`);
		const solution = entry as Record<string, unknown>;
		const slug = String(solution.name ?? "");
		if (!SLUG_RE.test(slug))
			throw new RegistryExportError("offline_format", `${where} 的方案名「${slug}」不是合法 slug（只允许字母数字与 . _ -）——拒绝把它拼进文件路径`);
		const versions = solution.versions;
		if (!Array.isArray(versions))
			throw new RegistryExportError("offline_format", `${where} 的方案 ${slug} 缺 versions 数组`);
		for (const raw of versions as unknown[]) {
			if (raw === null || typeof raw !== "object" || Array.isArray(raw))
				throw new RegistryExportError("offline_format", `${where} 的版本条目不是对象（方案 ${slug}）`);
			const v = raw as Record<string, unknown>;
			const version = String(v.version ?? "");
			if (!VERSION_RE.test(version))
				throw new RegistryExportError("offline_format", `${where} 的版本号「${version}」不合法（方案 ${slug}）——拒绝把它拼进文件路径`);
			const archive = (v.archive !== null && typeof v.archive === "object" && !Array.isArray(v.archive))
				? v.archive as Record<string, unknown>
				: null;
			const sha256 = String(archive?.sha256 ?? "").toLowerCase();
			if (!/^[0-9a-f]{64}$/.test(sha256))
				throw new RegistryExportError("offline_format", `${where} 的 ${slug}@${version} 缺合法的 archive.sha256——没有摘要就无法证明下载完整`);
			const size = Number(archive?.size);
			if (!Number.isInteger(size) || size < 0)
				throw new RegistryExportError("offline_format", `${where} 的 ${slug}@${version} 的 archive.size 不合法`);
			// 文件名按 slug/version 构造而不是信 archive.file：那条字段来自源，指到 `../` 就能写出目录外
			out.push({ slug, version, file: `${slug}-${version}.tgz`, sha256, size });
		}
	}
	return out;
}

/** 限并发映射：任一任务失败即停（不再发起新的），并把第一个错误抛给调用方 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const out = Array.from<R>({ length: items.length });
	let cursor = 0;
	let failure: unknown = null;
	const width = Math.max(1, Math.min(limit, items.length));
	const workers = Array.from({ length: width }, async () => {
		while (failure === null) {
			const index = cursor++;
			if (index >= items.length)
				return;
			try {
				out[index] = await fn(items[index]!, index);
			}
			catch (error) {
				failure = failure ?? error;
				return;
			}
		}
	});
	await Promise.all(workers);
	if (failure !== null)
		throw failure;
	return out;
}

function writeFile(file: string, data: string | Uint8Array): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, data);
}

/**
 * 业务命令体。返回结果（测试/CI 断言用）；不打印、不 exit——输出与退出码归 cli.ts。
 *
 * 落盘是「先全下到隐藏暂存目录，最后整体换位」：中途失败（包体 sha 不符、网络断）不会在
 * `<out>/registry/` 留下半份离线包——那种半份包最坑，看着像能导，import 到一半才炸。
 */
export async function registryExportCommand(opts: RegistryExportOptions): Promise<RegistryExportResult> {
	const siteUrl = normalizeSiteUrl(opts.siteUrl);
	const cwd = opts.cwd ?? process.cwd();
	const fetchFn = opts.fetchFn ?? globalThis.fetch;
	const outDir = path.resolve(cwd, opts.out ?? ".");
	const target = path.join(outDir, REGISTRY_SUBDIR);
	const api = `${siteUrl}${CDN_ROUTE_PREFIX}`;
	const dryRun = opts.dryRun === true;

	// ① 索引层：catalog → 钉值 → 各分片 → 吊销清单，逐份验自洽
	const catalogText = await fetchBody(fetchFn, `${api}/index`, "索引总目录");
	const catalogSig = await fetchIndexSig(fetchFn, `${api}/index/signature`, "索引总目录");
	const catalogVerify = inspectSidecar({ rel: "catalog.yaml", body: catalogText, sigText: catalogSig, canon: (seq, t) => indexCanonical("catalog", seq, t) });
	if (!catalogVerify.ok || catalogVerify.seq === null)
		throw new RegistryExportError(catalogVerify.code ?? "index_sig_mismatch", catalogVerify.message ?? "索引总目录验签失败");
	const catalogSeq = catalogVerify.seq;

	const pins = shardPinsOf(catalogText);
	if (pins.size === 0)
		throw new RegistryExportError("offline_format", "索引总目录的分片钉值为空——结构破损，无法确定要导出哪些分片");
	const shardNos = [...pins.keys()].sort((a, b) => a - b);

	const shardTexts = new Map<number, { body: string, sig: string }>();
	const refs: PackageRef[] = [];
	const seen = new Set<string>();
	for (const no of shardNos) {
		const body = await fetchBody(fetchFn, `${api}/shard/${no}`, `分片 shards/${no}.yaml`);
		const sig = await fetchIndexSig(fetchFn, `${api}/shard/${no}/signature`, `分片 shards/${no}.yaml`);
		const verdict = inspectSidecar({ rel: `shards/${no}.yaml`, body, sigText: sig, canon: (seq, t) => indexCanonical("shard", seq, t) });
		if (!verdict.ok)
			throw new RegistryExportError(verdict.code ?? "index_sig_mismatch", verdict.message ?? `分片 shards/${no}.yaml 验签失败`);
		if (verdict.seq !== pins.get(no))
			throw new RegistryExportError("index_generation_mismatch", `分片 shards/${no}.yaml 签名是第 ${String(verdict.seq)} 代，总目录钉的是第 ${pins.get(no)} 代——源正在重建索引，导出会得到半代产物，先等索引稳定再导出`);
		shardTexts.set(no, { body, sig });
		for (const ref of packagesOf(no, body)) {
			const key = `${ref.slug}@${ref.version}`;
			if (seen.has(key))
				throw new RegistryExportError("offline_format", `${key} 在分片里出现了两次——索引自相矛盾，导出会互相覆盖`);
			seen.add(key);
			refs.push(ref);
		}
	}

	const revBody = await fetchBody(fetchFn, `${api}/revocations`, "吊销清单");
	const revSig = await fetchRevocationSig(fetchFn, `${api}/revocations/signature`);
	const revVerdict = inspectSidecar({ rel: "revocations.yaml", body: revBody, sigText: revSig, canon: (seq, t) => revocationCanonical(seq, t) });
	if (!revVerdict.ok || revVerdict.seq === null)
		throw new RegistryExportError(revVerdict.code ?? "revocations_sig_mismatch", revVerdict.message ?? "吊销清单验签失败");
	const revocationSeq = revVerdict.seq;

	const verified = 1 + shardNos.length + 1;
	const indexFiles = [
		"catalog.yaml",
		"catalog.yaml.sig",
		...shardNos.flatMap(no => [`shards/${no}.yaml`, `shards/${no}.yaml.sig`]),
		"revocations.yaml",
		"revocations.yaml.sig",
	];
	const packageFiles = refs.flatMap(ref => [ref.file, `${ref.file}.sig`]);
	// 相对 <out> 列（与 import 的 written 相对落点列同一语义，但这里多一层 registry/）
	const written = [...indexFiles, ...packageFiles].map(f => `${REGISTRY_SUBDIR}/${f}`).concat("source.json");
	const declaredBytes = refs.reduce((sum, ref) => sum + ref.size, 0);

	// ② dry-run：索引层已验完，包体不下载（那是全部流量），只报计划
	if (dryRun) {
		return {
			siteUrl,
			outDir,
			target,
			catalogSeq,
			revocationSeq,
			shards: shardNos,
			packages: refs.length,
			verified,
			written,
			bytes: declaredBytes,
			dryRun: true,
		};
	}

	// ③ 下载 + 落盘：先全下到暂存目录，最后整体换位
	const staging = path.join(outDir, `.ojm-registry-export-${process.pid}`);
	fs.rmSync(staging, { recursive: true, force: true });
	fs.mkdirSync(staging, { recursive: true });
	let bytes = 0;
	try {
		writeFile(path.join(staging, "catalog.yaml"), catalogText);
		writeFile(path.join(staging, "catalog.yaml.sig"), catalogSig);
		for (const no of shardNos) {
			const shard = shardTexts.get(no)!;
			writeFile(path.join(staging, "shards", `${no}.yaml`), shard.body);
			writeFile(path.join(staging, "shards", `${no}.yaml.sig`), shard.sig);
		}
		writeFile(path.join(staging, "revocations.yaml"), revBody);
		writeFile(path.join(staging, "revocations.yaml.sig"), revSig);

		await mapLimit(refs, opts.concurrency ?? DEFAULT_CONCURRENCY, async (ref) => {
			const url = `${api}/package/${encodeURIComponent(ref.slug)}/${encodeURIComponent(ref.version)}`;
			const res = await fetchRaw(fetchFn, url, `包体 ${ref.file}`);
			if (res.status !== 200)
				throw new RegistryExportError("export_fetch_failed", `取包体 ${ref.file} 失败（${url}）：HTTP ${res.status}`);
			// ③a 长度与摘要都对一遍：长度不对是截断/串包（消息更好定位），摘要不对是内容被替换
			if (res.bytes.byteLength !== ref.size)
				throw new RegistryExportError("package_sha_mismatch", `包体 ${ref.file} 长度 ${res.bytes.byteLength} 字节，索引声明 ${ref.size} 字节——下载被截断或串包，已停止导出`);
			const actual = sha256Hex(res.bytes);
			if (actual !== ref.sha256)
				throw new RegistryExportError("package_sha_mismatch", `包体 ${ref.file} 的 sha256 是 ${actual}，索引声明 ${ref.sha256}——内容被替换或损坏，已停止导出`);
			const sigRes = await fetchRaw(fetchFn, `${url}/signature`, `包体签名 ${ref.file}.sig`);
			if (sigRes.status !== 200)
				throw new RegistryExportError("export_fetch_failed", `取包体签名 ${ref.file}.sig 失败（${url}/signature）：HTTP ${sigRes.status}——缺它安装侧无法验包，已停止导出`);
			writeFile(path.join(staging, ref.file), res.bytes);
			writeFile(path.join(staging, `${ref.file}.sig`), sigRes.bytes);
			bytes += res.bytes.byteLength;
		});

		// ④ 换位：先清旧 registry/ 再整体改名，保证「落盘 = 本次导出的完整一代」
		fs.rmSync(target, { recursive: true, force: true });
		fs.renameSync(staging, target);
	}
	catch (error) {
		fs.rmSync(staging, { recursive: true, force: true });
		throw error;
	}

	// ⑤ source.json 最后写：它一出现就代表这一代导出成功（import 靠它给 seq 账本分桶）
	writeFile(path.join(outDir, "source.json"), `${JSON.stringify({
		origin: siteUrl,
		exported_at: new Date().toISOString(),
		catalog_seq: catalogSeq,
		revocation_seq: revocationSeq,
		shards: shardNos,
		packages: refs.length,
	}, null, 2)}\n`);

	return {
		siteUrl,
		outDir,
		target,
		catalogSeq,
		revocationSeq,
		shards: shardNos,
		packages: refs.length,
		verified,
		written,
		bytes,
		dryRun: false,
	};
}
