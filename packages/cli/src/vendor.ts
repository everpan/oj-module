/**
 * `ram vendor [tag] [--force]` —— oj vendor 按平台联网下载（设计 V1–V9）。
 *
 * 从 everpan/only-js 的 release 取本平台资产，sha256 校验后装进工程 bin/。
 * tag 缺省追最新 release（/releases/latest），显式指定则按 tag 下载；
 * init 也走同一通道补装（无内置 tar.gz 兜底）。
 */

import type { Buffer } from "node:buffer";
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
	size?: number
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

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface OjProbeResult {
	ok: boolean
	/** 失败时的原始输出（stderr/stdout 合并），供人话报错展示首行 */
	detail: string
}

/**
 * oj 二进制可用性冒烟：对最小 api 目录跑一次 `oj build`，验证 JsRuntime 能初始化。
 *
 * 背景：官方 release 由 CI 构建，`extension!` 的 `dir` 形式把**构建机绝对路径**
 * 编译进二进制（`LoadedFromFsDuringSnapshot`），在非构建机上 `JsRuntime::new`
 * 读盘 ENOENT。`oj --version` 走 Rust 侧仍正常，故只能在会初始化 JsRuntime 的
 * 命令上暴露——这里在安装时即探一次，给人话报错，而不是等用户 `ram build` 才 panic。
 *
 * 注意：探针目录必须含至少一个 `api.ts`，空目录 `oj build` 不会初始化 JsRuntime。
 * 详见 docs/prd/oj-release-binary-defect-report.md。
 *
 * 非致命：安装仍算完成（用户可自行替换 bin/oj），调用方决定如何呈现。
 */
export function probeOjRuntime(binDir: string, platform: NodeJS.Platform = process.platform): OjProbeResult {
	const ojBin = path.join(binDir, ojBinName(platform));
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "ram-oj-probe-"));
	try {
		const epDir = path.join(work, "src", "web", "hello");
		fs.mkdirSync(epDir, { recursive: true });
		fs.writeFileSync(path.join(epDir, "api.ts"), "export default { get() { json.ok({ ok: true }); } };\n");
		fs.writeFileSync(path.join(work, "src", "web", "manifest.yaml"), "name: web\ndesc: probe\nversion: 0.1.0\n");
		execFileSync(ojBin, ["build", "-d", path.join(work, "src"), "-o", path.join(work, "out")], { stdio: "pipe" });
		return { ok: true, detail: "" };
	}
	catch (e) {
		const err = e as { stdout?: Buffer | string, stderr?: Buffer | string, message?: string };
		const text = `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`.trim() || (err.message ?? String(e));
		return { ok: false, detail: text };
	}
	finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
}

/** 探针失败时的人话报错（安装时打印，不阻断——用户可自行替换 bin/oj） */
function reportProbeFailure(log: (msg: string) => void, detail: string): void {
	const firstLine = detail.split("\n").map(l => l.trim()).find(Boolean) ?? "(无输出)";
	log("");
	log("[ram] ⚠️ oj 二进制自检失败：JsRuntime 无法初始化，release 产物有缺陷");
	log(`[ram]    原始输出：${firstLine}`);
	log("[ram]    原因：官方 release 由 CI 构建，JS 扩展源码路径被烤进二进制，非构建机上找不到文件。");
	log("[ram]    影响：ram dev / ram build / ram preview 都会失败（oj --version 仍正常，故不易察觉）。");
	log("[ram]    处置：换用本地自建二进制——cargo build --release -p oj 后覆盖本工程 bin/oj。");
	log("[ram]    详见 docs/prd/oj-release-binary-defect-report.md");
	log("");
}

