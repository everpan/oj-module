/**
 * @oj-module/runtime/contract —— API 契约 DSL（AC-D11）。
 *
 * 零浏览器依赖（Node codegen 与浏览器运行时双安全）：
 * - defineApi：契约端点定义（含定义期校验）
 * - API_DEF / API_DEF_LEGACY：端点品牌标记（后者为旧名只读兼容，供新 codegen 识别存量产物）
 * - z：zod re-export（契约 schema 书写；v4 钉版，pnpm catalog 单一来源）
 * - ContractApiError：契约制 client 统一错误类型
 * - ScopedRequestLike：生成 client 的 request 最小结构类型
 */
export { API_DEF, API_DEF_LEGACY, defineApi } from "./define-api.js";
export { ContractApiError } from "./errors.js";
export { z } from "zod";
