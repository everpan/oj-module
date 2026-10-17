// 校验步骤（P1-6，十阶段 stage 3 verifying）：下载产物 sha256 与 manifest.archive.sha256
// fail-closed 比对（C2-29，索引真源 = Form B CDN 聚合）。
// ⚠ 同信任域：P1 无签名阶段，sha256 仅防传输损坏不防投毒（设计 §9 补充①原文口径）——
// Ed25519 验签 P2 上线前，本步不得用于不受控分发源。
// 摘要面经 ctx 注入（DIP），缺省回落运行时全局 crypto.sha256Hex（oj 运行时私有面，0.1.75 起收二进制
// 入参）；Node 测试侧 WebCrypto 无此面——两面皆缺即 fail-closed 拒装，不静默跳过校验。

import type { InstallContext } from "./preflight";
import { fsFace } from "../atomic";
import { archiveFileOf } from "./download";

export type Sha256Face = (data: Uint8Array) => string;

export interface VerifyContext extends InstallContext {
	/** 暂存目录（与 download 同目录接力） */
	staging: string
	/** 注入式摘要面；缺省回落 globalThis.crypto.sha256Hex */
	sha256Hex?: Sha256Face
}

export interface StageResult {
	stage: "verifying"
	ok: boolean
	message: string
	retryable?: boolean
}

export async function verify(ctx: VerifyContext): Promise<StageResult> {
	const arch = archiveFileOf(ctx.manifest);
	if (!arch.ok) {
		return { stage: "verifying", ok: false, retryable: false, message: `校验失败：${arch.message}` };
	}
	const expected = arch.archive.sha256;
	if (typeof expected !== "string" || expected === "") {
		return {
			stage: "verifying",
			ok: false,
			retryable: false,
			message: "校验失败：archive.sha256 缺失（C2-29 fail-closed：Form A 占位无摘要，安装清单须为 Form B CDN 聚合真源）",
		};
	}
	const dest = `${ctx.staging}/${arch.file}`;
	try {
		const face = ctx.sha256Hex ?? (globalThis as { crypto?: { sha256Hex?: Sha256Face } }).crypto?.sha256Hex;
		if (typeof face !== "function") {
			return {
				stage: "verifying",
				ok: false,
				retryable: false,
				message: "校验失败：摘要能力不可用（sha256Hex 面未注入且运行时全局缺失）——C2-29 fail-closed 拒装，不静默跳过",
			};
		}
		const bytes = await fsFace().readFile(dest);
		const actual = face(bytes);
		if (actual !== expected) {
			return {
				stage: "verifying",
				ok: false,
				retryable: true,
				message: `校验失败：${arch.file} 摘要与索引不符（C2-29 fail-closed；附录 A verifying：分发包可能损坏，请重试下载）期望 ${expected}，实得 ${actual}`,
			};
		}
		return { stage: "verifying", ok: true, message: `校验通过：${arch.file} sha256 与索引一致（C2-29；P1 无签名阶段——同信任域仅防传输损坏，不防投毒，设计 §9①）` };
	}
	catch (e) {
		return { stage: "verifying", ok: false, retryable: true, message: `校验失败：无法读取 ${dest}（${String(e)}）——附录 A verifying：请重试下载` };
	}
}
