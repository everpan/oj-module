// BDD：MCP 服务管理页（20261110-1027 §4.3 全场景，T7）。
// 数据源 useMarketClient()（catalog + 既有 index 漂移对账），测试注入内存 fake。
// 验收锚点 = §4.3 场景表：四态状态卡/常驻 Alert/分组工具表/质量标注/纯文本渲染断言/
// 漂移/静态统计/调用统计恒「—」/接入配置（不含 token 值）/刷新。
import type { McpCatalogResult } from "../../../../../oj-market/web/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import { createInstance } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";
import { InMemoryMarketClient } from "../../../../../oj-market/web/__tests__/marketClient.fake";
import { MarketClientContext } from "../../../../../oj-market/web/api/context";
import zhCN from "../../locales/zh-CN.json";
import { McpPage } from "./index";

// i18n 真初始化（system 命名空间）：断言中文文案而非 key 原样。
const i18n = createInstance();
void i18n.use(initReactI18next).init({
	lng: "zh-CN",
	fallbackLng: "zh-CN",
	resources: { "zh-CN": { system: zhCN } },
});

function renderPage(client: InMemoryMarketClient) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<I18nextProvider i18n={i18n}>
			<ConfigProvider button={{ autoInsertSpace: false }}>
				<QueryClientProvider client={queryClient}>
					<MarketClientContext value={client}>
						<McpPage />
					</MarketClientContext>
				</QueryClientProvider>
			</ConfigProvider>
		</I18nextProvider>,
	);
}

/** §4.3 工具表夹具：wiki（读+危险+富文本描述）/order/未声明契约 各一组 */
const CATALOG_MOUNTED: McpCatalogResult = {
	status: "mounted",
	generation: 7,
	groups: [
		{
			module: "wiki",
			tools: [
				{ name: "wiki_search", description: "<b>搜索</b>wiki & 页面", module: "wiki", readOnly: true, destructive: false, params: ["path", "query"] },
				{ name: "wiki_delete", module: "wiki", readOnly: false, destructive: true, params: ["path"] },
			],
		},
		{ module: "order", tools: [{ name: "order_create", description: "创建订单", module: "order", readOnly: false, destructive: false, params: ["path", "query", "body"] }] },
		{ module: "", tools: [{ name: "no_tag_tool", module: "", readOnly: false, destructive: false, params: [] }] },
	],
};

const INDEX_WITH_GHOST = {
	list: [
		{ name: "wiki", latest: "1.1.0", installed: "1.1.0", enabled: true, upgradable: false },
		{ name: "order", latest: "2.0.0", installed: "2.0.0", enabled: true, upgradable: false },
		{ name: "ghost", latest: "0.1.0", installed: "0.1.0", enabled: true, upgradable: false },
	],
	total: 3,
	page: 1,
	size: 20,
};

describe("mCP 服务管理页：mounted 态（§4.3）", () => {
	it("当 status=mounted，则 状态卡「已启用」+ 常驻 Alert（fail-closed 规则）+ 分组工具表（组头=方案名·工具数·只读/写/危险分布）", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: CATALOG_MOUNTED, indexPage: INDEX_WITH_GHOST });
		renderPage(client);

		await screen.findByText("已启用");
		expect(screen.getByText(/代际/).textContent).toContain("7");
		// 常驻 Alert：fail-closed 收敛认知
		expect(screen.getByText(/仅方案模块工具对外暴露/).textContent).toContain("安装方案时自动登记");
		// 分组头：方案名 + 工具数 + 静态统计（wiki：2 工具，只读 1 / 写 1 / 危险 1）
		const wikiHead = screen.getByText("wiki").closest("[class*=group]") ?? screen.getByText("wiki").parentElement!;
		expect(wikiHead.textContent).toContain("2 个工具");
		expect(wikiHead.textContent).toContain("只读 1");
		expect(wikiHead.textContent).toContain("写 1");
		expect(wikiHead.textContent).toContain("危险 1");
		expect(screen.getByText("wiki_search")).toBeTruthy();
		expect(screen.getByText("order_create")).toBeTruthy();
		// 工具描述由方案作者提供（说明行常驻）
		expect(screen.getByText(/工具描述由方案作者提供/)).toBeTruthy();
	});

	it("当 渲染任意工具行，则 质量标注 Tag 齐备（只读/危险/无描述/未声明契约）且调用统计恒「—」", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: CATALOG_MOUNTED, indexPage: INDEX_WITH_GHOST });
		const { container } = renderPage(client);
		await screen.findByText("wiki_search");
		// 折叠组先展开（未声明契约组默认折叠）
		fireEvent.click(container.querySelector(".ant-collapse .ant-collapse-header")!);
		await screen.findByText("no_tag_tool");

		const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
		expect(rowOf("wiki_search").textContent).toContain("只读");
		expect(rowOf("wiki_delete").textContent).toContain("危险");
		expect(rowOf("wiki_delete").textContent).toContain("无描述");
		// tags[0] 缺失 = openapi 契约未声明（杂项工具组）
		expect(rowOf("no_tag_tool").textContent).toContain("未声明契约");
		// v1 调用统计恒「—」（v2 随上游 R2'；文案不出现内部需求编号）
		expect(container.textContent).not.toContain("R2");
		const dashCells = screen.getAllByText("—");
		expect(dashCells.length).toBeGreaterThanOrEqual(3);
		// 入参三键子集如实展示
		expect(rowOf("order_create").textContent).toContain("path");
		expect(rowOf("order_create").textContent).toContain("body");
	});

	it("当 tool description 含 HTML/markdown 记号，则 纯文本渲染（禁 HTML 注入——测试断言无元素生成）", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: CATALOG_MOUNTED, indexPage: INDEX_WITH_GHOST });
		const { container } = renderPage(client);
		await screen.findByText("wiki_search");

		expect(screen.getByText("<b>搜索</b>wiki & 页面")).toBeTruthy();
		expect(container.querySelector("b")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
	});

	it("当 方案已装但无任何工具分组（漂移），则 该方案行提示「无可见工具（未入白名单或无 api）」", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: CATALOG_MOUNTED, indexPage: INDEX_WITH_GHOST });
		renderPage(client);
		await screen.findByText("wiki_search");

		expect(screen.getByText("ghost").textContent).toContain("ghost");
		expect(screen.getByText(/无可见工具（未入白名单或无 api）/)).toBeTruthy();
	});

	it("当 非方案分组（module 不在已装方案或空串），则 折叠展示并标「非方案」", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: CATALOG_MOUNTED, indexPage: INDEX_WITH_GHOST });
		const { container } = renderPage(client);
		await screen.findByText("wiki_search");

		const collapse = container.querySelector(".ant-collapse")!;
		expect(collapse.textContent).toContain("非方案");
		expect(collapse.textContent).toContain("未声明契约");
		// 折叠态：默认不见工具行，展开后可见
		expect(screen.queryByText("no_tag_tool")).toBeNull();
		fireEvent.click(collapse.querySelector(".ant-collapse-header")!);
		await screen.findByText("no_tag_tool");
	});
});

