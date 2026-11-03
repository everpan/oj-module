import path from "node:path";
import { describe, expect, it } from "vitest";

import { readModuleDefinition } from "../../packages/cli/src/build";
import { MODULES_DIR, PROJECT_ROOT, TEMPLATE_DIR } from "../helpers/paths";

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

	it("解析模板聚合模块元数据（含 peerRuntime 与多根）", async () => {
		const definition = await readModuleDefinition(path.join(TEMPLATE_DIR, "src/app/web/entry.ts"), PROJECT_ROOT);
		expect(definition.name).toBe("app");
		expect(definition.version).toBe("0.1.0");
		// `^0.0.0` 在 semver 下等价于「恰好 0.0.0」，宿主一升级就误判不兼容，
		// 故声明为开放范围（宿主 runtime 尚未发版，workspace 内为 0.0.0）
		expect(definition.peerRuntime).toBe(">=0.0.0");
		// 多根聚合：顶层路由首段去重 > 1（首页/登录/个人中心/通知/系统管理）
		expect(definition.routes?.length ?? 0).toBeGreaterThan(1);
	});

	it("default 导出缺 name 时报错", async () => {
		await expect(readModuleDefinition(path.join(PROJECT_ROOT, "tests/fixtures/entry-no-name.ts"), PROJECT_ROOT))
			.rejects
			.toThrow(/name 或 version/);
	});

	/**
	 * 回归：模块**顶层**调用被桩化的裸依赖，且是柯里化工厂（zustand v5 的
	 * `create()(initializer)` 形态）。桩此前的 `apply: () => undefined` 让第二次调用
	 * 抛 `(0, import_x.create)(...) is not a function` → 元数据读取失败 → `ojm dev`
	 * 起不来。桩改为可链式（`apply: () => value`）后本用例通过。
	 */
	it("顶层柯里化裸依赖调用不炸元数据读取（桩可链式）", async () => {
		const definition = await readModuleDefinition(
			path.join(PROJECT_ROOT, "tests/fixtures/entry-chainable-stub.ts"),
			PROJECT_ROOT,
		);
		expect(definition.name).toBe("chainable-stub");
		expect(definition.version).toBe("0.0.0");
	});

	/**
	 * 回归（Windows 卡死修复）：裸导入桩的 onResolve 必须排除入口与 Windows 盘符绝对路径，
	 * 否则入口自身会被桩化成「可 thenable 的代理」，mod.default 变代理 → async return
	 * 被 thenable 接管而永不 settle → 事件循环排空 → Node 以退出码 0 静默退出
	 * （pnpm dev 起不来）。本用例在 type:module 仓库内跑通，即守住入口不被误桩、元数据
	 * 正常读回真实对象。
	 */
	it("windows 卡死回归：入口不被裸导入桩误伤为 thenable 代理（盘符绝对路径排除）", async () => {
		const definition = await readModuleDefinition(path.join(MODULES_DIR, "home/entry.ts"), PROJECT_ROOT);
		expect(definition.name).toBe("home");
		expect(definition.version).toBe("1.0.0");
		// 取到的必须是真实定义对象，而非被桩成的 thenable 代理（否则 await 会卡死）
		expect(typeof definition).toBe("object");
		expect(Array.isArray(definition)).toBe(false);
	});
});
