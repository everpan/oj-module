import type { IndexRow } from "../types";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetailDrawer } from "../components/DetailDrawer";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

const row: IndexRow = {
	name: "alpha",
	latest: "1.2.0",
	installed: "1.1.0",
	enabled: true,
	upgradable: true,
	summary: "一站式客户管理",
	description: "第一行：客户档案\n第二行：跟进记录与报表",
};

describe("detailDrawer 方案详情（BDD）", () => {
	const handlers = {
		onClose: vi.fn(),
		onInstall: vi.fn(),
		onHistory: vi.fn(),
		onRollback: vi.fn(),
	};

	it("given 带 summary/description When 打开 Then 展示完整简介与描述（描述保留换行，卡片限行的全文在此）", () => {
		renderWithProviders(
			<DetailDrawer row={row} open canManage {...handlers} />,
			new InMemoryMarketClient(),
		);
		expect(screen.getByText("简介")).toBeTruthy();
		expect(screen.getByText("详细介绍")).toBeTruthy();
		expect(screen.getByTestId("detail-summary").textContent).toBe(row.summary);
		const desc = screen.getByTestId("detail-description");
		expect(desc.textContent).toBe(row.description);
		expect(desc.style.whiteSpace).toBe("pre-wrap");
	});

	it("given 未声明 summary/description When 打开 Then 不出现这两行（不显示占位符）", () => {
		renderWithProviders(
			<DetailDrawer row={{ ...row, summary: undefined, description: undefined }} open canManage {...handlers} />,
			new InMemoryMarketClient(),
		);
		expect(screen.queryByTestId("detail-summary")).toBeNull();
		expect(screen.queryByTestId("detail-description")).toBeNull();
		expect(screen.queryByText("简介")).toBeNull();
		expect(screen.queryByText("详细介绍")).toBeNull();
	});
});
