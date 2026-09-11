/**
 * `ram dev` —— 全栈开发服务器（设计 §4）。
 *
 * 职责是「装配」：按工程布局解析各协作方（shell dist、oj、mock、watch），
 * 组装一个 http server。具体能力各自独立：
 *   - 静态/SPA/注入     → static-handler.ts
 *   - /api 反代与 SSE   → dev-proxy.ts
 *   - oj 子进程生命周期 → oj.ts
 *   - 布局探测          → layout.ts
 *   - 工程 mock 约定    → dev-mock.ts
 *
 * 两种形态（按 api/config.yaml 是否存在自动判定）：
 *   全栈   /api/* 反代 oj（oj 自带热更，ram 不重启它），模块源码变更 → 重建 → SSE 刷新
 *   纯前端 /api/* 走工程 mock（mock/*.mock.mjs 约定，未命中 404），行为与历史版本一致
 *
 * 测试经 DevOptions 注入桩（shell dist / 重建函数 / ojStarter）。
 */

import type { ContractMockRoute } from "./contract/mock";
import type { MockRoute } from "./dev-mock";
import type { OjProcess } from "./oj";
import { Buffer } from "node:buffer";
import { existsSync, watch } from "node:fs";

import http from "node:http";
import { resolve } from "node:path";
import process from "node:process";
import { buildModules } from "./build";
import { loadContractMocks, resolveMock } from "./contract/mock";
import { loadProjectMocks, mockStatusCode } from "./dev-mock";
import { createReloadHub, proxyApi, sseScript } from "./dev-proxy";
import { resolveLayout } from "./layout";
import { startOj } from "./oj";
import { readOjApiPrefix } from "./oj-config";
import { createStaticHandler, decodeReqPath, listenOnFreePort } from "./static-handler";
import { resolveShellDist } from "./versions";

const DEFAULT_PORT = 5174;

export interface DevOptions {
	port?: number
	/** 注入桩 shell dist（测试）；默认解析 cli 内置 shell-dist */
	shellDist?: string
	/** 注入重建函数（测试）；默认 buildModules（不合并全站，产物只写模块） */
	buildModulesFn?: (projectRoot: string) => Promise<unknown>
	/** 注入桩 oj（测试）；默认 startOj；纯前端工程不调用 */
	ojStarter?: (configPath: string, base: string, apiSrc: string) => OjProcess
	/** 强制纯前端形态（不起 oj，/api 走 mock） */
	frontendOnly?: boolean
}

