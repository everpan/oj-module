/**
 * ojm → oj 子命令透传（`ojm test` / `exec` / `openapi` / `migrate` / `schema`）。
 *
 * 只做两件事，其余一律交给用户：
 *   1. 定位 bin/oj（缺失给人话报错）；
 *   2. 用户没给 -c/--config 时补上 <project>/api/config.yaml 的绝对路径。
 *
 * 为什么必须补 -c：这些子命令的 -c 缺省是 `./config.yaml`（相对 CWD），而 ojm
 * 工程的 config 在 api/ 下——从工程根跑就会读不到。oj 的 -d/--db 等都有自动
 * 探测（自 config 逐级搜，src 优先），ojm 不去猜，避免替用户做错的决定。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveOjBin } from "./vendor";

/** 接受 -c 配置的子命令；`secret` 不在内（keygen/seal 不需要 config） */
const CONFIG_SUBCOMMANDS = new Set(["test", "exec", "openapi", "migrate", "schema"]);

/** 注入桩 oj 执行（测试）；默认 execFileSync(bin/oj, args, inherit) */
export type ExecOj = (args: string[]) => void;

export function runOjSubcommand(
	projectRoot: string,
	sub: string,
	userArgs: string[],
	exec: ExecOj = args => execFileSync(resolveOjBin(projectRoot), args, { stdio: "inherit" }),
): void {
	const ojBin = resolveOjBin(projectRoot);
	if (!fs.existsSync(ojBin)) {
		throw new Error(
			`[ojm] 缺少 ${ojBin}。\n`
			+ "请重跑 ojm init 或 ojm vendor（联网下载 oj，不覆盖 config 与用户代码）。",
		);
	}

	const args = [sub, ...userArgs];
	const hasConfigFlag = userArgs.includes("-c") || userArgs.includes("--config");
	const configPath = path.join(projectRoot, "api/config.yaml");
	if (CONFIG_SUBCOMMANDS.has(sub) && !hasConfigFlag && fs.existsSync(configPath))
		args.splice(1, 0, "-c", configPath);

	exec(args);
}
