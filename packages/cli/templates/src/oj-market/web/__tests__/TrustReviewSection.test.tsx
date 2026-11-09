// BDD：发布管理「信任审核」区（2026-11-10 round 2：审核入口可主动发现）。
// 未知发布方首装停 needs_trust 后，待审指纹以列表形态出现在 superadmin 的发布管理页，
// 无需为审批再去触发一次安装。
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrustReviewSection } from "../publish/pages/trust-review";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

function forbidden(): Error {
	return Object.assign(new Error("forbidden"), { response: { status: 403 } });
}

const ITEM = {
	task_id: "t1",
	name: "crm",
	version: "1.0.0",
	key_id: "crm.author",
	fingerprint: "ab".repeat(32),
	started_at: 1000,
};

describe("发布管理「信任审核」区", () => {
	it("超管视角：列出待审项（方案/版本/发布方 key/指纹），点确认调 trust(task_id) 并刷新列表", async () => {
		const client = new InMemoryMarketClient({ trustReviewRows: [ITEM] });
		renderWithProviders(<TrustReviewSection />, client);
		await screen.findByText("crm.author");
		expect(screen.getByText("ab".repeat(32))).toBeTruthy();
		expect(screen.getByText("crm@1.0.0")).toBeTruthy();
		fireEvent.click(screen.getByText("确认信任"));
		await waitFor(() => expect(client.calls).toContain("trust:t1"));
		// 确认后刷新列表（初始一次 + 失效后一次）
		await waitFor(() => expect(client.calls.filter(c => c === "trustReview").length).toBe(2));
	});

	it("非超管（GET 403）：整个区不渲染——可见范围由服务端决定，前端不重复判权", async () => {
		const client = new InMemoryMarketClient({ trustReviewError: forbidden() });
		renderWithProviders(<TrustReviewSection />, client);
		await waitFor(() => expect(client.calls).toContain("trustReview"));
		expect(screen.queryByText("crm.author")).toBeNull();
	});
});
