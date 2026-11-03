/**
 * oj 子进程编排（设计 §4/§6）。
 *
 * 职责单一：spawn `oj serve`、健康轮询、stdout/stderr 直接透传（oj 自带 [oj] 前缀，
 * 退出回收。不关心 who 调它（dev 直接用，preview 在 migrate 后用）。
 *
 * 子命令是 `serve` 不是 `server`：oj 0.1.50 只认 `serve`（实测 `oj server --help`
 * → unrecognized subcommand）。ojm 以最新 oj 为准，不做版本兼容分支——老版本 oj
 * 由 `ojm vendor` 的最低版本门禁挡住（见 src/vendor.ts 的 MIN_OJ_VERSION）。
 *
 * 健康判据：GET {base}/health 状态码 <400（oj 内置匿名健康端点；2xx/3xx 均视为就绪）。
 * 秒退：ready 拒绝，错误信息优先带 stderr 尾部（证书缺失等常见错因可直接读出）；
 * 若 oj 把 FATAL 落盘到 logs/ 而未进 stderr（手册说 `--console-log` 会镜像到终端，但
 * 部分环境仍可能只落盘），再读 `<configDir>/logs/server-*.log` 最新文件兜底，绝不输出
 * 无意义的 "(无输出)"（方案 A' 失败提示不吞，评审 E-1）。
 */

import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { readOjPluginsDir, readOjPort } from "./oj-config";
import { resolveOjBin } from "./vendor";

/**
 * logs/ 兜底（评审 E-1）：oj 启动期 FATAL 有时只落盘不进 stderr。
 * 给定 oj 的日志目录（通常 `<configDir>/logs`），挑最新的 `server-*.log`，
 * 抽出 ERROR/FATAL/panic 等关键行（没有则取末 30 行），供失败信息兜底展示。
 * 找不到日志目录 / 文件即返回空串（调用方维持 "(无输出)"）。
 */
function readLatestLogError(logsDir: string): string {
	if (!logsDir || !fs.existsSync(logsDir))
		return "";
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(logsDir, { withFileTypes: true });
	}
	catch {
		return "";
	}
	const logs = entries
		.filter(e => e.isFile() && /^server-.*\.log$/.test(e.name))
		.map((e) => {
			try {
				return { name: e.name, mtime: fs.statSync(path.join(logsDir, e.name)).mtimeMs };
			}
			catch {
				return null;
			}
		})
		.filter((x): x is { name: string, mtime: number } => x !== null)
		.sort((a, b) => b.mtime - a.mtime);
	if (logs.length === 0)
		return "";
	const text = fs.readFileSync(path.join(logsDir, logs[0].name), "utf-8");
	const lines = text.split(/\r?\n/);
	const keyLines = lines.filter(l => /error|fatal|panic|denied|invalid|unable|cannot|fail|exception|refused/i.test(l));
	const picked = keyLines.length > 0 ? keyLines.slice(-30) : lines.slice(-30);
	return picked.join("\n").trim();
}

export interface OjProcess {
	port: number
	/** 健康就绪（或失败拒绝：秒退带 stderr 尾部 / 超时） */
	ready: Promise<void>
	/** SIGTERM 回收，3s 不退升级 SIGKILL；已退出则立即返回 */
	stop: () => Promise<void>
	/**
	 * 同步强杀（SIGKILL）：仅作进程退出兜底，防 oj 孤儿化。
	 * 可选：唯一消费点（dev 的 process exit 兜底）按 `kill?.()` 宽容调用；
	 * 未 spawn 真实进程的实现（测试桩）可不提供。
	 */
	kill?: () => void
}

export interface StartOjPoll {
	intervalMs?: number
	timeoutMs?: number
}

/**
 * 工程根：从 config 所在目录向上找最近的含 `bin/` 的目录（ojm 的 vendor 布局）。
 *
 * 两种布局：
 *   <root>/api/config.yaml → <root>/bin/oj     （历史布局，命中第二层）
 *   <root>/config.yaml     → <root>/bin/oj     （module-root，命中第一层）
 * 找不到 `bin/` 时退回旧的「往上两级」，保持既有报错行为（缺 bin/oj 的文案不变）。
 */
