// tgz 成员守卫（R1）：zip-slip 防护的校验核，纯函数、无依赖。
// 输入契约：`tar -tvzf` 的逐行输出（P1-6 extract 步骤喂 `tar -tzf` 同型输出）。
// 成员名取行内最后一个空格分隔字段；条目类型取权限串首字符（l=symlink、h=hardlink）；
// symlink 行成员名取 ` -> ` 左侧（右侧是链接目标）。
// 拒绝：绝对路径、任何 `..` 段、l/h 条目、空成员名、反斜杠路径（防御性）；
// `./` 前缀视为相对合法（归一化后必须在包根内）。

function extractMemberName(line: string): string {
	const arrow = line.indexOf(" -> ");
	const entry = arrow === -1 ? line : line.slice(0, arrow);
	const trimmed = entry.trim();
	if (trimmed === "")
		return "";
	const fields = trimmed.split(/\s+/);
	return fields[fields.length - 1];
}

export function validateTarListing(lines: string[]): { ok: true } | { ok: false, offender: string } {
	for (const line of lines) {
		const name = extractMemberName(line);
		// 空成员名：退化行（空行/无名字段）一律拒绝，安全边界不做容错
		if (name === "")
			return { ok: false, offender: "" };
		const type = line.trimStart()[0];
		if (type === "l" || type === "h")
			return { ok: false, offender: name };
		// Windows 风格路径（含 `\`）与绝对路径防御性拒绝
		if (name.includes("\\") || name.startsWith("/"))
			return { ok: false, offender: name };
		const normalized = name.replace(/^\.\//, "");
		if (normalized.split("/").includes(".."))
			return { ok: false, offender: name };
	}
	return { ok: true };
}
