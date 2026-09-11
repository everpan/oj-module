import type { ApiDefinitionInput } from "@oj-module/runtime/contract";
import { API_DEF } from "@oj-module/runtime/contract";

/**
 * AC-D12：契约 IR 构建 + schema 白名单。
 *
 * IR 是 codegen 的统一中间表示：evaluate 出的运行时对象在这里归一
 * （method 缺省、fullPath 拼接、参数段提取、目录切分），各发射器只消费 IR，
 * 不再触碰 zod 内部结构（除 emit-schema 的白名单内递归发射）。
 */

/** schema 白名单 def.type（zod v4 `_zod.def.type`） */
const ALLOWED_TYPES = new Set([
	"string",
	"number",
	"boolean",
	"date",
	"object",
	"array",
	"enum",
	"literal",
	"union",
	"optional",
	"nullable",
	"default",
]);

/** 白名单内 string/number 约束 check 名（zod v4 check 实例 `_zod.def.check`） */
const ALLOWED_CHECKS = new Set([
	"min_length",
	"max_length",
	"length_equals",
	"greater_than",
	"less_than",
	"multiple_of",
	"number_format",
	"string_format",
]);

export interface IrEndpoint {
	/** 契约文件里的导出名，如 "getOrderDetail" */
	name: string
	apiPrefix: string
	/** 相对 apiPrefix 的 route，如 "/item/{id}" */
	route: string
	method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"
	/** apiPrefix + route，如 "/order/item/{id}" */
	fullPath: string
	/** 参数段名（catch-all 去 *），如 ["id"] */
	paramNames: string[]
	querySchema?: unknown
	paramsSchema?: unknown
	bodySchema?: unknown
	dataSchema?: unknown
	raw: boolean
	ignoreLoading?: boolean
	description?: string
}

interface ZodLike { _zod?: { def?: Record<string, unknown> } }

function defOf(schema: unknown, where: string): Record<string, unknown> {
	const def = (schema as ZodLike)?._zod?.def;
	if (!def || typeof def.type !== "string") {
		throw new Error(`[ram-api] 契约 schema 白名单校验失败（${where}）：不是 zod schema——契约只接受 @oj-module/runtime/contract 导出的 z 构建的 schema。`);
	}
	return def;
}

/**
 * 递归白名单校验：拒绝 pipe/transform（def.type "pipe"）、refine（custom check）、
 * coerce（def.coerce）、lazy 等——它们无法保真反向发射为源码 / 无法转 OpenAPI。
 */
export function assertWhitelisted(schema: unknown, where: string): void {
	const def = defOf(schema, where);
	const type = def.type as string;
	if (!ALLOWED_TYPES.has(type)) {
		throw new Error(`[ram-api] 契约 schema 超出白名单（${where}）：类型 "${type}" 不支持。白名单：${[...ALLOWED_TYPES].join("/")}；transform/refine/coerce/pipe/lazy 无法进入契约（无法转 OpenAPI 与保真发射），请改用纯数据结构约束。`);
	}
	if (def.coerce === true) {
		throw new Error(`[ram-api] 契约 schema 超出白名单（${where}）：z.coerce.* 不支持——params/query 请直接声明语义类型（如 z.number()），URL 序列化由生成物负责。`);
	}
	for (const check of (def.checks as unknown[]) ?? []) {
		const checkName = (check as ZodLike)?._zod?.def?.check as string | undefined;
		if (checkName && !ALLOWED_CHECKS.has(checkName)) {
			throw new Error(`[ram-api] 契约 schema 超出白名单（${where}）：约束 "${checkName}" 不支持（refine/superRefine 属 custom 校验，无法转 OpenAPI）。`);
		}
	}
	if (type === "object") {
		for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) {
			assertWhitelisted(child, `${where}.${key}`);
		}
	}
	else if (type === "array") {
		assertWhitelisted(def.element, `${where}[]`);
	}
	else if (type === "union") {
		(def.options as unknown[]).forEach((opt, i) => assertWhitelisted(opt, `${where}<${i}>`));
	}
	else if (type === "optional" || type === "nullable" || type === "default") {
		assertWhitelisted(def.innerType, where);
	}
}

