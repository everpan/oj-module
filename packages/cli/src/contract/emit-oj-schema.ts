import type { IrEndpoint } from "./ir";

/**
 * IR 的 JSON Schema（oj `openapi.json` 白名单子集）→ oj 的 `.schema` 入参契约
 * （oj v0.1.44，手册 §4）。
 *
 * 这是「openapi.json → 前端 client + 后端入参校验」的最后一环：契约里声明的
 * query/params/body 不只生成前端类型与校验，也落成后端 handler 的 `.schema`，
 * 由 oj 在 **JS 之前**校验（违反即 400，handler 不执行）。
 *
 * 关键字白名单（oj 侧，白名单外装配期 fail-fast）：
 *   type / required / properties / items / additionalProperties / minimum /
 *   maximum / minLength / maxLength / pattern / enum / nullable / minItems / maxItems
 * 所以发射时必须**主动裁剪**到这个子集。
 *
 * 输入是 IR 里的 JSON Schema 对象（来自 openapi.json），而非 zod——翻译层退役后
 * 单一事实源即 openapi.json，本模块只做「JSON Schema 白名单裁剪」这一件事。
 */

/** oj `.schema` 的入参通道（对应 http.params / http.query / http.body） */
export type OjSchemaChannel = "params" | "query" | "body";

/** params/query 在 HTTP 里只有字符串形态：只允许扁平标量，array/object 是死契约 */
const FLAT_SCALARS = new Set(["string", "number", "integer", "boolean", "null"]);

/** 发射期收集的诊断：降级（约束无法表达）必须说出来，不能静默丢 */
export interface OjSchemaDiag {
	warnings: string[]
}

function numOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Rust regex（oj 用）不是 ECMAScript：不支持 lookahead / lookbehind / 反向引用。
 * openapi.json 来自 oj 自身时本就合规；但用户手写 openapi.json 可能带 JS 专属写法——
 * 这里在**生成期**拦下，避免把服务拖到装配期才 fail-fast。
 */
