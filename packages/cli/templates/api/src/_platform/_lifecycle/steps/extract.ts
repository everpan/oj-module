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
	run: (argv: string[]) => Promise<ExecResult>
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
		return { stage: "extracting", ok: true, message: `解压完成：${lines.length} 个成员 → ${ctx.staging}/（单根已归平，§2.9 布局消费点；目录 rename 由 P1-10 落锁段接管）` };
	}
	catch (e) {
		return { stage: "extracting", ok: false, retryable: true, message: `解压失败：${String(e)}——附录 A extracting（S1-2 exec.run tar 三步范式）` };
	}
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
