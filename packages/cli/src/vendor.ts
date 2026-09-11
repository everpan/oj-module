/**
 * `ojm vendor [tag] [--force]` —— oj vendor 经 npm 包 @oj-bin/oj 安装（设计 N1–N8，
 * docs/prd/202609111926-vendor-npm-install-design.md）。
 *
 * 下载通道：`npm i @oj-bin/oj@<version>`（临时目录执行，postinstall 按平台把
 * oj/plugins/devkit 落到 <cwd>/bin/），再 cpSync 进工程 bin/——平台选择、完整性
 * 校验（npm dist.integrity）、registry 镜像全交给 npm，GitHub releases 通道已退役。
 * tag 缺省经 `npm view` 追 latest；init 也走同一通道补装。
 */

import type { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const NPM_PKG = "@oj-bin/oj";

function ojBinName(platform: string): string {
	return platform === "win32" ? "oj.exe" : "oj";
}

/** 本地版本只认 .oj-version 标记；bin/oj 缺失或标记缺失都视为未安装（N6，格式 vX.Y.Z） */
export function readLocalVersion(binDir: string, platform: NodeJS.Platform = process.platform): string | null {
	if (!fs.existsSync(path.join(binDir, ojBinName(platform))))
		return null;
	const marker = path.join(binDir, ".oj-version");
	if (!fs.existsSync(marker))
		return null;
	return fs.readFileSync(marker, "utf-8").trim() || null;
}

export interface OjProbeResult {
	ok: boolean
	/** 失败时的原始输出（stderr/stdout 合并），供人话报错展示首行 */
	detail: string
}

/**
 * oj 二进制可用性冒烟：对最小 api 目录跑一次 `oj build`，验证 JsRuntime 能初始化。
 *
 * 背景：官方发布二进制由 CI 构建，`extension!` 的 `dir` 形式把**构建机绝对路径**
 * 编译进二进制（`LoadedFromFsDuringSnapshot`），在非构建机上 `JsRuntime::new`
 * 读盘 ENOENT。`oj --version` 走 Rust 侧仍正常，故只能在会初始化 JsRuntime 的
 * 命令上暴露——这里在安装时即探一次，给人话报错，而不是等用户 `ojm build` 才 panic。
 *
 * 注意：探针目录必须含至少一个 `api.ts`，空目录 `oj build` 不会初始化 JsRuntime。
 * 详见 docs/prd/oj-release-binary-defect-report.md。
 *
 * 非致命：安装仍算完成（用户可自行替换 bin/oj），调用方决定如何呈现。
 */
export function probeOjRuntime(binDir: string, platform: NodeJS.Platform = process.platform): OjProbeResult {
	const ojBin = path.join(binDir, ojBinName(platform));
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-oj-probe-"));
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
	log("[ojm] ⚠️ oj 二进制自检失败：JsRuntime 无法初始化，发布产物有缺陷");
	log(`[ojm]    原始输出：${firstLine}`);
	log("[ojm]    原因：官方二进制由 CI 构建，JS 扩展源码路径被烤进二进制，非构建机上找不到文件。");
	log("[ojm]    影响：ojm dev / ojm build / ojm preview 都会失败（oj --version 仍正常，故不易察觉）。");
	log("[ojm]    处置：换用本地自建二进制——cargo build --release -p oj 后覆盖本工程 bin/oj。");
	log("[ojm]    详见 docs/prd/oj-release-binary-defect-report.md");
	log("");
}

/** npm 执行器（测试注入）；返回 stdout */
export type NpmRun = (args: string[], cwd: string) => string;

const NPM_CMD = process.platform === "win32" ? "npm.cmd" : "npm";

const defaultRun: NpmRun = (args, cwd) =>
	execFileSync(NPM_CMD, args, { cwd, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 });

export interface VendorDeps {
	run?: NpmRun
	/** 安装后冒烟（测试注入）；默认 probeOjRuntime */
	probe?: (binDir: string) => OjProbeResult
}

/** npm 失败 → 人话报错：stderr 首行 + 完整命令（可直接复制重试） */
function runNpm(run: NpmRun, args: string[], cwd: string, what: string): string {
	try {
		return run(args, cwd);
	}
	catch (e) {
		const err = e as { stderr?: Buffer | string, message?: string };
		const firstLine = (err.stderr?.toString() ?? "").split("\n").map(l => l.trim()).find(Boolean);
		throw new Error(
			`[ojm] ${what}失败：${firstLine ?? err.message ?? String(e)}\n`
			+ `命令：npm ${args.join(" ")}\n`
			+ "若 registry 访问受限，请在 .npmrc 配置镜像（如 npmmirror）后重试。",
		);
	}
}

/**
 * 临时目录 `npm i @oj-bin/oj@<version>`（N2：零污染用户工程）→ 验证 bin/oj 落盘
 * （N5：上游 postinstall 失败也 exit 0，必须自查；缺失时裸跑 postinstall.js 兜底
 * 一次，覆盖 --ignore-scripts 类场景）→ cpSync 进工程 bin/ → 写版本标记。
 */
function installFromNpm(version: string, binDir: string, run: NpmRun, log: (msg: string) => void): void {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-oj-npm-"));
	try {
		log(`[ojm] 安装 ${NPM_PKG}@${version} …`);
		runNpm(run, ["install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", `${NPM_PKG}@${version}`], tmp, "下载");
		const staged = path.join(tmp, "bin", ojBinName(process.platform));
		if (!fs.existsSync(staged)) {
			const postinstall = path.join(tmp, "node_modules", "@oj-bin", "oj", "postinstall.js");
			if (fs.existsSync(postinstall)) {
				try {
					execFileSync(process.execPath, [postinstall], { cwd: tmp, env: { ...process.env, INIT_CWD: tmp }, stdio: "pipe" });
				}
				catch { /* 兜底失败走下面统一报错 */ }
			}
		}
		if (!fs.existsSync(staged)) {
			throw new Error(
				`[ojm] ${NPM_PKG}@${version} 安装后未找到 bin/${ojBinName(process.platform)}。\n`
				+ "当前平台可能暂无预编译包（上游现有：linux-x64、darwin-arm64、win32-x64），"
				+ "或 npm 配置禁用了安装脚本（--ignore-scripts / pnpm 未批准）。",
			);
		}
		fs.mkdirSync(binDir, { recursive: true });
		log(`[ojm] 拷贝 → ${binDir}`);
		fs.cpSync(path.join(tmp, "bin"), binDir, { recursive: true });
		if (process.platform !== "win32")
			fs.chmodSync(path.join(binDir, ojBinName(process.platform)), 0o755);
		fs.writeFileSync(path.join(binDir, ".oj-version"), `v${version}\n`);
	}
	finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

/**
 * US-1..US-5 编排：解析目标版本（tag 缺省经 npm view 追 latest，显式 tag 去 v 前缀）
 * → 本地已是该版本则跳过（--force 除外）→ 临时目录安装 + 拷贝 → 报告版本 → 探针冒烟。
 */
export async function vendorCommand(
	projectRoot: string,
	opts: { force: boolean, tag?: string },
	deps: VendorDeps & { log?: (msg: string) => void } = {},
): Promise<void> {
	const log = deps.log ?? console.log;
	const run = deps.run ?? defaultRun;
	const probe = deps.probe ?? probeOjRuntime;
	const version = opts.tag
		? opts.tag.replace(/^v/, "")
		: runNpm(run, ["view", NPM_PKG, "version"], projectRoot, "查询最新版本").trim();
	log(opts.tag ? `[ojm] 目标版本 v${version}` : "[ojm] 查询最新版本…");
	const binDir = path.join(projectRoot, "bin");
	const local = readLocalVersion(binDir);
	if (!opts.force && local === `v${version}`) {
		log(`[ojm] oj 已是 v${version}，跳过。`);
		const result = probe(binDir);
		if (!result.ok)
			reportProbeFailure(log, result.detail);
		return;
	}
	if (opts.force && local === `v${version}`)
		log(`[ojm] 本地已是 v${version}，--force 重装。`);
	else
		log(`[ojm] 本地 ${local ?? "未安装"} → v${version}`);
	installFromNpm(version, binDir, run, log);
	log(`[ojm] oj ${local ? `${local} → ` : ""}v${version} 安装完成：${path.join(binDir, ojBinName(process.platform))}`);
	// 安装后冒烟：发布二进制可能因构建机路径被烤进而不可用（见 probeOjRuntime）
	const result = probe(binDir);
	if (!result.ok)
		reportProbeFailure(log, result.detail);
}