/**
 * route →（目录镜像 + `.route` 尾巴）切分（AC-D10 §4 算法，stub 生成与
 * --check 对账共用同一实现）：静态前缀段 → 目录；自首个参数段起的尾巴 → `.route`。
 */
export function splitRoute(route: string): { dir: string, tail?: string } {
	const segs = route.split("/").filter(Boolean);
	const firstParam = segs.findIndex(seg => seg.startsWith("{"));
	if (firstParam === -1)
		return { dir: segs.join("/") };
	return {
		dir: segs.slice(0, firstParam).join("/"),
		tail: segs.slice(firstParam).join("/"),
	};
}

/** 提取 route 参数段名（catch-all 去 * 前缀） */
function paramNamesOf(route: string): string[] {
	return route.split("/")
		.filter(seg => seg.startsWith("{"))
		.map(seg => seg.replace(/^\{\*?/, "").replace(/\}$/, ""));
}

/** evaluate 出的模块导出 → IR 端点数组 */
export function buildIr(exports: Record<string, unknown>): IrEndpoint[] {
	const endpoints: IrEndpoint[] = [];
	for (const [name, value] of Object.entries(exports)) {
		if ((value as Record<PropertyKey, unknown>)?.[API_DEF] !== true)
			continue;
		const def = value as ApiDefinitionInput;
		// schema 白名单（报错文案含端点名 + 字段路径）
		for (const slot of ["query", "params", "body", "data"] as const) {
			const schema = def[slot];
			if (schema)
				assertWhitelisted(schema, `${name}.${slot}`);
		}
		const paramNames = paramNamesOf(def.route);
		// 评审 F8：params schema 键必须覆盖 route 参数段——否则生成物 URL 插值出 undefined
		if (def.params) {
			const shape = (def.params as unknown as ZodLike)?._zod?.def?.shape as Record<string, unknown> | undefined;
			if (!shape) {
				throw new Error(`[ram-api] 契约端点 "${name}"：params 必须是 z.object（收到非 object schema）——params 与 route 参数段一一对应。`);
			}
			const missing = paramNames.filter(p => !(p in shape));
			if (missing.length) {
				throw new Error(`[ram-api] 契约端点 "${name}"：params schema 缺 route 参数段 ${missing.map(p => `{${p}}`).join("、")} 的键——两者须一一对应（缺省 params 则参数段全按 string 声明，二选一）。`);
			}
		}
		endpoints.push({
			name,
			apiPrefix: def.apiPrefix,
			route: def.route,
			method: def.method ?? "GET",
			// apiPrefix "/" 为框架内部根级端点（如 runtime 自带 role-list）——拼出 "//" 即错
			fullPath: def.apiPrefix === "/" ? def.route : `${def.apiPrefix}${def.route}`,
			paramNames,
			querySchema: def.query,
			paramsSchema: def.params,
			bodySchema: def.body,
			dataSchema: def.data,
			raw: def.response === "raw",
			ignoreLoading: def.ignoreLoading,
			description: def.description,
		});
	}

	// 同（目录, method）冲突：oj 中同一 api.ts 文件同一方法名只能有一个 handler
	const seen = new Map<string, string>();
	for (const ep of endpoints) {
		const { dir } = splitRoute(ep.route);
		const key = `${ep.apiPrefix}|${dir}|${ep.method}`;
		const existing = seen.get(key);
		if (existing) {
			throw new Error(`[ram-api] 契约路由冲突："${existing}" 与 "${ep.name}" 都映射到 ${ep.apiPrefix}/${dir}/api.ts 的 ${ep.method}——同一目录同一方法只能有一个端点（oj 一文件一方法一 handler），请调整 route 拆目录。`);
		}
		seen.set(key, ep.name);
	}
	return endpoints;
}
