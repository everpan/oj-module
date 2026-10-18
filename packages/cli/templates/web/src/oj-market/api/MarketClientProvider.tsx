import type { MarketClient } from "./client";
import React from "react";
import { MarketClientContext } from "./context";
import { httpMarketClient } from "./defaultClient";

/**
 * 注入市场客户端（默认走运行时 HTTP 实现，测试传内存 fake）。
 * 单独成文件：`react-refresh` 要求组件文件只导出组件，context 在 ./context。
 */
export function MarketClientProvider({ client, children }: { client?: MarketClient, children: React.ReactNode }) {
	return React.createElement(MarketClientContext.Provider, { value: client ?? httpMarketClient }, children);
}
