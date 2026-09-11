/**
 * @react-antd-module/runtime/contract —— API 契约 DSL（AC-D11）。
 *
 * 零浏览器依赖（Node codegen 与浏览器运行时双安全）：
 * - defineApi：契约端点定义（含定义期校验）
 * - z：zod re-export（契约 schema 书写；v4 钉版，pnpm catalog 单一来源）
 * - ContractApiError：契约制 client 统一错误类型
 * - ScopedRequestLike：生成 client 的 request 最小结构类型
 */
export { API_DEF, defineApi } from "./define-api.ts";
export type { ApiDefinitionInput, HttpMethod } from "./define-api.ts";
export { ContractApiError } from "./errors.ts";
export type { ScopedRequestLike } from "./scoped-request-like.ts";
export { z } from "zod";
