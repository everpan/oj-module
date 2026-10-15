import type { JsonSchema } from "./openapi-ir";

/**
 * JSON Schema（oj `.schema` 白名单子集）→ zod 源码表达式。
 *
 * 单一职责（SRP）：只把 openapi.json 里的 JSON Schema 翻成 zod 源码字符串，不碰 IR / 文件 IO。
 *
 * 安全铁律（来自安全评审）：
 * 1. 所有动态字符串（属性名 / enum 值 / default 值 / pattern / 路径）一律 `jsonLit`（JSON.stringify）
 *    嵌入**普通字符串字面量**，绝不走模板插值——openapi.json 值是任意 JSON 字符串，可含反引号、
 *    斜杠星、换行、模板插值符，模板插值会破坏产物或注入。
 * 2. `pattern` 不进运行时 `z.regex`：oj 的 pattern 是 Rust regex（线性引擎），JS `RegExp` 是回溯
 *    引擎——原样执行既有 ReDoS 灾难性回溯风险，又有 Rust 拒/JS 放行的语义漂移。仅发 `// @oj-warn`
 *    注释（用 `//` 行注释，pattern 经 JSON.stringify 已是单行转义串，安全）。
 * 3. `default` 不射 `.default()`：oj 运行期不为缺参补默认值，前端若补会让可选字段变必填、掩盖契约
 *    漂移。仅发 `// @oj-note` 注释。
 * 4. 白名单外关键字 fail-fast（绝不静默降级）；`required` 项可不在 `properties` 中（JSON Schema 允许），
 *    取值前先判存在（缺失键直接跳过）。
 */

/** oj `.schema` 白名单关键字（openapi-guide §2.6），其余 fail-fast */
const ALLOWED_KEYWORDS = new Set([
	"type",
	"required",
	"properties",
	"items",
	"additionalProperties",
	"minimum",
	"maximum",
	"minLength",
	"maxLength",
	"pattern",
	"enum",
	"nullable",
	"minItems",
	"maxItems",
	"default",
]);

/** 任意 JSON 值 → 源码安全字面量（字符串/数字/布尔/null 一律 JSON.stringify） */
function jsonLit(v: unknown): string {
	return JSON.stringify(v);
}

function fail(where: string, msg: string): never {
	throw new Error(`[ojm-api] openapi→zod 失败（${where}）：${msg}`);
}

/**
 * enum → zod 基础表达式：全字符串用 `z.enum([...])`，否则（数值/布尔/混合）用
 * `z.union([z.literal(...)])`。注意 enum 是**独立基础类型**，绝不能挂在 `z.string()`/
 * `z.number()` 之后（`z.string().enum()` 在 zod 里不存在）——故此处返回完整表达式，
 * 由 emitScalar 作为 base 使用，而非作为检查链追加。
 */
function emitEnum(values: unknown[], _where: string): string {
	const allString = values.every(v => typeof v === "string");
	if (allString)
		return `z.enum([${values.map(jsonLit).join(", ")}])`;
	return `z.union([${values.map(v => `z.literal(${jsonLit(v)})`).join(", ")}])`;
}

/**
 * JSON Schema type → zod 基础表达式，并**统一**叠加标量约束（min/max）与
 * nullable（借鉴 json-schema-to-zod 的「基础类型 + 修饰符」结构）。
 *
 * 关键修正（对照 json-schema-to-zod 映射表补齐口径内缺口）：
 * - enum 优先作为 base（见 emitEnum）：挂在 `z.string()` 后（`z.string().enum()`）
 *   在 zod 里不存在，是运行期 TypeError 根因。
 * - object/array 也走 base + checks 合并，故 `nullable:true` 对对象/数组同样生效
 *   （旧实现 object/array 提前 return，导致对象/数组的 nullable 被静默丢弃）。
 * - pattern/default 仍只发注释（Rust regex 不进运行时 / oj 运行期不补值），不射进 zod。
 */
function emitScalar(type: string, schema: JsonSchema, where: string): string {
	// enum 是独立基础类型（z.enum / z.union），不得追加到 typed base 之后
	if (Array.isArray(schema.enum))
		return emitEnumWithNullable(schema.enum, schema, where);

	let base: string;
	switch (type) {
		case "string":
			base = "z.string()";
			break;
		case "number":
			base = "z.number()";
			break;
		case "integer":
			base = "z.number().int()";
			break;
		case "boolean":
			base = "z.boolean()";
			break;
		case "null":
			base = "z.null()";
			break;
		case "object":
			base = emitObject(schema, where);
			break;
		case "array":
			base = emitArray(schema, where);
			break;
		default:
			fail(where, `未知 type "${type}"`);
	}

	const checks: string[] = [];
	if (type === "string") {
		if (typeof schema.minLength === "number")
			checks.push(`.min(${schema.minLength})`);
		if (typeof schema.maxLength === "number")
			checks.push(`.max(${schema.maxLength})`);
	}
	else if (type === "number" || type === "integer") {
		if (typeof schema.minimum === "number")
			checks.push(`.min(${schema.minimum})`);
		if (typeof schema.maximum === "number")
			checks.push(`.max(${schema.maximum})`);
	}
	if (schema.nullable === true)
		checks.push(".nullable()");

	let out = `${base}${checks.join("")}`;
	// pattern：Rust regex，不进运行时（ReDoS + 语义漂移），仅注释
	if (typeof schema.pattern === "string")
		out = `// @oj-warn: pattern=${jsonLit(schema.pattern)} 为 Rust regex，未在前端执行（跨语言语义漂移/ReDoS 风险）\n\t${out}`;
	// default：oj 运行期不补值，仅文档注释
	if (schema.default !== undefined)
		out = `// @oj-note: default=${jsonLit(schema.default)}（oj 不补值，仅文档）\n\t${out}`;
	return out;
}

