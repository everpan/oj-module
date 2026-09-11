import type {
	AppInfo,
	AppRouteRecordRaw,
	AuthProvider,
	BasicTableProps,
	LoginInfo,
	Manifest,
	ManifestModuleEntry,
	MenuItemType,
	ModuleConfig,
	ModuleContext,
	ModuleDefinition,
	ModuleI18n,
	ModuleInstance,
	ModuleLifecycle,
	RoleItemType,
	RouteMeta,
	TreeDataNodeWithId,
} from "#src/index";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as Runtime from "#src/index";

import { PROJECT_ROOT } from "../helpers/paths";

// pro-components 发布物 type:"module" 与 lib/ 的 CJS 语法矛盾、es/ 内部
// 又是目录导入，node 无法直接加载（vite dev/build 走 bundler 解析不受影响）。
// 出口契约只关心 BasicTable 从主入口导出，其内部依赖在此 stub。
vi.mock("@ant-design/pro-components", () => ({ ProTable: () => null }));

/**
 * P3.1 冻结出口白名单（设计文档 §4.3 / D3）。
 *
 * 本文件即冻结契约：出口面 = 改造前 modules/ + apps/playground 对
 * `#src/*` 的全量实际用量（components/basic-*、api、hooks、store、icons、
 * utils/tree、constants/options、路由与模块类型）。包名化（P3.2）之后，
 * 模块工程只能从本入口取用框架能力，超出此面的 import 一律不允许。
 *
 * 运行时符号在下方逐项断言；类型出口无法在运行时观察，
 * 由文件顶部的 `import type` 交由 `tsc --noEmit` 全量校验，
 * 并在文件尾用类型联合引用防止意外删减。
 */
describe("runtime 主入口出口白名单 (P3.1)", () => {
	it("模块契约 / 路由装配 / 应用元信息", () => {
		expect(Runtime.defineModule).toBeTypeOf("function");
		expect(Runtime.getModule).toBeTypeOf("function");
		expect(Runtime.getModules).toBeTypeOf("function");
		expect(Runtime.getRegisteredApiPrefix).toBeTypeOf("function");
		expect(Runtime.getRegisteredStore).toBeTypeOf("function");
		expect(Runtime.getRoutes).toBeTypeOf("function");
		expect(Runtime.loadAll).toBeTypeOf("function");
		// P7.12：手册 §7.3 承诺的卸载与插槽订阅出口
		expect(Runtime.unloadModule).toBeTypeOf("function");
		expect(Runtime.useSlotNodes).toBeTypeOf("function");
		expect(Runtime.getAppInfo).toBeTypeOf("function");
		// AC-D15：zod re-export（契约 schema 书写入口；zod 随 runtime dist 走，不进 importmap）
		expect(Runtime.z).toBeTypeOf("object");
		expect(Runtime.z.object).toBeTypeOf("function");
	});

	it("组件：basic-* / iframe / access-control / 表单项", () => {
		for (const key of [
			"BasicContent",
			"BasicButton",
			"BasicTable",
			"Iframe",
			"AccessControl",
			"FormAvatarItem",
			"FormTreeItem",
			// AntdApp：宿主链必须用它（--oo-* 变量同步 + StaticAntd），
			// 误用 antd 原生 App 则暗黑模式 footer 露白（设计 202609112121）
			"AntdApp",
		] as const) {
			expect(Runtime[key], key).toBeDefined();
		}
	});

	it("api：user / system-role / system-menu（api/home 已模块化为 modules/home 自有 client）", () => {
		for (const key of [
			"fetchLogin",
			"fetchLogout",
			"fetchUserInfo",
			"fetchRoleList",
			"fetchAddRoleItem",
			"fetchUpdateRoleItem",
			"fetchDeleteRoleItem",
			"fetchRoleMenu",
			"fetchMenuByRoleId",
			"fetchMenuList",
			"fetchAddMenuItem",
			"fetchUpdateMenuItem",
			"fetchDeleteMenuItem",
		] as const) {
			expect(Runtime[key], key).toBeTypeOf("function");
		}
	});

	it("hooks 与权限常量", () => {
		expect(Runtime.useAccess).toBeTypeOf("function");
		expect(Runtime.usePreferences).toBeTypeOf("function");
		expect(Runtime.accessControlCodes).toBeDefined();
		expect(Runtime.AccessControlRoles).toBeDefined();
	});

	it("i18n：宿主链路初始化（e2e 偏差 2 修复——shell 曾以空 resources 自行 init，框架 translation 命名空间丢失）", () => {
		expect(Runtime.setupI18n).toBeTypeOf("function");
	});

	it("store：user / auth", () => {
		expect(Runtime.useUserStore).toBeTypeOf("function");
		expect(Runtime.useAuthStore).toBeTypeOf("function");
	});

	it("图标：本地图标 + Ri 常用图标（构建期内联，声明零泄漏）", () => {
		for (const key of [
			"ProfileCardIcon",
			"ServerErrorIcon",
			"EmbeddedIcon",
			"RiAccountCircleLine",
			"RiReactjsLine",
			"RiUserSettingsLine",
		] as const) {
			expect(Runtime[key], key).toBeDefined();
		}
		expect(Runtime.menuIcons).toBeDefined();
	});

	it("工具与常量：tree / expanded-keys / options", () => {
		expect(Runtime.handleTree).toBeTypeOf("function");
		expect(Runtime.traverseTreeValues).toBeTypeOf("function");
		expect(Runtime.getAllExpandedKeys).toBeTypeOf("function");
		expect(Runtime.getYesNoOptions).toBeTypeOf("function");
		expect(Runtime.getBooleanOptions).toBeTypeOf("function");
	});

	it("redirect 解析出口（P3，login 模块化）", () => {
		expect(Runtime.getRedirectPath).toBeTypeOf("function");
	});

	it("cli 的 runtime stub 覆盖全部运行时出口（防漂移，P3.4）", () => {
		const stubSource = fs.readFileSync(
			path.join(PROJECT_ROOT, "packages/cli/src/build.ts"),
			"utf-8",
		);
		const stubBlock = stubSource.match(/RUNTIME_STUB_SOURCE = `([^`]+)`/)?.[1] ?? "";
		const stubExports = new Set([...stubBlock.matchAll(/export const (\w+)/g)].map(m => m[1]));
		const runtimeExports = Object.keys(Runtime).filter(k => (Runtime as Record<string, unknown>)[k] !== undefined);
		const missing = runtimeExports.filter(key => !stubExports.has(key));
		expect(missing, `出口符号未同步进 cli RUNTIME_STUB_SOURCE：${missing.join(", ")}`).toEqual([]);
	});
});

/**
 * 类型出口面：tsc --noEmit 校验以下类型均可从主入口获取。
 */
export type RuntimeTypeSurface = AppInfo | AppRouteRecordRaw | AuthProvider | BasicTableProps<any, any, any> | LoginInfo | Manifest | ManifestModuleEntry | MenuItemType | ModuleConfig | ModuleContext | ModuleDefinition | ModuleI18n | ModuleInstance | ModuleLifecycle | RoleItemType | RouteMeta | TreeDataNodeWithId;
