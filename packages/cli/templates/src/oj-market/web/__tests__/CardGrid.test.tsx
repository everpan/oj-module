import type { IndexRow } from "../types";
import { fireEvent, screen } from "@testing-library/react";
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

	it("given 索引带 summary/description When 渲染 Then 卡片显示简介与描述（描述全文进 title 供查看）", () => {
		const description = "详细描述：提供示例 CRUD、菜单路由与安装/升级/回滚全链路。";
		renderWithProviders(
			<CardGrid rows={[{ ...installed, summary: "一句话说清方案做什么", description }]} {...handlers} />,
			new InMemoryMarketClient(),
		);
		expect(screen.getByTestId("card-summary-alpha").textContent).toContain("一句话说清方案做什么");
		const desc = screen.getByTestId("card-description-alpha");
		expect(desc.textContent).toContain(description);
		expect(desc.getAttribute("title")).toBe(description);
	});

	it("given 索引未声明 summary/description When 渲染 Then 卡片不出现简介/描述块（不显示占位符）", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		expect(screen.queryByTestId("card-summary-alpha")).toBeNull();
		expect(screen.queryByTestId("card-description-alpha")).toBeNull();
	});

	it("given 索引带 publisher_key When 渲染 Then 卡片显示发布者（签出的 key_id，全文进 title）", () => {
		renderWithProviders(
			<CardGrid rows={[{ ...installed, publisher_key: "demo-solution.wecom-everpan" }]} {...handlers} />,
			new InMemoryMarketClient(),
		);
		const pub = screen.getByTestId("card-publisher-alpha");
		expect(pub.textContent).toContain("demo-solution.wecom-everpan");
		expect(pub.getAttribute("title")).toBe("demo-solution.wecom-everpan");
	});

	it("given 索引未声明 publisher_key When 渲染 Then 卡片不出现发布者行（不显示占位符）", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		expect(screen.queryByTestId("card-publisher-alpha")).toBeNull();
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

	it("given canManage=false（非 superadmin）When 渲染 Then 安装/启停/回滚/卸载按钮禁用、历史与正文详情保持可用", () => {
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
		// 只读操作不受影响：历史按钮可用，详情由点击卡片正文触发
		expect(btn("历史").disabled).toBe(false);
		expect(screen.getByTestId("card-body-alpha")).toBeTruthy();
		// 禁用时不应触发写回调
		btn("卸载").click();
		expect(handlers.onUninstall).not.toHaveBeenCalled();
	});

	it("given oj-market 已装 When 渲染 Then 卸载按钮永久禁用且提示禁止卸载", () => {
		handlers.onUninstall.mockClear();
		const ojMarket = { ...installed, name: "oj-market" };
		renderWithProviders(<CardGrid rows={[ojMarket]} {...handlers} />, new InMemoryMarketClient());
		const btn = screen.getByTestId("card-uninstall-oj-market") as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute("title")).toContain("禁止卸载");
		btn.click();
		expect(handlers.onUninstall).not.toHaveBeenCalled();
	});

	it("given oj-market 已启用 When 渲染 Then 停用按钮永久禁用且提示禁止停用", () => {
		const ojMarket = { ...installed, name: "oj-market" };
		renderWithProviders(<CardGrid rows={[ojMarket]} {...handlers} />, new InMemoryMarketClient());
		const btn = screen.getByRole("button", { name: "停用" }) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute("title")).toContain("禁止停用");
	});

	it("given 普通方案已启用 When 点击停用 Then 先二次确认，确认后才触发 onEnableToggle", async () => {
		handlers.onEnableToggle.mockClear();
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		fireEvent.click(screen.getByRole("button", { name: "停用" }));
		// 未确认前不得直接停用
		expect(handlers.onEnableToggle).not.toHaveBeenCalled();
		fireEvent.click(await screen.findByText("确认停用"));
		expect(handlers.onEnableToggle).toHaveBeenCalledWith(installed);
	});

	it("given 空列表 When 渲染 Then 显示空态", () => {
		renderWithProviders(<CardGrid rows={[]} {...handlers} />, new InMemoryMarketClient());
		expect(screen.getByTestId("card-grid-empty")).toBeTruthy();
	});

	it("given 已装且无可升级发布版（upgradable=false）When 渲染 Then 升级按钮禁用并提示已是最新", () => {
		renderWithProviders(<CardGrid rows={[disabledRow]} {...handlers} />, new InMemoryMarketClient());
		const btn = screen.getByRole("button", { name: "升级" }) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute("title")).toContain("最新");
	});

	it("given 已装且存在更高发布版（upgradable=true）When 渲染 Then 升级按钮可用", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		const btn = screen.getByRole("button", { name: "升级" }) as HTMLButtonElement;
		expect(btn.disabled).toBe(false);
	});

	it("given 任意卡片 When 渲染 Then 动作区不换行、按钮不收缩、无横向滚动条（钉死需求）", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		const actions = screen.getByTestId("card-actions-alpha") as HTMLDivElement;
		expect(actions.style.flexWrap).toBe("nowrap");
		// 不应出现滚动条：overflowX 既不能是 auto 也不能是 scroll
		expect(["auto", "scroll"]).not.toContain(actions.style.overflowX);
		const btn = screen.getByRole("button", { name: "升级" }) as HTMLButtonElement;
		expect(btn.style.flexShrink).toBe("0");
	});

	it("given 网格 When 渲染 Then 最小列宽恢复 340px（详情按钮移除后 5 按钮一行免滚动）", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		const grid = screen.getByTestId("card-grid") as HTMLDivElement;
		expect(grid.style.gridTemplateColumns).toContain("minmax(340px");
	});

	it("given 点击卡片正文 When 渲染 Then 触发 onDetails（详情入口）", () => {
		handlers.onDetails.mockClear();
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		screen.getByTestId("card-body-alpha").click();
		expect(handlers.onDetails).toHaveBeenCalledWith(installed);
	});

	it("given 动作区 When 渲染 Then 不再有「详情」按钮（详情改由正文点击）", () => {
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		expect(screen.queryByRole("button", { name: "详情" })).toBeNull();
	});

	it("given 点击动作区按钮 When 渲染 Then 不误触发详情（动作区是正文兄弟节点）", () => {
		handlers.onDetails.mockClear();
		renderWithProviders(<CardGrid rows={[installed]} {...handlers} />, new InMemoryMarketClient());
		screen.getByRole("button", { name: "历史" }).click();
		expect(handlers.onDetails).not.toHaveBeenCalled();
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
