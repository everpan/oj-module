// 本地归档 manifest 补全（Phase B T3b 抽取：installBody file 源与 bundle 收敛共用）。
// ojm build --bundle 产物的包内 manifest 是 Form A（archive 仅 file，sha256/size 由
// publish 填充于 Form B），而安装器 verify 段对 archive.sha256 fail-closed——字节在手
// 的本地安装（multipart 上传 / 随站 bundle）须在安装时点补摘要成可校验清单
// （verify 复核同批字节，R10 语义保持；CDN 源不受影响，Form B 真源自带摘要）。
// 正名（P2-11 索引投毒加固）：archive.file 逐字 <name>-<version>.tgz——name(C2-01)/
// version（无路径分隔符）拼出的单文件名安全时即正名；否则退回常量名（此刻尚未过预检，
// 恶意命名不提前拒也不给穿越面——预检稍后照拒）。
// detached 侧车签名注入（P2-3，G4 补裁）：与 Form B archive.signature 同结构注入，
// verify 段统一验签（六码分流）；sig 为 null（无旁车）时不注入，验签 fail-closed
// 由 verify 段按 sig_missing 裁决，本层不预判。

import type { ExecFace } from "./steps/extract";
import { manifestOfUpload } from "./manifest-of-upload";

export interface LocalArchivePrep {
	/** 暂存目录（与安装器 staging 同纪律） */
	stagingDir: string
	/** exec 面（tar 列表/解包） */
	exec: ExecFace
	/** sha256 摘要面（archive 补摘要） */
	sha256Hex: (data: Uint8Array) => string
}

export interface LocalArchiveInput {
	/** 身份权威名（body/标记权威，包内 manifest 兜底；冲突即拒） */
	name: string
	/** 期望版本（null = 以包内 manifest.version 为准） */
	reqVersion: string | null
	/** tgz 字节 */
	bytes: Uint8Array
	/** detached 侧车签名（已解析的 SidecarSig 形状；null = 无旁车） */
	sig: unknown | null
}

export interface LocalArchiveManifest {
	manifest: Record<string, unknown>
	version: string
}

export async function localArchiveManifestOf(prep: LocalArchivePrep, input: LocalArchiveInput): Promise<LocalArchiveManifest> {
	const manifest: unknown = await manifestOfUpload({ stagingDir: prep.stagingDir, bytes: input.bytes, exec: prep.exec });
	const m = (manifest !== null && typeof manifest === "object" ? manifest : {}) as Record<string, unknown>;
	// 身份：入参权威、manifest 兜底；两者俱在且冲突即拒（防锁名/注册名分叉的坏装）
	const mVersion = typeof m.version === "string" ? m.version : "";
	if (input.reqVersion !== null && mVersion !== "" && mVersion !== input.reqVersion)
		throw Object.assign(new Error(`期望版本「${input.reqVersion}」与包内 manifest.version「${mVersion}」不一致——请核对分发包`), { status: 400 });
	const mName = typeof m.name === "string" ? m.name : "";
	if (mName !== "" && mName !== input.name)
		throw Object.assign(new Error(`期望 name「${input.name}」与包内 manifest.name「${mName}」不一致——请核对分发包`), { status: 400 });
	if (input.reqVersion === null && mVersion === "")
		throw Object.assign(new Error("version 不可得（期望版本与包内 manifest.version 均缺失）"), { status: 400 });
	const version = input.reqVersion ?? mVersion;
	const namedFile = /^[a-z][a-z0-9-]{0,63}$/.test(input.name) && /^[0-9A-Z.-]+$/i.test(version) && !version.includes("..")
		? `${input.name}-${version}.tgz`
		: "upload.tgz";
	m.archive = { file: namedFile, sha256: prep.sha256Hex(input.bytes), size: input.bytes.byteLength };
	if (input.sig !== null)
		m.archive = { ...(m.archive as Record<string, unknown>), signature: input.sig };
	return { manifest: m, version };
}