function assertRustCompatiblePattern(pattern: string, where: string, diag: OjSchemaDiag): void {
	if (/\(\?[=!]|\(\?<[=!]/.test(pattern)) {
		diag.warnings.push(`${where}：pattern 用了零宽断言（lookahead/lookbehind），oj 的 pattern 是 Rust regex 不支持——已跳过该约束（前端 zod 校验不受影响）。`);
	}
	if (/\\\{[1-9]/.test(pattern)) {
		diag.warnings.push(`${where}：pattern 用了反向引用（\\1…\\9），oj 的 pattern 是 Rust regex 不支持——已跳过。`);
	}
}

/** params/query 通道：只允许扁平标量，array/object 是永远无法满足的死契约 */
function assertFlatScalars(schema: Record<string, unknown> | undefined, where: string): void {
	if (!schema || schema.type !== "object" || typeof schema.properties !== "object")
		return;
	for (const [key, child] of Object.entries(schema.properties as Record<string, unknown>)) {
		const type = (child as { type?: string }).type;
		if (type && !FLAT_SCALARS.has(type)) {
			throw new Error(
				`[ojm-api] 契约 ${where}.${key}：params/query 通道只允许扁平标量（string/number/integer/boolean/null），收到 "${type}"——`
				+ "params/query 在 HTTP 里只有字符串形态，声明 array/object 是永远无法满足的死契约（oj 装配期即拒）。",
			);
		}
	}
}

/**
 * JSON Schema → oj `.schema` 裁剪（递归）。
 * 返回裁剪后的对象；若整个 schema 无可表达约束返回 undefined。
 * 类型数组 ["x","null"] → {type:"x", nullable:true}；非单实类型联合（["string","number"]）
 * → 告警并丢弃该字段（oj 白名单无 oneOf/anyOf，后端不校验，前端 zod 不受影响）。
 */
function convert(schema: unknown, where: string, diag: OjSchemaDiag): Record<string, unknown> | undefined {
	if (!schema || typeof schema !== "object")
		return undefined;
	const s = schema as Record<string, unknown>;
	const out: Record<string, unknown> = {};

	// 类型：数组形态 = union / nullable 展开
	const rawType = s.type;
	let type: string | undefined;
	let nullable = false;
	if (Array.isArray(rawType)) {
		const nonNull = rawType.filter((t): t is string => t !== "null");
		if (nonNull.length === 1) {
			type = nonNull[0];
			nullable = rawType.includes("null");
		}
		else {
			diag.warnings.push(`${where}：联合类型 ${JSON.stringify(rawType)} 无法进 oj .schema（白名单无 oneOf/anyOf），该字段在后端不做入参校验；前端 zod 校验不受影响。`);
			return undefined;
		}
	}
	else if (typeof rawType === "string") {
		type = rawType;
	}

	if (type)
		out.type = type;
	if (nullable)
		out.nullable = true;

	// format 是 JSON Schema 专有键，oj 白名单无——静默跳过会削弱校验，故告警
	if (typeof s.format === "string") {
		diag.warnings.push(`${where}：format "${s.format}" 不在 oj .schema 白名单，已跳过（后端不校验该格式约束；需要后端强校验请改用 .regex()，Rust regex 写法）。`);
	}

	// 对象：递归裁剪每个属性；required 仅保留「确有可表达约束」的键（避免空 required）
	if (type === "object" || (type === undefined && s.properties)) {
		const props = s.properties as Record<string, unknown> | undefined;
		if (props) {
			const properties: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(props)) {
				const child = convert(v, `${where}.${k}`, diag);
				if (child !== undefined)
					properties[k] = child;
			}
			if (Object.keys(properties).length) {
				out.properties = properties;
				const required = ((s.required as string[]) ?? []).filter(k => k in properties);
				if (required.length)
					out.required = required;
			}
		}
	}

	// 数组：递归裁剪 items
	if (type === "array" && s.items) {
		const items = convert(s.items, `${where}[]`, diag);
		if (items !== undefined)
			out.items = items;
	}

	// 字面量联合已转 enum（oj 支持）
	if (Array.isArray(s.enum))
		out.enum = s.enum;

	// 数值 / 字符串 / 数组 边界约束（白名单内）
	for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const) {
		const v = numOf(s[key]);
		if (v !== undefined)
			out[key] = v;
	}

	if (typeof s.pattern === "string") {
		assertRustCompatiblePattern(s.pattern, where, diag);
		out.pattern = s.pattern;
	}
	if (typeof s.additionalProperties === "boolean")
		out.additionalProperties = s.additionalProperties;
	// default 纯注解：oj 不补值，但保留做文档/后端语义提示无害
	if (s.default !== undefined)
		out.default = s.default;

	return Object.keys(out).length > 0 ? out : undefined;
}

/** 端点 → oj `.schema` 三通道（无声明的通道不出现）；附带降级诊断 */
export function ojSchemaOfEndpoint(ep: IrEndpoint, diag: OjSchemaDiag = { warnings: [] }): Record<string, unknown> | undefined {
	const out: Record<string, unknown> = {};
	const channels: [OjSchemaChannel, unknown][] = [
		["params", ep.paramsSchema],
		["query", ep.querySchema],
		["body", ep.bodySchema],
	];
	for (const [channel, schema] of channels) {
		if (!schema)
			continue;
		const where = `${ep.name}.${channel}`;
		const converted = convert(schema, where, diag);
		if (channel !== "body")
			assertFlatScalars(converted, where);
		// 空对象 = 该通道无可表达约束，不写（写了 oj 会当「任意对象」收下，反而弱于不声明）
		if (converted && Object.keys(converted).length > 0)
			out[channel] = converted;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** 发射成 stub 里的赋值语句源码（`get.schema = {...};`）；无声明返回空串 */
export function emitOjSchemaLine(ep: IrEndpoint, method: string, diag?: OjSchemaDiag): string {
	const schema = ojSchemaOfEndpoint(ep, diag);
	if (!schema)
		return "";
	return `${method}.schema = ${JSON.stringify(schema, null, "\t")};\n`;
}
