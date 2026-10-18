// 默认市场客户端单例：基于运行时 request（ky 形态）。
// 组件经 MarketClientContext 消费，测试可注入内存 fake，避免依赖真实后端（DIP）。
import { request } from "@oj-module/runtime";
import { createHttpMarketClient } from "./client";

/** 运行时 request 形态与 HttpRequest 兼容（ky get/post 返回带 .json<T>() 的响应） */
export const httpMarketClient = createHttpMarketClient(request as unknown as Parameters<typeof createHttpMarketClient>[0]);
