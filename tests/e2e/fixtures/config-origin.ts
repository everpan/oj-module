import fs from "node:fs";
import path from "node:path";

// MCP 服务页要显示「已启用 / mounted」必须知道自身对外地址（vars.canonical_origin）。
// 模板默认把该行注释掉（playbook §9：避免把开发机 localhost 硬编码进模板，本地验证才填）。
// e2e 是本地验证工具，所以这里临时把它解注成 dev 地址，跑完 globalTeardown 再还原，仓库不留脏改。
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CONFIG = path.join(REPO_ROOT, "packages/cli/templates/config.yaml");
const BACKUP = `${CONFIG}.e2e-bak`;

// 注释态：`  # canonical_origin: "..."  # 模板默认...` → 解注成 `  canonical_origin: "..."`
const COMMENTED_RE = /^\s*#\s*(canonical_origin:\s*"[^"]*")\s*(#.*)?$/m;

export function injectCanonicalOrigin(): void {
	if (!fs.existsSync(CONFIG))
		return;
	if (!fs.existsSync(BACKUP))
		fs.copyFileSync(CONFIG, BACKUP); // 仅首次备份，幂等（崩溃重跑也能还原）
	let text = fs.readFileSync(CONFIG, "utf-8");
	if (COMMENTED_RE.test(text)) {
		text = text.replace(COMMENTED_RE, "  $1");
		fs.writeFileSync(CONFIG, text);
	}
}

export function restoreCanonicalOrigin(): void {
	if (fs.existsSync(BACKUP)) {
		fs.copyFileSync(BACKUP, CONFIG);
		fs.rmSync(BACKUP);
	}
}
