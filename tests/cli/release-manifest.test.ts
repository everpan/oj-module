import type { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

// GNU tar 把 Windows 盘符绝对路径里的 `C:` 当「远程主机:路径」（Cannot connect to C: resolve failed），
// 需 --force-local；但 Windows 自带 bsdtar 不支持该选项（报 Option --force-local is not supported），
// 且 bsdtar 本就不做远程解析。按实际解析到的 tar 版本决定：仅 win32 + GNU tar 才加。POSIX 恒不加。
const TAR_LOCAL: string[] = (() => {
	if (process.platform !== "win32")
		return [];
	try {
		const version = execFileSync("tar", ["--version"], { encoding: "utf-8", shell: true });
		return /GNU tar/i.test(version) ? ["--force-local"] : [];
	}
	catch {
		return [];
	}
})();

/**
 * 发布清单守卫（架构评审 P1 落地）：把「发布走 pnpm」这条口头约定钉成机器断言。
 *
 * 背景：包内依赖用 `workspace:*`（cli→runtime）与 `catalog:`（共享依赖）两种协议。
 * **pnpm** 在 pack/publish 时会把它们改写成精确版本/真实范围，而 **npm** 不会——
 * 若走 `npm publish`，tarball 里会留下协议字面量，外部工程直接装不上。
 * 故这里真的跑一次 `pnpm pack`（就是发布路径），解出 tarball 内的 manifest 断言。
 * 顺带复核 P5 的 sourcemap 排除、bin 双入口与 runtime「包内无 .ts 源」（US-7/R8）。
 */

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-pack-guard-"));

/**
 * pnpm pack 会触发 cli 的 prepack：sync-devkit / sync-host-versions / sync-bundles。
 * 前两者是幂等同步（devkit 目标 gitignored；host-versions 矩阵与 shell-dist 一致），
 * 不留跨套件可见状态；但 sync-bundles.mjs 会无条件 rmSync 并重建
 * packages/cli/shell-dist/bundles/：本地 templates/dist 只要留有已签名 tgz，pack 后
 * 这个 gitignored 目录就从「源码仓应有的空态」变成「有随站包」。packages/cli 的
 * market-bundle-freshness 守卫在模块加载时读它，于是「先跑根套件、再跑 packages/cli
 * 套件」会误激活发布形态守卫并失败——顺序依赖就出在这份残留上。
 *
 * 修法：真实 pack 照跑（发布路径的验证价值不能丢），把 bundles/ 当测试夹具——跑前留
 * 快照、每次 pack 后就地还原、afterAll 兜底。本测试对共享目录零残留，两个套件谁先谁后
 * 结果一致。用「还原」而非让守卫跳过，是不绕过发布形态校验（守卫缺 entry.js 的报错
 * 在真实发布形态下仍然有效）。
 */
const bundlesDir = path.join(PROJECT_ROOT, "packages/cli", "shell-dist", "bundles");

interface BundlesState {
	exists: boolean
	/** sync-bundles 只往该目录平铺 *.tgz / *.sig，无子目录 */
	files: Map<string, Buffer>
}

function readBundles(): BundlesState {
	if (!fs.existsSync(bundlesDir))
		return { exists: false, files: new Map() };
	const files = new Map<string, Buffer>();
	for (const name of fs.readdirSync(bundlesDir)) {
		const p = path.join(bundlesDir, name);
		if (fs.statSync(p).isFile())
			files.set(name, fs.readFileSync(p));
	}
	return { exists: true, files };
}

function restoreBundles(s: BundlesState): void {
	fs.rmSync(bundlesDir, { recursive: true, force: true });
	if (!s.exists)
		return; // 源码仓合法空态：prepack 生成的随站包一并清掉
	fs.mkdirSync(bundlesDir, { recursive: true });
	for (const [name, content] of s.files)
		fs.writeFileSync(path.join(bundlesDir, name), content);
}

/** 内容指纹，供回归断言比较「跑 pack 前后 bundles 是否逐字一致」。 */
function bundlesFingerprint(s: BundlesState): string {
	if (!s.exists)
		return "<absent>";
	return [...s.files]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, buf]) => `${name}=${buf.toString("base64")}`)
		.join(";");
}

const bundlesBaseline = readBundles();

/** 源包版本（发布演练断言 tarball 版本与之相等，避免每次发版改测试） */
function sourceVersion(pkgDir: string): string {
	return (JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, pkgDir, "package.json"), "utf-8")) as { version: string }).version;
}

afterAll(() => {
	fs.rmSync(outDir, { recursive: true, force: true });
	restoreBundles(bundlesBaseline); // 兜底：即便某条用例在 pack 之外动过 bundles 也还原
});

/** 跑 pnpm pack 并返回 tarball 路径 */
function pack(pkgDir: string, name: string): string {
	execFileSync("pnpm", ["pack", "--pack-destination", outDir], { cwd: path.join(PROJECT_ROOT, pkgDir), stdio: "pipe", shell: true });
	// prepack 已重建过 shell-dist/bundles，就地还原，不留跨套件可见的残留
	restoreBundles(bundlesBaseline);
	const tarball = fs.readdirSync(outDir).find(f => f.startsWith(name) && f.endsWith(".tgz"));
	if (!tarball)
		throw new Error(`pnpm pack 未产出 ${name} 的 tarball`);
	return path.join(outDir, tarball);
}

interface PackedManifest {
	version?: string
	dependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
	bin?: Record<string, string>
}

