// oj 能力探针 spec：双探的第二探（设计 202610220010 §7）。
//
// 失败方式很隐蔽：能力缺失却在构建入口回落到旧布局，会得到「源码搬了、产物还是旧的」
// 半坏状态。这里钉住三件事：解析只看整词旗标、缓存按二进制指纹失效、缺失即抛且带版本。
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CAPS_FILE, probeOjCaps, readCapsCache, requireModuleRootCapability, writeCapsCache } from "../oj-caps";

function newProject(): { root: string, ojBin: string } {
	const root = mkdtempSync(join(tmpdir(), "ojm-caps-"));
	mkdirSync(join(root, "bin"), { recursive: true });
	const ojBin = join(root, "bin", "oj");
	writeFileSync(ojBin, "#!/bin/sh\necho fake\n", { mode: 0o755 });
	return { root, ojBin };
}

const HELP_WITH = "Options:\n  -d, --dir <DIR>  源码目录\n      --module-root <GLOB>  模块根 glob\n";
const HELP_WITHOUT = "Options:\n  -d, --dir <DIR>  源码目录\n";

describe("probeOjCaps", () => {
	it("帮助里有 --module-root 即支持", () => {
		const { ojBin } = newProject();
		expect(probeOjCaps(ojBin, () => HELP_WITH).moduleRoot).toBe(true);
	});

	it("帮助里没有则不支持", () => {
		const { ojBin } = newProject();
		expect(probeOjCaps(ojBin, () => HELP_WITHOUT).moduleRoot).toBe(false);
	});

	it("同名前缀不算命中（--module-rooted 之类的说明文字）", () => {
		const { ojBin } = newProject();
		expect(probeOjCaps(ojBin, () => "--module-rooted 是别的意思\n").moduleRoot).toBe(false);
	});

	it("探测本身失败时报错带处置命令", () => {
		const { ojBin } = newProject();
		expect(() => probeOjCaps(ojBin, () => {
			throw new Error("boom");
		})).toThrow(/ojm vendor/);
	});
});

describe("能力缓存", () => {
	it("写入后能读回", () => {
		const { ojBin } = newProject();
		writeCapsCache(ojBin, { moduleRoot: true });
		expect(readCapsCache(ojBin)).toEqual({ moduleRoot: true });
	});

	it("换二进制（size 变）后缓存失效", () => {
		const { ojBin } = newProject();
		writeCapsCache(ojBin, { moduleRoot: true });
		writeFileSync(ojBin, "#!/bin/sh\necho replaced-and-longer\n", { mode: 0o755 });
		expect(readCapsCache(ojBin)).toBeNull();
	});

	it("mtime 变（同尺寸手替）后缓存失效", () => {
		const { ojBin } = newProject();
		writeCapsCache(ojBin, { moduleRoot: true });
		const future = new Date(Date.now() + 60_000);
		utimesSync(ojBin, future, future);
		expect(readCapsCache(ojBin)).toBeNull();
	});

	it("缓存文件损坏不影响主流程（视为未缓存）", () => {
		const { root, ojBin } = newProject();
		writeFileSync(join(root, "bin", CAPS_FILE), "{not json", "utf-8");
		expect(readCapsCache(ojBin)).toBeNull();
	});
});

describe("requireModuleRootCapability", () => {
	it("支持时通过并落缓存，第二次不再探测", () => {
		const { root } = newProject();
		let calls = 0;
		const run = () => {
			calls += 1;
			return HELP_WITH;
		};
		expect(requireModuleRootCapability(root, run).moduleRoot).toBe(true);
		expect(requireModuleRootCapability(root, run).moduleRoot).toBe(true);
		expect(calls).toBe(1);
		expect(readFileSync(join(root, "bin", CAPS_FILE), "utf-8")).toContain("\"moduleRoot\": true");
	});

	it("二进制缺失时报错指向 ojm vendor", () => {
		const { root } = newProject();
		const run = () => HELP_WITH;
		expect(() => requireModuleRootCapability(join(root, "nope"), run)).toThrow(/ojm vendor/);
	});

	it("能力缺失时抛错，文案含现场版本与两种处置", () => {
		const { root } = newProject();
		const run = (_bin: string, args: string[]) =>
			args[0] === "-V" ? "oj 0.1.84\n" : HELP_WITHOUT;
		expect(() => requireModuleRootCapability(root, run)).toThrow(/oj 0\.1\.84/);
		expect(() => requireModuleRootCapability(root, run)).toThrow(/ojm vendor/);
	});

	it("能力缺失也写缓存（避免每次构建重探），换二进制后指纹变化自动重探", () => {
		const { root, ojBin } = newProject();
		expect(() => requireModuleRootCapability(root, (_b, args) => (args[0] === "-V" ? "oj 0.1.84" : HELP_WITHOUT))).toThrow();
		expect(readCapsCache(ojBin)?.moduleRoot).toBe(false);
		// 二进制更新后指纹变化 → 重探，能力补齐即放行
		const before = statSync(ojBin).size;
		writeFileSync(ojBin, "#!/bin/sh\necho upgraded\n", { mode: 0o755 });
		expect(statSync(ojBin).size).not.toBe(before);
		expect(requireModuleRootCapability(root, () => HELP_WITH).moduleRoot).toBe(true);
	});
});
