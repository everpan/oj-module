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

	it("given 带 publisher_key When 打开 Then 详情展示发布者（签出的 key_id，长串可折行）", () => {
		renderWithProviders(
			<DetailDrawer row={{ ...row, publisher_key: "demo-solution.wecom-everpan.macbook" }} open canManage {...handlers} />,
			new InMemoryMarketClient(),
		);
		expect(screen.getByText("发布者")).toBeTruthy();
		const pub = screen.getByTestId("detail-publisher");
		expect(pub.textContent).toBe("demo-solution.wecom-everpan.macbook");
		expect(pub.style.wordBreak).toBe("break-all");
	});

	it("given 打开详情 When 渲染 Then 标签列宽可容纳三个汉字且不折行", () => {
		renderWithProviders(
			<DetailDrawer row={row} open canManage {...handlers} />,
			new InMemoryMarketClient(),
		);
		// bordered Descriptions 是 table-layout:auto：不给宽度时中文标签会被长值列压到 2 字宽。
		// Drawer 走 portal 挂到 body，必须从 document 查。
		const label = document.querySelector("th.ant-descriptions-item-label") as HTMLElement | null;
		expect(label).toBeTruthy();
		expect(label!.style.width).toBe("96px");
		expect(label!.style.whiteSpace).toBe("nowrap");
	});

	it("given 未声明 publisher_key When 打开 Then 不出现发布者行（不显示占位符）", () => {
		renderWithProviders(
			<DetailDrawer row={{ ...row, publisher_key: undefined }} open canManage {...handlers} />,
			new InMemoryMarketClient(),
		);
		expect(screen.queryByTestId("detail-publisher")).toBeNull();
		expect(screen.queryByText("发布者")).toBeNull();
	});
});
