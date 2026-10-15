import type { IrEndpoint } from "../../packages/cli/src/contract/ir";
/**
 * 测试夹具助手（非测试文件，不进入 vitest 运行集）。
 *
 * 翻译层退役后，事实源是 oj v0.1.71 的 `openapi.json`（OpenAPI 3.1）。
 * 这两组助手把「旧 defineApi 契约」表达成新管线可消费的形态：
 *  - `mkEp`：直接构造 IrEndpoint（emit 器单测用，喂 JSON Schema）
 *  - `specToOpenapi` / `writeOpenapiJson`：把紧凑 spec 落成 openapi.json（runApi/checkApi e2e 用）
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** 由 JSON Schema 构造 IrEndpoint（友好键 query/params/body/data → *Schema 字段） */
export function mkEp(over: Partial<IrEndpoint> & { query?: unknown, params?: unknown, body?: unknown, data?: unknown }): IrEndpoint {
	const apiPrefix = over.apiPrefix ?? "/order";
	const route = over.route ?? "/x";
	const wire = over.urlPrefix ?? apiPrefix;
	const fullPath = wire === "/" ? route : `${wire}${route}`;
	const paramNames = route.split("/").filter(s => s.startsWith("{")).map(s => s.replace(/^\{\*?/, "").replace(/\}$/, ""));
	const { query, params, body, data, ...rest } = over;
	return {
		name: "ep",
		apiPrefix,
		urlPrefix: over.urlPrefix,
		route,
		method: over.method ?? "GET",
		fullPath,
		paramNames,
		raw: false,
		querySchema: query,
		paramsSchema: params,
		bodySchema: body,
		dataSchema: data,
		...rest,
	};
}

export interface ApiSpec {
	/** 模块名（= 旧 apiPrefix 去首斜杠），如 "order" */
	module: string
	/** 模块相对 route，如 "/list" 或 "/item/{id}" */
	route: string
	/** HTTP 方法，缺省 GET */
	method?: string
	/** oj 全局 base 前缀（如 /api），提供则写进 path 键 */
	base?: string
	/** 端点方法名（camelCase），不传则自动推导 */
	name?: string
	/** path 参数（JSON Schema props，自动 required） */
	params?: Record<string, unknown>
	/** query 参数（JSON Schema props） */
	query?: Record<string, unknown>
	/** 请求体（JSON Schema object） */
	body?: Record<string, unknown>
	/** 响应 data 负载（JSON Schema） */
	data?: Record<string, unknown>
	/** 标记 raw（二进制/流） */
	raw?: boolean
}

/** camelCase 方法名 → camelCaseOperationId 能还原的 operationId（下划线分段） */
function opId(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.toLowerCase();
}

function autoName(spec: ApiSpec): string {
	const segs = `${spec.module}${spec.route}_${spec.method ?? "GET"}`.split(/[^a-z0-9]+/i).filter(Boolean);
	return segs.map((s, i) => i === 0 ? s.toLowerCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join("");
}

/** 紧凑 spec 列表 → openapi.json 文档对象（oj v0.1.71 形态） */
export function specToOpenapi(specs: ApiSpec[]): { openapi: string, paths: Record<string, Record<string, unknown>> } {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const spec of specs) {
		const base = spec.base ?? "";
		const path = `${base}/${spec.module}${spec.route}`;
		const method = (spec.method ?? "GET").toLowerCase();
		const op: Record<string, unknown> = {
			operationId: opId(spec.name ?? autoName(spec)),
			tags: [spec.module],
		};
		const parameters: unknown[] = [];
		for (const [k, v] of Object.entries(spec.params ?? {}))
			parameters.push({ name: k, in: "path", required: true, schema: v });
		for (const [k, v] of Object.entries(spec.query ?? {}))
			parameters.push({ name: k, in: "query", required: false, schema: v });
		if (parameters.length)
			op.parameters = parameters;
		if (spec.body)
			op.requestBody = { required: true, content: { "application/json": { schema: spec.body } } };
		if (spec.data)
			op.responses = { 200: { "x-oj-response-enforced": false, "content": { "application/json": { schema: { type: "object", properties: { data: spec.data }, required: ["data"] } } } } };
		paths[path] = { ...(paths[path] ?? {}), [method]: op };
	}
	return { openapi: "3.1.0", paths };
}

/** 把 spec 列表写成 cwd/openapi.json（runApi/checkApi 的事实源） */
export function writeOpenapiJson(cwd: string, specs: ApiSpec[]): string {
	const doc = specToOpenapi(specs);
	const p = join(cwd, "openapi.json");
	writeFileSync(p, JSON.stringify(doc, null, 2));
	return p;
}
