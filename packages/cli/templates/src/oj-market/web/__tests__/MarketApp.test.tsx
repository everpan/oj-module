import type { IndexPage, IndexRow } from "../types";
import { useUserStore } from "@oj-module/runtime";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import MarketApp from "../pages/MarketApp";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

const row: IndexRow = { name: "alpha", latest: "1.2.0", installed: null, enabled: null, upgradable: false };

const indexPage: IndexPage = { list: [row], total: 1, page: 1, size: 20 };

describe("marketApp · 安装完成刷新提示（fix A 菜单断路：新方案菜单需整页刷新才出现）", () => {
	beforeEach(() => {
		// 市场写操作要求 superadmin；测试态默认角色为空 → 装/升/回滚按钮禁用，
		// 点击不触发，刷新提示链走不到。此处注入角色使按钮可用。
		useUserStore.setState({ roles: ["superadmin"] });
	});

	it("given 点击安装并成功终态 When 完成 Then 弹出刷新提示且文案明确点出「菜单」", async () => {
		const done = {
			id: "t1",
			name: "alpha",
			version: "1.2.0",
			status: "done" as const,
			stage: "done" as const,
			progress: 100,
			message: "ok",
			stages: [],
			startedAt: 0,
		};
		// 卡片触发安装 → 安装弹窗轮询拿到 done → onDone 弹出刷新提示
		const client = new InMemoryMarketClient({ indexPage, taskRecord: done, installResult: { task_id: "t1" } });
		renderWithProviders(<MarketApp />, client);

		// 卡片上的「安装」按钮（未装方案显示「安装」）
		const installBtn = await screen.findByText("安装");
		fireEvent.click(installBtn);

		// 刷新提示弹窗出现（data-testid=refresh-prompt），文案点出菜单
		const prompt = await screen.findByTestId("refresh-prompt", undefined, { timeout: 5000 });
		expect(prompt.textContent).toContain("菜单");
		// 「刷新页面」按钮可点击（窗口.location.reload 由真实浏览器接管，测试只断言存在）
		expect(screen.getByText("刷新页面")).toBeTruthy();
	});
});
