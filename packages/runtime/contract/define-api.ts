import type { z } from "zod";

/**
 * AC-D11/AC-D4：契约端点定义。
 *
 * route 一律相对 apiPrefix（无 oj 根绝对写法——前端受模块手册 D11 前缀收敛，
 * 根绝对逃逸语义不放行）；参数段支持 oj matchit 同款 `{id}` 单段与
 * `{*path}` catch-all，参数段内不得混字面（`{id}.json` 非法）。
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/**
 * multipart/form-data 的文件部件：**只声明名字与形态**。
 *
 * 二进制刻意不进 zod（JSON Schema 无 binary 类型，且字节由运行时的 FormData
 * 组装）：oj 侧按 `http.files`（元数据 { field, filename, content_type, size }）
 * 与 `http.file(i)`（字节）读取。
 */
export interface ApiFormFile {
	/** 表单字段名（= FormData 的 append key = oj 侧 http.files[].field） */
	name: string
	/** true = 必传；缺省可选（可选文件不 append 部件，oj 侧自然缺省） */
	required?: boolean
	/** true = 同名多文件：生成 client 接受数组并逐个 append（oj 侧 http.files 多条） */
	multiple?: boolean
}

/** multipart/form-data 请求体：文本部件走 zod，文件部件只声明形态（与 body 互斥） */
export interface ApiFormInput {
	/** 文本部件 schema（z.object——字段名即部件名；进 OpenAPI 的 multipart JSON schema） */
	fields?: z.ZodType
	/** 文件部件（与 fields 至少声明其一） */
	files?: ApiFormFile[]
}

export interface ApiDefinitionInput {
	/** 模块 API 前缀（"/" 开头）；uni-dev 形态字面等于 oj 模块段名（AC-D9） */
	apiPrefix: string
	/**
	 * 线上 URL 前缀（"/" 开头，D-M8）：存量 oj 后端 URL 命名空间与目录名错位时
	 * 显式声明（如目录 workitems、URL /workspaces/{slug}/...）。缺省 = apiPrefix。
	 * 认领/护栏身份仍按 apiPrefix（目录名）；线上前缀不一致的同模块端点混用报错。
	 */
	urlPrefix?: string
	/** 相对 apiPrefix 的路由（"/" 开头），支持 `{id}` / `{*path}` 参数段 */
	route: string
	/** HTTP 方法，缺省 "GET"（IR 层归一） */
	method?: HttpMethod
	/** 查询参数 schema（声明语义类型，URL 序列化由生成物负责） */
	query?: z.ZodType
	/** 路径参数 schema（与 route 参数段一一对应） */
	params?: z.ZodType
	/** 请求体 schema（JSON；与 form 互斥） */
	body?: z.ZodType
	/**
	 * multipart/form-data 请求体（与 body 互斥）：文本部件写进 form.fields（zod），
	 * 文件部件只声明名字——二进制无法保真进 JSON Schema，FormData 由生成 client 组装。
	 */
	form?: ApiFormInput
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
	if (def.urlPrefix !== undefined && !def.urlPrefix.startsWith("/"))
		fail(route, `urlPrefix 必须以 "/" 开头（收到: ${def.urlPrefix}）。`);
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
	if (def.form && def.body)
		fail(route, "form 与 body 互斥——一个端点只有一种请求体形态：multipart/form-data（form）与 JSON（body）声明其一，文本字段请写进 form.fields。");
	if (def.form) {
		const files = def.form.files ?? [];
		if (!def.form.fields && files.length === 0)
			fail(route, "form 至少需要 fields 或一项 files——空 multipart 请求体无意义；无请求体请删掉 form（改用 query/params）。");
		const seen = new Set<string>();
		for (const file of files) {
			if (!file?.name)
				fail(route, "form.files 每项必须有 name——它既是 FormData 的 append key，也是 oj 侧 http.files[].field 的字段名。");
			if (seen.has(file.name))
				fail(route, `form.files 字段名 "${file.name}" 重复——同名多文件请用 multiple: true。`);
			seen.add(file.name);
		}
	}
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
 *
 * 注：旧标记 `Symbol.for("ram.api.def")` 不在本包公开——只有 cli 的 IR 识别
 * 存量产物时才需要它，故由 `packages/cli/src/contract/ir.ts` 自行声明（避免把
 * 兼容专用符号扩进公共出口，设计 §7 R3）。
 */
export const API_DEF = Symbol.for("ojm.api.def");

/** 定义一个契约端点：定义期校验后原样返回（描述符 .route 等可枚举，供 codegen/mock 遍历） */
export function defineApi<D extends ApiDefinitionInput>(def: D): D {
	validateDefinition(def);
	Object.defineProperty(def, API_DEF, { value: true, enumerable: false });
	return def;
}
