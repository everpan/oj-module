import type { NpmRun } from "../../packages/cli/src/vendor";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseVendorArgs } from "../../packages/cli/src/args";
import { NPM_PKG, probeOjRuntime, readLocalVersion, vendorCommand } from "../../packages/cli/src/vendor";

/**
 * ojm vendor 子命令（docs/prd/202609111926-vendor-npm-install-design.md）：
 * 下载源为 npm 包 @oj-bin/oj（tag 缺省追 latest，可显式指定），
 * 临时目录 `npm i` 后拷贝 bin/ 进工程，写 .oj-version 标记。
 * （202609040905 旧 GitHub releases 方案已被本文档取代。）
 */

describe("parseVendorArgs", () => {
	it("无参数 force=false；--force 任意位置生效", () => {
		expect(parseVendorArgs([])).toEqual({ force: false });
		expect(parseVendorArgs(["--force"])).toEqual({ force: true });
	});

	it("位置参数为 tag：v 前缀可选（0.1.12 → v0.1.12）", () => {
		expect(parseVendorArgs(["v0.1.12"])).toEqual({ force: false, tag: "v0.1.12" });
		expect(parseVendorArgs(["0.1.12", "--force"])).toEqual({ force: true, tag: "v0.1.12" });
	});

	it("非法 tag 形状 → 报错（防误把目录当版本）", () => {
		expect(() => parseVendorArgs(["abc"])).toThrowError(/非法版本号/);
	});
});

