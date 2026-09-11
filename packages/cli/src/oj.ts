/**
 * oj 子进程编排（设计 §4/§6）。
 *
 * 职责单一：spawn `oj server`、健康轮询、stdout/stderr 透传（[oj] 前缀）、
 * 退出回收。不关心 who 调它（dev 直接用，preview 在 migrate 后用）。
 *
 * 健康判据：GET {base}/health 状态码 <400（oj 内置匿名健康端点；2xx/3xx 均视为就绪）。
 * 秒退：ready 拒绝，错误信息带 stderr 尾部（证书缺失等常见错因可直接读出）。
 */

import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { readOjPort } from "./oj-config";

export interface OjProcess {
	port: number
	/** 健康就绪（或失败拒绝：秒退带 stderr 尾部 / 超时） */
	ready: Promise<void>
	/** SIGTERM 回收，3s 不退升级 SIGKILL；已退出则立即返回 */
	stop: () => Promise<void>
}

export interface StartOjPoll {
	intervalMs?: number
	timeoutMs?: number
}

export function startOj(
	configPath: string,
	base: string,
	apiSrcPath: string,
	poll: StartOjPoll = {},
	extraArgs: string[] = [],
): OjProcess {
	const port = readOjPort(configPath);
	// 约定：config 在 <project>/api/config.yaml，vendor 二进制在 <project>/bin/oj
	const binPath = path.join(path.dirname(configPath), "..", "bin", "oj");
	const healthUrl = `http://127.0.0.1:${port}${base}/health`;

	let stderrTail = "";
	// --console-log：oj 新版终端默认静默（console_log 缺省 false，只落 logs/），
	// ojm dev/preview 的 [oj] 透传管道必须显式打开终端输出才能看到日志（手册 §10）。
	const child = spawn(binPath, ["server", "-c", configPath, "-b", base, "--api-path", apiSrcPath, "--console-log", ...extraArgs], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.on("data", (chunk: Buffer) => {
		process.stdout.write(String(chunk).replace(/^/gm, "[oj] "));
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		const text = String(chunk);
		stderrTail = (stderrTail + text).slice(-2000);
		process.stderr.write(text.replace(/^/gm, "[oj] "));
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
			finish(new Error(`[ojm] 无法启动 oj（${binPath}）：${err.message}`));
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

	return { port, ready, stop };
}
