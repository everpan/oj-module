// 解压步骤（P1-6，十阶段 stage 4 extracting）：R1 zip-slip 防护的 list→validate→extract 三步范式
// （S1-2.2 裁决：tar 会忠实重建 symlink/hardlink，先列后解是安全必需而非优化）。
// listing 必须来自 -tvzf verbose 形态（消费方铁律①：非 verbose 裸名首字符撞 l/h 误拒，勿换 -tzf）；
// 喂 validateTarListing 前先 trim 尾部空行再 split（铁律②：尾随空行=空成员名必拒）。
// 任一恶意成员 → 全拒且零解压零落盘（附录 A extracting「安装已终止且零落盘」）；校验通过才
// `tar -xzf -C staging`，解压到 staging 就位即止——版本目录 rename 由 P1-10 落锁段接管。
// argv 与平台 exec 白名单逐字对齐（S1-2 基座 yaml），不得添加未白名单旗标——安全性由
// validate 段 + `-C` 限定目标目录承担，而非 tar 旗标。exec 面经 ctx 注入（DIP，测试 stub）。

import type { InstallContext } from "./preflight";
import { fsFace } from "../atomic";
import { validateTarListing } from "../tgz-guard";
import { archiveFileOf } from "./download";

export interface ExecResult {
	code: number
	stdout: string
	stderr: string
}

export interface ExecFace {
	/** opts 透传平台 exec.run（timeoutMs 等；0.1.78 共用 opts——缺省 30s 会杀长命令） */
	run: (argv: string[], opts?: { timeoutMs?: number }) => Promise<ExecResult>
	/**
	 * oj 0.1.78 流式形态（P2-13 feature-detect 存在性；缺失回落 exec.run——stage 粒度，进度不增量刷）。
	 * stdout/stderr 为 AsyncIterable<Uint8Array>（原始字节，UTF-8 切块自管）；exit() 等待退出；
	 * 超时/超限不抛错只 code=137（v0.1.79 订正）。消费面：migrate 段进度流（h.kill() 主动取消归 P3，G2）。
	 */
	spawn?: (argv: string[], opts?: { timeoutMs?: number }) => Promise<ExecSpawnHandle>
}

/** exec.spawn 句柄（devkit api-manual「exec 流式形态 v0.1.78」；devkit global.d.ts 未收录，此处按契约镜像） */
export interface ExecSpawnHandle {
	stdout: AsyncIterable<Uint8Array>
	stderr: AsyncIterable<Uint8Array>
	exit: () => Promise<{ code: number }>
	kill: () => void
}

export interface ExtractContext extends InstallContext {
	/** 暂存目录（下载/校验/解压三步同目录接力；亦为解压 -C 目标） */
	staging: string
	/** 注入式 exec 面（平台 exec.run；测试 stub 不真跑 tar） */
	exec: ExecFace
}

