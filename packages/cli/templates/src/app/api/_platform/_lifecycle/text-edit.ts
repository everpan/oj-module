// config.yaml 文本锚点编辑（R18）：安装器改写用户 config.yaml 的唯一手段。
// 禁止 yaml 解析/stringify 回写——用户注释、缩进、空行、键序必须逐字保留，
// 因此只做文本级行操作：锚点是整行注释（如 `# ojm:mount`），块插入其下一行。
// 匹配口径：整行 trim 后相等才算已存在（子串出现不算，防误判幂等）。

/** `ojm preview` 派生的 config 文件名（与 CLI 侧 preview-config.ts 逐字一致）；纯函数收口于此，installer/compensate/uninstall 三面共用 */
export const PREVIEW_CONFIG_NAME = ".ojm-preview.yaml";

/** 与 config 同目录的 preview 派生路径（无目录分隔符 = 同目录裸名） */
export function previewSiblingOf(configPath: string): string {
	const cut = Math.max(configPath.lastIndexOf("/"), configPath.lastIndexOf("\\"));
	return cut < 0 ? PREVIEW_CONFIG_NAME : `${configPath.slice(0, cut + 1)}${PREVIEW_CONFIG_NAME}`;
}

/** server.mcp.modules 段内锚点（20261110-1027 §4.2；锚点随模板 config.yaml 骨架发布） */
export const MCP_ANCHOR = "# ojm:mcp-modules";

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

/**
 * `appendAnonymousPaths` 的逆操作（P0 补偿清单 §3.5）：把指定匿名路径从 `auth.anonymous_paths`
 * 列表移除。纯文本判定，与 append 同源——按行 `- <path>`（trim 匹配）删除，列表其余项/注释/空行
 * 原样保留；幂等：路径不在列表内则 no-op、返回 removed=[]。键缺失（从未接线）= 没东西可删，no-op。
 * `paths` 形态应与 append 传入一致（方案相对形态），本函数统一补前导 `/` 对齐写入形态。
 */
