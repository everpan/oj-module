/**
 * `ram vendor` —— oj vendor 按平台联网下载（设计 V1–V9）。
 *
 * 从 everpan/only-js 最新 release 取本平台资产，sha256 校验后装进工程
 * bin/。init 的内置 tar.gz 是离线兜底，本命令是联网更新通道，两者独立。
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ReleaseAsset {
	name: string
	browser_download_url: string
}

export interface Release {
	tag_name: string
	assets: ReleaseAsset[]
}

const TRIPLETS: Record<string, string> = {
	"darwin:arm64": "aarch64-apple-darwin",
	"darwin:x64": "x86_64-apple-darwin",
	"linux:x64": "x86_64-unknown-linux-gnu",
	"linux:arm64": "aarch64-unknown-linux-gnu",
	"win32:x64": "x86_64-pc-windows-msvc",
};

export function resolveTriplet(platform: string, arch: string): string {
	const triplet = TRIPLETS[`${platform}:${arch}`];
	if (!triplet) {
		throw new Error(
			`[ram] 暂不支持的平台组合：${platform}/${arch}。\n`
			+ `已支持：${Object.keys(TRIPLETS).map(k => k.replace(":", "/")).join("、")}`,
		);
	}
	return triplet;
}

/** Windows 资产为 zip（Rust 社区惯例，实测 v0.1.0），其余 tar.gz */
export function assetExt(platform: string): "tar.gz" | "zip" {
	return platform === "win32" ? "zip" : "tar.gz";
}

export function pickAsset(assets: ReleaseAsset[], tag: string, platform: string, arch: string): ReleaseAsset {
	const want = `oj-${tag}-${resolveTriplet(platform, arch)}.${assetExt(platform)}`;
	const hit = assets.find(a => a.name === want);
	if (!hit) {
		const names = assets.map(a => a.name).filter(n => !n.endsWith(".sha256"));
		throw new Error(
			`[ram] 最新 release（${tag}）没有本平台资产 ${want}。\n可用资产：\n  ${names.join("\n  ")}`,
		);
	}
	return hit;
}

function ojBinName(platform: string): string {
	return platform === "win32" ? "oj.exe" : "oj";
}

/** 本地版本只认 .oj-version 标记；bin/oj 缺失或标记缺失都视为未安装（V4） */
export function readLocalVersion(binDir: string, platform: NodeJS.Platform = process.platform): string | null {
	if (!fs.existsSync(path.join(binDir, ojBinName(platform))))
		return null;
	const marker = path.join(binDir, ".oj-version");
	if (!fs.existsSync(marker))
		return null;
	return fs.readFileSync(marker, "utf-8").trim() || null;
}

export const RELEASE_API = "https://api.github.com/repos/everpan/only-js/releases/latest";

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface VendorDeps {
	fetchFn?: FetchLike
	token?: string
}

function resolveDeps(deps: VendorDeps): Required<VendorDeps> {
	return {
		fetchFn: deps.fetchFn ?? (globalThis.fetch as FetchLike),
		token: deps.token ?? process.env.GITHUB_TOKEN ?? "",
	};
}

function authHeaders(token: string): Record<string, string> {
	const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
	if (token)
		headers.Authorization = `Bearer ${token}`;
	return headers;
}

export async function fetchLatestRelease(deps: VendorDeps = {}): Promise<Release> {
	const { fetchFn, token } = resolveDeps(deps);
	const res = await fetchFn(RELEASE_API, { headers: authHeaders(token) });
	if (!res.ok) {
		throw new Error(
			`[ram] 查询最新 release 失败（HTTP ${res.status}）。\n${
				token ? "已携带 GITHUB_TOKEN，请确认其有 everpan/only-js 读权限。" : "若仓库为私有或触发限流，请设置 GITHUB_TOKEN 后重试。"}`,
		);
	}
	return await res.json() as Release;
}

/**
 * 下载 → sha256 校验（V7，不符即删临时文件报错）→ 系统 tar 解包（V8，
 * strip 顶层目录；win32 的 zip 由 bsdtar 自动识别）→ chmod → 写版本标记。
 */
export async function installFromRelease(
	asset: ReleaseAsset,
	sumsAsset: ReleaseAsset,
	tag: string,
	binDir: string,
	deps: VendorDeps = {},
): Promise<void> {
	const { fetchFn, token } = resolveDeps(deps);
	const tmp = path.join(os.tmpdir(), `ram-oj-${process.pid}-${Date.now()}`);
	try {
		const res = await fetchFn(asset.browser_download_url, { headers: authHeaders(token) });
		if (!res.ok || !res.body)
			throw new Error(`[ram] 下载失败（HTTP ${res.status}）：${asset.name}`);
		await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(tmp));

		const sumsRes = await fetchFn(sumsAsset.browser_download_url, { headers: authHeaders(token) });
		if (!sumsRes.ok)
			throw new Error(`[ram] 下载校验文件失败（HTTP ${sumsRes.status}）：${sumsAsset.name}`);
		const expectHex = (await sumsRes.text()).trim().split(/\s+/)[0];
		const actualHex = createHash("sha256").update(fs.readFileSync(tmp)).digest("hex");
		if (actualHex !== expectHex) {
			throw new Error(
				`[ram] sha256 校验失败：${asset.name}\n期望 ${expectHex}\n实际 ${actualHex}\n文件可能被篡改或下载不完整，请重试。`,
			);
		}

		fs.mkdirSync(binDir, { recursive: true });
		execFileSync("tar", [asset.name.endsWith(".zip") ? "-xf" : "-xzf", tmp, "--strip-components=1", "-C", binDir]);
		const ojBin = path.join(binDir, ojBinName(process.platform));
		if (process.platform !== "win32")
			fs.chmodSync(ojBin, 0o755);
		fs.writeFileSync(path.join(binDir, ".oj-version"), `${tag}\n`);
	}
	finally {
		fs.rmSync(tmp, { force: true });
	}
}
