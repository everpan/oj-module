/**
 * prepack：发布前把本仓 `docs/devkit/` 顶层（ojm 模块开发 skill 的源文件）归置进
 * cli 包（packages/cli/devkit），随 `@oj-module/cli` 一起发布，再由 `ojm init`
 * 分发到工程的 `.claude/skills/ojm-module-dev/`（设计 §7 待对接，见
 * docs/devkit/framework-dev.md）。
 *
 * 只同步**顶层文件**：`docs/devkit/oj-api-dev/` 是 oj 侧 devkit 的快照
 * （10 个文件，与 ~/.local/share/oj/devkit/ 逐字节一致），仅本仓参考、
 * 不随 cli 包发货——用户工程的 oj-api-dev skill 由 oj 二进制分发。
 * 结构与刷新口径见 docs/devkit/README.md。
 *
 * 这样业务工程 `ojm init` 即可自动拿到最新 devkit 文档，无需手动拷贝；
 * 手动触发：`node scripts/sync-devkit.mjs`。
 *
 * 源：仓库 docs/devkit/（仅顶层文件）；目标：packages/cli/devkit/（已被 package.json#files 白名单纳入）。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(cliRoot, "..", "..", "docs", "devkit");
const destDir = path.join(cliRoot, "devkit");

if (!fs.existsSync(srcDir)) {
	throw new Error(`[sync-devkit] 源目录不存在：${srcDir}`);
}

fs.mkdirSync(destDir, { recursive: true });
let count = 0;
for (const name of fs.readdirSync(srcDir)) {
	const src = path.join(srcDir, name);
	if (!fs.statSync(src).isFile()) {
		// 子目录有意跳过：oj-api-dev/ 是 oj 侧 devkit 快照，仅本仓参考、
		// 不随 cli 包发货（用户工程从 oj 二进制拿）。见文件头注。
		if (fs.statSync(src).isDirectory()) {
			console.log(`[sync-devkit] 跳过子目录 ${name}/（仅本仓参考，不发货）`);
		}
		continue;
	}
	fs.copyFileSync(src, path.join(destDir, name));
	count++;
}

console.log(`[sync-devkit] ${count} 个文件 → ${path.relative(process.cwd(), destDir)}`);