/** enum 基础表达式 + nullable（enum 无法叠加 min/max，仅 nullable 有意义） */
function emitEnumWithNullable(values: unknown[], schema: JsonSchema, where: string): string {
	let out = emitEnum(values, where);
	if (schema.nullable === true)
		out += ".nullable()";
	if (typeof schema.pattern === "string")
		out = `// @oj-warn: pattern=${jsonLit(schema.pattern)} 为 Rust regex，未在前端执行（跨语言语义漂移/ReDoS 风险）\n\t${out}`;
	if (schema.default !== undefined)
		out = `// @oj-note: default=${jsonLit(schema.default)}（oj 不补值，仅文档）\n\t${out}`;
	return out;
}

/**
 * object → zod。除 properties/required 外，处理 additionalProperties 三态
 * （借鉴 json-schema-to-zod 映射）：
 * - `false` → `.strict()`（仅声明属性，拒额外键）
 * - `true`  → `.catchall(z.unknown())`（任意额外键放行；对应 oj 未限制额外字段）
 * - schema  → `.catchall(emitZod(schema))`（额外键须符合该子 schema）
 * `.strict()` 与 `.catchall()` 在 zod 互斥，三者择一。
 */
function emitObject(schema: JsonSchema, where: string): string {
	const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
	const required: string[] = Array.isArray(schema.required) ? schema.required : [];
	const members = Object.entries(props).map(([name, sub]) => {
		const expr = emitZodFromJsonSchema(sub, `${where}.${name}`);
		const opt = required.includes(name) ? "" : ".optional()";
		return `\t${jsonLit(name)}: ${expr}${opt}`;
	});
	let out = `z.object({\n${members.join(",\n")}\n})`;
	const ap = schema.additionalProperties;
	if (ap === false)
		out += ".strict()";
	else if (ap === true)
		out += ".catchall(z.unknown())";
	else if (ap && typeof ap === "object")
		out += `.catchall(${emitZodFromJsonSchema(ap as JsonSchema, `${where}<additionalProperties>`)})`;
	return out;
}

function emitArray(schema: JsonSchema, where: string): string {
	const items = schema.items as JsonSchema | undefined;
	const itemExpr = items ? emitZodFromJsonSchema(items, `${where}[]`) : "z.unknown()";
	let out = `z.array(${itemExpr})`;
	if (typeof schema.minItems === "number")
		out += `.min(${schema.minItems})`;
	if (typeof schema.maxItems === "number")
		out += `.max(${schema.maxItems})`;
	return out;
}

/** JSON Schema → zod 源码表达式（如 `z.object({...})`） */
export function emitZodFromJsonSchema(schema: JsonSchema, where: string): string {
	if (!schema || typeof schema !== "object")
		return "z.unknown()";
	for (const k of Object.keys(schema)) {
		if (!ALLOWED_KEYWORDS.has(k))
			fail(where, `不支持的关键字 "${k}"（oj .schema 白名单之外，绝不静默降级）`);
	}
	const type = schema.type;
	if (Array.isArray(type)) {
		const nonNull = type.filter((t): t is string => t !== "null");
		// 单实类型 + null = nullable（["string","null"] 标准写法）
		if (nonNull.length === 1) {
			const expr = emitScalar(nonNull[0], schema, where);
			return type.includes("null") ? `${expr}.nullable()` : expr;
		}
		// 多实类型（如 oj 把 z.union([z.string(),z.number()]) 翻成 ["string","number"]）：
		// 映射为 z.union，nullable 叠加在外层。oj 产物确有此形状，codegen 必须兜住。
		const members = nonNull.map(t => emitScalar(t, schema, where));
		let out = `z.union([${members.join(", ")}])`;
		if (type.includes("null"))
			out += ".nullable()";
		return out;
	}
	if (typeof type === "string")
		return emitScalar(type, schema, where);
	// 无 type（仅 enum 等少见情形）：oj 产物总有 type，保守退回 unknown
	return "z.unknown()";
}
