/**
 * JSON Schema（oj `openapi.json` 白名单子集）→ 示例值。
 *
 * 零依赖（不引入 faker，保证 emit-stub 复用时不与 mock 形成循环依赖）：
 * 示例值**确定性**生成，便于 stub / mock 字节稳定。仅覆盖 oj `.schema` 表达力
 * （type / properties / items / enum / min / max / minLength / maxLength）；
 * `pattern` 是 Rust regex，无法表达，忽略（示例值不强制满足 pattern）。
 *
 * 语义与 emit-stub 的示例源码生成共用同一套（emit-stub 用 JSON.stringify 把返回值
 * 包成 TS 字面量）。
 */

function numOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 类型数组 ["string","null"] → 取非 null 实类型；其余返回 undefined（无法取样本） */
function singleTypeOf(type: unknown): string | undefined {
	if (typeof type === "string")
		return type;
	if (Array.isArray(type)) {
		const nonNull = (type as unknown[]).filter(t => t !== "null");
		return nonNull.length === 1 ? (nonNull[0] as string) : undefined;
	}
	return undefined;
}

export function jsonSchemaToSample(schema: unknown): unknown {
	if (!schema || typeof schema !== "object")
		return null;
	const s = schema as Record<string, unknown>;
	// enum 优先：oj 把 zod enum 翻成 {type, enum}，示例值应取枚举首值（而非「示例」占位），
	// 否则 mock/client 示例值永远偏离真实取值。
	if (Array.isArray(s.enum) && s.enum.length > 0)
		return s.enum[0];
	const type = singleTypeOf(s.type);

	switch (type) {
		case "string": {
			const min = numOf(s.minLength) ?? 0;
			const max = numOf(s.maxLength) ?? Number.POSITIVE_INFINITY;
			// 默认「示例」恰好 2 字：低于 min 则补足，高于 max 则截断（保约束成立）
			let word = "示例";
			if (word.length < min)
				word = "示".repeat(Math.max(min, 1));
			if (Number.isFinite(max) && word.length > max)
				word = word.slice(0, max);
			return word;
		}
		case "integer":
		case "number": {
			const min = numOf(s.minimum) ?? 1;
			const lo = Number.isFinite(min) ? Math.ceil(min) : 1;
			return lo;
		}
		case "boolean":
			return true;
		case "array":
			return [jsonSchemaToSample(s.items)];
		case "object": {
			const out: Record<string, unknown> = {};
			const props = (s.properties as Record<string, unknown>) ?? {};
			for (const [k, v] of Object.entries(props))
				out[k] = jsonSchemaToSample(v);
			return out;
		}
		default:
			if (Array.isArray(s.enum) && s.enum.length > 0)
				return s.enum[0];
			return null;
	}
}
