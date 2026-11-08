import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { useMenu } from "#src/layout/layout-menu/use-menu";
import { usePreferencesStore } from "#src/store/preferences";

/**
 * 移动端菜单是「整屏高度 + 遮罩」的 Drawer（open 复用 sidebarCollapsed）。
 * iPhone SE 375×667 实测：点菜单项会导航，但抽屉不收起，跳转后的页面仍被
 * 遮罩盖住。handleMenuSelect 必须在移动端选中叶子项后把抽屉关掉。
 *
 * 这里用 ahooks useResponsive 读的 window.innerWidth 切换设备形态，
 * 不依赖真实视口——同一份 hook 逻辑覆盖移动/桌面两条分支。
 */

function Probe({ menuKey }: { menuKey: string }) {
	const { handleMenuSelect } = useMenu();
	return (
		<button type="button" onClick={() => handleMenuSelect(menuKey, "inline")}>
			go
		</button>
	);
}

function renderProbe(menuKey: string, initialPath = "/") {
	const router = createMemoryRouter(
		[
			{ path: "/", element: <Probe menuKey={menuKey} /> },
			{ path: "/target", element: <div>target page</div> },
		],
		{ initialEntries: [initialPath] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

function setViewportWidth(width: number) {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		writable: true,
		value: width,
	});
}

afterEach(() => {
	cleanup();
	usePreferencesStore.setState({ sidebarCollapsed: false });
});

describe("移动端菜单选中后自动收起（iPhone SE 375×667）", () => {
	it("点叶子项：导航到目标页并收起抽屉", () => {
		setViewportWidth(375);
		usePreferencesStore.setState({ sidebarCollapsed: true });
		const router = renderProbe("/target");

		fireEvent.click(screen.getByRole("button", { name: "go" }));

		expect(router.state.location.pathname).toBe("/target");
		expect(usePreferencesStore.getState().sidebarCollapsed).toBe(false);
	});

	it("点当前页菜单项：不重复导航也要收起抽屉", () => {
		setViewportWidth(375);
		usePreferencesStore.setState({ sidebarCollapsed: true });
		const router = renderProbe("/", "/");

		fireEvent.click(screen.getByRole("button", { name: "go" }));

		expect(router.state.location.pathname).toBe("/");
		expect(usePreferencesStore.getState().sidebarCollapsed).toBe(false);
	});

	it("合成归组父键（solgroup:*）只展开不收起抽屉", () => {
		setViewportWidth(375);
		usePreferencesStore.setState({ sidebarCollapsed: true });
		const router = renderProbe("solgroup:admin:wiki");

		fireEvent.click(screen.getByRole("button", { name: "go" }));

		expect(router.state.location.pathname).toBe("/");
		expect(usePreferencesStore.getState().sidebarCollapsed).toBe(true);
	});

	it("桌面端不受影响：折叠态保持折叠", () => {
		setViewportWidth(1280);
		usePreferencesStore.setState({ sidebarCollapsed: true });
		const router = renderProbe("/target");

		fireEvent.click(screen.getByRole("button", { name: "go" }));

		expect(router.state.location.pathname).toBe("/target");
		expect(usePreferencesStore.getState().sidebarCollapsed).toBe(true);
	});
});
