import type { IndexRow, MarketHistory } from "../types";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

const row: IndexRow = { name: "alpha", latest: "1.2.0", installed: "1.2.0", enabled: true, upgradable: false };
const rows: MarketHistory[] = [
	{ id: 1, solution: "alpha", version: "1.2.0", action: "install", status: "done", operator: "u1", message: null, created_at: 1700000000 },
	{ id: 2, solution: "beta", version: "0.9.0", action: "uninstall", status: "failed", operator: "u2", message: "locked", created_at: 1700000100 },
];

describe("historyDrawer 操作历史（BDD）", () => {
	it("given 历史记录 When 打开 Then 按当前方案过滤并展示", async () => {
		const client = new InMemoryMarketClient({ historyRows: rows });
		renderWithProviders(<HistoryDrawer row={row} open onClose={() => {}} />, client);
		await screen.findByTestId("history-table");
		expect(screen.getByText("1.2.0")).toBeTruthy();
		expect(screen.queryByText("0.9.0")).toBeNull();
	});

	it("given 空历史 When 打开 Then 显示空提示", async () => {
		const client = new InMemoryMarketClient({ historyRows: [] });
		renderWithProviders(<HistoryDrawer row={row} open onClose={() => {}} />, client);
		await screen.findByText("暂无操作记录");
	});
});