describe("readLocalVersion（N6 标记文件）", () => {
	it("bin/oj 缺失 → null；有 oj 无标记 → null；两者俱在 → 版本串", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-vendor-"));
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

describe("probeOjRuntime（发布二进制可用性冒烟）", () => {
	// 假二进制用 sh 脚本，win 不适用
	const posixOnly = process.platform === "win32" ? it.skip : it;

	posixOnly("正常二进制 → ok；JsRuntime ENOENT → 失败并带原始输出", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-oj-probe-"));
		const bin = path.join(dir, "bin");
		fs.mkdirSync(bin, { recursive: true });
		const fake = path.join(bin, "oj");
		fs.writeFileSync(fake, "#!/bin/sh\nexit 0\n");
		fs.chmodSync(fake, 0o755);
		expect(probeOjRuntime(bin)).toEqual({ ok: true, detail: "" });

		fs.writeFileSync(fake, "#!/bin/sh\necho 'Failed to initialize a JsRuntime: No such file or directory (os error 2)' >&2\nexit 1\n");
		fs.chmodSync(fake, 0o755);
		const bad = probeOjRuntime(bin);
		expect(bad.ok).toBe(false);
		expect(bad.detail).toContain("JsRuntime");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("vendorCommand（US-1..US-6 编排）", () => {
	const ojBin = process.platform === "win32" ? "oj.exe" : "oj";

	/** 假 npm：view 回版本；install 模拟 postinstall 在 <cwd>/bin/ 落盘 */
	function setup(latest = "0.2.0") {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-vendor-cmd-"));
		const calls: string[][] = [];
		const run: NpmRun = (args, cwd) => {
			calls.push(args);
			if (args[0] === "view")
				return `${latest}\n`;
			// install：模拟上游 postinstall 行为（INIT_CWD=cwd → <cwd>/bin/）
			const binDir = path.join(cwd, "bin");
			fs.mkdirSync(path.join(binDir, "plugins"), { recursive: true });
			fs.writeFileSync(path.join(binDir, ojBin), "#!/bin/sh\necho oj\n");
			fs.writeFileSync(path.join(binDir, "plugins", "db.so"), "fake");
			return "";
		};
		return { dir, bin: path.join(dir, "bin"), run, calls };
	}

	it("全新安装 → 幂等跳过 → --force 重装（US-1/2/4）", async () => {
		const { dir, bin, run, calls } = setup();
		const logs: string[] = [];
		const log = (m: string) => logs.push(m);

		await vendorCommand(dir, { force: false }, { run, log, probe: () => ({ ok: true, detail: "" }) });
		expect(fs.readFileSync(path.join(bin, ojBin), "utf-8")).toContain("echo oj");
		// plugins 一并拷贝（上游包内含 plugins/devkit）
		expect(fs.existsSync(path.join(bin, "plugins", "db.so"))).toBe(true);
		expect(fs.readFileSync(path.join(bin, ".oj-version"), "utf-8").trim()).toBe("v0.2.0");
		if (process.platform !== "win32")
			expect(fs.statSync(path.join(bin, ojBin)).mode & 0o111).not.toBe(0);
		// 分步人话日志：查询 → 安装（含包@版本）→ 拷贝 → 完成
		const joined = logs.join("\n");
		expect(joined).toMatch(/查询最新版本/);
		expect(joined).toMatch(new RegExp(`安装 ${NPM_PKG.replace("/", "\\/")}@0\\.2\\.0`));
		expect(joined).toMatch(/拷贝/);
		expect(joined).toMatch(/安装完成/);
		// npm 调用形态：无 save/lock 副作用
		const install = calls.find(c => c[0] === "install")!;
		expect(install).toContain("--no-save");
		expect(install).toContain("--no-package-lock");
		expect(install.includes(`${NPM_PKG}@0.2.0`)).toBe(true);
		const after1 = calls.length;

		await vendorCommand(dir, { force: false }, { run, log, probe: () => ({ ok: true, detail: "" }) }); // US-2
		expect(calls.filter(c => c[0] === "install")).toHaveLength(1);
		expect(logs.at(-1)).toMatch(/已是 v0\.2\.0/);

		await vendorCommand(dir, { force: true }, { run, log, probe: () => ({ ok: true, detail: "" }) }); // US-4
		expect(calls.filter(c => c[0] === "install")).toHaveLength(2);
		expect(calls.length).toBeGreaterThan(after1);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("本地旧版 → 更新到最新（US-3）", async () => {
		const { dir, bin, run } = setup("0.2.0");
		fs.mkdirSync(bin, { recursive: true });
		fs.writeFileSync(path.join(bin, ojBin), "old");
		fs.writeFileSync(path.join(bin, ".oj-version"), "v0.1.0\n");
		await vendorCommand(dir, { force: false }, { run, log: () => {}, probe: () => ({ ok: true, detail: "" }) });
		expect(fs.readFileSync(path.join(bin, ".oj-version"), "utf-8").trim()).toBe("v0.2.0");
		expect(fs.readFileSync(path.join(bin, ojBin), "utf-8")).toContain("echo oj");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("显式 tag：去 v 前缀装指定版本，不再 view（US-5）", async () => {
		const { dir, run, calls } = setup();
		await vendorCommand(dir, { force: false, tag: "v9.9.9" }, { run, log: () => {}, probe: () => ({ ok: true, detail: "" }) });
		expect(calls.some(c => c[0] === "view")).toBe(false);
		const install = calls.find(c => c[0] === "install")!;
		expect(install.includes(`${NPM_PKG}@9.9.9`)).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("npm i 本身失败 → 人话报错带 stderr 首行（US-6a）", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-vendor-fail-"));
		const run: NpmRun = (args) => {
			if (args[0] === "view")
				return "0.2.0\n";
			throw Object.assign(new Error("Command failed"), { stderr: Buffer.from("npm ERR! code ETARGET\nnpm ERR! No matching version") });
		};
		await expect(vendorCommand(dir, { force: false }, { run, log: () => {} }))
			.rejects
			.toThrowError(/ETARGET/);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("安装后 bin/oj 缺失 → 裸跑 postinstall 兜底成功（US-6b）", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-vendor-fallback-"));
		const run: NpmRun = (args, cwd) => {
			if (args[0] === "view")
				return "0.2.0\n";
			// 模拟 --ignore-scripts：包解开了但 postinstall 没跑
			const pkgDir = path.join(cwd, "node_modules", "@oj-bin", "oj");
			fs.mkdirSync(pkgDir, { recursive: true });
			fs.writeFileSync(
				path.join(pkgDir, "postinstall.js"),
				`const fs=require("fs"),path=require("path");
const bin=path.join(process.env.INIT_CWD,"bin");
fs.mkdirSync(bin,{recursive:true});
fs.writeFileSync(path.join(bin,${JSON.stringify(ojBin)}),"#!/bin/sh\\necho oj\\n");
`,
			);
			return "";
		};
		await vendorCommand(dir, { force: false }, { run, log: () => {}, probe: () => ({ ok: true, detail: "" }) });
		expect(fs.readFileSync(path.join(dir, "bin", ojBin), "utf-8")).toContain("echo oj");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("兜底后仍无 bin/oj → 人话报错（US-6c，平台不受支持）", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-vendor-noplat-"));
		const run: NpmRun = (args) => {
			if (args[0] === "view")
				return "0.2.0\n";
			return ""; // 什么都没落盘，也无 postinstall 可兜底
		};
		await expect(vendorCommand(dir, { force: false }, { run, log: () => {} }))
			.rejects
			.toThrowError(/未找到 bin|平台/);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("安装后探针判定二进制不可用 → 打人话报错但安装仍算完成（不抛错）", async () => {
		const { dir, run } = setup("0.3.0");
		const logs: string[] = [];
		await vendorCommand(dir, { force: false }, {
			run,
			log: m => logs.push(m),
			probe: () => ({ ok: false, detail: "Failed to initialize a JsRuntime: No such file or directory (os error 2)" }),
		});
		expect(fs.existsSync(path.join(dir, "bin", ojBin))).toBe(true);
		const joined = logs.join("\n");
		expect(joined).toMatch(/自检失败/);
		expect(joined).toMatch(/JsRuntime/);
		expect(joined).toMatch(/cargo build --release/);
		expect(joined).toMatch(/oj-release-binary-defect-report/);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
