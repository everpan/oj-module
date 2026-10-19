import type { IndexRow, MarketHistory } from "../types";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RollbackDialog } from "../components/RollbackDialog";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";
import "@testing-library/jest-dom/vitest";

const row: IndexRow = { name: "alpha", latest: "1.2.0", installed: "1.2.0", enabled: true, upgradable: false };

const history: MarketHistory[] = [
	{ id: 3, solution: "alpha", version: "1.2.0", action: "upgrade", status: "done", operator: "admin", message: null, created_at: 3 },
	{ id: 2, solution: "alpha", version: "1.1.0", action: "install", status: "done", operator: "admin", message: null, created_at: 2 },
	{ id: 1, solution: "alpha", version: "1.0.0", action: "install", status: "done", operator: "admin", message: null, created_at: 1 },
];

describe("rollbackDialog 回滚版本选择（BDD）", () => {
	it("given 已装 1.2.0 且有更早历史版本 When 打开 Then 列出候选旧版（不含已装）并默认选较新旧版，确认回滚之", async () => {
		const onRollback = vi.fn();
		renderWithProviders(
			<RollbackDialog row={row} open onClose={() => {}} onRollback={onRollback} />,
			new InMemoryMarketClient({ historyRows: history }),
		);
		await waitFor(() => expect(screen.getByTestId("rollback-versions")).toBeTruthy(), { timeout: 5000 });
		const group = screen.getByTestId("rollback-versions");
		// 候选 = < 已装：1.1.0 与 1.0.0；已装 1.2.0 不在候选
		expect(group.textContent).toContain("1.1.0");
		expect(group.textContent).toContain("1.0.0");
		// 默认选中较新的旧版 1.1.0 → 确认回滚携带该版本
		screen.getByRole("button", { name: "确认回滚" }).click();
		expect(onRollback).toHaveBeenCalledWith(row, "1.1.0");
	});

	it("given 无更早历史版本 When 打开 Then 显示无候选提示且确认禁用", async () => {
		const onRollback = vi.fn();
		renderWithProviders(
			<RollbackDialog row={row} open onClose={() => {}} onRollback={onRollback} />,
			new InMemoryMarketClient({ historyRows: history.slice(0, 1) }), // 仅 1.2.0（已装）
		);
		await waitFor(() => expect(screen.getByTestId("rollback-empty")).toBeTruthy(), { timeout: 5000 });
		expect(screen.getByRole("button", { name: "确认回滚" })).toBeDisabled();
		expect(onRollback).not.toHaveBeenCalled();
	});
});