export function removeAnonymousPaths(content: string, paths: string[]): { content: string, removed: string[] } {
	if (paths.length === 0) {
		return { content, removed: [] };
	}
	const wanted = new Set(paths.map(p => (p.startsWith("/") ? p : `/${p}`)));
	const lines = content.split("\n");
	const idx = lines.findIndex(l => /^\s*anonymous_paths\s*:/.test(l));
	if (idx === -1) {
		return { content, removed: [] };
	}
	// 收集列表项行区间（键行之后连续 `- item`，跳过空行/注释，遇首个其他行即止）
	const itemLines: number[] = [];
	for (let i = idx + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.trim() === "" || /^\s*#/.test(line)) {
			continue;
		}
		const stripped = line.replace(/#.*$/, "").trim();
		if (!stripped.startsWith("- ")) {
			break;
		}
		itemLines.push(i);
	}
	const removeSet = new Set<number>();
	const removed: string[] = [];
	for (const i of itemLines) {
		const val = lines[i]!.replace(/#.*$/, "").trim().slice(2).trim();
		if (wanted.has(val)) {
			removeSet.add(i);
			removed.push(val);
		}
	}
	if (removed.length === 0) {
		return { content, removed: [] };
	}
	const next = lines.filter((_, i) => !removeSet.has(i));
	return { content: next.join("\n"), removed };
}

/**
 * 纯文本解析 `auth.anonymous_paths` 列表（P0 §3.2 质辩1 / E8 残留检测消费面）：与 append/remove
 * 同源的列表收集口径——从 `anonymous_paths:` 键行起，连续 `- item` 行（跳过空行/注释）逐行取值。
 * 用于「读」已装站点的匿名条目，不修改文本。键缺失 = 返回 []。
 */
export function readAnonymousPaths(content: string): string[] {
	const lines = content.split("\n");
	const idx = lines.findIndex(l => /^\s*anonymous_paths\s*:/.test(l));
	if (idx === -1) {
		return [];
	}
	const out: string[] = [];
	for (let i = idx + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.trim() === "" || /^\s*#/.test(line)) {
			continue;
		}
		const stripped = line.replace(/#.*$/, "").trim();
		if (!stripped.startsWith("- ")) {
			break;
		}
		out.push(stripped.slice(2).trim());
	}
	return out;
}

/**
 * MCP 白名单登记（20261110-1027 §4.2）：把方案 api 模块名登记进 config.yaml
 * `server.mcp.modules` 列表（锚点 `# ojm:mcp-modules` 段内，锚点随模板骨架发布）。
 * 红线（评审定稿 §5.3）：`modules:` 键名全局不唯一（模板另有 platform.modules）——
 * 检测限定锚点缩进域（自锚点向下游走，遇缩进 < 锚点缩进即出段）；写入恒为块列表
 * （键行 + `  - name` 行）；锚点下已是 flow 风格 `modules: [..]`（用户手写）→ 跳过
 * 不改写（块级追加=坏 YAML，oj 拒启），skipped="flow" 由调用方记任务历史。
 */
export function ensureMcpModule(content: string, name: string): { content: string, changed: boolean, skipped?: "flow" } {
	const lines = content.split("\n");
	const scan = scanMcpModulesKey(lines);
	if (scan.anchorIdx === -1) {
		throw new Error(`text-edit: config.yaml 未找到锚点「${MCP_ANCHOR}」——存量站点缺失时调用方须先 hasAnchor 预判跳过（best-effort 降级），本函数 fail-fast 不猜位置`);
	}
	if (scan.flow) {
		return { content, changed: false, skipped: "flow" };
	}
	if (scan.keyIdx === -1) {
		return { content: insertAnchor(content, MCP_ANCHOR, `modules:\n  - ${name}`), changed: true };
	}
	const items = collectMcpItems(lines, scan.keyIdx);
	if (items.vals.has(name)) {
		return { content, changed: false };
	}
	const firstItemLine = lines[scan.keyIdx + 1] ?? "";
	const itemIndent = /^\s*- /.test(firstItemLine) ? (/^\s*/.exec(firstItemLine)?.[0] ?? "") : `${scan.indent}  `;
	lines.splice(items.lastIdx + 1, 0, `${itemIndent}- ${name}`);
	return { content: lines.join("\n"), changed: true };
}

/**
 * `ensureMcpModule` 的逆操作（卸载摘除）：从 `server.mcp.modules` 块列表摘除方案名。
 * 空表连 `modules:` 键行一并摘（缺省全暴露恢复——留空表=全屏蔽陷阱），锚点行保留
 * （后续安装仍可登记）。键/锚点缺失 = 没东西可摘，no-op；flow 风格 → skipped="flow"。
 * 双轨同名守卫（内建模块仍占名则不摘）属调用方锁真值判断，本函数保持纯文本语义。
 */
export function removeMcpModule(content: string, name: string): { content: string, removed: boolean, skipped?: "flow" } {
	const lines = content.split("\n");
	const scan = scanMcpModulesKey(lines);
	if (scan.flow) {
		return { content, removed: false, skipped: "flow" };
	}
	if (scan.anchorIdx === -1 || scan.keyIdx === -1) {
		return { content, removed: false };
	}
	const items = collectMcpItems(lines, scan.keyIdx);
	const removeSet = new Set<number>();
	for (const i of items.itemIdx) {
		const val = lines[i]!.replace(/#.*$/, "").trim().slice(2).trim();
		if (val === name) {
			removeSet.add(i);
		}
	}
	if (removeSet.size === 0) {
		return { content, removed: false };
	}
	let next = lines.filter((_, i) => !removeSet.has(i));
	const after = scanMcpModulesKey(next);
	if (after.keyIdx !== -1 && collectMcpItems(next, after.keyIdx).itemIdx.length === 0) {
		next = next.filter((_, i) => i !== after.keyIdx);
	}
	return { content: next.join("\n"), removed: true };
}

/** `# ojm:mcp-modules` 锚点定位 + 段内 `modules:` 键扫描（ensure/remove 共用）。 */
interface McpKeyScan {
	anchorIdx: number
	/** 锚点行缩进（空格串，regex 安全） */
	indent: string
	/** 段内 modules 键行下标；-1 = 键不存在 */
	keyIdx: number
	/** 键行为 flow 内联值（`modules: [a]`）= 不可块级改写 */
	flow: boolean
}

function scanMcpModulesKey(lines: string[]): McpKeyScan {
	const anchorIdx = lines.findIndex(l => l.trim() === MCP_ANCHOR);
	const indent = anchorIdx === -1 ? "" : (/^\s*/.exec(lines[anchorIdx]!)?.[0] ?? "");
	const scan: McpKeyScan = { anchorIdx, indent, keyIdx: -1, flow: false };
	if (anchorIdx === -1) {
		return scan;
	}
	const keyRe = new RegExp(`^${indent}modules\\s*:`);
	for (let i = anchorIdx + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.trim() === "") {
			continue;
		}
		if ((/^\s*/.exec(line)?.[0] ?? "").length < indent.length) {
			break;
		}
		if (/^\s*#/.test(line)) {
			continue;
		}
		if (keyRe.test(line)) {
			scan.keyIdx = i;
			const inline = line.replace(/#.*$/, "").trim().replace(/^modules\s*:/, "").trim();
			scan.flow = inline !== "";
			break;
		}
	}
	return scan;
}

/** modules 键行下的块列表项收集（appendAnonymousPaths 同款口径）：跳空行/注释，遇非 `- ` 行即止。 */
function collectMcpItems(lines: string[], keyIdx: number): { vals: Set<string>, lastIdx: number, itemIdx: number[] } {
	const vals = new Set<string>();
	const itemIdx: number[] = [];
	let lastIdx = keyIdx;
	for (let i = keyIdx + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.trim() === "" || /^\s*#/.test(line)) {
			continue;
		}
		const stripped = line.replace(/#.*$/, "").trim();
		if (!stripped.startsWith("- ")) {
			break;
		}
		vals.add(stripped.slice(2).trim());
		itemIdx.push(i);
		lastIdx = i;
	}
	return { vals, lastIdx, itemIdx };
}
