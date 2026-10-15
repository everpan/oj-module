/**
 * @oj-module/runtime/contract —— API 契约运行时。
 *
 * 零浏览器依赖（Node codegen 与浏览器运行时双安全）。
 *
 * 历史：`defineApi` DSL 已在 oj v0.1.71 流水线中退役——单一事实源改为 oj
 * `openapi.json`（`oj openapi` 产物）→ 前端 `ojm api` 生成 __client，不再消费
 * 旧 `contract.ts`/`defineApi`。本子包现仅保留：
 * - ContractApiError：契约制 client 统一错误类型（前端运行时用）
 * - ScopedRequestLike：生成 client 的 request 最小结构类型
 * - z：zod re-export（契约 schema 书写；v4 钉版，pnpm catalog 单一来源）
 */
export { ContractApiError } from "./errors.ts";
export type { ScopedRequestLike } from "./scoped-request-like.ts";
export { z } from "zod";
