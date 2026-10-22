import type { IndexRow, TaskRecord } from "../types";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { InstallDialog } from "../components/InstallDialog";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

const row: IndexRow = { name: "alpha", latest: "1.2.0", installed: null, enabled: null, upgradable: false };

describe("installDialog 安装进度（BDD）", () => {
	it("given 安装成功终态 When 打开 Then 轮询渲染 100% 成功", async () => {
		const done: TaskRecord = {
			id: "t1",
			name: "alpha",
			version: "1.2.0",
			status: "done",
			stage: "done",
			progress: 100,
			message: "ok",
			stages: [],
			startedAt: 0,
		};
		const client = new InMemoryMarketClient({ taskRecord: done, installResult: { task_id: "t1" } });
		renderWithProviders(<InstallDialog row={row} open onClose={() => {}} />, client);
		await waitFor(() => expect(screen.getByTestId("install-message").textContent).toBe("ok"), { timeout: 5000 });
		expect(client.calls.filter(c => c.startsWith("install:")).length).toBe(1);
		expect(client.calls.filter(c => c.startsWith("task:")).length).toBeGreaterThanOrEqual(1);
	});

	it("given 安装失败终态 When 打开 Then 渲染 reason + 不可重试标记", async () => {
		const failed: TaskRecord = {
			id: "t1",
			name: "alpha",
			version: "1.2.0",
			status: "failed",
			stage: "verifying",
			progress: 40,
			message: "verify failed",
			stages: [{ stage: "verifying", ok: false, message: "bad hash" }],
			error: { reason: "包校验失败", retryable: false, hintKey: "lifecycle.stage.verifying.hint" },
			startedAt: 0,
		};
		const client = new InMemoryMarketClient({ taskRecord: failed, installResult: { task_id: "t1" } });
		renderWithProviders(<InstallDialog row={row} open onClose={() => {}} />, client);
		await waitFor(() => expect(screen.getByText("包校验失败")).toBeTruthy(), { timeout: 5000 });
		expect(screen.getByText("不可重试")).toBeTruthy();
	});

	it("given 回滚（显式旧版 version）When 打开 Then 以该版本触发 install 且标题为「回滚中」", async () => {
		const done: TaskRecord = {
			id: "t1",
			name: "alpha",
			version: "1.1.0",
			status: "done",
			stage: "done",
			progress: 100,
			message: "ok",
			stages: [],
			startedAt: 0,
		};
		const client = new InMemoryMarketClient({ taskRecord: done, installResult: { task_id: "t1" } });
		const rollbackRow: IndexRow = { name: "alpha", latest: "1.2.0", installed: "1.2.0", enabled: true, upgradable: false };
		renderWithProviders(
			<InstallDialog row={rollbackRow} open onClose={() => {}} version="1.1.0" mode="rollback" />,
			client,
		);
		await waitFor(() => expect(screen.getByTestId("install-message").textContent).toBe("ok"), { timeout: 5000 });
		// 以显式旧版（而非 latest 1.2.0）触发安装
		expect(client.calls).toContain("install:alpha@1.1.0");
		expect(screen.getByText("回滚中")).toBeTruthy();
	});

	it("given needs_trust 终态 When 打开 Then 渲染指纹与确认按钮，点击后入库并重试安装", async () => {
		const pending: TaskRecord = {
			id: "t1",
			name: "alpha",
			version: "1.2.0",
			status: "needs_trust",
			stage: "verifying",
			progress: 18,
			message: "待信任确认",
			stages: [],
			trust: { key_id: "alpha.author", public_key: "ab".repeat(32), fingerprint: "6afc".repeat(16) },
			startedAt: 0,
		};
		const client = new InMemoryMarketClient({ taskRecord: pending, installResult: { task_id: "t1" } });
		renderWithProviders(<InstallDialog row={row} open onClose={() => {}} />, client);
		const button = await screen.findByText("指纹一致，信任并重试");
		expect(screen.getByTestId("install-trust-fingerprint").textContent).toContain("6afc".repeat(16));
		fireEvent.click(button);
		await waitFor(() => expect(client.calls).toContain("trust:t1"));
		// 确认入库后自动重试同一安装（staging 未清场，服务端续跑）
		await waitFor(() => expect(client.calls.filter(c => c.startsWith("install:")).length).toBe(2));
	});

	it("given 终态 When 父级每次渲染都换 onDone 身份 Then 只通告一次（防 onDone→重渲染→onDone 死循环）", async () => {
		const done: TaskRecord = {
			id: "t1",
			name: "alpha",
			version: "1.2.0",
			status: "done",
			stage: "done",
			progress: 100,
			message: "ok",
			stages: [],
			startedAt: 0,
		};
		const client = new InMemoryMarketClient({ taskRecord: done, installResult: { task_id: "t1" } });
		function Harness() {
			const [n, setN] = useState(0);
			return (
				<>
					<span data-testid="done-count">{n}</span>
					<InstallDialog row={row} open onClose={() => {}} onDone={() => setN(v => v + 1)} />
				</>
			);
		}
		renderWithProviders(<Harness />, client);
		await waitFor(() => expect(screen.getByTestId("install-message").textContent).toBe("ok"), { timeout: 5000 });
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(screen.getByTestId("done-count").textContent).toBe("1");
	});
});
