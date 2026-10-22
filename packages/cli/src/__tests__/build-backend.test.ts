// buildBackend spec：宿主 versions.json 双落点（方案安装的 C2-09 前置）。
//
// 安装器按 B-11 布局读 `dist/api/versions.json`（与 manifests.yaml 同层）做 peerRuntime
// 强制比对；而站点壳的 versions.json 落在 dist/web。两者不同源时，新工程 `ojm build`
// 完仍会在 preflight 被 C2-09 拒装——这条用例钉住「同源双写」，防止回归。
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildBackend } from "../build";

/**
 * 假 oj 二进制：只需成功退出——本 spec 验的是 buildBackend 在 oj build 之后的收尾动作
 * （versions.json 同源落地），oj build 自身的产物由用例预先放好模拟。
 */
function fakeOj(projectRoot: string): void {
	mkdirSync(join(projectRoot, "bin"), { recursive: true });
	const bin = join(projectRoot, "bin", "oj");
	writeFileSync(bin, "#!/bin/sh\nexit 0\n");
	chmodSync(bin, 0o755);
}

function newProject(): string {
	const root = mkdtempSync(join(tmpdir(), "ojm-build-backend-"));
	mkdirSync(join(root, "api", "src", "demo"), { recursive: true });
	writeFileSync(join(root, "api", "src", "demo", "manifest.yaml"), "name: demo\nversion: 0.1.0\n", "utf-8");
	writeFileSync(join(root, "api", "config.yaml"), "server:\n  port: 9778\n", "utf-8");
	// 模拟 oj build 已产出的 manifests.yaml（验证收尾动作不破坏既有产物）
	mkdirSync(join(root, "dist", "api"), { recursive: true });
	writeFileSync(join(root, "dist", "api", "manifests.yaml"), "demo: 0.1.0\n", "utf-8");
	fakeOj(root);
	return root;
}

describe("given 宿主工程有 api/src When ojm build 后端", () => {
	it("then dist/api/versions.json 与 shell-dist 同源落地（安装器 C2-09 前置）", async () => {
		const root = newProject();

		await buildBackend(root);

		const hostVersions = join(root, "dist", "api", "versions.json");
		expect(existsSync(hostVersions)).toBe(true);
		const parsed = JSON.parse(readFileSync(hostVersions, "utf-8")) as Record<string, string>;
		expect(typeof parsed["@oj-module/runtime"]).toBe("string");
	});

	it("then 既有 oj build 产物不被覆盖（manifests.yaml 原样保留）", async () => {
		const root = newProject();

		await buildBackend(root);

		expect(readFileSync(join(root, "dist", "api", "manifests.yaml"), "utf-8")).toBe("demo: 0.1.0\n");
	});
});

describe("given 纯前端工程（无 api/src）When ojm build 后端", () => {
	it("then 跳过构建、不产出 dist/api", async () => {
		const root = mkdtempSync(join(tmpdir(), "ojm-build-backend-fe-"));

		expect(await buildBackend(root)).toBe(false);
		expect(existsSync(join(root, "dist", "api"))).toBe(false);
	});
});

/**
 * 假 oj：把 argv 落盘供断言；`build --help` 的输出可切（模拟是否支持 --module-root）。
 * 能力探针会先跑 `build --help`，所以脚本必须区分这两次调用。
 */
function fakeOjRecording(projectRoot: string, supportsModuleRoot: boolean): void {
	mkdirSync(join(projectRoot, "bin"), { recursive: true });
	const bin = join(projectRoot, "bin", "oj");
	writeFileSync(bin, [
		"#!/bin/sh",
		"if [ \"$1\" = \"build\" ] && [ \"$2\" = \"--help\" ]; then",
		`  ${supportsModuleRoot ? "echo '      --module-root <GLOB>  模块根 glob'" : "echo '  -d, --dir <DIR>'"}`,
		"  exit 0",
		"fi",
		"if [ \"$1\" = \"-V\" ]; then echo 'oj 0.1.84'; exit 0; fi",
		"printf '%s\\n' \"$*\" > \"$(dirname \"$0\")/invoked\"",
		"exit 0",
		"",
	].join("\n"), { mode: 0o755 });
}

/** 新布局工程：src/<name>/{api,web} + 仓库根 config.yaml */
function newModuleRootProject(): string {
	const root = mkdtempSync(join(tmpdir(), "ojm-build-backend-mr-"));
	mkdirSync(join(root, "src", "wiki", "api"), { recursive: true });
	writeFileSync(join(root, "src", "wiki", "api", "manifest.yaml"), "name: wiki\nversion: 0.1.0\n", "utf-8");
	writeFileSync(join(root, "config.yaml"), "server:\n  port: 9778\n", "utf-8");
	return root;
}

describe("given module-root 布局 When ojm build 后端", () => {
	it("then 一次调用、单一输出根：--module-root src + -o dist/api（与 -d 互斥）", async () => {
		const root = newModuleRootProject();
		fakeOjRecording(root, true);

		expect(await buildBackend(root)).toBe(true);

		// 逐模块 `-o <tmp>` 会让每个 tmp 各写一份 manifests.yaml，锁与兄弟目录关系全丢
		const invoked = readFileSync(join(root, "bin", "invoked"), "utf-8").trim();
		expect(invoked).toBe(
			`build -c ${join(root, "config.yaml")} --module-root ${join(root, "src")} -o ${join(root, "dist", "api")} --no-minify`,
		);
		expect(existsSync(join(root, "dist", "api", "versions.json"))).toBe(true);
	});

	it("then oj 缺 --module-root 能力时 fail-fast，不落任何产物", async () => {
		const root = newModuleRootProject();
		fakeOjRecording(root, false);

		await expect(buildBackend(root)).rejects.toThrow(/不支持 --module-root/);
		expect(existsSync(join(root, "bin", "invoked"))).toBe(false); // 没跑 oj build
		expect(existsSync(join(root, "dist", "api"))).toBe(false);
	});
});
