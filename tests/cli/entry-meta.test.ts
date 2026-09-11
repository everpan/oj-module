import path from "node:path";
import { describe, expect, it } from "vitest";

import { readModuleDefinition } from "../../packages/cli/src/build";
import { MODULES_DIR, PLAYGROUND_DIR, PROJECT_ROOT } from "../helpers/paths";

/**
 * P3.4 / B10：模块元数据（name/version）由真实 import 解析，
 * 不再用正则从 entry.ts 源码里抠字符串——正则会被注释、
 * 多行、变量引用等任何写法骗过；真实 import 永远说真话。
 */
describe("build-modules 真实 import 解析元数据（P3.4 / B10）", () => {
	it("解析 home 模块元数据", async () => {
		const definition = await readModuleDefinition(path.join(MODULES_DIR, "home/entry.ts"), PROJECT_ROOT);
		expect(definition.name).toBe("home");
		expect(definition.version).toBe("1.0.0");
	});

	it("解析 system 模块元数据", async () => {
		const definition = await readModuleDefinition(path.join(MODULES_DIR, "system/entry.ts"), PROJECT_ROOT);
		expect(definition.name).toBe("system");
		expect(definition.version).toBe("1.0.0");
	});

	it("解析 playground demo 模块元数据（含 peerRuntime）", async () => {
		const definition = await readModuleDefinition(path.join(PLAYGROUND_DIR, "web/src/demo/entry.ts"), PROJECT_ROOT);
		expect(definition.name).toBe("demo");
		expect(definition.version).toBe("0.1.0");
		// `^0.0.0` 在 semver 下等价于「恰好 0.0.0」，宿主一升级就误判不兼容，
		// 故声明为开放范围（宿主 runtime 尚未发版，workspace 内为 0.0.0）
		expect(definition.peerRuntime).toBe(">=0.0.0");
	});

	it("default 导出缺 name 时报错", async () => {
		await expect(readModuleDefinition(path.join(PROJECT_ROOT, "tests/fixtures/entry-no-name.ts"), PROJECT_ROOT))
			.rejects
			.toThrow(/name 或 version/);
	});
});
