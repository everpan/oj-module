import { describe, expect, it } from "vitest";

import { createHttpMarketClient } from "../../packages/cli/templates/web/src/oj-market/api/client";

/** 最小 ky 形态桩：按预设给结果或抛错（含 HTTPError 的 response.status） */
function fakeRequest(handler: (url: string) => unknown): Parameters<typeof createHttpMarketClient>[0] {
	return {
		get: async (url: string) => ({
			json: async () => handler(url),
		}),
		post: async (url: string) => ({
			json: async () => handler(url),
		}),
	} as unknown as Parameters<typeof createHttpMarketClient>[0];
}

function httpError(status: number): unknown {
	return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

/**
 * 模板默认不配 `framework.market_cdn_url`，`GET /_platform/market/index` 恒返 503。
 * 该码是「未配置市场地址」的预期空态（PRD §5.3），必须落成空数组让卡片区走空态文案，
 * 不能当故障弹错误态 + 重试。
 */
describe("市场客户端：未配置市场地址（503）归空态", () => {
	it("index 遇 503 → 返回空数组", async () => {
		const client = createHttpMarketClient(fakeRequest(() => {
			throw httpError(503);
		}));
		await expect(client.index()).resolves.toEqual([]);
	});

	it("index 正常 → 原样返回 data", async () => {
		const client = createHttpMarketClient(fakeRequest(() => ({
			code: 0,
			data: [{ name: "alpha", version: "0.1.0" }],
		})));
		await expect(client.index()).resolves.toEqual([{ name: "alpha", version: "0.1.0" }]);
	});

	it("index 遇其它状态码 → 照旧上抛（不静默吞错）", async () => {
		const client = createHttpMarketClient(fakeRequest(() => {
			throw httpError(500);
		}));
		await expect(client.index()).rejects.toThrow("HTTP 500");
	});
});
