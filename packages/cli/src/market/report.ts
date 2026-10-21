/**
 * walkthrough 报告落盘 + 白黑名单脱敏（T12 收尾，设计 §3.6.3）。
 *
 * 白名单（可落盘）：key_id、公钥、指纹、task_id、AC 表、阶段结果、sha256——报告常规内容。
 * 黑名单（禁落盘，脱敏兜底）：Bearer token、JWT、私钥 PEM、jwt_secret 值——正常路径本不该
 * 进报告（凭据只在内存），此处是第二道防线：即便某条 detail 意外带了敏感串，落盘前也被掩码。
 */

import type { FailurePlaybookEntry } from "./failure-playbook";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** 黑名单模式（g 旗标，replace 全局掩码） */
const BLACKLIST: Array<{ re: RegExp, mask: string }> = [
	{ re: /Bearer\s+[\w.~-]+/g, mask: "Bearer ***" },
	{ re: /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, mask: "***" }, // JWT 三段形态
	{ re: /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, mask: "[redacted PEM]" },
	{ re: /(jwt_secret\s*[:=]\s*)\S+/g, mask: "$1***" },
];

/** 报告文本过黑名单（幂等：已掩码文本二次过检不再变化） */
export function sanitizeReportText(text: string): string {
	let out = text;
	for (const { re, mask } of BLACKLIST)
		out = out.replace(re, mask);
	return out;
}

export interface WalkthroughReportRow {
	key: string
	title: string
	ok: boolean
	detail: string
}

/** 渲染 AC 表 + 汇总行 + 失败文案表，脱敏后落 `logs/walkthrough-<ts>.md`；返回落盘路径 */
export function writeWalkthroughReport(opts: { rows: WalkthroughReportRow[], port: number, playbook: FailurePlaybookEntry[], logDir?: string }): string {
	const dir = opts.logDir ?? path.join(process.cwd(), "logs");
	mkdirSync(dir, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const file = path.join(dir, `walkthrough-${ts}.md`);
	const pass = opts.rows.filter(r => r.ok).length;
	const failed = opts.rows.length - pass;
	const lines = [
		"# ojm market walkthrough 报告",
		"",
		`- 时间：${new Date().toISOString()}`,
		`- 隔离站点端口：${opts.port}`,
		`- 汇总：${opts.rows.length} 项 —— ${pass} PASS / ${failed} FAIL`,
		"",
		"## AC 表",
		"",
		"| op | 结果 | 说明 |",
		"|---|---|---|",
		...opts.rows.map(r => `| ${r.key} | ${r.ok ? "PASS" : "FAIL"} | ${r.ok ? r.title : `${r.title}——${r.detail}`} |`),
		"",
		"## 失败路径人话文案表",
		"",
		"| 失败码 | 阶段 | 成因 | 下一步 |",
		"|---|---|---|---|",
		...opts.playbook.map(e => `| ${e.code} | ${e.stage} | ${e.cause} | ${e.next} |`),
		"",
	];
	writeFileSync(file, sanitizeReportText(lines.join("\n")));
	return file;
}
