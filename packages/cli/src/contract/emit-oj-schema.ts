import type { IrEndpoint } from "./ir";

/**
 * 契约 schema → oj 的 `.schema` 入参契约（oj v0.1.44，手册 §4）。
 *
 * 这是「一份契约 → 前端 client + 后端入参校验」的最后一环：契约里声明的
 * query/params/body 不只生成前端类型与校验，也落成后端 handler 的 `.schema`，
 * 由 oj 在 **JS 之前**校验（违反即 400，handler 不执行）。
 *
 * 关键字白名单（oj 侧，白名单外装配期 fail-fast）：
 *   type / required / properties / items / additionalProperties / minimum /
 *   maximum / minLength / maxLength / pattern / enum / nullable / minItems / maxItems
 * 所以发射时必须**主动裁剪**到这个子集——把 `format` / `oneOf` 之类原样写出去，
 * 服务根本起不来。
 */

/** oj `.schema` 的入参通道（对应 http.params / http.query / http.body） */
export type OjSchemaChannel = "params" | "query" | "body";

/** params/query 在 HTTP 里只有字符串形态：只允许扁平标量，array/object 是死契约 */
const FLAT_SCALARS = new Set(["string", "number", "integer", "boolean", "null"]);

interface ZodDefLike {
	type?: string
	shape?: Record<string, unknown>
	element?: unknown
	options?: unknown[]
	innerType?: unknown
	entries?: Record<string, unknown>
	values?: unknown[]
	checks?: { _zod?: { def?: Record<string, unknown> } }[]
	pattern?: unknown
}

function defOf(schema: unknown): ZodDefLike | undefined {
	return (schema as { _zod?: { def?: ZodDefLike } })?._zod?.def;
}

/** 发射期收集的诊断：降级（约束无法表达）必须说出来，不能静默丢 */
export interface OjSchemaDiag {
	warnings: string[]
}

function typeNameOf(value: unknown): "string" | "number" | "boolean" | "null" {
	if (typeof value === "string")
		return "string";
	if (typeof value === "number")
		return "number";
	if (typeof value === "boolean")
		return "boolean";
	return "null";
}

/**
 * Rust regex（oj 用）不是 ECMA-262：不支持 lookahead / lookbehind / 反向引用。
 * 这里在**生成期**拦下，避免把服务拖到装配期才 fail-fast。
 */
function assertRustCompatiblePattern(pattern: string, where: string): void {
	if (/\(\?[=!]|\(\?<[=!]/.test(pattern)) {
		throw new Error(
			`[ojm-api] 契约 ${where} 的 pattern 用了零宽断言（lookahead/lookbehind）：oj 的 pattern 是 Rust regex，不支持——请改写成等价的非断言表达式，或去掉该约束。`,
		);
	}
	if (/\\[1-9]/.test(pattern)) {
		throw new Error(
			`[ojm-api] 契约 ${where} 的 pattern 用了反向引用（\\1…\\9）：oj 的 pattern 是 Rust regex，不支持——请改写。`,
		);
	}
}

/** zod 约束 → oj 白名单内的约束键（无法表达的返回 undefined 并记诊断） */
function constraintsOf(def: ZodDefLike, where: string, diag: OjSchemaDiag): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const check of def.checks ?? []) {
		const cd = check._zod?.def ?? {};
		switch (cd.check) {
			case "min_length":
				out[def.type === "array" ? "minItems" : "minLength"] = cd.minimum;
				break;
			case "max_length":
				out[def.type === "array" ? "maxItems" : "maxLength"] = cd.maximum;
				break;
			case "greater_than":
				out.minimum = cd.inclusive === false ? (cd.value as number) : cd.value;
				break;
			case "less_than":
				out.maximum = cd.inclusive === false ? (cd.value as number) : cd.value;
				break;
			case "string_format": {
				// 两种情况都挂在 string_format 下，必须分开：
				//  · 内置格式（email/uuid/url…，有 format）：format 不在 oj 白名单（写了服务起不来），
				//    且其自带 pattern 含零宽断言，Rust regex 也拒——整条跳过。
				//  · 用户 .regex(re)（无 format、只有 pattern）：可发射，但须是 Rust 兼容写法。
				//  · 用户 .regex(re)：zod v4 也挂在 string_format 下，但 format 值是字面 "regex"
				const isUserRegex = cd.format === "regex";
				if (isUserRegex) {
					const source = cd.pattern instanceof RegExp ? cd.pattern.source : typeof cd.pattern === "string" ? cd.pattern : undefined;
					if (source) {
						assertRustCompatiblePattern(source, where);
						out.pattern = source;
					}
					break;
				}
				if (cd.format) {
					diag.warnings.push(`${where}：z.string().${String(cd.format)}() 的格式约束无法进 oj .schema（白名单无 format），已在后端跳过——需要后端强校验请改用 .regex()（Rust regex 写法）。`);
					break;
				}
				break;
			}
			case "number_format":
				// z.int() / z.number().int() → safeint：oj 侧对应 integer（影响 params/query 的字符串强转）
				if (cd.format === "safeint" || cd.format === "int")
					out.type = "integer";
				else
					diag.warnings.push(`${where}：number_format "${String(cd.format)}" 无法进 oj .schema，已跳过。`);
				break;
			case "multiple_of":
				diag.warnings.push(`${where}：multipleOf 约束不在 oj .schema 白名单，已跳过。`);
				break;
			default:
				break;
		}
	}
	return out;
}

