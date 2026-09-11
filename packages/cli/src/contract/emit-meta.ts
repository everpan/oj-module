import type { IrEndpoint } from "./ir";
import { stringify } from "yaml";
import { z } from "zod";

/**
 * AC-D1/D9：routes.json 与 openapi.yaml 发射器。
 *
 * - routes.json：ojm dev mock 消费；格式 = oj routes.js 规范化
 *   （去 apiPrefix 首斜杠、不含 base、含模块段），method+pattern 排序保证字节稳定。
 * - openapi.yaml：OpenAPI 3.1，文档站（ojm api docs）与外部评审的单一来源。
 *   z.date() 无法进 JSON Schema——先降级为 datetime string（线上传输本就是 ISO 串）。
 * 两者都是提交产物：同输入必须字节稳定，diff 即可评审。
 */

/** routes.json：`[{ method, pattern }]`，pattern 去首斜杠、含模块段（AC-D9） */
export function emitRoutesJson(ir: IrEndpoint[]): string {
	const rows = ir
		.map(ep => ({ method: ep.method, pattern: ep.fullPath.replace(/^\//, "") }))
		.sort((a, b) => (a.method < b.method ? -1 : a.method > b.method ? 1 : a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0));
	return `${JSON.stringify(rows, null, "\t")}\n`;
}

/** z.date() → datetime string（JSON Schema 无 date 类型；线上本就是 ISO 串） */
function replaceDates(schema: unknown): unknown {
	const def = (schema as { _zod?: { def?: Record<string, unknown> } })?._zod?.def;
	if (!def)
		return schema;
	switch (def.type) {
		case "date":
			return z.string().datetime();
		case "object": {
			const shape: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(def.shape as Record<string, unknown>))
				shape[k] = replaceDates(v);
			return z.object(shape as Record<string, z.ZodType>);
		}
		case "array":
			return z.array(replaceDates(def.element) as z.ZodType);
		case "union":
			return z.union((def.options as unknown[]).map(s => replaceDates(s) as z.ZodType) as [z.ZodType, ...z.ZodType[]]);
		case "optional":
			return (replaceDates(def.innerType) as z.ZodType).optional();
		case "nullable":
			return (replaceDates(def.innerType) as z.ZodType).nullable();
		case "default":
			return (replaceDates(def.innerType) as z.ZodType).default(def.defaultValue);
		default:
			return schema;
	}
}

/** zod schema → JSON Schema（剥 $schema——嵌入文档不需要逐份声明 draft） */
function jsonSchema(schema: unknown): Record<string, unknown> {
	const out = z.toJSONSchema(replaceDates(schema) as z.ZodType) as Record<string, unknown>;
	delete out.$schema;
	return out;
}

/** `{*path}` → `{path}`（OpenAPI 模板无 catch-all 记号） */
function openapiPath(fullPath: string): string {
	return fullPath.replace(/\{\*(\w+)\}/g, "{$1}");
}

function pathParameters(ep: IrEndpoint): Record<string, unknown>[] {
	const props = (ep.paramsSchema ? jsonSchema(ep.paramsSchema).properties : {}) as Record<string, unknown> | undefined;
	return ep.paramNames.map(name => ({
		name,
		in: "path",
		required: true,
		schema: props?.[name] ?? { type: "string" },
	}));
}

function queryParameters(ep: IrEndpoint): Record<string, unknown>[] {
	if (!ep.querySchema)
		return [];
	const s = jsonSchema(ep.querySchema);
	const required = new Set((s.required as string[]) ?? []);
	return Object.entries((s.properties as Record<string, unknown>) ?? {}).map(([name, schema]) => ({
		name,
		in: "query",
		required: required.has(name),
		schema,
	}));
}

function successResponse(ep: IrEndpoint): Record<string, unknown> {
	if (ep.raw) {
		return {
			description: "成功（原始流，非信封）",
			content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
		};
	}
	const properties: Record<string, unknown> = { code: { type: "integer" }, msg: { type: "string" } };
	if (ep.dataSchema)
		properties.data = jsonSchema(ep.dataSchema);
	return {
		description: "成功（oj 信封：code=0）",
		content: { "application/json": { schema: { type: "object", properties } } },
	};
}

/** 业务错误响应（§6.2 通道 b：HTTP status=code，信封 {code,msg}） */
function errorResponse(): Record<string, unknown> {
	return {
		description: "业务错误（oj 信封：code 非 0，HTTP status=code）",
		content: { "application/json": { schema: { type: "object", properties: { code: { type: "integer" }, msg: { type: "string" } }, required: ["code"] } } },
	};
}

/** openapi.yaml：OpenAPI 3.1；paths/methods 排序 + 键序固定，保证字节稳定 */
export function emitOpenapiYaml(ir: IrEndpoint[], opts: { title: string, version: string }): string {
	const paths: Record<string, Record<string, unknown>> = {};
	const sorted = [...ir].sort((a, b) => (a.fullPath < b.fullPath ? -1 : a.fullPath > b.fullPath ? 1 : a.method < b.method ? -1 : 1));
	for (const ep of sorted) {
		const op: Record<string, unknown> = {};
		op.operationId = ep.name;
		if (ep.description)
			op.description = ep.description;
		const parameters = [...pathParameters(ep), ...queryParameters(ep)];
		if (parameters.length)
			op.parameters = parameters;
		if (ep.bodySchema)
			op.requestBody = { required: true, content: { "application/json": { schema: jsonSchema(ep.bodySchema) } } };
		op.responses = ep.raw
			? { 200: successResponse(ep) }
			// §6.2 错误通道入交付物（评审 F14/m9）：业务错误为 default 响应，信封 code 非 0
			: { 200: successResponse(ep), default: errorResponse() };
		const p = openapiPath(ep.fullPath);
		(paths[p] ??= {})[ep.method.toLowerCase()] = op;
	}
	return stringify({
		openapi: "3.1.0",
		info: { title: opts.title, version: opts.version },
		paths,
	});
}