export interface VendorDeps {
	fetchFn?: FetchLike
	token?: string
	/** 安装后冒烟（测试注入）；默认 probeOjRuntime */
	probe?: (binDir: string) => OjProbeResult
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

/** 网络层异常（DNS/超时等）undici 只抛 TypeError: fetch failed，真实原因在 cause —— 取出 cause 与失败 URL，给人话与代理指引（URL 可直接拿去 curl 验证连通性） */
async function fetchGuarded(fetchFn: FetchLike, url: string, token: string): Promise<Response> {
	try {
		return await fetchFn(url, { headers: authHeaders(token) });
	}
	catch (err) {
		const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
		throw new Error(
			`[ram] 网络请求失败：${cause}\nURL：${url}\n`
			+ "若本机直连 github 受限，请带代理重试（Node ≥ 24）：\n"
			+ "  NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 ram vendor",
		);
	}
}

function formatSize(bytes: number): string {
	return bytes >= 1024 * 1024
		? `${(bytes / 1024 / 1024).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const RELEASE_LATEST_API = "https://api.github.com/repos/everpan/only-js/releases/latest";

export function releaseApiUrl(tag: string): string {
	return `https://api.github.com/repos/everpan/only-js/releases/tags/${tag}`;
}

/** 查询最新 release（tag 缺省路径）。 */
export async function fetchLatestRelease(deps: VendorDeps = {}): Promise<Release> {
	const { fetchFn, token } = resolveDeps(deps);
	const res = await fetchGuarded(fetchFn, RELEASE_LATEST_API, token);
	if (!res.ok) {
		throw new Error(
			`[ram] 查询最新 release 失败（HTTP ${res.status}）。\n${
				token
					? "已携带 GITHUB_TOKEN，请确认其有 everpan/only-js 读权限。"
					: "若仓库为私有或触发限流，请设置 GITHUB_TOKEN 后重试。"}`,
		);
	}
	return await res.json() as Release;
}

/** 按指定 tag 查询 release（`ram vendor <tag>` 显式指定版本时）。 */
export async function fetchRelease(tag: string, deps: VendorDeps = {}): Promise<Release> {
	const { fetchFn, token } = resolveDeps(deps);
	const url = releaseApiUrl(tag);
	const res = await fetchGuarded(fetchFn, url, token);
	if (!res.ok) {
		throw new Error(
			`[ram] 查询 release ${tag} 失败（HTTP ${res.status}）。\n${
				res.status === 404
					? "该 tag 尚未发布 release——请确认上游 everpan/only-js 已发布对应版本。"
					: token
						? "已携带 GITHUB_TOKEN，请确认其有 everpan/only-js 读权限。"
						: "若仓库为私有或触发限流，请设置 GITHUB_TOKEN 后重试。"}`,
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
	deps: VendorDeps & { log?: (msg: string) => void } = {},
): Promise<void> {
	const { fetchFn, token } = resolveDeps(deps);
	const log = deps.log ?? (() => {});
	const tmp = path.join(os.tmpdir(), `ram-oj-${process.pid}-${Date.now()}`);
	try {
		log(`[ram] 下载 ${asset.name}${asset.size ? `（${formatSize(asset.size)}）` : ""} …`);
		const res = await fetchGuarded(fetchFn, asset.browser_download_url, token);
		if (!res.ok || !res.body)
			throw new Error(`[ram] 下载失败（HTTP ${res.status}）：${asset.name}\nURL：${asset.browser_download_url}`);
		await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), fs.createWriteStream(tmp));

		const sumsRes = await fetchGuarded(fetchFn, sumsAsset.browser_download_url, token);
		if (!sumsRes.ok)
			throw new Error(`[ram] 下载校验文件失败（HTTP ${sumsRes.status}）：${sumsAsset.name}`);
		const expectHex = (await sumsRes.text()).trim().split(/\s+/)[0];
		const actualHex = createHash("sha256").update(fs.readFileSync(tmp)).digest("hex");
		if (actualHex !== expectHex) {
			throw new Error(
				`[ram] sha256 校验失败：${asset.name}\n期望 ${expectHex}\n实际 ${actualHex}\n文件可能被篡改或下载不完整，请重试。`,
			);
		}
		log("[ram] sha256 校验通过");

		fs.mkdirSync(binDir, { recursive: true });
		log(`[ram] 解包 → ${binDir}`);
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

/**
 * US-1..US-4 编排：查 release（tag 缺省追 latest，显式指定按 tag）
 * → 本地已是该版本则跳过（--force 除外）→ 选本平台资产 + 同名 .sha256
 * → 安装 → 报告版本。
 */
export async function vendorCommand(
	projectRoot: string,
	opts: { force: boolean, tag?: string },
	deps: VendorDeps & { log?: (msg: string) => void } = {},
): Promise<void> {
	const log = deps.log ?? console.log;
	const probe = deps.probe ?? probeOjRuntime;
	const source = opts.tag ? `release ${opts.tag}` : "最新 release";
	log(`[ram] 查询${source}…`);
	const release = opts.tag ? await fetchRelease(opts.tag, deps) : await fetchLatestRelease(deps);
	const binDir = path.join(projectRoot, "bin");
	const local = readLocalVersion(binDir);
	if (!opts.force && local === release.tag_name) {
		log(`[ram] oj 已是 ${release.tag_name}，跳过。`);
		const result = probe(binDir);
		if (!result.ok)
			reportProbeFailure(log, result.detail);
		return;
	}
	if (opts.force && local === release.tag_name)
		log(`[ram] 本地已是 ${release.tag_name}，--force 重装。`);
	else
		log(`[ram] 本地 ${local ?? "未安装"} → ${release.tag_name}`);
	const asset = pickAsset(release.assets, release.tag_name, process.platform, process.arch);
	const sums = release.assets.find(a => a.name === `${asset.name}.sha256`);
	if (!sums) {
		throw new Error(
			`[ram] release（${release.tag_name}）缺少校验文件 ${asset.name}.sha256，release 结构异常，拒绝安装。`,
		);
	}
	await installFromRelease(asset, sums, release.tag_name, binDir, { ...deps, log });
	log(`[ram] oj ${local ? `${local} → ` : ""}${release.tag_name} 安装完成：${path.join(binDir, ojBinName(process.platform))}`);
	// 安装后冒烟：release 二进制可能因构建机路径被烤进而不可用（见 probeOjRuntime）
	const result = probe(binDir);
	if (!result.ok)
		reportProbeFailure(log, result.detail);
}
