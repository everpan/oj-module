#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(DIR, "../src/index.ts");

// 通过 --import 注册 tsx，让 Node 直接加载 .ts/.tsx 源码（CLI 本身是 TS）。
// tsx 的解析必须锚定 CLI 包自身（bin 所在的包上下文），不能交给 CWD——
// `ram init` 产出的外部工程 node_modules 里没有 tsx。
// 模块定义读取时，`@oj-module/runtime` 由 esbuild 虚拟模块插件指向只读占位，
// 因此不会真正加载含 svg 的框架运行时（设计文档 B10 / §4.3）。
const tsx = import.meta.resolve("tsx");

// spawn + 信号转发而非 execFileSync：`kill <pid>` / 进程管理器只信号外层，
// 不转发会留下孤儿内层进程（连带 ram dev/preview 起的 oj）。终端 Ctrl-C
// 发进程组信号本就不会孤儿化，这里是双保险。
const child = spawn(process.execPath, ["--import", tsx, ENTRY, ...process.argv.slice(2)], {
	stdio: "inherit",
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code, signal) => {
	if (signal) {
		// 内层被信号杀死：摘掉自家转发 handler 再以同信号自杀——否则 handler
		// 吞掉信号，事件循环排空后进程以退出码 0 收场，调用方（脚本/CI）
		// 无法区分「正常退出」与「被杀」（集中审阅 F5）
		process.removeAllListeners("SIGINT");
		process.removeAllListeners("SIGTERM");
		process.kill(process.pid, signal);
	}
	else {
		process.exitCode = code;
	}
});
