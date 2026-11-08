import type { MarketHistory } from "../types";
import { describe, expect, it } from "vitest";
import { canPurgeHistory, installSucceeded, latestInstallByVersion, versionKey } from "../utils/history";

function h(over: Partial<MarketHistory> & { id: number, version: string }): MarketHistory {
	return {
		solution: "alpha",
		action: "install",
		status: "failed",
		operator: null,
		message: null,
		created_at: 1700000000,
		...over,
	};
}

describe("操作历史判定（2026-11-08：失败版本可标记可删除）", () => {
	it("installSucceeded：done / partial 算装上；failed / needs_trust / cancelled 不算", () => {
		expect(installSucceeded(h({ id: 1, version: "1.0.0", status: "done" }))).toBe(true);
		expect(installSucceeded(h({ id: 2, version: "1.0.0", status: "partial" }))).toBe(true);
		for (const status of ["failed", "needs_trust", "cancelled"])
			expect(installSucceeded(h({ id: 3, version: "1.0.0", status }))).toBe(false);
	});

	it("versionKey 带方案名：同名版本号跨方案不撞（alpha@1.0.0 ≠ beta@1.0.0）", () => {
		expect(versionKey({ solution: "alpha", version: "1.0.0" })).toBe("alpha@1.0.0");
		expect(versionKey({ solution: "beta", version: "1.0.0" })).not.toBe(versionKey({ solution: "alpha", version: "1.0.0" }));
	});

	it("latestInstallByVersion：时间倒序首见即最新；非 install 动作不参与", () => {
		const rows: MarketHistory[] = [
			h({ id: 5, version: "2.0.0", status: "failed" }),
			h({ id: 4, version: "2.0.0", status: "done" }),
			h({ id: 3, version: "1.0.0", status: "done" }),
			h({ id: 2, version: "1.0.0", status: "failed" }),
			h({ id: 1, version: "1.0.0", action: "enable", status: "success" }),
		];
		const latest = latestInstallByVersion(rows);
		expect(latest.get("alpha@2.0.0")?.id).toBe(5); // 最近一次是失败尝试
		expect(latest.get("alpha@1.0.0")?.id).toBe(3); // enable 行被忽略
	});

	it("canPurgeHistory：仅 install 且最近一次未成功、且不是当前生效版本", () => {
		const latest = latestInstallByVersion([
			h({ id: 3, version: "2.0.0", status: "failed" }),
			h({ id: 2, version: "1.5.0", status: "done" }),
			h({ id: 1, version: "1.0.0", status: "failed" }),
		]);
		// 失败且非生效 → 可删
		expect(canPurgeHistory(h({ id: 3, version: "2.0.0" }), latest, "1.5.0")).toBe(true);
		// 最近一次成功过 → 不可删（要移除请走卸载/回滚）
		expect(canPurgeHistory(latest.get("alpha@1.5.0")!, latest, "1.5.0")).toBe(false);
		// 当前生效版本 → 不可删（即便历史里有一条失败）
		expect(canPurgeHistory(h({ id: 1, version: "1.0.0" }), latest, "1.0.0")).toBe(false);
		// 非 install 动作 → 不可删
		expect(canPurgeHistory(h({ id: 9, version: "2.0.0", action: "disable", status: "success" }), latest, "1.5.0")).toBe(false);
		// 同版本多次失败：按钮只在「最近一次尝试」那行出现（避免同一删除动作重复渲染）
		const retriedTwice = latestInstallByVersion([
			h({ id: 8, version: "2.0.0", status: "failed" }),
			h({ id: 7, version: "2.0.0", status: "failed" }),
		]);
		expect(canPurgeHistory(h({ id: 8, version: "2.0.0", status: "failed" }), retriedTwice, "1.5.0")).toBe(true);
		expect(canPurgeHistory(h({ id: 7, version: "2.0.0", status: "failed" }), retriedTwice, "1.5.0")).toBe(false);
		// 失败后重试成功 → 最近一次成功，旧失败行也不再提供删除按钮
		const retried = latestInstallByVersion([
			h({ id: 6, version: "2.0.0", status: "done" }),
			h({ id: 5, version: "2.0.0", status: "failed" }),
		]);
		const older = h({ id: 5, version: "2.0.0", status: "failed" });
		expect(canPurgeHistory(older, retried, "1.5.0")).toBe(false);
	});
});
