# ram vendor 子命令 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `ram vendor [--force]` 子命令：从 GitHub `everpan/only-js` 最新 release 按平台下载 oj 资产，sha256 校验后安装到工程 `bin/`（幂等，可强制重装）。

**Architecture:** 单一新文件 `packages/cli/src/vendor.ts`（纯函数 + 依赖注入的 IO 函数），`src/index.ts` 注册 case，`src/args.ts` 加参数解析，`src/usage.ts` 补说明。init 的内置 tar.gz 路径不动。

**Tech Stack:** Node 22+ 原生 `fetch`/`node:stream`/`node:crypto`，系统 `tar`（Win10+ bsdtar 可读 zip），Vitest。

**Spec:** `docs/prd/202609040905-vendor-download-design.md`（决策 V1–V9、用例 US-1..US-6 以其为准）

## Global Constraints

- 缩进用 tab、双引号、分号（@antfu/eslint-config）；注释中文、与现有 cli 文件同款头注
- 零新 npm 依赖（V9）；解压用系统 `tar`（V8）
- 测试放 `tests/cli/vendor.test.ts`，import 自 `../../packages/cli/src/vendor`；跑 `pnpm vitest run tests/cli/vendor.test.ts`
- 资产名 `oj-<tag>-<triplet>.<ext>`；ext：unix=`tar.gz`，win32=`zip`（实测 v0.1.0）
- `.sha256` 资产格式 `<hex>  <filename>`（sha256sum），取首段 hex 比对（V7 必做）
- 版本比较 = tag 字符串相等；本地版本只认 `bin/.oj-version` 标记（V4）
- 每次实现前先建分支：`git checkout -b feat/cli-vendor`（CLAUDE.md）

---

### Task 1: 建分支 + args/纯函数（resolveTriplet / pickAsset / readLocalVersion）

**Files:**
- Modify: `packages/cli/src/args.ts`（加 `parseVendorArgs`）
- Create: `packages/cli/src/vendor.ts`
- Test: `tests/cli/vendor.test.ts`

**Interfaces:**
- Produces（后续任务依赖）:
  - `parseVendorArgs(argv: string[]): { force: boolean }`
  - `resolveTriplet(platform: string, arch: string): string` — 不支持即 throw
  - `assetExt(platform: string): "tar.gz" | "zip"`
  - `ReleaseAsset = { name: string, browser_download_url: string }`
  - `pickAsset(assets: ReleaseAsset[], tag: string, platform: string, arch: string): ReleaseAsset` — 内部调 resolveTriplet/assetExt；无匹配 throw（错误含可用资产名列表）
  - `readLocalVersion(binDir: string): string | null` — `bin/oj`（win32 为 `oj.exe`，见下）或 `.oj-version` 缺失 → null

> 说明：`bin/oj` 存在性判断在 win32 下查 `oj.exe`。统一辅助 `ojBinName(platform) = platform === "win32" ? "oj.exe" : "oj"`（内部函数，不导出）。

- [ ] **Step 1: 建分支**

```bash
git checkout -b feat/cli-vendor
```

- [ ] **Step 2: 写失败测试**

