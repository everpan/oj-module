// 上传包 manifest 抽取共享管线（v4 §二：上传端点与回填命令同一抽取实现，勿各写一遍）。
// R1 三步范式（list→validate→extract）+ REG-CS8 体积闸（validate 与 extract 之间，
// 零解压零落盘拒解压炸弹）+ 解包扁平化 + manifest.yaml 解析。
// 原实现位于 market/api.ts manifestOfUpload（file 源安装用）；上传端点落地时上收此处，
// 两侧共用。错误口径：带 status 的可读失败（respond 收口成 json.fail，D14/B5 同通道）。

import type { ExecFace } from "./steps/extract";
import { fsFace } from "./atomic";
import { flattenBundleRoot } from "./steps/extract";
import { checkTarVolumeLimits, validateTarListing } from "./tgz-guard";

/** 带 status 的可读失败（respond 收口：err.status → json.fail） */
function fail(status: number, msg: string): never {
	throw Object.assign(new Error(msg), { status });
}

export interface ManifestOfUploadInput {
	/** 暂存目录（与安装器 staging 同纪律：包体落 upload.tgz 后解包，文件名常量无用户输入） */
	stagingDir: string
	/** 上传字节（tgz 包体） */
	bytes: Uint8Array
	/** exec 面（tar 列表/解包；注入 stub 不真跑） */
	exec: ExecFace
}

/**
 * 抽取包内嵌 manifest 对象。校验序：
 * ① tar -tvzf 列表（损坏包 400）→ ② validateTarListing（zip-slip 拒收 400）→
 * ③ checkTarVolumeLimits（体积闸 413，零解压零落盘）→ ④ tar -xzf 解包（失败 400）→
 * ⑤ flattenBundleRoot（单根目录包扁平化）→ ⑥ manifest.yaml 解析（不可解析 400）。
 */
export async function manifestOfUpload(input: ManifestOfUploadInput): Promise<unknown> {
	const f = fsFace();
	const staged = `${input.stagingDir}/upload.tgz`; // 常量名不含用户输入，无穿越面
	await f.mkdir(input.stagingDir, { recursive: true });
	await f.writeFile(staged, input.bytes);
	const listed = await input.exec.run(["tar", "-tvzf", staged]);
	if (listed.code !== 0)
		fail(400, `上传包列表失败（tar -tvzf）：${(listed.stderr || listed.stdout).trim()}——包体损坏？`);
	// 铁律②：tar 输出恒带尾随换行，先 trim 尾部空行再 split（extract.ts 同款）
	const lines = listed.stdout.replace(/\n+$/, "").split("\n");
	const v = validateTarListing(lines);
	if (!v.ok)
		fail(400, `上传包含非法成员「${v.offender}」——R1 zip-slip 防护拒收（list→validate→extract 三步范式）`);
	// REG-CS8 体积闸：清单在手即拒解压炸弹，先于一切解压/落盘动作
	const vol = checkTarVolumeLimits(lines);
	if (!vol.ok) {
		const label = vol.code === "too_many_entries" ? "条目数超限" : vol.code === "unpacked_too_large" ? "解压后总体积超限" : "单成员体积超限";
		fail(413, `上传包${label}（${vol.offender}）——REG-CS8 体积闸拒收（解压炸弹防护），请缩减包体后重发`);
	}
	const extracted = await input.exec.run(["tar", "-xzf", staged, "-C", input.stagingDir]);
	if (extracted.code !== 0)
		fail(400, `上传包解包失败（tar -xzf）：${(extracted.stderr || extracted.stdout).trim()}`);
	await flattenBundleRoot(input.stagingDir);
	const g = globalThis as { yaml?: { parse: (text: string) => Promise<unknown> } };
	try {
		return await g.yaml!.parse(new TextDecoder().decode(await f.readFile(`${input.stagingDir}/manifest.yaml`)));
	}
	catch (e) {
		return fail(400, `上传包 manifest.yaml 不可解析：${String(e)}`);
	}
}
