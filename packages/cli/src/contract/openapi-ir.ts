import type { IrEndpoint } from "./ir";

/**
 * openapi.json（oj v0.1.73 `oj openapi` 产物，OpenAPI 3.1）→ IrEndpoint[]。
 *
 * 单一职责（SRP）：只做「openapi.json 结构 → 统一 IR」的解析，不含任何 zod / 代码发射逻辑。
 * schema 字段在此承载 **JSON Schema 对象**（白名单子集），下游 emit-jsonschema-zod 负责转 zod。
 *
 * 注入安全：本模块只读取数据、产出数据，不拼任何源码字符串，故无注入面。
 */

/** JSON Schema 白名单子集（透传 openapi.json 里 oj 已校验过的契约，下游再转 zod） */
export type JsonSchema = Record<string, unknown>;

export interface OpenApiDoc {
	openapi?: string
	paths?: Record<string, Record<string, OpenApiOperation>>
}

export interface OpenApiOperation {
	"operationId"?: string
	"tags"?: string[]
	"x-oj-file"?: string
	"parameters"?: OpenApiParameter[]
	"requestBody"?: { required?: boolean, content?: Record<string, { schema?: JsonSchema }> }
	"responses"?: Record<string, { "description"?: string, "x-oj-response-enforced"?: boolean, "content"?: Record<string, { schema?: JsonSchema }> }>
}

export interface OpenApiParameter {
	name: string
	in: "path" | "query" | "header" | "cookie"
	required?: boolean
	schema?: JsonSchema
}

export interface IrFromOpenapiOptions {
	/** wire 基础前缀（如 /v1/api）；提供则直接剥离，否则从 path + module 反推 */
	base?: string
	/** 已知 raw 端点路由（相对路径集合）：openapi.json 不携带 raw 标记，由 handler-scan 补充 */
	rawPaths?: Set<string>
}

/** operationId（去 base 子路径 + 方法，非字母数字转 _）→ camelCase 端点方法名 */
export function camelCaseOperationId(operationId: string): string {
	return operationId
		.split("_")
		.filter(Boolean)
		.map((seg, i) => (i === 0 ? seg.toLowerCase() : seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()))
		.join("");
}

/** 剥 base + 模块前缀，得到模块相对路径（如 /collections/{id}）；客户端用 apiPrefix + route 拼回全路径 */
function stripBase(path: string, base: string | undefined, module: string): string {
	let rel = path;
	// base 缺省：从 path 反推（path 中 "/<module>" 之前的部分即 base）
	if (!base) {
		const idx = path.indexOf(`/${module}`);
		if (idx >= 0)
			base = path.slice(0, idx);
	}
	if (base && rel.startsWith(base))
		rel = rel.slice(base.length);
	const modPrefix = `/${module}`;
	if (rel.startsWith(modPrefix))
		rel = rel.slice(modPrefix.length);
	return rel || "/";
}

/** 从路径模板抽取参数段名（catch-all {*path} → path） */
function paramNamesOf(route: string): string[] {
	return [...route.matchAll(/\{([^}]+)\}/g)].map(m => m[1].replace(/^\*/, ""));
}

/** parameters[] 按 in 通道合并为 params / query 两个 object schema（required 收集到数组） */
function collectParams(parameters: OpenApiParameter[] | undefined): { params?: JsonSchema, query?: JsonSchema } {
	const paramsProps: Record<string, JsonSchema> = {};
	const paramsReq: string[] = [];
	const queryProps: Record<string, JsonSchema> = {};
	const queryReq: string[] = [];
	for (const p of parameters ?? []) {
		if (p.in === "path") {
			paramsProps[p.name] = p.schema ?? { type: "string" };
			if (p.required)
				paramsReq.push(p.name);
		}
		else if (p.in === "query") {
			queryProps[p.name] = p.schema ?? { type: "string" };
			if (p.required)
				queryReq.push(p.name);
		}
	}
	const params = Object.keys(paramsProps).length
		? { type: "object", required: paramsReq, properties: paramsProps }
		: undefined;
	const query = Object.keys(queryProps).length
		? { type: "object", required: queryReq, properties: queryProps }
		: undefined;
	return { params, query };
}

/**
 * responses.200 解包 data：仅当带 x-oj-response-enforced:false（= 信封 {code,msg,data}）才取
 * properties.data 作为返回 payload；未声明 response 的端点（仅有 description:OK）返回 undefined。
 */
function extractDataSchema(op: OpenApiOperation): JsonSchema | undefined {
	const r200 = op.responses?.["200"];
	if (!r200 || r200["x-oj-response-enforced"] !== false)
		return undefined;
	const schema = r200.content?.["application/json"]?.schema as JsonSchema | undefined;
	const data = (schema?.properties as Record<string, JsonSchema> | undefined)?.data;
	return data as JsonSchema | undefined;
}

/** openapi.json → IrEndpoint[] */
export function irFromOpenapi(doc: OpenApiDoc, opts: IrFromOpenapiOptions = {}): IrEndpoint[] {
	const out: IrEndpoint[] = [];
	for (const [path, methods] of Object.entries(doc.paths ?? {})) {
		for (const [method, op] of Object.entries(methods)) {
			const module = op.tags?.[0] ?? path.split("/").filter(Boolean)[0] ?? "";
			const route = stripBase(path, opts.base, module);
			const name = camelCaseOperationId(op.operationId ?? `${route}_${method}`);
			const { params, query } = collectParams(op.parameters);
			const body = op.requestBody?.content?.["application/json"]?.schema;
			const dataSchema = extractDataSchema(op);
			const apiPrefix = `/${module}`;
			out.push({
				name,
				apiPrefix,
				route,
				"method": method.toUpperCase() as IrEndpoint["method"],
				// fullPath = 模块前缀 + 模块相对 route（不含 oj 全局 base，base 由 oj 处理）；
				// 与旧 IR（buildIr 的 wirePrefix+route）口径一致，供 client URL / mock / route 对账复用
				"fullPath": apiPrefix === "/" ? route : `${apiPrefix}${route}`,
				"paramNames": paramNamesOf(route),
				"paramsSchema": params,
				"querySchema": query,
				"bodySchema": body,
				dataSchema,
				"raw": opts.rawPaths?.has(route) ?? false,
				"x-oj-file": op["x-oj-file"],
			} as IrEndpoint);
		}
	}
	return out;
}
