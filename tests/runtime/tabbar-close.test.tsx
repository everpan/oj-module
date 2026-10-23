/**
 * tabbar 关闭回归——「幽灵 tab」。
 *
 * 背景：1e453baf（lint 清零）往「监听路由变化」effect 的依赖数组加了 activeKey，
 * 关闭激活 tab 后该 effect 用旧 location 把刚删的 tab re-add 回来（zustand sync
 * 更新抢占 react-router 的 startTransition 导航），表现为：被关 tab 仍在 tab 栏、
 * 实际激活了回退 tab。详见 docs/plans/20261023-1838-tab-close-ghost-tab.md。
 *
 * 本测试在组件层锁定：关闭激活 tab 后 openTabs 必须真实移除它。
 */

import type { ReactElement } from "react";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { ConfigProvider } from "antd";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JSSThemeProvider } from "#src/components/jss-theme-provider";
import LayoutTabbar from "#src/layout/layout-tabbar";
import { useAccessStore } from "#src/store/access";
import { useTabsStore } from "#src/store/tabs";

const HOME = "/home";
const PATHS = [HOME, "/a", "/b"];

function seedTabs(keys: string[], active: string) {
	const store = useTabsStore.getState();
	store.resetTabs();
	for (const k of keys) {
		store.addTab(k, { key: k, label: k, closable: k !== HOME, draggable: k !== HOME });
	}
	store.setActiveKey(active);
}

function renderTabbarAt(path: string): ReactElement {
	// useMatches 要求 data router（react-router v7），不能用组件路由的 MemoryRouter
	const router = createMemoryRouter(
		PATHS.map(p => ({ path: p, element: <LayoutTabbar />, handle: { title: `Title${p}` } })),
		{ initialEntries: [path] },
	);
	return (
		<ConfigProvider>
			<JSSThemeProvider>
				<RouterProvider router={router} />
			</JSSThemeProvider>
		</ConfigProvider>
	);
}

/** 取 tab 栏上所有可关闭按钮（antd editable-card 的 .ant-tabs-tab-remove） */
function removeButtons(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(".ant-tabs-tab-remove"));
}

describe("tabbar 关闭标签（幽灵 tab 回归）", () => {
	beforeEach(() => {
		sessionStorage.clear();
		useAccessStore.setState({
			flatRouteList: Object.fromEntries(PATHS.map(p => [p, { path: p, handle: { title: `Title${p}` } }])),
		} as any);
	});

	afterEach(() => {
		cleanup();
		useTabsStore.getState().resetTabs();
	});

	it("场景1：关闭激活 tab，tab 真实移除且激活回退 tab（本缺陷 RED）", async () => {
		seedTabs(PATHS, "/b");
		const { container } = render(renderTabbarAt("/b"));

		const buttons = removeButtons(container);
		expect(buttons, "home 不可关闭，只有 /a /b 两个关闭按钮").toHaveLength(2);
		fireEvent.click(buttons[1]); // 关闭 /b（激活）

		await waitFor(() => {
			expect(useTabsStore.getState().openTabs.has("/b"), "被关 tab 不得残留在 openTabs").toBe(false);
		});
		expect(useTabsStore.getState().activeKey).toBe("/a");
	});

	it("场景2：关闭非激活 tab，仅移除目标，激活不变", async () => {
		seedTabs(PATHS, "/b");
		const { container } = render(renderTabbarAt("/b"));

		fireEvent.click(removeButtons(container)[0]); // 关闭 /a（非激活）

		await waitFor(() => {
			expect(useTabsStore.getState().openTabs.has("/a")).toBe(false);
		});
		expect(useTabsStore.getState().openTabs.has("/b")).toBe(true);
		expect(useTabsStore.getState().activeKey).toBe("/b");
	});

	it("场景3：home 无关闭按钮且 store 层拒绝关闭", async () => {
		seedTabs(PATHS, "/b");
		const { container } = render(renderTabbarAt("/b"));

		expect(removeButtons(container)).toHaveLength(2);
		await useTabsStore.getState().removeTab(HOME);
		expect(useTabsStore.getState().openTabs.has(HOME)).toBe(true);
	});
});