export async function devServer(projectRoot: string, opts: DevOptions = {}): Promise<http.Server> {
	const layout = resolveLayout(projectRoot);
	const shellDist = opts.shellDist ?? resolveShellDist();
	const localDist = layout.distDir;
	const build = opts.buildModulesFn ?? ((root: string) => buildModules(root));

	// 1) 先把本地模块构建一次
	console.log("[ram] 构建本地模块…");
	await build(projectRoot);

	// 工程 mock（可选约定 mock/*.mock.mjs）：纯前端形态的 /api 边界
	const mocks: MockRoute[] = await loadProjectMocks(projectRoot);
	// 契约 mock（AC-D14）：手写精确匹配优先，契约 pattern 兜底示例值；装载失败不崩 dev
	let contractMocks: ContractMockRoute[] = [];
	try {
		contractMocks = await loadContractMocks(projectRoot);
	}
	catch (error) {
		console.error(`[ram-api] 契约 mock 装载失败（不影响 dev 启动）：${error instanceof Error ? error.message : String(error)}`);
	}

	// 2) oj 后端（工程有 api/config.yaml 时全栈形态；桩可注入）
	const configPath = resolve(projectRoot, "api/config.yaml");
	let oj: OjProcess | undefined;
	let ojTarget: string | undefined;
	// 反代前缀跟随 config 的 server.api_prefix（F2：改前缀后硬编码 /api 会静默失效）
	let apiBase = "/api";
	if (!opts.frontendOnly && existsSync(configPath)) {
		apiBase = readOjApiPrefix(configPath);
		const starter = opts.ojStarter ?? ((cfg: string, b: string, apiSrc: string) => startOj(cfg, b, apiSrc));
		oj = starter(configPath, apiBase, resolve(projectRoot, "api/src"));
		try {
			await oj.ready; // 失败人话报错（stderr 尾部），fail-fast
		}
		catch (error) {
			// F3：ready 拒绝必须先回收子进程，否则 oj 孤儿化继续占端口
			await oj.stop().catch(() => {});
			throw error;
		}
		ojTarget = `http://127.0.0.1:${oj.port}`;
	}

	const hub = createReloadHub();

	// 3) 静态半边（dev：模块产物优先，shell dist 兜底；no-store；注入刷新通道）
	// hostRoots 钉死 shell dist：ram build 的合并残留不得反向遮蔽宿主（F11）
	const serveStatic = createStaticHandler({
		roots: [localDist, shellDist],
		hostRoots: [shellDist],
		reload: { script: sseScript(), handler: hub.handler },
		noStore: true,
	});

	const server = http.createServer((req, res) => {
		const urlPath = decodeReqPath(req.url ?? "/");
		if (urlPath === null) {
			res.writeHead(400, { "content-type": "text/plain" });
			res.end("400 Bad Request: malformed URL encoding");
			return;
		}
		// API 前缀跟随 config 的 server.api_prefix：全栈形态反代 oj；纯前端形态走工程 mock（历史行为不变）
		if (urlPath.startsWith(`${apiBase}/`)) {
			if (ojTarget) {
				void proxyApi(ojTarget)(req, res);
				return;
			}
			const apiRel = urlPath.replace(/^(\.\.[/\\])+/, "");
			const respond = resolveMock(mocks, contractMocks, req.method ?? "get", apiRel.slice(apiBase.length));
			if (!respond) {
				res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
				// AC-D16：信封键为 msg（oj 形态）
				res.end(JSON.stringify({ code: 404, msg: `No mock for ${req.method} ${apiRel}`, data: null }));
				return;
			}
			const chunks: Buffer[] = [];
			req.on("data", chunk => chunks.push(chunk));
			req.on("end", () => {
				let body: Record<string, unknown> = {};
				try {
					body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
				}
				catch {
					// 非 JSON 请求体按空 body 交给 mock 处理
				}
				const payload = respond({
					body,
					query: new URLSearchParams((req.url ?? "").split("?")[1] ?? ""),
				});
				res.writeHead(mockStatusCode(payload), { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify(payload));
			});
			return;
		}

		serveStatic(req, res);
	});

	// 退出回收：server 关闭 → SSE 通道 + oj 子进程一并回收（SIGINT 走同一路径）
	server.on("close", () => {
		hub.close();
		void oj?.stop();
	});
	process.once("SIGINT", () => {
		console.log("\n[ram] 正在退出…");
		// 顺序很重要：SSE 连接永不结束，server.close 必须在 hub 销毁客户端之后
		hub.close();
		void oj?.stop();
		server.close(() => process.exit(0));
		// 1.5s 内没关干净也强制退（oj.stop 内部另有 3s SIGKILL 兜底）
		setTimeout(() => process.exit(0), 1500).unref();
	});

	// 端口被占用时自动顺延，避免 `EADDRINUSE` 直接让 `pnpm dev` 以非零码退出
	const actualPort = await listenOnFreePort(server, opts.port ?? DEFAULT_PORT);
	console.log(`\n[ram] 开发服务器已启动：http://localhost:${actualPort}`);

	if (ojTarget)
		console.log(`[ram] oj 后端已就绪：${apiBase} → ${ojTarget}（api.ts 保存即热更）`);
	else
		console.log("[ram] 纯前端形态（无 api/config.yaml）：/api 由 mock/ 提供");

	console.log("[ram] 宿主来自 @react-antd-module/cli 内置 shell-dist（importmap 单例），模块来自本地 dist/");

	if (!ojTarget && mocks.length)
		console.log(`[ram] 工程 mock：${mocks.length} 条路由（mock/ 目录，重启生效）`);

	console.log(`[ram] 修改 ${layout.modulesSrc} 下的源码会触发重建并自动刷新浏览器。\n`);

	// 4) 监听模块源码（watchTarget 纯源码目录，永不落产物 → 无自触发循环）
	const { createContractRegen } = await import("./contract/watch");
	// 评审 F2：契约重生成后同步重建契约 mock 表——否则 client 按新 schema
	// 校验、mock 按旧 schema 出数，dev 期必现假「契约违例」且需重启恢复
	const regenContracts = createContractRegen(projectRoot, {
		onRegenerated: (result) => {
			if (result.written.length > 0)
				console.log(`[ram-api] 契约产物已更新 ${result.written.length} 个文件——模块重建将自动触发。`);
			loadContractMocks(projectRoot).then(
				(routes) => {
					contractMocks = routes;
				},
				(error: unknown) => {
					console.error(`[ram-api] 契约 mock 表重载失败（沿用旧表）：${error instanceof Error ? error.message : String(error)}`);
				},
			);
		},
	});
	let timer: NodeJS.Timeout | null = null;
	const trigger = () => {
		if (timer)
			clearTimeout(timer);
		timer = setTimeout(async () => {
			try {
				console.log("[ram] 检测到模块源码变更，重建中…");
				await build(projectRoot);
				hub.broadcast();
				console.log("[ram] 重建完成，已通知浏览器刷新。");
			}
			catch (err) {
				console.error("[ram] 重建失败：", err);
			}
		}, 300);
	};
	try {
		watch(layout.watchTarget, { recursive: true }, (_event, filename) => {
			if (!filename)
				return;
			// 契约文件变更：先 runApi 重生成 client（落 modules 树 → 二次触发本 watch 走重建）
			if (filename.endsWith("contract.ts"))
				regenContracts();
			trigger();
		});
	}
	catch {
		// 某些平台不支持 recursive，退化为不自动重建（手动 ram build 仍可用）
	}
	// uni-dev 契约在 api/src（不在模块 watch 范围内），单独挂 watcher
	try {
		const apiSrc = `${projectRoot}/api/src`;
		if (existsSync(apiSrc)) {
			watch(apiSrc, { recursive: true }, (_event, filename) => {
				if (filename?.endsWith("contract.ts"))
					regenContracts();
			});
		}
	}
	catch {
		// 同上：平台不支持 recursive 时退化为手动 ram api
	}

	return server;
}
