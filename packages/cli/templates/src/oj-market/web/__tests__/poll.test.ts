import { describe, expect, it } from "vitest";
import { poll } from "../utils/poll";

describe("poll 轮询工具（BDD）", () => {
	it("given 首次非终态 When 轮询 Then 在终态返回且不抛错", async () => {
		let n = 0;
		const result = await poll(
			async () => ++n,
			v => v >= 3,
			{ intervalMs: 1, timeoutMs: 1000 },
		);
		expect(result).toBe(3);
	});

	it("given 始终非终态超过超时 When 轮询 Then 返回最近一次值（不抛）", async () => {
		let n = 0;
		const result = await poll(
			async () => ++n,
			() => false,
			{ intervalMs: 1, timeoutMs: 10 },
		);
		expect(result).toBeGreaterThan(0);
	});
});
