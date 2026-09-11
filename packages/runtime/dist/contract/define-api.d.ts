import type { z } from "zod";
/**
 * AC-D11/AC-D4：契约端点定义。
 *
 * route 一律相对 apiPrefix（无 oj 根绝对写法——前端受模块手册 D11 前缀收敛，
 * 根绝对逃逸语义不放行）；参数段支持 oj matchit 同款 `{id}` 单段与
 * `{*path}` catch-all，参数段内不得混字面（`{id}.json` 非法）。
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
export interface ApiDefinitionInput {
    /** 模块 API 前缀（"/" 开头）；uni-dev 形态字面等于 oj 模块段名（AC-D9） */
    apiPrefix: string;
    /** 相对 apiPrefix 的路由（"/" 开头），支持 `{id}` / `{*path}` 参数段 */
    route: string;
    /** HTTP 方法，缺省 "GET"（IR 层归一） */
    method?: HttpMethod;
    /** 查询参数 schema（声明语义类型，URL 序列化由生成物负责） */
    query?: z.ZodType;
    /** 路径参数 schema（与 route 参数段一一对应） */
    params?: z.ZodType;
    /** 请求体 schema */
    body?: z.ZodType;
    /** 响应信封 data 部分的 schema；与 response:"raw" 互斥 */
    data?: z.ZodType;
    /** "raw" = 二进制/非信封逃生口：不解包、不校验、不进 mock 生成 */
    response?: "raw";
    /** true = 该端点不触发全局加载条（客户端表现层开关，非线协议，不进 OpenAPI） */
    ignoreLoading?: boolean;
    /** 接口描述（进 OpenAPI 文档） */
    description?: string;
}
/**
 * defineApi 产物的品牌标记（Symbol.for 跨模块实例稳定）。
 * 非枚举属性——不影响 .route 等的可枚举性；codegen 据此可靠识别端点，
 * 不与契约文件里导出的普通 schema/常量混淆。
 *
 * 注：旧标记 `Symbol.for("ram.api.def")` 不在本包公开——只有 cli 的 IR 识别
 * 存量产物时才需要它，故由 `packages/cli/src/contract/ir.ts` 自行声明（避免把
 * 兼容专用符号扩进公共出口，设计 §7 R3）。
 */
export declare const API_DEF: unique symbol;
/** 定义一个契约端点：定义期校验后原样返回（描述符 .route 等可枚举，供 codegen/mock 遍历） */
export declare function defineApi<D extends ApiDefinitionInput>(def: D): D;
