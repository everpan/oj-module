import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isSharedDep, SHARED_DEPS } from "../../packages/cli/src/shared-deps";
import { PROJECT_ROOT } from "../helpers/paths";

const SHELL_DIST = path.join(PROJECT_ROOT, "packages/cli/shell-dist");

/**
 * M1 T7：@plane/kit 首方共享包的三处登记落进产物。
 *
 * 登记链路：SHARED_DEPS（{ specifier: "@plane/kit", asset: "kit", hard: true }）
 * → generateImportmap / generateShellEntries / writeVersionsJson 全部由该表生成（P4.1），
 * 故本测试锁死「表 → 产物」的传导，防静默漂移。
 */
describe("@plane/kit 共享登记（M1 T7）", () => {
	it("sHARED_DEPS 含硬共享条目（单例语义：React context）", () => {
		const entry = SHARED_DEPS.find(d => d.specifier === "@plane/kit");
		expect(entry, "@plane/kit 未登记进 SHARED_DEPS").toBeTruthy();
		expect(entry!.asset).toBe("kit");
		expect(entry!.hard, "@plane/kit 必须是硬共享（多副本 = 两份 antd 上下文树）").toBe(true);
	});

	it("isSharedDep 命中 @plane/kit 及其子路径", () => {
		expect(isSharedDep("@plane/kit")).toBe(true);
		expect(isSharedDep("@plane/kit/sub")).toBe(true);
		expect(isSharedDep("@plane/kitx")).toBe(false);
	});

	it("importmap 含 @plane/kit 键且产物存在", () => {
		const html = fs.readFileSync(path.join(SHELL_DIST, "index.html"), "utf-8");
		const match = html.match(/<script type="importmap"[^>]*>(.*?)<\/script>/s);
		expect(match, "index.html 缺少 importmap").toBeTruthy();
		const importmap = JSON.parse(match![1]).imports;
		expect(importmap["@plane/kit"]).toBe("/assets/kit.js");
		expect(fs.existsSync(path.join(SHELL_DIST, "assets/kit.js")), "assets/kit.js 缺失，请重建 shell").toBe(true);
	});

	it("versions.json 含 @plane/kit 条目且与 cli lockstep 同版", () => {
		const versions = JSON.parse(fs.readFileSync(path.join(SHELL_DIST, "versions.json"), "utf-8"));
		const cliVersion = JSON.parse(
			fs.readFileSync(path.join(PROJECT_ROOT, "packages/cli/package.json"), "utf-8"),
		).version;
		expect(versions["@plane/kit"], "versions.json 缺少 @plane/kit（P4.5 版本门禁真源）").toBe(cliVersion);
	});
});
