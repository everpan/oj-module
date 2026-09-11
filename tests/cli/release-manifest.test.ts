import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

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

afterAll(() => {
	fs.rmSync(outDir, { recursive: true, force: true });
});

/** 跑 pnpm pack 并返回 tarball 路径 */
function pack(pkgDir: string, name: string): string {
	execFileSync("pnpm", ["pack", "--pack-destination", outDir], { cwd: path.join(PROJECT_ROOT, pkgDir), stdio: "pipe" });
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
	const raw = execFileSync("tar", ["-xzOf", tgz, "package/package.json"], { encoding: "utf-8" });
	return { raw, json: JSON.parse(raw) };
}

function entriesOf(tgz: string): string[] {
	return execFileSync("tar", ["-tzf", tgz], { encoding: "utf-8" }).split("\n");
}

/** 发布态不得残留包管理协议字面量（workspace/catalog/link/file） */
function protocolLeaks(pkg: PackedManifest): [string, string][] {
	const fields = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
	return Object.entries(fields).filter(([, v]) => typeof v === "string" && /^(?:workspace|catalog|link|file):/.test(v)) as [string, string][];
}

describe("发布清单（走真实 pnpm pack 路径）", () => {
	it("runtime：协议已改写、peer 为真实范围、包内无 .ts 源", () => {
		const tgz = pack("packages/runtime", "oj-module-runtime-");
		const { json } = manifestOf(tgz);
		expect(json.version).toBe("0.1.5");
		expect(protocolLeaks(json), "runtime manifest 残留包管理协议").toEqual([]);
		// catalog: 必须被改写成真实 semver 范围
		for (const [, range] of Object.entries(json.peerDependencies ?? {}))
			expect(String(range)).toMatch(/^[\^~]?\d+\.\d+\.\d+/);

		const entries = entriesOf(tgz);
		expect(entries.filter(e => /\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)), "runtime 包含非声明 .ts 源").toEqual([]);
		expect(entries.filter(e => /(?:^|\/)src\//.test(e)), "runtime 包含 src/").toEqual([]);
		expect(entries).toContain("package/dist/contract/index.js");
	});

	it("cli：无 workspace 协议、runtime 精确版本、无 sourcemap、bin 双入口", () => {
		const tgz = pack("packages/cli", "oj-module-cli-");
		const { raw, json } = manifestOf(tgz);
		expect(json.version).toBe("0.1.5");
		// 关键断言：npm 发布路径会原样保留 workspace:*，pnpm 才改写
		expect(raw).not.toContain("workspace:");
		expect(protocolLeaks(json), "cli manifest 残留包管理协议").toEqual([]);
		expect(json.dependencies?.["@oj-module/runtime"]).toMatch(/^\d+\.\d+\.\d+/);
		expect(json.bin).toMatchObject({ ojm: "./bin/ojm.mjs", ram: "./bin/ram.mjs" });

		const entries = entriesOf(tgz);
		expect(entries.filter(e => e.endsWith(".map")), "tarball 里出现了 sourcemap").toEqual([]);
		expect(entries).toContain("package/shell-dist/index.html");
		expect(entries).toContain("package/templates/api/.ojm-api-exempt.json");
	});
});
