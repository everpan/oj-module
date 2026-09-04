import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseVendorArgs } from "../../packages/cli/src/args";
import { pickAsset, readLocalVersion, resolveTriplet } from "../../packages/cli/src/vendor";

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
