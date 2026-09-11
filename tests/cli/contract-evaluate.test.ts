import path from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateContract } from "../../packages/cli/src/contract/evaluate";

const FIXTURE = path.join(__dirname, "fixtures/order.contract.ts");

/**
 * AC-D13：契约求值——esbuild bundle + 真 import()，契约只 import
 * @react-antd-module/runtime/contract（真实现，零浏览器依赖）；误 import runtime
 * 时用空壳 stub 并告警（浏览器代码进 Node 必炸）。
 */
describe("evaluateContract（AC-D13）", () => {
	it("返回契约模块全部具名导出：端点描述符 + zod schema", async () => {
		const exports = await evaluateContract(FIXTURE, process.cwd());
		const detail = exports.getOrderDetail as { route: string, method?: string };
		expect(detail.route).toBe("/item/{id}");
		expect(detail.method).toBe("GET");
		expect(exports.getOrderList).toMatchObject({ apiPrefix: "/order", route: "/list" });
		// zod schema 导出是真 zod 实例（v4 内部标记 _zod）
		expect((exports.OrderItem as { _zod?: unknown })._zod).toBeDefined();
		// raw 端点
		expect(exports.downloadOrderFile).toMatchObject({ route: "/file/{*path}", response: "raw" });
	});

	it("契约文件不存在 → 人话报错", async () => {
		await expect(evaluateContract("/nonexistent/contract.ts", process.cwd()))
			.rejects
			.toThrowError(/契约/);
	});
});
