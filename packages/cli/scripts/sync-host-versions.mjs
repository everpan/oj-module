/**
 * prepack：发布前把宿主版本矩阵同步进 cli 包（vendor/host-versions.json），
 * 并断言内置宿主产物与 runtime 同版本（设计 R5 发布完整性门禁）。
 *
 * 背景（0.1.0 发布实测 bug2）：init 钉版数据源原是 shell dist，但发布包里
 * 没有 shell 兄弟目录、目标工程也尚未 install——鸡生蛋死锁。随包内置一份
 * 矩阵快照，init 在 shell-dist 不可达时回退到它。
 *
 * P1 起宿主并入 cli：`shell-dist/` 随 cli 发布，矩阵真源就是它；
 * vendor 快照是「shell-dist 尚未构建」时的兜底。
 *
 * 由 cli 的 prepack 钩子自动执行（发布前必新）；也可手动 `node scripts/...`。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const shellDist = path.join(cliRoot, "shell-dist");
const versionsPath = path.join(shellDist, "versions.json");

if (!fs.existsSync(path.join(shellDist, "index.html")) || !fs.existsSync(versionsPath)) {
	throw new Error(
		`[prepack] cli 内置宿主产物缺失（${shellDist}）——\n`
		+ "请先构建宿主：pnpm --filter @oj-module/cli build:shell",
	);
}

const matrix = JSON.parse(fs.readFileSync(versionsPath, "utf-8"));

// R5：宿主产物里的 runtime 必须与随包发布的 runtime 同版本，
// 否则会发布出「类型来自新版、实现来自旧宿主」的跨版本组合
const runtimePkgPath = path.join(cliRoot, "..", "runtime", "package.json");
if (fs.existsSync(runtimePkgPath)) {
	const runtimeVersion = JSON.parse(fs.readFileSync(runtimePkgPath, "utf-8")).version;
	const hostRuntime = matrix["@oj-module/runtime"];
	if (hostRuntime !== runtimeVersion) {
		throw new Error(
			`[prepack] 宿主产物的 runtime 版本（${hostRuntime ?? "缺失"}）`
			+ `≠ packages/runtime 版本（${runtimeVersion}）——\n`
			+ "请重建宿主：pnpm --filter @oj-module/cli build:shell",
		);
	}
}

const out = path.join(cliRoot, "vendor", "host-versions.json");
fs.writeFileSync(out, `${JSON.stringify({ matrix }, null, "\t")}\n`);
console.log(`[sync-host-versions] 矩阵 ${Object.keys(matrix).length} 项 → ${path.relative(process.cwd(), out)}`);
