import type { AppRouteRecordRaw } from "#src/router/types";

import { describe, expect, it } from "vitest";

import { applyRoutePrefix, getModuleRoutePrefix } from "#src/module-loader";
import { rewriteAdminPaths } from "#src/router/utils/rewrite-admin-paths";

/**
 * R1.2 / R1.3：web.route_prefix 运行期消费。
 * - applyRoutePrefix：按生效前缀改写模块路由根（单根约定下仅首段/根段），children 相对不动；
 * - 与 rewriteAdminPaths 组合：admin 提升落到 /system/<prefix>/admin；
 * - 缺省 prefix = name → 与现有路由根逐字节一致（零漂移）；
 * - getModuleRoutePrefix：模块内深链/跳转单点消费口（未加载回落 name）。
 */

function r(path: string, meta: { module?: string, category?: "main" | "admin" | "hidden" }, children?: AppRouteRecordRaw[]): AppRouteRecordRaw {
	return children ? { path, handle: { title: path, ...meta }, children } : { path, handle: { title: path, ...meta } };
}

/** 模拟 wiki 单根结构：根 /wiki，children 含 space/admin(admin) */
function wikiRoutes(): AppRouteRecordRaw[] {
	return [
		r("wiki", { module: "wiki" }, [
			r("status", { module: "wiki", category: "hidden" }),
			r("space", { module: "wiki" }, [r(":id/members", { module: "wiki" })]),
			r("admin", { module: "wiki", category: "admin" }, [r("index", { module: "wiki" })]),
		]),
	];
}

describe("applyRoutePrefix", () => {
	it("p1 顶层首段改写为 prefix，children 相对不动", () => {
		const out = applyRoutePrefix(wikiRoutes(), "kb");
		const root = out[0]!;
		expect(root.path).toBe("kb"); // 保持相对风格
		expect(root.children?.map(c => c.path)).toEqual(["status", "space", "admin"]);
		// 相对子路由保持相对
		expect(root.children?.[1]?.children?.[0]?.path).toBe(":id/members");
	});

	it("p2 保持前导斜杠风格：绝对→/kb，相对→kb", () => {
		expect(applyRoutePrefix([r("/wiki")], "kb")[0]!.path).toBe("/kb");
		expect(applyRoutePrefix([r("wiki")], "kb")[0]!.path).toBe("kb");
	});

	it("p3 顶层多段路径：仅首段替换，其余段保留", () => {
		expect(applyRoutePrefix([r("wiki/extra")], "kb")[0]!.path).toBe("kb/extra");
	});

	it("p4 缺省 prefix = name 时逐字节零漂移", () => {
		const out = applyRoutePrefix(wikiRoutes(), "wiki");
		expect(out[0]!.path).toBe("wiki");
		expect(out).toEqual(wikiRoutes());
	});
});

describe("route_prefix 与 admin 提升组合", () => {
	it("c1 route_prefix=/kb → admin 提升落到 /system/kb/admin，原树摘除 admin", () => {
		const out = rewriteAdminPaths(applyRoutePrefix(wikiRoutes(), "kb"));
		const hoisted = out.find(rt => rt.path === "/system/kb/admin");
		expect(hoisted).toBeDefined();
		expect(hoisted?.handle?.category).toBe("admin");
		const root = out.find(rt => rt.path === "kb");
		expect(root?.children?.map(c => c.path)).toEqual(["status", "space"]); // admin 已摘除
	});

	it("c2 缺省 prefix → admin 提升仍落在 /system/wiki/admin（现状不变）", () => {
		const out = rewriteAdminPaths(applyRoutePrefix(wikiRoutes(), "wiki"));
		expect(out.find(rt => rt.path === "/system/wiki/admin")).toBeDefined();
	});
});

describe("getModuleRoutePrefix", () => {
	it("g1 未加载模块回落 name（与缺省语义一致，调用方据此懒取单点消费）", () => {
		expect(getModuleRoutePrefix("wiki")).toBe("wiki");
	});
});

/**
 * R1.3 单点消费范式（与 oj-wiki-solution paths.ts 同构）：
 * 模块内深链统一经 getModuleRoutePrefix 取根，勿硬编码。
 */
function createPaths(root: string) {
	const base = `/${root}`;
	return {
		base,
		space: (id: string | number) => `${base}/space/${id}`,
	};
}

describe("createPaths 单点消费范式", () => {
	it("s1 经 getModuleRoutePrefix 取根，缺省给出 /wiki/space/1", () => {
		const prefix = getModuleRoutePrefix("wiki"); // 未加载 → "wiki"
		const paths = createPaths(prefix);
		expect(paths.base).toBe("/wiki");
		expect(paths.space(1)).toBe("/wiki/space/1");
	});
});
