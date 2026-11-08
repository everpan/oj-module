import type { IndexRow, MarketHistory } from "../types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

const row: IndexRow = { name: "alpha", latest: "1.2.0", installed: "1.2.0", enabled: true, upgradable: false };
const rows: MarketHistory[] = [
	{ id: 1, solution: "alpha", version: "1.2.0", action: "install", status: "done", operator: "u1", message: null, created_at: 1700000000 },
	{ id: 2, solution: "beta", version: "0.9.0", action: "uninstall", status: "failed", operator: "u2", message: "locked", created_at: 1700000100 },
];

/** 安装失败场景：当前生效 1.2.0（成功）+ 2.0.0 装失败（迁移报错） */
const failedRows: MarketHistory[] = [
	{ id: 4, solution: "alpha", version: "2.0.0", action: "install", status: "failed", operator: "u1", message: "安装失败（阶段 migrating）：迁移脚本 0003 执行失败：no such column: tenant_id；本次安装未生效（未落锁、未改库表与配置），可直接重试", created_at: 1700000300 },
	{ id: 3, solution: "alpha", version: "1.2.0", action: "install", status: "done", operator: "u1", message: "安装完成：alpha@1.2.0", created_at: 1700000200 },
	{ id: 2, solution: "alpha", version: "2.0.0", action: "install", status: "failed", operator: "u1", message: "安装失败（阶段 migrating）：上一次失败", created_at: 1700000100 },
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

	it("given 安装失败记录 When 打开 Then 结果标记区分成败并展示最后一次错误明细", async () => {
		const client = new InMemoryMarketClient({ historyRows: failedRows });
		renderWithProviders(<HistoryDrawer row={row} open onClose={() => {}} />, client);
		await screen.findByTestId("history-table");
		// 同版本多行都带结果 Tag：失败 / 成功（install 动作用 result.* 文案，不是 status.*）
		const tags = screen.getAllByTestId("history-result-2.0.0");
		expect(tags).toHaveLength(2);
		for (const t of tags)
			expect(t.textContent).toBe("安装失败");
		expect(screen.getByTestId("history-result-1.2.0").textContent).toBe("安装成功");
		// 错误明细列直接可读（不点开也能看见阶段与原因）
		expect(screen.getAllByTestId("history-message")[0]!.textContent).toContain("阶段 migrating");
	});

	it("given 失败版本 When 点击删除并确认 Then 调用 purgeHistory 并静默刷新历史", async () => {
		const client = new InMemoryMarketClient({ historyRows: failedRows });
		renderWithProviders(<HistoryDrawer row={row} open onClose={() => {}} />, client);
		await screen.findByTestId("history-table");
		// 只有「未成功且非当前生效」的版本才有删除入口（1.2.0 装成功 → 无按钮）
		expect(screen.queryByTestId("history-purge-1.2.0")).toBeNull();
		// 同版本两次失败只出一个按钮（挂在该版本最近一次尝试那行，避免重复入口）
		const btns = screen.getAllByTestId("history-purge-2.0.0");
		expect(btns).toHaveLength(1);
		await userEvent.click(btns[0]!);
		await userEvent.click(screen.getByRole("button", { name: "删除" }));
		await screen.findByTestId("history-table");
		expect(client.calls).toContain("purgeHistory:alpha@2.0.0");
		// 写后刷新：history 被再拉一次（第一次是打开抽屉）
		expect(client.calls.filter(c => c === "history")).toHaveLength(2);
	});

	it("given 服务端拒绝删除 When 确认 Then 展示人话错误且不刷新", async () => {
		const client = new InMemoryMarketClient({
			historyRows: failedRows,
			purgeResult: { ok: false, deleted: 0, removedDir: false, message: "「alpha@2.0.0」曾安装成功（含部分生效），不能按「未成功版本」删除；如需移除请用卸载或回滚" },
		});
		renderWithProviders(<HistoryDrawer row={row} open onClose={() => {}} />, client);
		await screen.findByTestId("history-table");
		await userEvent.click(screen.getAllByTestId("history-purge-2.0.0")[0]!);
		await userEvent.click(screen.getByRole("button", { name: "删除" }));
		const alert = await screen.findByTestId("history-purge-error");
		expect(alert.textContent).toContain("曾安装成功");
		expect(client.calls.filter(c => c === "history")).toHaveLength(1);
	});
});
