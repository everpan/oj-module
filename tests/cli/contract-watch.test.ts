import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createContractRegen } from "../../packages/cli/src/contract/watch";

/**
 * AC-D7 watch 集成：契约变更 → 去抖合并 → runApi 重生成 → 产物落 modules 树
 * （既有模块 watch 捕获产物变更 → 重建 + SSE，复用不新造）。
 * 失败不崩 dev server：[ram-api] 前缀人话错误。
 */

const tmpDirs: string[] = [];

function makeProject(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ram-watch-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, "api/src/order"), { recursive: true });
	writeFileSync(join(dir, "api/src/order/contract.ts"), `
import { defineApi, z } from "@react-antd-module/runtime/contract";
export const getOrderList = defineApi({
	apiPrefix: "/order",
	route: "/list",
	data: z.object({ list: z.array(z.object({ id: z.number() })), total: z.number() }),
});
`);
	return dir;
}

const settle = () => new Promise(r => setTimeout(r, 300));

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("createContractRegen（去抖 + 容错）", () => {
	it("连续触发合并为一次 runApi（去抖）", async () => {
		const run = vi.fn().mockResolvedValue({ written: [] });
		const regen = createContractRegen("/any", { debounceMs: 20, run });
		regen();
		regen();
		regen();
		await new Promise(r => setTimeout(r, 100));
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("runApi 进行中再来变更 → 收尾后补跑一次（不丢变更）", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const run = vi.fn().mockImplementation(async () => {
			await gate;
			return { written: [] };
		});
		const regen = createContractRegen("/any", { debounceMs: 10, run });
		regen();
		await new Promise(r => setTimeout(r, 30)); // 第一次已进入 run
		regen(); // 进行中触发 → 记 pending
		release();
		await new Promise(r => setTimeout(r, 100));
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("runApi 抛错 → onError 收到 [ram-api] 人话，不抛出", async () => {
		const onError = vi.fn();
		const regen = createContractRegen("/nonexistent-project", { debounceMs: 10, onError });
		regen();
		await new Promise(r => setTimeout(r, 100));
		expect(onError).toHaveBeenCalledTimes(1);
		expect(String(onError.mock.calls[0][0])).toContain("ram-api");
	});

	it("真实 runApi：契约变更后 client.ts 落到模块树", async () => {
		const cwd = makeProject();
		const regen = createContractRegen(cwd, { debounceMs: 10 });
		regen();
		await settle();
		expect(existsSync(join(cwd, "modules/src/order/api/client.ts"))).toBe(true);
		// 再次触发（契约未变）→ 幂等零写入
		const written: string[] = [];
		const regen2 = createContractRegen(cwd, { debounceMs: 10, onRegenerated: r => written.push(...r.written) });
		regen2();
		await settle();
		expect(written).toEqual([]);
	});
});
