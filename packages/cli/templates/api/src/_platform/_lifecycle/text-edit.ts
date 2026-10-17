// config.yaml 文本锚点编辑（R18）：安装器改写用户 config.yaml 的唯一手段。
// 禁止 yaml 解析/stringify 回写——用户注释、缩进、空行、键序必须逐字保留，
// 因此只做文本级行操作：锚点是整行注释（如 `# ojm:mount`），块插入其下一行。
// 匹配口径：整行 trim 后相等才算已存在（子串出现不算，防误判幂等）。

export function hasAnchor(content: string, anchor: string): boolean {
	const target = anchor.trim();
	return content.split("\n").some(line => line.trim() === target);
}

export function insertAnchor(content: string, anchorComment: string, block: string): string {
	const target = anchorComment.trim();
	const lines = content.split("\n");
	const index = lines.findIndex(line => line.trim() === target);
	if (index === -1) {
		throw new Error(`text-edit: config.yaml 中未找到锚点注释行「${anchorComment}」，无法插入内容块`);
	}
	// 幂等：锚点的下一行已与本块首行相同（上次插入的痕迹）则原样返回，
	// 二次调用 no-op。判定只看紧邻一行（trim 后比较，兼容缩进继承）；
	// 用户在锚点与块之间手工加行后重跑会再插一次——不猜意图，宁重不漏。
	const firstBlock = block.split("\n")[0].trim();
	if (lines[index + 1] !== undefined && lines[index + 1].trim() === firstBlock) {
		return content;
	}
	// 缩进继承锚点行：块的每个非空行前缀锚点行缩进，空行保持为空（不留尾随空白）
	const indent = /^\s*/.exec(lines[index])?.[0] ?? "";
	const blockLines = block.split("\n").map(line => (line === "" ? "" : indent + line));
	lines.splice(index + 1, 0, ...blockLines);
	return lines.join("\n");
}
