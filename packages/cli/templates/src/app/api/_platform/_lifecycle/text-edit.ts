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

/**
 * D3 一次性注入集收口（P1-10，裁决 7 escape hatch；S1-1 实测定稿「安装无需改 mounts」——
 * 注入集只剩 server.reload_api: true，R18）。纯文本判定，不引 yaml 解析：
 * - 存在 reload_api 键：值 false → 拒绝（用户主动关闭热更端点，安装器不偷偷翻转语义值）；
 *   其余（true 等）→ no-op 幂等；
 * - 键不存在 → 锚点 `# ojm:reload` 下插入 `reload_api: true`（insertAnchor 语义：缩进继承、
 *   注释逐字保留；锚点缺失 = 可读报错不猜位置——锚点随模板 config.yaml 发布，P1-16 接线点）。
 */
export function ensureReloadApi(content: string): { content: string, changed: boolean } {
	const lines = content.split("\n");
	const idx = lines.findIndex(l => /^\s*reload_api\s*:/.test(l));
	if (idx !== -1) {
		if (/^\s*reload_api\s*:\s*false\s*(?:#.*)?$/.test(lines[idx]!)) {
			throw new Error("text-edit: config.yaml 显式 reload_api: false（用户关闭热更端点）——安装器拒绝偷偷翻转语义值，请人工确认后改回 true 再重试安装");
		}
		return { content, changed: false };
	}
	return { content: insertAnchor(content, "# ojm:reload", "reload_api: true"), changed: true };
}

/**
 * 安装序号自增（B-11 reload 触发面；PRD E5 实测先例：vars 段语义值改动可热生效，而
 * reloadConfig 的 unchanged 判定基于 config 文档 sha——不落盘变更则热更恒 unchanged）。
 * R18 同纪律：纯文本行操作，注释/缩进/键序逐字保留，`ojm_install_seq: N` 整行自增为 N+1
 * （行内尾注释原样保留）。键缺失/形状不符 = 可读报错不猜位置（键随模板 config.yaml 发布；
 * 用户删行 = 显式退出热更触发，安装器拒绝静默安装）。
 */
export function bumpInstallSeq(content: string): { content: string, seq: number } {
	const lines = content.split("\n");
	const idx = lines.findIndex(l => /^\s*ojm_install_seq\s*:\s*\d+\s*(?:#.*)?$/.test(l));
	if (idx === -1) {
		throw new Error("text-edit: config.yaml 缺 ojm_install_seq: N 行（vars 安装序号，模板 config.yaml 随发，勿删）——reload 热更无变更可落（unchanged 恒真），安装终止于 reloading 段");
	}
	const m = /^(\s*ojm_install_seq\s*:\s*)(\d+)/.exec(lines[idx]!)!;
	const seq = Number(m[2]) + 1;
	lines[idx] = `${m[1]}${seq}${lines[idx]!.slice(m[0].length)}`;
	return { content: lines.join("\n"), seq };
}

/**
 * C2-26 anonymous 运行时接线（P2-15③ 承载，观察项 6 收口）：把方案的匿名端点追加进
 * config.yaml `auth.anonymous_paths` 列表（oj 匿名模型 config 独占；热改属
 * restart_pending——reload 段消息已明示，重启后生效）。
 * 幂等：已存在（trim 相等）的路径不重复插入；`anonymous_paths:` 键缺失 = 可读报错
 * （键随模板 config.yaml 发布，用户删键 = 显式退出匿名模型，安装器不猜位置重建）。
 * paths 传方案相对形态（C2-26 anonymous 值，首段=apiSeg）；本函数统一补前导 `/`。
 */
export function appendAnonymousPaths(content: string, paths: string[]): { content: string, added: string[] } {
	const lines = content.split("\n");
	const idx = lines.findIndex(l => /^\s*anonymous_paths\s*:/.test(l));
	if (idx === -1) {
		throw new Error("text-edit: config.yaml 缺 auth.anonymous_paths 键（oj 匿名模型 config 独占，键随模板 config.yaml 发布）——方案匿名端点无法接线，请恢复该键后重试安装");
	}
	// 列表项收集：键行之后连续的 `- item` 行（缩进任意）；空行/注释行跳过不中断
	// （模板 config.yaml 列表中部有行内注释），遇首个其他内容行即止
	const wanted = paths.map(p => (p.startsWith("/") ? p : `/${p}`));
	const existing = new Set<string>();
	let last = idx;
	for (let i = idx + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.trim() === "" || /^\s*#/.test(line)) {
			continue;
		}
		// 先剥行内注释再取项值（防 ReDoS：不写可交换量词的组合）
		const stripped = line.replace(/#.*$/, "").trim();
		if (!stripped.startsWith("- ")) {
			break;
		}
		existing.add(stripped.slice(2).trim());
		last = i;
	}
	const added = wanted.filter(p => !existing.has(p));
	if (added.length === 0) {
		return { content, added: [] };
	}
	const itemIndent = /^\s*-/.exec(lines[idx + 1] ?? "")?.[0]?.replace(/-.*/, "") ?? (`${/^\s*/.exec(lines[idx]!)?.[0] ?? ""}  `);
	lines.splice(last + 1, 0, ...added.map(p => `${itemIndent}- ${p}`));
	return { content: lines.join("\n"), added };
}
