import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getRoutes, loadAll, unloadModule } from "#src/module-loader";
import { useAccessStore } from "#src/store/access";
import { useUserStore } from "#src/store/user";
import { PROJECT_ROOT, RUNTIME_DIR } from "../helpers/paths";

// U4：角色就绪后模块路由必须重新合并——硬刷新时守卫先以空角色注册一次
// （解耦注册块），userInfo 返回后 fetchUserInfoAndRoutes 必须**在角色已写入
// store 之后**再 getModuleRoutes() 合并，否则带 handle.roles / config.requiredRoles
// 的模块入口（如系统管理）对管理员不可见。0.2.68 之前缺第二次合并（下游反馈），
// feat/ojm 起由 auth-guard 的 userInfo→merge 顺序保证；本文件把该顺序与
// store 层行为钉成回归。
/* eslint-disable test/prefer-lowercase-title -- U4 是需求编号锚点，保留大写 */

vi.mock("@ant-design/pro-components", () => ({ ProTable: () => null }));

const AUTH_GUARD = path.join(RUNTIME_DIR, "router/guard/auth-guard.tsx");

describe("U4：角色就绪后模块路由重新合并（守卫时序）", () => {
	it("fetchUserInfoAndRoutes 内 getModuleRoutes() 必须晚于 userInfo 决议（源码顺序）", () => {
		const source = fs.readFileSync(AUTH_GUARD, "utf-8");
		const fnMatch = source.match(/async function fetchUserInfoAndRoutes\(\)[\s\S]*?\n\t\}/);
		expect(fnMatch, "auth-guard 应含 fetchUserInfoAndRoutes").not.toBeNull();
		const body = fnMatch![0];
		const awaitedIdx = body.indexOf("await Promise.allSettled(promises)");
		const mergeIdx = body.indexOf("getModuleRoutes()");
		expect(awaitedIdx, "userInfo/route 决议应先发生").toBeGreaterThanOrEqual(0);
		expect(mergeIdx, "登录分支应消费 getModuleRoutes()").toBeGreaterThanOrEqual(0);
		expect(mergeIdx, "模块路由合并必须晚于 userInfo 决议（否则角色未就绪即过滤）").toBeGreaterThan(awaitedIdx);
	});

	it("重复重建幂等：10 次相同合并不产生重复路由项", () => {
		useUserStore.setState({ roles: ["admin"] });
		let lastPaths: string[] = [];
		for (let i = 0; i < 10; i++) {
			useAccessStore.getState().setAccessStore(getRoutes());
			lastPaths = useAccessStore.getState().routeList.map(r => r.path).filter((p): p is string => Boolean(p));
		}
		expect(new Set(lastPaths).size).toBe(lastPaths.length);
	});
});

describe("U4：两阶段注册行为（空角色先行注册 → 角色就绪重建）", () => {
	beforeAll(async () => {
		const entry = `${PROJECT_ROOT}/tests/fixtures/required-roles-entry.tsx`;
		await unloadModule("rr-fixture");
		await loadAll({ modules: [{ name: "rr-fixture", entry: pathToFileURL(entry).href }] });
	});

	it("阶段1空角色：受角色控制的路由未注册；阶段2角色就绪：重建后可见", () => {
		// 阶段1——模拟守卫挂载时的解耦注册（userInfo 尚未返回，store 角色为空）
		useUserStore.setState({ roles: [] });
		useAccessStore.getState().setAccessStore(getRoutes());
		expect(useAccessStore.getState().routeList.map(r => r.path)).not.toContain("/rr-admin");

		// 阶段2——模拟 fetchUserInfoAndRoutes：userInfo 已把角色写入 store，
		// 此时 getRoutes() 必须能取到角色过滤后的完整模块路由并整体替换登记
		useUserStore.setState({ roles: ["admin"] });
		useAccessStore.getState().setAccessStore(getRoutes());
		const state = useAccessStore.getState();
		expect(state.routeList.map(r => r.path)).toContain("/rr-admin");
		expect(state.routeList.map(r => r.path)).toContain("/rr-open");
		// 重建是整体替换而非叠加——无重复菜单项
		const paths = state.routeList.map(r => r.path);
		expect(new Set(paths).size).toBe(paths.length);
	});
});