```ts
// tests/cli/vendor.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseVendorArgs } from "../../packages/cli/src/args";
import { pickAsset, readLocalVersion, resolveTriplet } from "../../packages/cli/src/vendor";

describe("parseVendorArgs", () => {
	it("无参数 force=false；--force 任意位置生效", () => {
		expect(parseVendorArgs([])).toEqual({ force: false });
		expect(parseVendorArgs(["--force"])).toEqual({ force: true });
	});
});

describe("resolveTriplet（US-5 平台映射表）", () => {
	it.each([
		["darwin", "arm64", "aarch64-apple-darwin"],
		["darwin", "x64", "x86_64-apple-darwin"],
		["linux", "x64", "x86_64-unknown-linux-gnu"],
		["linux", "arm64", "aarch64-unknown-linux-gnu"],
		["win32", "x64", "x86_64-pc-windows-msvc"],
	])("%s/%s → %s", (platform, arch, triplet) => {
		expect(resolveTriplet(platform, arch)).toBe(triplet);
	});

	it("不支持的组合 → 人话报错并列出已支持组合", () => {
		expect(() => resolveTriplet("win32", "arm64")).toThrowError(/暂不支持/);
	});
});

describe("pickAsset（资产匹配）", () => {
	const assets = [
		{ name: "oj-v0.1.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://x/darwin" },
		{ name: "oj-v0.1.0-aarch64-apple-darwin.tar.gz.sha256", browser_download_url: "https://x/darwin.sum" },
		{ name: "oj-v0.1.0-x86_64-pc-windows-msvc.zip", browser_download_url: "https://x/win" },
	];

	it("darwin/arm64 命中 tar.gz", () => {
		expect(pickAsset(assets, "v0.1.0", "darwin", "arm64").name)
			.toBe("oj-v0.1.0-aarch64-apple-darwin.tar.gz");
	});

	it("win32/x64 命中 zip（不写死 tar.gz）", () => {
		expect(pickAsset(assets, "v0.1.0", "win32", "x64").name)
			.toBe("oj-v0.1.0-x86_64-pc-windows-msvc.zip");
	});

	it("无匹配 → 报错列出可用资产名（US-6）", () => {
		expect(() => pickAsset(assets, "v0.1.0", "linux", "arm64"))
			.toThrowError(/oj-v0\.1\.0-aarch64-apple-darwin\.tar\.gz/);
	});
});

describe("readLocalVersion（V4 标记文件）", () => {
	it("bin/oj 缺失 → null；有 oj 无标记 → null；两者俱在 → 版本串", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ram-vendor-"));
		const bin = path.join(dir, "bin");
		expect(readLocalVersion(bin)).toBeNull();
		fs.mkdirSync(bin, { recursive: true });
		fs.writeFileSync(path.join(bin, "oj"), "");
		expect(readLocalVersion(bin)).toBeNull();
		fs.writeFileSync(path.join(bin, ".oj-version"), "v0.1.0\n");
		expect(readLocalVersion(bin)).toBe("v0.1.0");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run tests/cli/vendor.test.ts`
Expected: FAIL（`parseVendorArgs` / `vendor.ts` 不存在）

- [ ] **Step 4: 最小实现**

`packages/cli/src/args.ts` 追加（同款注释风格）：

```ts
/**
 * `ram vendor [--force]`：检查并按需更新 oj vendor
 * （docs/prd/202609040905-vendor-download-design.md V1/V2）。
 */
export function parseVendorArgs(argv: string[]): { force: boolean } {
	return { force: argv.includes("--force") };
}
```

`packages/cli/src/vendor.ts`：

```ts
/**
 * `ram vendor` —— oj vendor 按平台联网下载（设计 V1–V9）。
 *
 * 从 everpan/only-js 最新 release 取本平台资产，sha256 校验后装进工程
 * bin/。init 的内置 tar.gz 是离线兜底，本命令是联网更新通道，两者独立。
 */

import fs from "node:fs";
import path from "node:path";

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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/cli/vendor.test.ts`
Expected: PASS（4 个 describe 全绿）

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/args.ts packages/cli/src/vendor.ts tests/cli/vendor.test.ts
git commit -m "feat(cli): vendor 纯函数层（triplet 映射/资产匹配/版本标记）"
```

---

### Task 2: fetchLatestRelease + install（IO 层，依赖注入）

**Files:**
- Modify: `packages/cli/src/vendor.ts`
- Test: `tests/cli/vendor.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ReleaseAsset` / `Release`
- Produces:
  - `FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>`
  - `VendorDeps = { fetchFn?: FetchLike, token?: string }`（缺省 `globalThis.fetch` / `process.env.GITHUB_TOKEN`）
  - `fetchLatestRelease(deps?: VendorDeps): Promise<Release>` — 403/404 报错带 GITHUB_TOKEN 提示
  - `installFromRelease(asset: ReleaseAsset, sumsAsset: ReleaseAsset, tag: string, binDir: string, deps?: VendorDeps): Promise<void>`
  - Task 3 依赖 `RELEASE_API = "https://api.github.com/repos/everpan/only-js/releases/latest"` 导出常量

- [ ] **Step 1: 写失败测试（追加到 tests/cli/vendor.test.ts）**

```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
// 顶部 import 追加：fetchLatestRelease, installFromRelease, RELEASE_API

function fakeRelease(tag: string) {
	return { tag_name: tag, assets: [{ name: `oj-${tag}-aarch64-apple-darwin.tar.gz`, browser_download_url: "https://fake/x" }] };
}