function manifestOf(tgz: string): { raw: string, json: PackedManifest } {
	const raw = execFileSync("tar", [...TAR_LOCAL, "-xzOf", tgz, "package/package.json"], { encoding: "utf-8", shell: true });
	return { raw, json: JSON.parse(raw) };
}

function entriesOf(tgz: string): string[] {
	// bsdtar on Windows emits CRLF; strip \r so entry names match POSIX/GNU output.
	return execFileSync("tar", [...TAR_LOCAL, "-tzf", tgz], { encoding: "utf-8", shell: true }).replace(/\r/g, "").split("\n");
}

/** 发布态不得残留包管理协议字面量（workspace/catalog/link/file） */
function protocolLeaks(pkg: PackedManifest): [string, string][] {
	const fields = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
	return Object.entries(fields).filter(([, v]) => typeof v === "string" && /^(?:workspace|catalog|link|file):/.test(v)) as [string, string][];
}

// Windows 上 pnpm pack 冷启动较慢，单测默认 5s 会偶发超时；三条都显式放宽到 60s。
describe("发布清单（走真实 pnpm pack 路径）", () => {
	it("runtime：协议已改写、peer 为真实范围、包内无 .ts 源", { timeout: 60_000 }, () => {
		const tgz = pack("packages/runtime", "oj-module-runtime-");
		const { json } = manifestOf(tgz);
		expect(json.version).toBe(sourceVersion("packages/runtime"));
		expect(protocolLeaks(json), "runtime manifest 残留包管理协议").toEqual([]);
		// catalog: 必须被改写成真实 semver 范围
		for (const [, range] of Object.entries(json.peerDependencies ?? {}))
			expect(String(range)).toMatch(/^[\^~]?\d+\.\d+\.\d+/);

		const entries = entriesOf(tgz);
		expect(entries.filter(e => /\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)), "runtime 包含非声明 .ts 源").toEqual([]);
		expect(entries.filter(e => /(?:^|\/)src\//.test(e)), "runtime 包含 src/").toEqual([]);
		expect(entries).toContain("package/dist/contract/index.js");
	});

	it("cli：无 workspace 协议、runtime 精确且 lockstep、无 sourcemap、bin 双入口", { timeout: 60_000 }, () => {
		const tgz = pack("packages/cli", "oj-module-cli-");
		const { raw, json } = manifestOf(tgz);
		expect(json.version).toBe(sourceVersion("packages/cli"));
		// 关键断言：npm 发布路径会原样保留 workspace:*，pnpm 才改写
		expect(raw).not.toContain("workspace:");
		expect(protocolLeaks(json), "cli manifest 残留包管理协议").toEqual([]);
		// lockstep：cli 发布的精确依赖版本必须等于 runtime 包版本（不允许漂移）
		expect(json.dependencies?.["@oj-module/runtime"]).toBe(sourceVersion("packages/runtime"));
		expect(json.version).toBe(sourceVersion("packages/runtime"));
		expect(json.bin).toMatchObject({ ojm: "./bin/ojm.mjs" });

		const entries = entriesOf(tgz);
		expect(entries.filter(e => e.endsWith(".map")), "tarball 里出现了 sourcemap").toEqual([]);
		expect(entries).toContain("package/shell-dist/index.html");
		expect(entries).toContain("package/templates/.ojm-api-exempt.json");
	});

	/**
	 * 0.2.5 发布实测 bug3：npm/pnpm pack 会剥离 `.gitignore` 等 VCS 点文件
	 * （npm-packlist 的 always-exclude，`files` 字段也绕不过）。init.include.yaml
	 * 曾收录 `.gitignore`，tarball 里没有它 → readInitInclude fail-fast →
	 * 用户工程 init 整体中断、只剩空目录。白名单条目必须逐条落在 tarball 内。
	 */
	it("cli：init.include.yaml 每条收录路径都在 tarball 内", { timeout: 60_000 }, () => {
		const tgz = pack("packages/cli", "oj-module-cli-");
		const inTarball = new Set(entriesOf(tgz).map(e => e.replace(/^package\//, "").replace(/\/$/, "")));
		const listText = fs.readFileSync(
			path.join(PROJECT_ROOT, "packages/cli/templates/init.include.yaml"),
			"utf-8",
		);
		const listed = [...listText.matchAll(/^\s*-\s*(\S+)\s*$/gm)].map(m => m[1]);
		expect(listed.length).toBeGreaterThan(0);
		// tarball 只列文件条目：目录条目按「其下有子孙文件」判定（同 copyTemplates 的穿行语义）
		const missing = listed.filter(p =>
			!inTarball.has(`templates/${p}`) && ![...inTarball].some(e => e.startsWith(`templates/${p}/`)));
		expect(missing, "init.include.yaml 有条目未进 tarball（点文件会被 pack 剥离）").toEqual([]);
	});

	/**
	 * 回归：本文件真跑 pnpm pack 会触发 prepack → sync-bundles 重建 shell-dist/bundles。
	 * 若不还原，随后单独跑 packages/cli 套件时，market-bundle-freshness 守卫会在模块加载时
	 * 误判「发布形态已有随站包」并因本地 backend-only 包缺 entry.js 而失败（顺序依赖）。
	 * 走一次真实 cli pack，断言 bundles 与跑前逐字一致——删掉还原逻辑这条就会挂。
	 */
	it("prepack 的随站包副作用已就地还原（消除跨套件顺序依赖）", { timeout: 60_000 }, () => {
		pack("packages/cli", "oj-module-cli-");
		expect(bundlesFingerprint(readBundles()), "pack 后 shell-dist/bundles 应与跑前逐字一致").toBe(bundlesFingerprint(bundlesBaseline));
	});
});
