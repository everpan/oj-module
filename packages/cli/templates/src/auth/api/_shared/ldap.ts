// LDAP 纯函数（无全局依赖，L2 直测）：filter 转义 + 属性首值提取。D1/PRD §4.5 红线移植 wiki。
// 转义红线：axis("ldap") 的 filter 是拼进目录查询的原始 RFC 4515 字符串，**无参数绑定**——
// 用户输入拼进 filter 前必须转义（oj-bin docs/api/13-ldap.md「filter 注入」红线）。

/** RFC 4515 转义：`*` `(` `)` `\` NUL → `\hh`（两位十六进制）。 */
export function esc(s: string): string {
	return String(s).replace(/[*(\\)\0]/g, c => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** 属性首值（LDAP 多值属性取第一项；缺失/空数组 → 空串）。 */
export function firstAttr(attrs: Record<string, string[]> | undefined, name: string): string {
	const v = attrs?.[name];
	return Array.isArray(v) && v.length > 0 ? String(v[0]) : "";
}
