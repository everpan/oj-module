import type { AppRouteRecordRaw } from "#src/router/types";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { addRouteIdByPath } from "#src/router/utils/add-route-id-by-path";
import { generateMenuItemsFromRoutes } from "#src/router/utils/generate-menu-items-from-routes";
import { PLAYGROUND_DIR } from "../helpers/paths";

/**
 * 菜单 key 必须是可导航的绝对路径（契约）。
 *
 * 背景（202609010056 playground 全量模块暴露）：react-router 允许子路由使用
 * 相对 path（如 "detail"），但菜单生成器曾把 item.path 原样作为 antd Menu 的
 * key，点击时 navigate("detail") 被相对解析到当前路由下（如 /system/dept
 * → /system/detail），落 404。demo 模块单独运行时恰好从 /demo 出发相对解析
 * 正确，多模块共存后必炸——菜单 key 契约应为「绝对路径」。
 */
describe("菜单生成器：相对 path 解析为绝对路径", () => {
	it("子路由相对 path 拼接父路径", () => {
		const routes = [
			{
				path: "/demo",
				handle: { title: "demo" },
				children: [
					{ path: "detail", handle: { title: "demo:menu.detail" } },
					{ path: "about", handle: { title: "demo:menu.about" } },
				],
			},
		] as AppRouteRecordRaw[];

		const [group] = generateMenuItemsFromRoutes(routes);
		expect(group.children?.map(c => c.key)).toEqual(["/demo/detail", "/demo/about"]);
	});

	it("绝对 path 保持不变", () => {
		const routes = [
			{
				path: "/system",
				handle: { title: "system" },
				children: [
					{ path: "/system/user", handle: { title: "system:menu.user" } },
				],
			},
		] as AppRouteRecordRaw[];

		const [group] = generateMenuItemsFromRoutes(routes);
		expect(group.children?.[0]?.key).toBe("/system/user");
	});

	it("嵌套相对 path 逐级拼接", () => {
		const routes = [
			{
				path: "/a",
				handle: { title: "a" },
				children: [
					{
						path: "b",
						handle: { title: "b" },
						children: [
							{ path: "c", handle: { title: "c" } },
						],
					},
				],
			},
		] as AppRouteRecordRaw[];

		const [group] = generateMenuItemsFromRoutes(routes);
		const nested = group.children?.[0];
		expect(nested?.key).toBe("/a/b");
		expect(nested?.children?.[0]?.key).toBe("/a/b/c");
	});

	it("仓库 demo 模块的相对子路由生成绝对 key（防回归）", async () => {
		// 直接读 playground demo entry 源码校验其相对 path 声明仍在，
		// 生成器必须对其产出可导航 key
		const { readFileSync } = await import("node:fs");
		const source = readFileSync(path.join(PLAYGROUND_DIR, "web/src/demo/entry.ts"), "utf-8");
		expect(source).toContain("path: \"detail\"");

		const routes = [
			{
				path: "/demo",
				handle: { title: "demo" },
				children: [
					{ path: "detail", handle: { title: "demo:menu.detail" } },
				],
			},
		] as AppRouteRecordRaw[];
		const [group] = generateMenuItemsFromRoutes(routes);
		expect(group.children?.[0]?.key).toBe("/demo/detail");
	});
});

/**
 * 路由 id 契约：id 必须与菜单 key 同一空间（绝对路径）。
 *
 * 背景：菜单选中态/手风琴展开态（useMatches 的 match.id）与菜单项 key
 * （item.path）必须可互相匹配；相对 path 若不拼接父路径，id="detail" 与
 * 菜单 key="/demo/detail" 永不相等——高亮丢失、手风琴把当前组收起
 * （202609010056 playground 全量模块暴露，demo-only 时代两空间同为相对
 * key 恰好对齐，多模块后暴露）。
 */
describe("addRouteIdByPath：相对 path 的 id 拼接父路径", () => {
	it("子路由相对 path 的 id 为绝对路径", () => {
		const routes = [
			{
				path: "/demo",
				children: [
					{ index: true, Component: () => null },
					{ path: "detail", Component: () => null },
				],
			},
		] as any;

		const [parent] = addRouteIdByPath(routes);
		expect((parent as any).id).toBe("/demo");
		expect((parent.children?.[0] as any).id).toBe("/demo/");
		expect((parent.children?.[1] as any).id).toBe("/demo/detail");
	});

	it("绝对 path 的 id 保持不变（既有行为）", () => {
		const routes = [
			{
				path: "/system",
				children: [
					{ path: "/system/user", Component: () => null },
				],
			},
		] as any;

		const [parent] = addRouteIdByPath(routes);
		expect((parent as any).id).toBe("/system");
		expect((parent.children?.[0] as any).id).toBe("/system/user");
	});
});