describe("mCP 服务管理页：异常三态（§4.3，文案区分由服务端 message 承载）", () => {
	it("当 status=unmounted，则 状态卡「未启用」+ 服务端 message（两态区分）+ 启用指引", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: { status: "unmounted", groups: [], message: "尚未修改：在 config.yaml 现有 server.mcp 段内把 enabled 改为 true…" } });
		renderPage(client);
		await screen.findByText("未启用");
		expect(screen.getByText(/尚未修改/)).toBeTruthy();
		// message 与指引都含启用措辞——按「出现即对」断言（服务端 message 承载两态区分）
		expect(screen.getAllByText(/enabled 改为 true/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/POST \{base\}\/_system\/config/).length).toBeGreaterThan(0);
	});

	it("当 status=auth，则 上游 msg 透传 + mcp 段检查项 + JWT exp 警示", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: { status: "auth", groups: [], message: "token 过期" } });
		renderPage(client);
		await screen.findByText("鉴权失败");
		expect(screen.getByText("token 过期")).toBeTruthy();
		expect(screen.getByText(/auth 插件/)).toBeTruthy();
		expect(screen.getByText(/24 小时过期/)).toBeTruthy();
	});

	it("当 status=unreachable，则 服务端区分文案（canonical_origin 未配置 vs 网络不可达）如实展示", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: { status: "unreachable", groups: [], message: "canonical_origin 未配置：无法定位站点 {base}" } });
		renderPage(client);
		await screen.findByText("不可达");
		expect(screen.getAllByText(/canonical_origin 未配置/).length).toBeGreaterThan(0);
		expect(screen.getByText(/vars\.canonical_origin/)).toBeTruthy();
	});

	it("当 catalog 拉取抛错（网络级），则 如实报错而非渲染成空态", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogError: new Error("boom") });
		renderPage(client);
		await screen.findByText(/boom/);
	});
});

describe("mCP 服务管理页：接入配置与刷新（§4.3）", () => {
	it("当 点击「复制接入配置」，则 剪贴板得到 URL+Bearer 说明+实配 JSON+线路 A 模板（不含 token 值；含 exp 警示与重连说明）", async () => {
		let copied = "";
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => {
			copied = t;
		} } });
		const client = new InMemoryMarketClient({ mcpCatalogResult: CATALOG_MOUNTED, indexPage: INDEX_WITH_GHOST });
		renderPage(client);
		await screen.findByText("wiki_search");

		fireEvent.click(screen.getByText("复制接入配置"));
		await waitFor(() => expect(copied).not.toBe(""));
		expect(copied).toContain("/mcp");
		expect(copied).toContain("Bearer");
		expect(copied).toContain("24 小时");
		expect(copied).toContain("mcpServers");
		expect(copied).toContain("oj mcp -c config.yaml");
		expect(copied).toContain("-32601");
		// 红线：不含 token 值（页面根本拿不到上游 JWT 以外的凭据，粘贴占位符而非真值）
		expect(copied).not.toMatch(/Bearer [\w-]{20,}/);
	});

	it("当 手动刷新，则 重新拉 catalog 与已装方案列表（升级 reload 后即见新工具）", async () => {
		const client = new InMemoryMarketClient({ mcpCatalogResult: CATALOG_MOUNTED, indexPage: INDEX_WITH_GHOST });
		renderPage(client);
		await screen.findByText("wiki_search");
		fireEvent.click(screen.getByText("刷新"));
		await waitFor(() => expect(client.calls.filter(c => c === "mcpCatalog").length).toBe(2));
		expect(client.calls.filter(c => c.startsWith("index")).length).toBe(2);
	});
});
