/**
 * 白名单 schema → TS 源码发射器（AC-D12/D6）。
 *
 * 生成物（api.schemas.ts）里的 schema 是**重新发射的源码**而非跨树
 * import——前端模块因此保持自包含，不直接依赖契约源文件。
 * 只处理 AC-D12 白名单内的 def.type（IR 构建期已拦截白名单外 schema），
 * 遇到意料外结构时报人话错误而非静默错发。
 */

interface ZodDef { [key: string]: unknown }

function defOf(schema: unknown): ZodDef {
	const def = (schema as { _zod?: { def?: ZodDef } })?._zod?.def;
	if (!def)
		throw new Error("[ojm-api] schema 发射失败：不是 zod schema（白名单校验应已在 IR 阶段拦截，此为内部不一致）。");
	return def;
}

const IDENT = /^[a-z_$][\w$]*$/i;

/** 对象键发射：合法标识符原样，其余 JSON 引号化（emit-stub 的示例值同款复用） */
export function keyOf(name: string): string {
	return IDENT.test(name) ? name : JSON.stringify(name);
}

/** string_format → zod 方法名映射（白名单内常见格式；regex 单列） */
const STRING_FORMAT_METHOD: Record<string, string> = {
	email: "email",
	url: "url",
	uuid: "uuid",
	datetime: "datetime",
	date: "date",
	time: "time",
};

function emitChecks(type: string, def: ZodDef): string {
	let out = "";
	for (const check of (def.checks as { _zod?: { def?: ZodDef } }[]) ?? []) {
		const cd = check._zod?.def;
		if (!cd)
			continue;
		switch (cd.check) {
			case "min_length":
				out += `.min(${cd.minimum})`;
				break;
			case "max_length":
				out += `.max(${cd.maximum})`;
				break;
			case "length_equals":
				out += `.length(${cd.length})`;
				break;
			case "greater_than":
				out += cd.inclusive === false ? `.gt(${cd.value})` : `.min(${cd.value})`;
				break;
			case "less_than":
				out += cd.inclusive === false ? `.lt(${cd.value})` : `.max(${cd.value})`;
				break;
			case "multiple_of":
				out += `.multipleOf(${cd.value})`;
				break;
			case "number_format":
				if (cd.format === "safeint")
					out += ".int()";
				break;
			case "string_format": {
				if (cd.format === "regex") {
					const pattern = cd.pattern as RegExp;
					// 评审 F10：flags 丢失即语义削弱——不可保真，拒绝而非静默降级
					if (pattern.flags && pattern.flags !== "u")
						throw new Error(`[ojm-api] schema 发射失败：regex /${pattern.source}/${pattern.flags} 带 flags 无法保真发射（白名单只支持无 flags 形态）。`);
					out += `.regex(/${pattern.source}/)`;
					break;
				}
				const method = STRING_FORMAT_METHOD[cd.format as string];
				if (!method) {
					throw new Error(`[ojm-api] schema 发射失败：string format "${String(cd.format)}" 不在可保真映射（${Object.keys(STRING_FORMAT_METHOD).join("/")}）——静默放宽校验违背白名单「检出即报错」，请改用已支持格式或纯 string。`);
				}
				out += `.${method}()`;
				break;
			}
			default:
				break;
		}
	}
	return out;
}

/** 递归发射 schema 为 z 调用链源码 */
export function emitSchemaSource(schema: unknown): string {
	const def = defOf(schema);
	const type = def.type as string;
	switch (type) {
		case "string":
			return `z.string()${emitChecks(type, def)}`;
		case "number":
			return `z.number()${emitChecks(type, def)}`;
		case "boolean":
			return "z.boolean()";
		case "date":
			// 评审 F1：线上传输本就是 ISO 串（emit-meta/mock/stub 三链一致），
			// z.date() 期望 Date 实例会让 dev 校验对线上数据必误报——发 z.iso.datetime()
			return "z.iso.datetime()";
		case "literal": {
			const values = def.values as unknown[];
			return `z.literal(${values.length === 1 ? JSON.stringify(values[0]) : JSON.stringify(values)})`;
		}
		case "enum":
			return `z.enum(${JSON.stringify(Object.keys(def.entries as object))})`;
		case "union":
			return `z.union([${(def.options as unknown[]).map(emitSchemaSource).join(", ")}])`;
		case "array":
			// min/max 等长度约束同样保真发射（评审 F10：此前静默丢弃）
			return `z.array(${emitSchemaSource(def.element)})${emitChecks(type, def)}`;
		case "object": {
			const entries = Object.entries(def.shape as Record<string, unknown>)
				.map(([k, v]) => `\n\t${keyOf(k)}: ${emitSchemaSource(v).replaceAll("\n", "\n\t")},`);
			return `z.object({${entries.join("")}\n})`;
		}
		case "optional":
			return `${emitSchemaSource(def.innerType)}.optional()`;
		case "nullable":
			return `${emitSchemaSource(def.innerType)}.nullable()`;
		case "default": {
			const value = def.defaultValue;
			if (typeof value === "function" || JSON.stringify(value) === undefined) {
				throw new Error("[ojm-api] schema 发射失败：default 值必须是 JSON 可序列化字面量（函数/undefined 不支持）。");
			}
			return `${emitSchemaSource(def.innerType)}.default(${JSON.stringify(value)})`;
		}
		default:
			throw new Error(`[ojm-api] schema 发射失败：类型 "${type}" 不在白名单（应在 IR 阶段被拦截，此为内部不一致）。`);
	}
}
