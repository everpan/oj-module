// 下载步骤（P1-6，十阶段 stage 2 downloading）：S1-2.3 裁决形态——isolate 内 fetch → fs.writeFile。
// 落盘位 = <staging>/<archive.file>（.staging/<name>-<version>.tgz），与 verify/extract 同目录接力。
// 失败语义走 StageResult（附录 A downloading：retryable ✓——网络类失败可重试）；契约身份缺失
// （C2-29，重试不自愈）retryable=false。fetch 面经 ctx 注入（DIP，生产 = 平台 isolate 全局 fetch），
// fs 同 atomic（globalThis.fs 面）。

import type { InstallContext } from "./preflight";
import { fsFace } from "../atomic";
import { MAX_PACKAGE_BYTES } from "../limits";

/** 最小 fetch 面（结构化：Node fetch/Response 天然满足；测试注入 stub 不真跑网络） */
export type FetchFace = (url: string) => Promise<{
	ok: boolean
	status: number
	arrayBuffer: () => Promise<ArrayBuffer>
}>;

export interface DownloadContext extends InstallContext {
	/** 分发包完整 URL（安装器由市场源 + archive.file 拼装；本步不拼 URL） */
	archiveUrl: string
	/** 暂存目录（.staging/）；与 verify/extract 同目录接力（D11 锁前失败清场重跑） */
	staging: string
	/** 注入式 fetch 面 */
	fetch: FetchFace
}

export interface StageResult {
	stage: "downloading"
	ok: boolean
	message: string
	retryable?: boolean
	/** 终止态错误码（installer 据此置 task.error.reason）；体积闸门命中恒 package_too_large */
	code?: string
}

/**
 * 三步共用：从 manifest 提取 archive 身份（C2-29 安全形态守卫，verify/extract 复用）。
 * file 仅接受 `<name>-<version>.tgz` 安全形态：无路径分隔符（穿越结构性不可能）、
 * 无前导点、无 `..` 段——这是信任边界（archive 来自分发源），宁可过严不可放行。
 */
export function archiveFileOf(manifest: unknown): { ok: true, file: string, archive: Record<string, unknown> } | { ok: false, message: string } {
	if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
		return { ok: false, message: "C2-29：manifest 不是键值对象，archive 身份不可得" };
	}
	const archive = (manifest as Record<string, unknown>).archive as Record<string, unknown>;
	if (typeof archive !== "object" || archive === null || Array.isArray(archive)) {
		return { ok: false, message: "C2-29：archive 段缺失或不是键值对象（Form B 真源须含 file/sha256/size）" };
	}
	const file = archive.file;
	if (typeof file !== "string" || !/^[A-Z0-9][\w.-]*$/i.test(file) || file.includes("..")) {
		return { ok: false, message: `C2-29：archive.file「${String(file)}」缺失或不符安全形态 ^<name>-<version>.tgz$（禁路径分隔符/前导点/.. 穿越段）` };
	}
	return { ok: true, file, archive };
}

export async function download(ctx: DownloadContext): Promise<StageResult> {
	const arch = archiveFileOf(ctx.manifest);
	if (!arch.ok) {
		return { stage: "downloading", ok: false, retryable: false, message: `下载失败：${arch.message}` };
	}
	// P2-11 索引投毒加固：archive.file 收紧 <name>-<version>.tgz 逐字（禁异名/异版本/路径拼接；
	// 此刻 name/version 已过 preflight C2-01/C2-02，均无路径分隔符，逐字等值即排除穿越形态）
	const expected = `${ctx.name}-${ctx.version}.tgz`;
	if (arch.file !== expected) {
		return { stage: "downloading", ok: false, retryable: false, message: `下载失败：archive.file「${arch.file}」须逐字为 <name>-<version>.tgz（「${expected}」，P2-11 索引投毒加固）` };
	}
	const dest = `${ctx.staging}/${arch.file}`;
	// REG-CS8 下载闸（红队 F1）：先比对索引声明的 archive.size，超限直接拒——不发请求、不读入内存，
	// 把「先中毒后验毒」的源头堵死（限量值全仓单源，与解压闸/上传侧共用 MAX_PACKAGE_BYTES）。
	const declaredSize = arch.archive.size;
	if (typeof declaredSize === "number" && Number.isFinite(declaredSize) && declaredSize > MAX_PACKAGE_BYTES) {
		return {
			stage: "downloading",
			ok: false,
			retryable: false,
			code: "package_too_large",
			message: `下载失败：分发包声明体积 ${declaredSize} 字节超过上限 ${MAX_PACKAGE_BYTES}（REG-CS8 package_too_large）——拒绝下载以省带宽与内存，请发布方拆分或压缩后重试`,
		};
	}
	try {
		const res = await ctx.fetch(ctx.archiveUrl);
		if (!res.ok) {
			return {
				stage: "downloading",
				ok: false,
				retryable: true,
				message: `下载失败：分发源返回 HTTP ${res.status}（${ctx.archiveUrl}）——附录 A downloading：请检查网络与市场地址后重试`,
			};
		}
		const bytes = new Uint8Array(await res.arrayBuffer());
		// P2-11 索引投毒加固：下载后立即比 archive.size（声明在场且为有限数才比对；
		// 内容级真伪仍由 verify 段 sha256 fail-closed 把关，size 是低成本前置快筛）
		const declared = arch.archive.size;
		if (typeof declared === "number" && Number.isFinite(declared) && declared !== bytes.byteLength) {
			return { stage: "downloading", ok: false, retryable: false, message: `下载失败：分发包 ${bytes.byteLength} 字节与索引声明 archive.size ${declared} 不符——P2-11 索引投毒加固（size 立即比对）` };
		}
		const f = fsFace();
		await f.mkdir(ctx.staging, { recursive: true });
		await f.writeFile(dest, bytes);
		return { stage: "downloading", ok: true, message: `下载完成：${arch.file}（${bytes.byteLength} 字节）→ ${dest}` };
	}
	catch (e) {
		return { stage: "downloading", ok: false, retryable: true, message: `下载失败：${String(e)}——附录 A downloading（S1-2.3 fetch→fs.writeFile 范式）` };
	}
}
