/**
 * 静态站点请求处理（dev 与 preview 共用，设计 §4/§6）。
 *
 * 存在式解析：给定一组静态根（按序取第一个命中的文件），宿主 HTML、
 * assets、模块产物、versions.json、favicon 全部自然覆盖，无需逐类分支；
 * 未命中且形似路由（无扩展名 + Accept: text/html）回落宿主 index.html。
 *
 * reload 通道仅 dev 传入（SSE 端点 + 外链脚本注入）；preview 传 null——
 * 生产形态零注入，缓存策略交托管层（不设 no-store）。
 */

import type http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, normalize, resolve } from "node:path";

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".map": "application/json; charset=utf-8",
};

export interface ReloadChannel {
	/** /__ojm_reload.js 的脚本文本（外链，不依赖 CSP nonce） */
	script: string
	/** GET /__ojm_reload 的 SSE handler */
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
}

export interface StaticHandlerOptions {
	/** 静态解析根（按序第一个命中）：dev=[模块产物 dist, shell dist]，preview=[合并站点目录] */
	roots: string[]
	/**
	 * 宿主内容专用根（可选）：`/`、`/index.html`、SPA 回落及一切非模块空间
	 * 路径只从这里读。dev 必须传 [shellDist]——`ojm build` 的合并残留
	 * （index.html/assets/versions.json 拷贝）留在 localDist，多根解析会让
	 * 陈旧拷贝反向遮蔽 shell dist（集中审阅 F11）。preview 不传（单根即合并站点）。
	 */
	hostRoots?: string[]
	/** SSE 刷新通道；null = 生产形态（无端点、无注入） */
	reload: ReloadChannel | null
	/** dev true：开发态禁缓存；preview false */
	noStore: boolean
}

/** 模块空间路径：/modules.json 与 /modules/*（模块产物，localDist 优先） */
function isModulePath(rel: string): boolean {
	return rel === "/modules.json" || rel.startsWith("/modules/");
}

/**
 * 解码请求路径；畸形百分号编码（如 /%ZZ）decodeURIComponent 抛 URIError，
 * 在 http 请求回调里会穿透成 uncaughtException 崩掉整个进程——返回 null，
 * 由调用方回 400（集中审阅 F1）。
 */
export function decodeReqPath(url: string): string | null {
	try {
		return decodeURIComponent(url.split("?")[0]);
	}
	catch {
		return null;
	}
}

/** CSP `script-src 'self' + nonce` 不给内联脚本发 nonce → 刷新逻辑必须外链 */
function injectReloadScript(html: string): string {
	if (html.includes("/__ojm_reload.js"))
		return html;
	return html.replace("</head>", "<script src=\"/__ojm_reload.js\" defer></script></head>");
}

export function createStaticHandler(opts: StaticHandlerOptions): (req: http.IncomingMessage, res: http.ServerResponse) => void {
	const sendFile = (res: http.ServerResponse, filePath: string) => {
		const type = MIME[extname(filePath)] ?? "application/octet-stream";
		res.writeHead(200, { "content-type": type });
		res.end(readFileSync(filePath));
	};
	const resolveFile = (rel: string): string | null => {
		// 模块空间走 roots（dev 里 localDist 优先）；宿主内容归 hostRoots
		const roots = opts.hostRoots && !isModulePath(rel) ? opts.hostRoots : opts.roots;
		for (const root of roots) {
			const filePath = resolve(root, rel.replace(/^\//, ""));
			if (existsSync(filePath) && statSync(filePath).isFile())
				return filePath;
		}
		return null;
	};
	const serveHtml = (res: http.ServerResponse) => {
		// index.html 是宿主内容：dev 在 hostRoots（shell dist），preview 在合并站点目录
		const htmlPath = resolveFile("index.html");
		if (!htmlPath) {
			res.writeHead(500, { "content-type": "text/plain" });
			res.end("index.html not found in static roots");
			return;
		}
		const html = readFileSync(htmlPath, "utf-8");
		res.writeHead(200, { "content-type": MIME[".html"] });
		res.end(opts.reload ? injectReloadScript(html) : html);
	};

	return (req, res) => {
		if (opts.noStore) {
			// 开发态严禁缓存：模块/宿主频繁重建，浏览器若按启发式缓存会一直
			// 复用「修复前」的产物，出现「改了源码、重启 dev、刷新仍报旧错」
			res.setHeader("Cache-Control", "no-store");
		}

		const urlPath = decodeReqPath(req.url ?? "/");
		if (urlPath === null) {
			res.writeHead(400, { "content-type": "text/plain" });
			res.end("400 Bad Request: malformed URL encoding");
			return;
		}
		const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");

		if (opts.reload) {
			if (rel === "/__ojm_reload") {
				opts.reload.handler(req, res);
				return;
			}
			if (rel === "/__ojm_reload.js") {
				res.writeHead(200, { "content-type": MIME[".js"] });
				res.end(opts.reload.script);
				return;
			}
		}

		if (rel === "/" || rel === "/index.html") {
			serveHtml(res);
			return;
		}

		const file = resolveFile(rel);
		if (file) {
			sendFile(res, file);
			return;
		}

		// SPA history fallback：深链接/刷新直达路由路径回落宿主 HTML
		if (!extname(rel) && (req.headers.accept ?? "").includes("text/html")) {
			serveHtml(res);
			return;
		}

		res.writeHead(404, { "content-type": "text/plain" });
		res.end(`404 Not Found: ${rel}`);
	};
}

/**
 * 在 startPort 起尝试监听，遇到 EADDRINUSE 时顺延到下一个端口，最多尝试
 * maxTries 次。返回实际监听的端口。这样「端口被占用」只会改个端口号，
 * 而不会让 `pnpm dev` 直接以 Exit status 1 退出。
 */
export function listenOnFreePort(server: http.Server, startPort: number, maxTries = 10): Promise<number> {
	return new Promise((resolve, reject) => {
		const attempt = (port: number) => {
			server.once("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE" && port - startPort < maxTries) {
					console.warn(`[ojm] 端口 ${port} 已被占用，改用 ${port + 1}`);
					attempt(port + 1);
				}
				else {
					reject(err);
				}
			});
			server.listen(port, () => resolve(port));
		};
		attempt(startPort);
	});
}
