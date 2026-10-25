import type { IndexRow } from "../types";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardGrid } from "../components/CardGrid";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

const installed: IndexRow = {
	name: "alpha",
	latest: "1.2.0",
	installed: "1.1.0",
	enabled: true,
	upgradable: true,
};
const notInstalled: IndexRow = {
	name: "beta",
	latest: "0.9.0",
	installed: null,
	enabled: null,
	upgradable: false,
};
const disabledRow: IndexRow = {
	name: "gamma",
	latest: "2.0.0",
	installed: "2.0.0",
	enabled: false,
	upgradable: false,
};

describe("cardGrid 卡片网格（BDD）", () => {
	const handlers = {
		onInstall: vi.fn(),
		onEnableToggle: vi.fn(),
		onDetails: vi.fn(),
		onHistory: vi.fn(),
		onUninstall: vi.fn(),
		onRollback: vi.fn(),
		onRetry: vi.fn(),
	};

	it("given 已装可升级+已停用的卡片 When 渲染 Then 显示 upgradable/enabled/disabled 标识与动作按钮", () => {
		renderWithProviders(
			<CardGrid rows={[installed, disabledRow]} {...handlers} />,
			new InMemoryMarketClient(),
		);
		expect(screen.getByTestId("card-alpha")).toBeTruthy();
		expect(screen.getByText("可升级")).toBeTruthy();
		expect(screen.getByText("已启用")).toBeTruthy();
		expect(screen.getByTestId("card-gamma")).toBeTruthy();
		expect(screen.getByText("已停用")).toBeTruthy();
		// 已装方案应有 启用/停用 + 卸载 按钮
		expect(screen.getAllByText("卸载").length).toBeGreaterThan(0);
	});

	it("given 已装可升级卡片 When 渲染 Then 双版本展示「已装 → 最新」且有回滚按钮", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		const versions = screen.getByTestId("card-versions-alpha");
		expect(versions.textContent).toContain("1.1.0");
		expect(versions.textContent).toContain("1.2.0");
		expect(screen.getByTestId("card-rollback-alpha")).toBeTruthy();
	});

	it("given 索引带 license When 渲染 Then 卡片显示该项（P-2）", () => {
		renderWithProviders(
			<CardGrid rows={[{ ...installed, license: "MIT" }]} {...handlers} />,
			new InMemoryMarketClient(),
		);
		expect(screen.getByTestId("card-license-alpha").textContent).toContain("MIT");
	});

	it("given 索引未声明 license When 渲染 Then 卡片不出现许可行（不显示占位符）", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		expect(screen.queryByTestId("card-license-alpha")).toBeNull();
	});

	it("given 未安装卡片 When 渲染 Then 安装按钮显示「安装」而非「升级」，且无回滚按钮", () => {
		renderWithProviders(<CardGrid rows={[notInstalled]} {...handlers} />, new InMemoryMarketClient());
		expect(screen.getByText("安装")).toBeTruthy();
		expect(screen.queryByText("升级")).toBeNull();
		expect(screen.queryByTestId("card-rollback-beta")).toBeNull();
	});

	it("given 点击回滚 When 渲染 Then 回调 onRollback 携带该行", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		screen.getByTestId("card-rollback-alpha").click();
		expect(handlers.onRollback).toHaveBeenCalledWith(installed);
	});

	it("given canManage=false（非 superadmin）When 渲染 Then 安装/启停/回滚/卸载按钮禁用、详情/历史保持可用", () => {
		renderWithProviders(
			<CardGrid rows={[installed]} canManage={false} {...handlers} />,
			new InMemoryMarketClient(),
		);
		const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
		// 写操作禁用
		expect(btn("升级").disabled).toBe(true);
		expect(btn("停用").disabled).toBe(true);
		expect(btn("卸载").disabled).toBe(true);
		expect((screen.getByTestId("card-rollback-alpha") as HTMLButtonElement).disabled).toBe(true);
		// 只读操作不受影响
		expect(btn("详情").disabled).toBe(false);
		expect(btn("历史").disabled).toBe(false);
		// 禁用时不应触发写回调
		btn("卸载").click();
		expect(handlers.onUninstall).not.toHaveBeenCalled();
	});

	it("given 空列表 When 渲染 Then 显示空态", () => {
		renderWithProviders(<CardGrid rows={[]} {...handlers} />, new InMemoryMarketClient());
		expect(screen.getByTestId("card-grid-empty")).toBeTruthy();
	});

	it("given loading=true When 渲染 Then 显示加载态", () => {
		renderWithProviders(<CardGrid rows={[]} loading {...handlers} />, new InMemoryMarketClient());
		expect(screen.getByTestId("card-grid-loading")).toBeTruthy();
	});

	it("given error When 渲染 Then 显示错误态并可重试", () => {
		renderWithProviders(<CardGrid rows={[]} error="boom" {...handlers} />, new InMemoryMarketClient());
		const retry = screen.getByTestId("card-grid-retry");
		expect(retry).toBeTruthy();
		retry.click();
		expect(handlers.onRetry).toHaveBeenCalled();
	});
});