function resolveProjectRoot(configPath: string): string {
	const configDir = path.dirname(configPath);
	for (const dir of [configDir, path.dirname(configDir)]) {
		if (fs.existsSync(path.join(dir, "bin")))
			return dir;
	}
	return path.dirname(configDir);
}

export function startOj(
	configPath: string,
	base: string,
	apiSource: string | string[],
	poll: StartOjPoll = {},
	extraArgs: string[] = [],
	logsDir?: string,
): OjProcess {
	const port = readOjPort(configPath);
	// logs/ 兜底目录（评审 E-1）：oj FATAL 有时只落盘不进 stderr。缺省按 config 同级
	// 的 logs/（与 oj 默认 logs_dir 一致）；调用方可显式覆盖（preview 派生 config 等）。
	const resolvedLogsDir = logsDir ?? path.join(path.dirname(configPath), "logs");
	// 约定：vendor 二进制在 <project>/bin/oj。工程根不能按「config 往上两级」算：
	// module-root 布局的 config 在仓库根（<project>/config.yaml），往上两级会越过工程，
	// 落到父目录找 bin/oj。改为「向上找最近的含 bin/ 的目录」，两种布局都成立。
	const projectRoot = resolveProjectRoot(configPath);
	const binPath = resolveOjBin(projectRoot);
	// 后端源码参数二选一（oj v0.1.85：`--api-path` 与 `--module-root` 互斥，同时给会被
	// clap 拒掉）：历史布局传目录 → `--api-path <dir>`；module-root 布局传**已拼好的
	// 旗标数组** → `["--module-root", "<project>/src"]`。
	const apiArgs = Array.isArray(apiSource) ? apiSource : ["--api-path", apiSource];
	const healthUrl = `http://127.0.0.1:${port}${base}/health`;

	// 插件目录发现显式化：oj 的 resolve_plugins_dir 依赖 current_exe() 启发式，而
	// Linux glibc 发行包的 bin/oj 是 ld-linux 启动器（exec 加载器而非二进制），
	// current_exe() 指向 bin/lib/ld-linux-*.so.2 → 插件目录解析落空 → 零插件加载，
	// config 声明 [auth] 时 oj serve 即 fail fast「no auth plugin loaded」。
	// ojm 既拥有 bin/plugins 布局，直接注入 OJ_PLUGINS_DIR（oj 发现优先级最高项）。
	// 注入条件：用户未在 toml 显式声明 plugins_dir（env 优先级更高，注入会覆盖），
	// 且 bin/plugins 确实存在（缺失时保持 oj 原行为，不生次生错误）。
	const pluginsDir = path.join(projectRoot, "bin", "plugins");
	// win32：oj 是原生 Windows 二进制，从 Git Bash / MSYS 终端启动时继承 MSYS 风格 PATH
	// （如 `/c/WINDOWS/system32`），Windows CreateProcess 无法按该形式解析可执行文件 → 内部
	// `tar` 等系统工具 "command not found in PATH"（市场安装解包即挂）。追加原生 Windows 系统
	// 目录（tar.exe 所在）；cmd/PowerShell 用户 PATH 本就含这些，无副作用。
	// win32: Git Bash/MSYS 把 PATH 写成 /usr/bin 这类 Unix 风格条目，oj 内部按 Windows 规则检索命令
	// 时无法据此定位 tar.exe（系统 tar 在 C:\Windows\System32），市场安装解包会报 tar not found in PATH。
	// 剔除无盘符的 Unix 风格条目、仅保留 Windows 绝对路径，并兜底补上系统目录与 Git bin。
	// cmd/PowerShell 用户 PATH 本就全是 Windows 形态，过滤无副作用。
	const env: NodeJS.ProcessEnv | undefined = (() => {
		let base: NodeJS.ProcessEnv = process.env;
		if (process.platform === "win32") {
			const cur = process.env.PATH ?? process.env.Path ?? "";
			const winEntries = cur.split(";").filter(e => /^[A-Z]:[\\/]/i.test(e.trim()));
			const sysDirs = ["C:\\Windows\\System32", "C:\\Windows", "C:\\Program Files\\Git\\usr\\bin"];
			const missing = sysDirs.filter(d => !winEntries.some(e => e.toLowerCase().startsWith(d.toLowerCase())));
			base = { ...process.env, PATH: [...winEntries, ...missing].join(";") };
		}
		return !readOjPluginsDir(configPath) && fs.existsSync(pluginsDir)
			? { ...base, OJ_PLUGINS_DIR: pluginsDir }
			: base;
	})();

	let stderrTail = "";
	// --console-log：oj 新版终端默认静默（console_log 缺省 false，只落 logs/），
	// ojm dev/preview 的 [oj] 透传管道必须显式打开终端输出才能看到日志（手册 §10）。
	const child = spawn(binPath, ["serve", "-c", configPath, "-b", base, ...apiArgs, "--console-log", ...extraArgs], {
		stdio: ["ignore", "pipe", "pipe"],
		...(env ? { env } : {}),
	});
	// 直接透传 oj 的 stdout/stderr：oj 自身 tracing 已带 `[oj]` 前缀
	// （如 `[oj] 2026-.. INFO request..`），无需再叠前缀，否则会叠成 `[oj] [oj]`。
	child.stdout?.on("data", (chunk: Buffer) => {
		process.stdout.write(String(chunk));
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		const text = String(chunk);
		stderrTail = (stderrTail + text).slice(-2000);
		process.stderr.write(text);
	});

	let settled = false;
	let pollTimer: NodeJS.Timeout | undefined;
	// oj 端口被占用时 stderr 通常会带这些签名（Rust 绑定失败 / 系统错误码）；命中即
	// 补一条「先杀占用进程」的可操作提示，避免只甩晦涩的 oj 原生报错。
	const portInUseHint = (text: string): string => {
		if (/Address already in use|EADDRINUSE|os error 98|os error 10048|地址已被使用|端口已被占用/i.test(text))
			return "\n可能原因：后端端口被占用（通常是上次 ojm dev 未正常退出留下的 oj 孤儿进程）。请先结束占用进程再重试。";
		return "";
	};
	const ready = new Promise<void>((resolve, reject) => {
		const intervalMs = poll.intervalMs ?? 500;
		const timeoutMs = poll.timeoutMs ?? 10_000;
		const finish = (err?: Error) => {
			if (settled)
				return;
			settled = true;
			clearInterval(pollTimer);
			err ? reject(err) : resolve();
		};
		pollTimer = setInterval(() => {
			// 用 node:http 而非全局 fetch：vitest happy-dom 环境会垫掉 fetch
			http.get(healthUrl, (res) => {
				res.resume();
				if ((res.statusCode ?? 500) < 400)
					finish();
			}).on("error", () => { /* 未就绪，继续轮询 */ });
		}, intervalMs);
		pollTimer.unref();
		child.once("exit", (code) => {
			const hint = portInUseHint(stderrTail);
			// A' 失败提示不吞：stderr 空时读 logs/ 最新 server-*.log 兜底（评审 E-1）
			const tail = stderrTail.trim() || readLatestLogError(resolvedLogsDir);
			finish(new Error(
				`[ojm] oj 进程异常退出（code ${code}）。${hint}\n`
				+ `stderr 尾部：\n${tail || "（无输出）"}`,
			));
		});
		// spawn 本身失败（如 ENOENT）只发 error 不发 exit，必须单独兜住
		child.once("error", (err) => {
			const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
			const hint = enoent ? "\n下一步：oj 二进制尚未安装（它在 .gitignore 里，不随仓库分发）。\n在本工程目录跑一次 `ojm vendor`（经 npm 包 @oj-bin/oj 下载），再重试本命令。" : "";
			finish(new Error(`[ojm] 无法启动 oj（${binPath}）：${err.message}${hint}`));
		});
		const timeout = setTimeout(() => {
			const hint = portInUseHint(stderrTail);
			const tail = stderrTail.trim() || readLatestLogError(resolvedLogsDir);
			finish(new Error(
				`[ojm] oj 健康检查超时（${Math.round(timeoutMs / 1000)}s）：${healthUrl} 一直不可达。${hint}\n`
				+ `stderr 尾部：\n${tail || "（无输出）"}`,
			));
		}, timeoutMs);
		timeout.unref();
	});

	const stop = () => new Promise<void>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve();
		}, 3000);
		timer.unref();
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
		child.kill("SIGTERM");
	});

	const kill = () => {
		if (child.exitCode !== null || child.signalCode !== null)
			return;
		child.kill("SIGKILL");
	};

	return { port, ready, stop, kill };
}
