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
 * 秒退：ready 拒绝，错误信息带 stderr 尾部（证书缺失等常见错因可直接读出）。
 */

import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { readOjPluginsDir, readOjPort } from "./oj-config";
import { resolveOjBin } from "./vendor";

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
): OjProcess {
	const port = readOjPort(configPath);
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
	const env: NodeJS.ProcessEnv | undefined
		= !readOjPluginsDir(configPath) && fs.existsSync(pluginsDir)
			? { ...process.env, OJ_PLUGINS_DIR: pluginsDir }
			: undefined;

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
			finish(new Error(
				`[ojm] oj 进程异常退出（code ${code}）。\n`
				+ `stderr 尾部：\n${stderrTail.trim() || "（无输出）"}`,
			));
		});
		// spawn 本身失败（如 ENOENT）只发 error 不发 exit，必须单独兜住
		child.once("error", (err) => {
			const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
			const hint = enoent ? "\n下一步：oj 二进制尚未安装（它在 .gitignore 里，不随仓库分发）。\n在本工程目录跑一次 `ojm vendor`（经 npm 包 @oj-bin/oj 下载），再重试本命令。" : "";
			finish(new Error(`[ojm] 无法启动 oj（${binPath}）：${err.message}${hint}`));
		});
		const timeout = setTimeout(() => {
			finish(new Error(
				`[ojm] oj 健康检查超时（${Math.round(timeoutMs / 1000)}s）：${healthUrl} 一直不可达。\n`
				+ `stderr 尾部：\n${stderrTail.trim() || "（无输出）"}`,
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
