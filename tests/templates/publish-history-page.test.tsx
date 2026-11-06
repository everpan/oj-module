import type { ReleasePage, ReleaseRow } from "../../packages/cli/templates/src/oj-market/web/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
// BDD：发布历史页（产品 / 版本 / 发布时间 / 状态，索引读不到时降级不阻断）。
//
// IO 边界只有 MarketClient 一个（页面用 useMarketClient），故注入内存 fake 即可，
// 断言全部落在「用户看见什么」：时间来源标签、在架/下线、索引故障提示。
import { App as AntdApp, ConfigProvider } from "antd";
import i18n from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";

import { InMemoryMarketClient } from "../../packages/cli/templates/src/oj-market/web/__tests__/marketClient.fake";
import { MarketClientProvider } from "../../packages/cli/templates/src/oj-market/web/api/MarketClientProvider";
import zhCN from "../../packages/cli/templates/src/oj-market/web/publish/locales/zh-CN.json";
import ReleaseHistoryPage from "../../packages/cli/templates/src/oj-market/web/publish/pages/history";

beforeAll(() => {
	if (!i18n.isInitialized) {
		i18n.use(initReactI18next).init({
			lng: "zh-CN",
			fallbackLng: "zh-CN",
			ns: ["publish"],
			defaultNS: "publish",
			resources: { "zh-CN": { publish: zhCN } },
			interpolation: { escapeValue: false },
		});
	}
});

function page(over: Partial<ReleasePage> = {}): ReleasePage {
	return { list: [], total: 0, page: 1, size: 20, ...over };
}

function row(over: Partial<ReleaseRow> = {}): ReleaseRow {
	return {
		id: 1,
		product: "demo-solution",
		version: "0.2.0",
		key_id: "demo-solution.alice",
		sha256: null,
		size: null,
		published_at: 1_700_000_000,
		published_at_source: "file",
		yanked: 0,
		...over,
	};
}

function renderPage(client: InMemoryMarketClient) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={qc}>
			<I18nextProvider i18n={i18n}>
				<ConfigProvider button={{ autoInsertSpace: false }}>
					<AntdApp>
						<MarketClientProvider client={client}>
							<ReleaseHistoryPage />
						</MarketClientProvider>
					</AntdApp>
				</ConfigProvider>
			</I18nextProvider>
		</QueryClientProvider>,
	);
}

describe("发布历史页", () => {
	it("given 没有发版记录 When 打开页面 Then 显示空态（不是一片空白）", async () => {
		renderPage(new InMemoryMarketClient({ releasePage: page() }));
		await waitFor(() => expect(screen.getByText("还没有发布记录")).toBeTruthy());
	});

	it("given 一条记录 When 渲染 Then 显示产品名、版本、发布身份与在架状态", async () => {
		const client = new InMemoryMarketClient({ releasePage: page({ list: [row()], total: 1 }) });
		renderPage(client);

		await waitFor(() => expect(screen.getByText("demo-solution.alice")).toBeTruthy());
		expect(screen.getByText("demo-solution")).toBeTruthy();
		expect(screen.getByText("0.2.0")).toBeTruthy();
		expect(screen.getByText("在架")).toBeTruthy();
		// 分页参数由页面给定（默认第 1 页 20 条），服务端才是排序权威
		expect(client.calls).toContain("releases:1:20");
	});

	it("given 发布时间来自 file 回填（上传前的存量包）When 渲染 Then 打「回填时间」标签（不冒充精确落包时刻）", async () => {
		const client = new InMemoryMarketClient({
			releasePage: page({
				list: [row({ id: 1, published_at_source: "file" }), row({ id: 2, version: "0.1.0", yanked: 1, published_at_source: "upload" })],
				total: 2,
			}),
		});
		renderPage(client);

		await waitFor(() => expect(screen.getByText("回填时间")).toBeTruthy());
		expect(screen.getByText("已下线")).toBeTruthy();
		// upload 来源不给标签：只有一行回填时间
		expect(screen.getAllByText("回填时间")).toHaveLength(1);
	});

	it("given 发布时间来自 upload（签名推送直写）When 渲染 Then 不给时间来源标签", async () => {
		const client = new InMemoryMarketClient({
			releasePage: page({ list: [row({ published_at_source: "upload" })], total: 1 }),
		});
		renderPage(client);

		await waitFor(() => expect(screen.getByText("demo-solution")).toBeTruthy());
		expect(screen.queryByText("回填时间")).toBeNull();
	});
});