export interface StageResult {
	stage: "extracting"
	ok: boolean
	message: string
	retryable?: boolean
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** tar 列表命令（逐字断言）：-tvzf verbose 形态是 validateTarListing 的输入契约（铁律①） */
export function buildListCmd(file: string): string[] {
	return ["tar", "-tvzf", file];
}

/** tar 解压命令（逐字断言）：-C 限定 staging；对齐 S1-2 白名单 `tar -xzf ${path:archive} -C ${path:dest}` */
export function buildExtractCmd(file: string, staging: string): string[] {
	return ["tar", "-xzf", file, "-C", staging];
}

export async function extract(ctx: ExtractContext): Promise<StageResult> {
	const arch = archiveFileOf(ctx.manifest);
	if (!arch.ok) {
		return { stage: "extracting", ok: false, retryable: false, message: `解压失败：${arch.message}` };
	}
	const file = `${ctx.staging}/${arch.file}`;
	try {
		// 第一步 list：verbose listing 是安全校验的唯一输入（R1）
		const listed = await ctx.exec.run(buildListCmd(file));
		if (listed.code !== 0) {
			return {
				stage: "extracting",
				ok: false,
				retryable: true,
				message: `解压失败：tar 列表失败（exit ${listed.code}）：${(listed.stderr || listed.stdout).trim()}（R1 三步范式第一步；附录 A extracting）`,
			};
		}
		// 铁律②：tar 输出恒带尾随换行（可能多个空行），先 trim 尾部空行再 split
		const lines = listed.stdout.replace(/\n+$/, "").split("\n");
		// 第二步 validate：任一越界/链接成员即全拒，零解压
		const v = validateTarListing(lines);
		if (!v.ok) {
			return {
				stage: "extracting",
				ok: false,
				retryable: true,
				message: `解压失败：包内容未通过安全校验（R1：offender「${v.offender}」为越界/链接成员）——零解压零落盘，附录 A extracting：若反复出现请勿使用该分发包`,
			};
		}
		// 第三步 extract：校验通过才落盘；-C staging 就位即止，rename 由 P1-10 落锁段接管
		const extracted = await ctx.exec.run(buildExtractCmd(file, ctx.staging));
		if (extracted.code !== 0) {
			return {
				stage: "extracting",
				ok: false,
				retryable: true,
				message: `解压失败：tar 解压失败（exit ${extracted.code}）：${(extracted.stderr || extracted.stdout).trim()}（R1 三步范式第三步；附录 A extracting）`,
			};
		}
		await flattenBundleRoot(ctx.staging);
		const c31 = await checkApiSegment(ctx);
		if (!c31.ok) {
			return { stage: "extracting", ok: false, retryable: false, message: c31.message };
		}
		return { stage: "extracting", ok: true, message: `解压完成：${lines.length} 个成员 → ${ctx.staging}/（单根已归平，§2.9 布局消费点；C2-31 复核通过；目录 rename 由 P1-10 落锁段接管）` };
	}
	catch (e) {
		return { stage: "extracting", ok: false, retryable: true, message: `解压失败：${String(e)}——附录 A extracting（S1-2 exec.run tar 三步范式）` };
	}
}

/** oj 原生模块清单七键白名单（OJ-X 红线：manifest.rs 形态 name/desc/version/config/db/tables/deps） */
const NATIVE_KEYS = new Set(["name", "desc", "version", "config", "db", "tables", "deps"]);

/**
 * C2-31 安装期复核纯函数（双端 DRY 于夹具，preflight 同纪律；构建侧同形实现在
 * packages/cli/src/bundle.ts checkModuleManifest）：包内 oj 原生清单 ↔ C2 Form A 逐项钉住——
 * name/version 三方一致、七键白名单（白名单外键 = OJ-X 红线，oj 不拒但契约拒）。
 * 只验不写：安装期改写原生清单等于掩盖上游不一致。
 *
 * 变更（2026-10-21）：**desc === summary 的等值校验已移除**。该等值要求把「构建期映射」
 * 当成安装期契约，于是 fixture/手写包只要 desc 与 summary 有一字之差就整包装不上——
 * 校验成本远高于它拦下的风险（desc 只是模块描述文本，非安全边界）。现只保留
 * 「summary 必填（C2-04）」与「desc 必填非空（oj 启动装配面）」两项。
 */
export function checkModuleManifest(
	c2: unknown,
	native: unknown,
	name: string,
	version: string,
): { ok: true } | { ok: false, message: string } {
	if (!isObj(native)) {
		return { ok: false, message: `包内原生清单不是键值对象（实为 ${native === null ? "null" : Array.isArray(native) ? "数组" : typeof native}）` };
	}
	const summary = isObj(c2) && typeof c2.summary === "string" ? c2.summary : undefined;
	if (summary === undefined || summary.trim() === "") {
		return { ok: false, message: "C2 manifest summary 缺省或空白（C2-04 必填字段）——C2-31" };
	}
	const desc = native.desc;
	if (typeof desc !== "string" || desc.trim() === "") {
		return { ok: false, message: "包内原生清单 desc 缺失或空白（oj Manifest 必填字段，serve 装配即失败）——C2-31" };
	}
	if (native.name !== name) {
		return { ok: false, message: `包内原生清单 name「${String(native.name)}」与安装身份「${name}」不一致——C2-31` };
	}
	if (native.version !== version) {
		return { ok: false, message: `包内原生清单 version「${String(native.version)}」与安装身份「${version}」不一致——C2-31` };
	}
	const extra = Object.keys(native).filter(k => !NATIVE_KEYS.has(k));
	if (extra.length > 0) {
		return { ok: false, message: `包内原生清单含白名单外键「${extra.join("、")}」（七键 = name/desc/version/config/db/tables/deps，OJ-X 红线）——C2-31` };
	}
	return { ok: true };
}

/**
 * C2-31 安装期复核接线（extracting 段收口）：manifest 声明 api 段而包内 api/<name>-<version>/
 * 缺失 = 结构违约；包内 api 模块目录在则必复核其原生清单（web-only 包无 api 段 → 跳过）。
 * yaml 解析走 oj 全局（market/api.ts 同款），解析失败按复核不通过处理（fail-closed）。
 */
async function checkApiSegment(ctx: ExtractContext): Promise<{ ok: true } | { ok: false, message: string }> {
	const modDir = `${ctx.staging}/api/${ctx.name}-${ctx.version}`;
	let inner: string[];
	try {
		inner = await fsFace().readdir(modDir);
	}
	catch {
		const declared = isObj(ctx.manifest) && ctx.manifest.api !== undefined;
		if (!declared) {
			return { ok: true }; // web-only 方案：无 api 段，migrate 段同步跳过
		}
		return { ok: false, message: `解压复核失败：manifest 声明 api 段而包内 api/${ctx.name}-${ctx.version}/ 缺失（§2.9 结构违约）——C2-31` };
	}
	if (!inner.includes("manifest.yaml")) {
		return { ok: false, message: `解压复核失败：api/${ctx.name}-${ctx.version}/ 缺 manifest.yaml（oj 原生清单，oj build 产物必带）——C2-31` };
	}
	const g = globalThis as { yaml?: { parse: (text: string) => Promise<unknown> } };
	let native: unknown;
	try {
		native = await g.yaml!.parse(new TextDecoder().decode(await fsFace().readFile(`${modDir}/manifest.yaml`)));
	}
	catch (e) {
		return { ok: false, message: `解压复核失败：api/${ctx.name}-${ctx.version}/manifest.yaml 不可解析（${String(e)}）——C2-31` };
	}
	// R2.2：引用式 solution 的 tables/deps 真源——保留 native manifest 供 deployWeb 回读装配。
	ctx.nativeManifest = native;
	return checkModuleManifest(ctx.manifest, native, ctx.name, ctx.version);
}

/**
 * 单根归平（契约 §2.9 布局消费点，P1-13 真机冒烟实测缺此步——附录 B-10）：`ojm build --bundle`
 * 产物是 `<name>-<version>/` 单根 tgz，`tar -xzf -C staging` 后内容嵌在一层目录里，而安装器
 * 全链消费扁平 staging（verifyTarget/deployWeb 读 `${staging}/manifest.yaml`，lockCommit 把
 * staging 整体 rename 成版本目录）。归平规则：顶层「以 manifest.yaml 为首层标记」的目录 = 包根，
 * 内容上提一层；标记不匹配（api/、web/、archive 文件）一律不动——不猜布局，宁可下游可读失败。
 * 幂等：flat 布局无匹配目录即空操作；market file 源预解包（manifestOfUpload）与本步骤同调此函数，
 * 二次解压重建的单根目录再次被归平。
 */
export async function flattenBundleRoot(staging: string): Promise<void> {
	const f = fsFace();
	let names: string[];
	try {
		names = await f.readdir(staging);
	}
	catch {
		return; // staging 不可列（不存在等）交由下游可读失败
	}
	for (const name of names) {
		const root = `${staging}/${name}`;
		let inner: string[];
		try {
			inner = await f.readdir(root); // readdir 失败 = 普通文件（archive 等），跳过
		}
		catch {
			continue;
		}
		if (!inner.includes("manifest.yaml")) {
			continue;
		}
		for (const item of inner) {
			const dest = `${staging}/${item}`;
			try {
				await f.rename(`${root}/${item}`, dest);
			}
			catch {
				// 目标已在（market file 源预解包 manifestOfUpload 先归平过同一 staging，重装/重试
				// 时上次产物尚在——附录 B-10）：staging 是安装器私有无价值暂存，先清后搬
				await f.remove(dest, { recursive: true, force: true });
				await f.rename(`${root}/${item}`, dest);
			}
		}
		await f.remove(root, { recursive: true });
	}
}
