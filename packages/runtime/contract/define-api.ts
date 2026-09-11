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
	apiPrefix: string
	/** 相对 apiPrefix 的路由（"/" 开头），支持 `{id}` / `{*path}` 参数段 */
	route: string
	/** HTTP 方法，缺省 "GET"（IR 层归一） */
	method?: HttpMethod
	/** 查询参数 schema（声明语义类型，URL 序列化由生成物负责） */
	query?: z.ZodType
	/** 路径参数 schema（与 route 参数段一一对应） */
	params?: z.ZodType
	/** 请求体 schema */
	body?: z.ZodType
	/** 响应信封 data 部分的 schema；与 response:"raw" 互斥 */
	data?: z.ZodType
	/** "raw" = 二进制/非信封逃生口：不解包、不校验、不进 mock 生成 */
	response?: "raw"
	/** true = 该端点不触发全局加载条（客户端表现层开关，非线协议，不进 OpenAPI） */
	ignoreLoading?: boolean
	/** 接口描述（进 OpenAPI 文档） */
	description?: string
}

/** oj matchit 同款参数段：整段必须是 {name} 或 {*name}，不得混字面 */
const PARAM_SEGMENT = /^\{\*?[a-z_]\w*\}$/i;

function fail(route: string, reason: string): never {
	throw new Error(`[契约] 端点定义非法（route: ${route}）：${reason}`);
}

function validateDefinition(def: ApiDefinitionInput): void {
	const { apiPrefix, route } = def;
	if (!apiPrefix?.startsWith("/")) {
		throw new Error(`[契约] apiPrefix 必须以 "/" 开头（收到: ${apiPrefix}）——如 "/order"；uni-dev 形态请与 oj 模块段名保持一致（AC-D9）。`);
	}
	if (!route?.startsWith("/"))
		fail(route, `route 必须以 "/" 开头（收到: ${route}），且一律相对 apiPrefix——不支持 oj 的根绝对写法（模块手册 D11 前缀收敛）。`);
	if (route.split("/").some(seg => seg === ".." || seg === "." || seg === "\\"))
		fail(route, "route 含路径穿越段（.././\\），请改为正常静态段。");
	for (const seg of route.split("/")) {
		if (seg.includes("{") && !PARAM_SEGMENT.test(seg))
			fail(route, `参数段 "${seg}" 混入字面量——matchit 约束：参数段必须整段为 {name} 或 {*name}，需要前缀/后缀字面时请拆成静态多段。`);
	}
	if (def.data && def.response === "raw")
		fail(route, "data schema 与 response:\"raw\" 互斥——raw 端点不解包信封，不需要 data schema。");
	if (def.response !== undefined && def.response !== "raw")
		fail(route, `response 仅支持 "raw"（收到: ${String(def.response)}）。`);
	// 评审 F9：方法面在定义期封顶，而不是延迟到 codegen 才炸
	if (def.method === "OPTIONS")
		fail(route, "OPTIONS 不在支持范围（ky/oj 均无对应方法）——预检请求由 fetch/CORS 层处理，契约不表达。");
	if (def.method === "HEAD" && def.data)
		fail(route, "HEAD 端点无响应体，不能声明 data schema——需要响应体请改用 GET。");
}

/**
 * defineApi 产物的品牌标记（Symbol.for 跨模块实例稳定）。
 * 非枚举属性——不影响 .route 等的可枚举性；codegen 据此可靠识别端点，
 * 不与契约文件里导出的普通 schema/常量混淆。
 */
export const API_DEF = Symbol.for("ram.api.def");

/** 定义一个契约端点：定义期校验后原样返回（描述符 .route 等可枚举，供 codegen/mock 遍历） */
export function defineApi<D extends ApiDefinitionInput>(def: D): D {
	validateDefinition(def);
	Object.defineProperty(def, API_DEF, { value: true, enumerable: false });
	return def;
}
