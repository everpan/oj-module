// buildBackend spec：宿主 versions.json 双落点（方案安装的 C2-09 前置）。
//
// 安装器按 B-11 布局读 `<api>/dist/versions.json`（与 manifests.yaml 同层）做 peerRuntime
// 强制比对；而站点壳的 versions.json 落在 web/dist。两者不同源时，新工程 `ojm build`
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
	mkdirSync(join(root, "api", "dist"), { recursive: true });
	writeFileSync(join(root, "api", "dist", "manifests.yaml"), "demo: 0.1.0\n", "utf-8");
	fakeOj(root);
	return root;
}

describe("given 宿主工程有 api/src When ojm build 后端", () => {
	it("then api/dist/versions.json 与 shell-dist 同源落地（安装器 C2-09 前置）", async () => {
		const root = newProject();

		await buildBackend(root);

		const hostVersions = join(root, "api", "dist", "versions.json");
		expect(existsSync(hostVersions)).toBe(true);
		const parsed = JSON.parse(readFileSync(hostVersions, "utf-8")) as Record<string, string>;
		expect(typeof parsed["@oj-module/runtime"]).toBe("string");
	});

	it("then 既有 oj build 产物不被覆盖（manifests.yaml 原样保留）", async () => {
		const root = newProject();

		await buildBackend(root);

		expect(readFileSync(join(root, "api", "dist", "manifests.yaml"), "utf-8")).toBe("demo: 0.1.0\n");
	});
});

describe("given 纯前端工程（无 api/src）When ojm build 后端", () => {
	it("then 跳过构建、不产出 api/dist", async () => {
		const root = mkdtempSync(join(tmpdir(), "ojm-build-backend-fe-"));

		expect(await buildBackend(root)).toBe(false);
		expect(existsSync(join(root, "api", "dist"))).toBe(false);
	});
});