/** 递归：zod schema → oj `.schema` 片段（裁剪到白名单） */
function convert(schema: unknown, where: string, diag: OjSchemaDiag): Record<string, unknown> {
	const def = defOf(schema);
	if (!def || !def.type)
		throw new Error(`[ojm-api] 契约 ${where} 不是 zod schema，无法转 oj .schema。`);

	switch (def.type) {
		case "object": {
			const properties: Record<string, unknown> = {};
			const required: string[] = [];
			for (const [key, child] of Object.entries(def.shape ?? {})) {
				const childDef = defOf(child);
				properties[key] = convert(child, `${where}.${key}`, diag);
				// optional / default 有缺省值 → 非必填；nullable 语义单独用 nullable 表达
				if (childDef?.type !== "optional" && childDef?.type !== "default")
					required.push(key);
			}
			const out: Record<string, unknown> = { type: "object", properties };
			if (required.length)
				out.required = required;
			return out;
		}
		case "array": {
			const out: Record<string, unknown> = { type: "array", items: convert(def.element, `${where}[]`, diag) };
			return { ...out, ...constraintsOf(def, where, diag) };
		}
		case "enum": {
			const values = Object.keys(def.entries ?? {});
			return { type: typeNameOf((def.entries ?? {})[values[0]]), enum: values };
		}
		case "literal": {
			const value = (def.values ?? [])[0];
			return { type: typeNameOf(value), enum: [value] };
		}
		case "union": {
			// 白名单无 oneOf/anyOf：全字面量联合 → enum 等价表达；否则降级为空约束
			const options = def.options ?? [];
			const literals = options.map(opt => defOf(opt)?.values?.[0]).filter(v => v !== undefined);
			if (literals.length === options.length && literals.length > 0) {
				return { type: typeNameOf(literals[0]), enum: literals };
			}
			diag.warnings.push(`${where}：union 无法进 oj .schema（白名单无 oneOf/anyOf），该字段在后端不做入参校验——前端 zod 校验不受影响。`);
			return {};
		}
		case "nullable": {
			const inner = convert(def.innerType, where, diag);
			return { ...inner, nullable: true };
		}
		case "optional":
		case "default":
			return convert(def.innerType, where, diag);
		case "date":
			// JSON 无日期类型：线上是 ISO 串，后端按 string 校验
			return { type: "string" };
		case "string":
		case "number":
		case "boolean": {
			const out: Record<string, unknown> = { type: def.type };
			return { ...out, ...constraintsOf(def, where, diag) };
		}
		default:
			diag.warnings.push(`${where}：zod 类型 "${def.type}" 无法转 oj .schema，该字段在后端不做入参校验。`);
			return {};
	}
}

/** params/query 通道：只允许扁平标量，array/object 是永远无法满足的死契约 */
function assertFlatScalars(schema: Record<string, unknown>, where: string): void {
	if (schema.type === "object" && typeof schema.properties === "object") {
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
		if (Object.keys(converted).length > 0)
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
