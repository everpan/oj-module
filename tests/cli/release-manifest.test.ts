import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 发布清单守卫（架构评审 P1 落地）：把「发布走 pnpm」这条口头约定钉成机器断言。
 *
 * 背景：`packages/cli` 的 dependencies 写 `@oj-module/runtime: "workspace:*"`。
 * **pnpm** 在 pack/publish 时会把 workspace 协议改写成精确版本，而 **npm** 不会——
 * 若有人用 `npm publish`，tarball 里会留下 `workspace:*`，外部工程直接装不上。
 * 故这里真的跑一次 `pnpm pack`（就是发布路径），解出 tarball 内的 manifest 断言。
 * 顺带复核 P5 的 sourcemap 排除与 bin 双入口。
 */

const CLI_DIR = path.join(PROJECT_ROOT, "packages/cli");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-pack-guard-"));

afterAll(() => {
	fs.rmSync(outDir, { recursive: true, force: true });
});

describe("cli 发布清单（走真实 pnpm pack 路径）", () => {
	it("tarball manifest 无 workspace 协议、runtime 为精确版本、无 sourcemap、bin 双入口", () => {
		execFileSync("pnpm", ["pack", "--pack-destination", outDir], { cwd: CLI_DIR, stdio: "pipe" });
		const tarball = fs.readdirSync(outDir).find(f => f.endsWith(".tgz"));
		expect(tarball, "pnpm pack 未产出 tarball").toBeTruthy();
		const tgz = path.join(outDir, tarball!);

		const manifestRaw = execFileSync("tar", ["-xzOf", tgz, "package/package.json"], { encoding: "utf-8" });
		// 关键断言：npm 发布路径会原样保留 workspace:*，pnpm 会改写为精确版本
		expect(manifestRaw).not.toContain("workspace:");
		const manifest = JSON.parse(manifestRaw) as {
			dependencies?: Record<string, string>
			bin?: Record<string, string>
		};
		expect(manifest.dependencies?.["@oj-module/runtime"]).toMatch(/^\d+\.\d+\.\d+/);
		expect(manifest.bin).toMatchObject({ ojm: "./bin/ojm.mjs", ram: "./bin/ram.mjs" });

		// P5：sourcemap 不发版（files 取反必须在 shell-dist 之后才生效）
		const entries = execFileSync("tar", ["-tzf", tgz], { encoding: "utf-8" }).split("\n");
		expect(entries.filter(e => e.endsWith(".map")), "tarball 里出现了 sourcemap").toEqual([]);
		expect(entries).toContain("package/shell-dist/index.html");
		expect(entries).toContain("package/templates/api/.ojm-api-exempt.json");
	}, 120_000);
});
