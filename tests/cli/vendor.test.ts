import type { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseVendorArgs } from "../../packages/cli/src/args";
import { fetchLatestRelease, installFromRelease, pickAsset, readLocalVersion, RELEASE_API, resolveTriplet, vendorCommand } from "../../packages/cli/src/vendor";

/**
 * ram vendor 子命令（docs/prd/202609040905-vendor-download-design.md）：
 * 从 everpan/only-js 最新 release 按平台下载 oj，sha256 校验后装进 bin/。
 */

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

	it.each([403, 404])("hTTP %i → 人话报错提示 GITHUB_TOKEN", async (status) => {
		await expect(fetchLatestRelease({ fetchFn: async () => new Response("x", { status }), token: "" }))
			.rejects
			.toThrowError(/GITHUB_TOKEN/);
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
			.rejects
			.toThrowError(/sha256/);
		expect(fs.existsSync(path.join(bin, "oj"))).toBe(false);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

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
				{ name: `${name}.sha256`, browser_download_url: "https://fake/oj.tar.gz.sha256" },
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

	// ponytail: fixture 依赖系统 tar，win CI 暂无；win 实机验证属设计 §5 范围外
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
			.rejects
			.toThrowError(/sha256/);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
