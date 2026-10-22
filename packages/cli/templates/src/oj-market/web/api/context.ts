import type { MarketClient } from "./client";
import { createContext, use } from "react";
import { httpMarketClient } from "./defaultClient";

/** 市场客户端上下文（依赖注入位；默认 = 运行时 HTTP 实现，测试可替换为内存 fake） */
export const MarketClientContext = createContext<MarketClient>(httpMarketClient);

/** 组件/hooks 取客户端（默认注入运行时实现） */
export function useMarketClient(): MarketClient {
	return use(MarketClientContext);
}
