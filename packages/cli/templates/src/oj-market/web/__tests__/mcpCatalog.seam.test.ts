// BDD：MarketClient.mcpCatalog 注入缝（20261110-1027 §4.3，T6）。
// 管理页 /system/framework/mcp 经 useMarketClient() 消费 catalog（+ 既有 index 做漂移对账），
// 测试注入本内存 fake——此文件钉缝本身：状态透传 / 错误面 / 未注入常态。
import { describe, expect, it } from "vitest";
import { InMemoryMarketClient } from "./marketClient.fake";

describe("marketClient.mcpCatalog 注入缝（20261110-1027 T6）", () => {
	it("当 注入 mcpCatalogResult，则 fake 原样透传并记录调用", async () => {
		const client = new InMemoryMarketClient({
			mcpCatalogResult: { status: "mounted", generation: 7, groups: [{ module: "wiki", tools: [{ name: "wiki_search", module: "wiki", readOnly: true, destructive: false, params: ["path"] }] }] },
		});
		const r = await client.mcpCatalog();
		expect(r.status).toBe("mounted");
		expect(r.generation).toBe(7);
		expect(r.groups[0]?.tools[0]?.name).toBe("wiki_search");
		expect(client.calls).toContain("mcpCatalog");
	});

	it("当 注入 mcpCatalogError，则 fake 抛出（页面错误面数据）", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogError: new Error("boom") });
		await expect(client.mcpCatalog()).rejects.toThrow("boom");
	});

	it("当 未注入，则 fake 返回 unmounted 空目录常态（骨架期缺省页渲染安全）", async () => {
		const client = new InMemoryMarketClient();
		const r = await client.mcpCatalog();
		expect(r).toEqual({ status: "unmounted", groups: [] });
	});
});
