/**
 * 校验 markdown 的 mermaid 图块语法（pnpm check:mermaid）。
 *
 * 背景：设计文档大量使用 mermaid，手写图块没有语法门禁，曾出现代码围栏未闭合、
 * 裸标签含括号导致 parse error 等问题（202610161300 生命周期文档）。本脚本把
 * mermaid.parse 跑在每个 ```mermaid 块上，任一失败即以非零码退出。
 *
 * mermaid 的 DOMPurify 需要 DOM 全局，这里用 happy-dom（vitest 同款环境）垫底。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { Window } from "happy-dom";

const window = new Window();
for (const key of [
	"window",
	"document",
	"DOMParser",
	"Element",
	"HTMLElement",
	"SVGElement",
	"NodeFilter",
	"Node",
	"DocumentFragment",
	"getComputedStyle",
	"CSSStyleSheet",
	"CSSStyleDeclaration",
]) {
	globalThis[key] = window[key];
}
globalThis.window ??= window;

const { default: mermaid } = await import("mermaid");
mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

/** 收集 git 跟踪的 markdown 文件（未跟踪的新文档也覆盖） */
function listMarkdown() {
	const tracked = execSync("git ls-files -- \"*.md\"", { encoding: "utf8" })
		.split("\n")
		.filter(Boolean);
	const untracked = execSync("git ls-files --others --exclude-standard -- \"*.md\"", { encoding: "utf8" })
		.split("\n")
		.filter(Boolean);
	return [...new Set([...tracked, ...untracked])].sort();
}

/** 抽取文件中的 mermaid 代码块；围栏未闭合也作为一个块返回以便报错 */
function extractBlocks(text) {
	const blocks = [];
	const lines = text.split("\n");
	let inBlock = false;
	let cur = null;
	lines.forEach((line, i) => {
		const trimmed = line.trim();
		if (!inBlock && trimmed.startsWith("```mermaid")) {
			inBlock = true;
			cur = { startLine: i + 1, body: [] };
		}
		else if (inBlock && trimmed === "```") {
			inBlock = false;
			blocks.push(cur);
			cur = null;
		}
		else if (inBlock) {
			cur.body.push(line);
		}
	});
	if (cur)
		blocks.push({ ...cur, unclosed: true });
	return blocks;
}

const files = listMarkdown();
let total = 0;
const failures = [];

for (const file of files) {
	const blocks = extractBlocks(readFileSync(file, "utf8"));
	for (const block of blocks) {
		total++;
		const label = `${file}:${block.startLine}`;
		if (block.unclosed) {
			failures.push({ label, message: "代码围栏未闭合（```mermaid 之后缺少 ```）" });
			continue;
		}
		try {
			await mermaid.parse(block.body.join("\n"));
		}
		catch (error) {
			failures.push({ label, message: String(error?.message ?? error).split("\n").slice(0, 4).join(" ") });
		}
	}
}

if (failures.length > 0) {
	console.error(`mermaid 校验失败：${failures.length}/${total} 个图块\n`);
	for (const f of failures) {
		console.error(`  ${f.label}`);
		console.error(`    ${f.message}\n`);
	}
	process.exit(1);
}
console.log(`mermaid 校验通过：${files.length} 个 markdown 中 ${total} 个图块全部合法`);