describe("fetchLatestRelease（V3/V6 认证与错误）", () => {
	const okResp = () => new Response(JSON.stringify(fakeRelease("v9.9.9")), { status: 200 });

	it("匿名成功返回 release JSON", async () => {
		const r = await fetchLatestRelease({ fetchFn: async () => okResp(), token: "" });
		expect(r.tag_name).toBe("v9.9.9");
	});

	it("有 token 时带 Authorization 头", async () => {
		let seen: string | undefined;
		await fetchLatestRelease({
			token: "tk",
			fetchFn: async (_url, init) => {
				seen = init?.headers?.Authorization;
				return okResp();
			},
		});
		expect(seen).toBe("Bearer tk");
	});

	it.each([403, 404])("HTTP %i → 人话报错提示 GITHUB_TOKEN", async (status) => {
		await expect(fetchLatestRelease({ fetchFn: async () => new Response("x", { status }), token: "" }))
			.rejects.toThrowError(/GITHUB_TOKEN/);
	});
});

describe("installFromRelease（下载→校验→解包→标记）", () => {
	// 真 tar 造 fixture：一个含 oj 假二进制的顶层目录，与上游包结构一致
	function makeFixture(dir: string): { tarBytes: Buffer, hex: string } {
		const src = path.join(dir, "pkg");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(path.join(src, "oj"), "#!/bin/sh\necho oj\n");
		const tarPath = path.join(dir, "a.tar.gz");
		execFileSync("tar", ["-czf", tarPath, "-C", dir, "pkg"]);
		const tarBytes = fs.readFileSync(tarPath);
		return { tarBytes, hex: createHash("sha256").update(tarBytes).digest("hex") };
	}

	it("全流程：解包出 bin/oj、写 .oj-version、sha256 不符即拒", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ram-vendor-io-"));
		const { tarBytes, hex } = makeFixture(dir);
		const asset = { name: "oj-v1.0.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://fake/oj.tar.gz" };
		const sums = { name: `${asset.name}.sha256`, browser_download_url: "https://fake/oj.tar.gz.sha256" };
		let servedSum = `${hex}  ${asset.name}\n`;
		const fetchFn: typeof fetch = async (url) => {
			const u = String(url);
			if (u.endsWith(".sha256"))
				return new Response(servedSum, { status: 200 });
			return new Response(new Uint8Array(tarBytes), { status: 200 });
		};
		const bin = path.join(dir, "bin");

		await installFromRelease(asset, sums, "v1.0.0", bin, { fetchFn, token: "" });
		expect(fs.readFileSync(path.join(bin, "oj"), "utf-8")).toContain("echo oj");
		expect(fs.readFileSync(path.join(bin, ".oj-version"), "utf-8").trim()).toBe("v1.0.0");
		expect(fs.statSync(path.join(bin, "oj")).mode & 0o111).not.toBe(0);

		// 篡改场景：sums 与实际不符 → 报错且 bin/ 不留 oj
		servedSum = `${"0".repeat(64)}  ${asset.name}\n`;
		fs.rmSync(bin, { recursive: true, force: true });
		await expect(installFromRelease(asset, sums, "v1.0.0", bin, { fetchFn, token: "" }))
			.rejects.toThrowError(/sha256/);
		expect(fs.existsSync(path.join(bin, "oj"))).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/cli/vendor.test.ts`
Expected: FAIL（`fetchLatestRelease` / `installFromRelease` 未导出）

- [ ] **Step 3: 实现（追加到 vendor.ts，头注不动）**

```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import process from "node:process";

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
			`[ram] 查询最新 release 失败（HTTP ${res.status}）。\n`
			+ (token ? "已携带 GITHUB_TOKEN，请确认其有 everpan/only-js 读权限。" : "若仓库为私有或触发限流，请设置 GITHUB_TOKEN 后重试。"),
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
```

> 注意：`fs.createWriteStream` 需在 import 处已有 `fs`（Task 1 已引）；新增 import 合并进文件头，eslint import 排序由 `pnpm lint:fix` 兜底。

- [ ] **Step 4: 跑测试确认通过 + lint**

Run: `pnpm vitest run tests/cli/vendor.test.ts && pnpm lint:fix`
Expected: PASS，lint 无错（import 排序自动修复后确认测试仍绿）

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/vendor.ts tests/cli/vendor.test.ts
git commit -m "feat(cli): vendor IO 层（release 查询/sha256 校验/解包安装）"
```

---

### Task 3: vendorCommand 编排 + 子命令注册

**Files:**
- Modify: `packages/cli/src/vendor.ts`（加 `vendorCommand`）
- Modify: `packages/cli/src/index.ts`（注册 case）
- Modify: `packages/cli/src/args.ts` 无需动；`packages/cli/src/usage.ts`（补 vendor 行）
- Test: `tests/cli/vendor.test.ts`

**Interfaces:**
- Consumes: Task 1/2 全部导出
- Produces:
  - `vendorCommand(projectRoot: string, opts: { force: boolean }, deps?: VendorDeps & { log?: (msg: string) => void }): Promise<void>` — US-1..US-4 编排；`log` 缺省 `console.log`

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { RELEASE_API, vendorCommand } from "../../packages/cli/src/vendor";

describe("vendorCommand（US-1..US-4 编排）", () => {
	function setup(tag = "v0.2.0") {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ram-vendor-cmd-"));
		const src = path.join(dir, "pkg");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(path.join(src, "oj"), "#!/bin/sh\necho oj\n");
		execFileSync("tar", ["-czf", path.join(dir, "a.tar.gz"), "-C", dir, "pkg"]);
		const tarBytes = fs.readFileSync(path.join(dir, "a.tar.gz"));
		const hex = createHash("sha256").update(tarBytes).digest("hex");
		const name = `oj-${tag}-aarch64-apple-darwin.tar.gz`;
		const release = {
			tag_name: tag,
			assets: [
				{ name, browser_download_url: "https://fake/oj" },
				{ name: `${name}.sha256`, browser_download_url: "https://fake/oj.sum" },
			],
		};
		let downloads = 0;
		const fetchFn: typeof fetch = async (url) => {
			const u = String(url);
			if (u === RELEASE_API)
				return new Response(JSON.stringify(release), { status: 200 });
			downloads++;
			if (u.endsWith(".sha256"))
				return new Response(`${hex}  ${name}\n`, { status: 200 });
			return new Response(new Uint8Array(tarBytes), { status: 200 });
		};
		return { dir, bin: path.join(dir, "bin"), fetchFn, count: () => downloads };
	}

	const macOnly = process.platform === "darwin" ? it : it.skip;

	macOnly("US-1 全新安装 → US-2 幂等跳过 → US-4 --force 重装", async () => {
		const { dir, bin, fetchFn, count } = setup();
		const logs: string[] = [];
		const log = (m: string) => logs.push(m);

		await vendorCommand(dir, { force: false }, { fetchFn, token: "", log });
		expect(fs.existsSync(path.join(bin, "oj"))).toBe(true);
		const after1 = count();

		await vendorCommand(dir, { force: false }, { fetchFn, token: "", log }); // US-2
		expect(count()).toBe(after1);
		expect(logs.at(-1)).toMatch(/已是最新 v0\.2\.0/);

		await vendorCommand(dir, { force: true }, { fetchFn, token: "", log }); // US-4
		expect(count()).toBeGreaterThan(after1);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	macOnly("US-3 本地旧版 → 更新到最新", async () => {
		const { dir, bin, fetchFn } = setup("v0.2.0");
		fs.mkdirSync(bin, { recursive: true });
		fs.writeFileSync(path.join(bin, "oj"), "old");
		fs.writeFileSync(path.join(bin, ".oj-version"), "v0.1.0\n");
		await vendorCommand(dir, { force: false }, { fetchFn, token: "", log: () => {} });
		expect(fs.readFileSync(path.join(bin, ".oj-version"), "utf-8").trim()).toBe("v0.2.0");
		expect(fs.readFileSync(path.join(bin, "oj"), "utf-8")).toContain("echo oj");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("release 缺 .sha256 资产 → 人话报错（V7 必做，结构异常）", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ram-vendor-nosum-"));
		const release = { tag_name: "v1", assets: [{ name: "oj-v1-aarch64-apple-darwin.tar.gz", browser_download_url: "https://fake/x" }] };
		const fetchFn: typeof fetch = async () => new Response(JSON.stringify(release), { status: 200 });
		await expect(vendorCommand(dir, { force: false }, { fetchFn, token: "", log: () => {} }))
			.rejects.toThrowError(/sha256/);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
```

> `macOnly`：fixture 用系统 tar 造包+解包，win CI 暂无；与 oj-process.test.ts 现状一致（ponytail: win 实机验证属范围外，设计 §5）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/cli/vendor.test.ts`
Expected: FAIL（`vendorCommand` 未导出）

- [ ] **Step 3: 实现**

`vendor.ts` 追加：

```ts
/**
 * US-1..US-4 编排：查最新 release → 本地已是最新则跳过（--force 除外）
 * → 选本平台资产 + 同名 .sha256 → 安装 → 报告版本。
 */
export async function vendorCommand(
	projectRoot: string,
	opts: { force: boolean },
	deps: VendorDeps & { log?: (msg: string) => void } = {},
): Promise<void> {
	const log = deps.log ?? console.log;
	const release = await fetchLatestRelease(deps);
	const binDir = path.join(projectRoot, "bin");
	const local = readLocalVersion(binDir);
	if (!opts.force && local === release.tag_name) {
		log(`[ram] oj 已是最新 ${release.tag_name}，跳过。`);
		return;
	}
	const asset = pickAsset(release.assets, release.tag_name, process.platform, process.arch);
	const sums = release.assets.find(a => a.name === `${asset.name}.sha256`);
	if (!sums) {
		throw new Error(
			`[ram] release（${release.tag_name}）缺少校验文件 ${asset.name}.sha256，release 结构异常，拒绝安装。`,
		);
	}
	await installFromRelease(asset, sums, release.tag_name, binDir, deps);
	log(`[ram] oj ${local ? `${local} → ` : ""}${release.tag_name} 安装完成：${path.join(binDir, process.platform === "win32" ? "oj.exe" : "oj")}`);
}
```

`index.ts` 注册（import 区加 `import { vendorCommand } from "./vendor";`，switch 加 case）：

```ts
case "vendor": {
	const { force } = parseVendorArgs(process.argv.slice(3));
	await vendorCommand(projectRoot, { force });
	break;
}
```

（import 行同步加 `parseVendorArgs` 到已有 `./args` import。）

`usage.ts` 在命令清单加一行 `vendor`（风格照抄现有行）：`vendor [--force]  检查并按需更新 oj vendor（GitHub releases 按平台下载）`。

- [ ] **Step 4: 跑全量 cli 测试 + typecheck**

Run: `pnpm vitest run tests/cli/ && pnpm typecheck && pnpm lint`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/vendor.ts packages/cli/src/index.ts packages/cli/src/args.ts packages/cli/src/usage.ts tests/cli/vendor.test.ts
git commit -m "feat(cli): ram vendor 子命令（GitHub releases 按平台下载 oj，sha256 校验）"
```

---

### Task 4: 真机回归 + 文档收尾

**Files:**
- Modify: `docs/prd/202609040905-vendor-download-design.md`（§6 待验证项闭环、补总结段）

- [ ] **Step 1: 真机验证 US-1/US-2（真实 release v0.1.0，darwin/arm64）**

```bash
cd $(mktemp -d) && mkdir proj && cd proj
node /Users/ever/git/web/react-antd-module/packages/cli/bin/ram.mjs vendor   # 期望下载安装 v0.1.0
node /Users/ever/git/web/react-antd-module/packages/cli/bin/ram.mjs vendor   # 期望"已是最新"
./bin/oj --help | head -3                                                    # 期望可执行
```

Expected: 两步输出符合 US-1/US-2，`oj --help` 正常。

- [ ] **Step 2: 设计文档收尾**

- §6 问题表：`oj --version` 待验证项按真机结果闭环或保留；补「总结」段：关键过程（brainstorming 两轮定案 → 发版后修正 zip/sha256 → TDD 三任务）与耗时。
- CLAUDE.md 要求：更新计划任务状态。

- [ ] **Step 3: Commit**

```bash
git add docs/prd/202609040905-vendor-download-design.md
git commit -m "docs(prd): vendor 设计收尾（真机回归闭环 + 总结）"
```

---

## Self-Review 记录

- Spec 覆盖：V1–V9 → Task 1–3；US-1..US-6 → Task 1/2/3 测试 + Task 4 真机；§5 范围外未夹带 ✓
- 占位符：无；所有代码步含完整代码 ✓
- 类型一致：`ReleaseAsset`/`VendorDeps`/`FetchLike`/`vendorCommand` 签名跨任务一致；`ojBinName` 仅文件内使用（Task 3 的 win32 判断内联，未引用未导出符号）✓
