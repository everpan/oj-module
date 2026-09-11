/**
 * `ojm preview` —— 生产形态预览（设计 §6）。
 *
 * 职责：校验产物（fail-fast 四查）→ `oj migrate`（失败即退，不起 server）
 * → `oj server`（release/js，仅 API）→ ojm 静态层兜底（SPA 回退，无 SSE
 * 注入、不设 no-store）。默认静态归 ojm（与 oj 手册 §13「SPA 回退经前置
 * 反代补」一致）；`--oj-static` 切换为 oj `--app-path` 直出（真 exercise
 * oj 静态层，history 深链接 404 是已知限制）。
 *
 * 一律传绝对路径：oj 命令行相对 CWD、config 内相对 config 目录，混用即歧义。
 */

import type { OjProcess } from "./oj";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path, { normalize } from "node:path";
import process from "node:process";
import { proxyApi } from "./dev-proxy";
import { resolveLayout } from "./layout";
import { startOj } from "./oj";
import { readOjApiPrefix } from "./oj-config";
import { createStaticHandler, decodeReqPath, listenOnFreePort } from "./static-handler";

const DEFAULT_PORT = 4173;

export interface PreviewOptions {
	port?: number
	/** 静态改由 oj --app-path 直出（history 深链接 404，已知限制） */
	ojStatic?: boolean
	/** 注入桩站点目录（默认 layout.distDir） */
	siteDir?: string
	/** 注入桩 oj 命令执行（migrate）；默认 execFileSync(bin/oj, args, inherit) */
	execOj?: (args: string[]) => void
	/** 注入桩 oj 进程；默认 startOj */
	ojStarter?: (configPath: string, base: string, apiPath: string, extraArgs: string[]) => OjProcess
}

export async function previewServer(projectRoot: string, opts: PreviewOptions = {}): Promise<http.Server> {
	const layout = resolveLayout(projectRoot);
	const siteDir = opts.siteDir ?? layout.distDir;
	const ojBin = path.join(projectRoot, "bin", "oj");
	const configPath = path.join(projectRoot, "api", "config.yaml");
	const apiDist = path.join(projectRoot, "api", "dist");

	// fail-fast 四查：缺一即提示对应补救（init 幂等补缺 / ojm build 产物）
	if (!existsSync(ojBin))
		throw new Error(`[ojm] 缺少 ${ojBin}。\n请重跑 ojm init 或 ojm vendor（联网下载 oj，不覆盖 config 与用户代码）。`);
	if (!existsSync(configPath))
		throw new Error(`[ojm] 缺少 ${configPath}。\n请重跑 ojm init 生成后端配置。`);
	if (!existsSync(path.join(siteDir, "index.html")))
		throw new Error(`[ojm] ${siteDir} 缺少 index.html。\n请先 ojm build（构建模块并合并全站）。`);
	if (!existsSync(path.join(apiDist, "manifests.yaml")))
		throw new Error(`[ojm] ${apiDist} 缺少 manifests.yaml。\n请先 ojm build（后端 oj build 产物）。`);

	const execOj = opts.execOj ?? ((args: string[]) => execFileSync(ojBin, args, { stdio: "inherit" }));

	// D8：先迁移再起服务；migrate 非零退出 → 透传 stderr、ojm 非零退出、不起 server
	console.log("[ojm] oj migrate（应用待执行迁移）…");
	execOj(["migrate", "-c", configPath, "-d", apiDist]);

	const base = readOjApiPrefix(configPath);
	const starter = opts.ojStarter ?? ((cfg: string, b: string, apiPath: string, extraArgs: string[]) =>
		startOj(cfg, b, apiPath, undefined, extraArgs));
	const extraArgs = opts.ojStatic ? ["--app-path", siteDir] : [];
	const oj = starter(configPath, base, apiDist, extraArgs);
	try {
		await oj.ready;
	}
	catch (error) {
		// F3：ready 拒绝必须先回收子进程，否则 oj 孤儿化继续占端口
		await oj.stop().catch(() => {});
		throw error;
	}
	console.log(`[ojm] oj 后端已就绪（release/js）：${base} → http://127.0.0.1:${oj.port}`);

	const ojTarget = `http://127.0.0.1:${oj.port}`;
	const serveStatic = createStaticHandler({ roots: [siteDir], reload: null, noStore: false });

	const server = http.createServer((req, res) => {
		const urlPath = decodeReqPath(req.url ?? "/");
		if (urlPath === null) {
			res.writeHead(400, { "content-type": "text/plain" });
			res.end("400 Bad Request: malformed URL encoding");
			return;
		}
		const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
		// 反代前缀跟随 config 的 server.api_prefix（F2）
		if (rel.startsWith(`${base}/`)) {
			void proxyApi(ojTarget)(req, res);
			return;
		}
		serveStatic(req, res);
	});

	server.on("close", () => {
		void oj.stop();
	});
	process.once("SIGINT", () => {
		console.log("\n[ojm] 正在退出…");
		void oj.stop();
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 1500).unref();
	});

	const actualPort = await listenOnFreePort(server, opts.port ?? DEFAULT_PORT);
	console.log(`\n[ojm] preview 已启动：http://localhost:${actualPort}`);
	if (opts.ojStatic)
		console.log(`[ojm] --oj-static：oj 已挂静态直出 http://127.0.0.1:${oj.port}（history 深链接 404 为已知限制；ojm 本口仍提供 SPA 兜底 + /api 反代）`);
	else
		console.log(`[ojm] 静态兜底：ojm（SPA 回退）+ ${base} 反代 oj`);

	return server;
}
