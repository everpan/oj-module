import type { MarketClient } from "../api/client";
import { render } from "@testing-library/react";
import { ConfigProvider } from "antd";
import React from "react";
import { MarketClientProvider } from "../api/MarketClientProvider";

/** BDD 测试渲染器：注入客户端 + antd ConfigProvider（关闭按钮内 CJK 空格插入，保证文本断言精确） */
export function renderWithProviders(ui: React.ReactElement, client: MarketClient) {
	return render(
		<ConfigProvider button={{ autoInsertSpace: false }}>
			<MarketClientProvider client={client}>{ui}</MarketClientProvider>
		</ConfigProvider>,
	);
}
