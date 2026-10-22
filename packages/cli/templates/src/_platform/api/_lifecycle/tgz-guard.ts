// tgz 成员守卫（R1）：zip-slip 防护的校验核，纯函数、无依赖。
// 输入契约：`tar -tvzf` 的逐行输出（P1-6 extract 步骤必须喂 verbose 形态；
// 非 verbose `tar -tzf` 是裸成员名，首字符会撞 l/h 误拒——勿换）。
// 条目类型取权限串首字符（l=symlink、h=hardlink）；symlink 行成员名取 ` -> ` 左侧。
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
		// 成员名并非可靠来源：bsdtar 成员名可含空格，`../evil` 可藏在中段 token 里。
		// 路径检查覆盖行的全部空白分隔 token（日期/时刻 token 不含 `..`，不误杀）；
		// 任一 token 以 `/` 开头即拒（封「空格名 `/etc x`」形态）。
		// `C:/x` 这类盘符前缀不拒：POSIX 下是合法相对目录名、无逃逸力，反斜杠形态才拒。
		for (const token of line.split(/\s+/)) {
			if (token === "")
				continue;
			if (token.startsWith("/") || token.includes("\\"))
				return { ok: false, offender: token };
			if (token.split("/").includes(".."))
				return { ok: false, offender: token };
		}
	}
	return { ok: true };
}
