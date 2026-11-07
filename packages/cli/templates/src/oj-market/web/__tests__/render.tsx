import type { MarketClient } from "../api/client";
import { render } from "@testing-library/react";
import { ConfigProvider } from "antd";
import { createInstance } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MarketClientProvider } from "../api/MarketClientProvider";
import zhCN from "../locales/zh-CN.json";

// 组件测试的 i18n 真初始化：t() 断言中文文案（孤儿测试修复前 t 返回 key 原样）。
// createInstance 隔离宿主全局 i18n；命名空间与运行时模块注册一致（moduleName）。
const i18n = createInstance();
void i18n.use(initReactI18next).init({
	lng: "zh-CN",
	fallbackLng: "zh-CN",
	resources: { "zh-CN": { "oj-market": zhCN } },
});

/** BDD 测试渲染器：注入 i18n + 客户端 + antd ConfigProvider（关闭按钮内 CJK 空格插入，保证文本断言精确） */
export function renderWithProviders(ui: React.ReactElement, client: MarketClient) {
	return render(
		<I18nextProvider i18n={i18n}>
			<ConfigProvider button={{ autoInsertSpace: false }}>
				<MarketClientProvider client={client}>{ui}</MarketClientProvider>
			</ConfigProvider>
		</I18nextProvider>,
	);
}
