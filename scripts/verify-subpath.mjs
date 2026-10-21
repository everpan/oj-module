// verify-subpath.mjs — 子路径部署（`web.config.ts` 的 `siteBase`）端到端验收。
//
// 链路：造最小模块工程 → `ojm build`（siteBase=/oj）→ 核对产物（importmap / 注入的
// `window.__OJ_BASE__` / modules.json 不带前缀）→ 再以 siteBase 留空重建，核对与
// shell-dist 逐字节一致（零回归）→ 以 `mounts[prefix=/oj]` 起 `oj serve` 跑请求矩阵
// → 可选 headless chromium 核对 basename 真的生效。
//
// 为什么需要这个脚本：`siteBase` 的正确性横跨三个互不共享代码的产物（runtime 预构建
// 包、shell 的 importmap、CLI 的 html 重写），单测只能对撞纯函数；「构建出来的站点在
// 子路径下能不能跑」只有真构建 + 真服务能证明。
//
// 用法：
//   pnpm verify:subpath
//   SKIP_BROWSER=1 pnpm verify:subpath        # 跳过浏览器段（无 chromium 时也会自动跳过）
//   OJ_BIN=/abs/oj PORT=9785 pnpm verify:subpath
//
// 环境变量：OJ_BIN（默认 oj，需在 PATH）、PORT（默认 9785）、SITE（默认
// /tmp/oj-subpath-smoke）、SKIP_BROWSER=1。
//
// 前置：Node ≥ 18；`packages/cli/shell-dist` 已构建（缺失时自动
// `pnpm --filter @oj-module/cli build:shell`）。全绿退出 0，任一断言失败退出 1。

import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OJM = path.join(ROOT, "packages/cli/bin/ojm.mjs");
const SHELL_DIST = path.join(ROOT, "packages/cli/shell-dist");
const OJ_BIN = process.env.OJ_BIN ?? "oj";
const SITE = process.env.SITE ?? "/tmp/oj-subpath-smoke";
const PORT = Number(process.env.PORT ?? 9785);
const SUB = "/oj";
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, ok, detail = "") {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function runOjm(args) {
	const r = spawnSync(process.execPath, [OJM, ...args], { cwd: SITE, encoding: "utf8" });
	return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ───────────────────────────── 0. 前置：宿主产物 ─────────────────────────────

if (!fs.existsSync(path.join(SHELL_DIST, "index.html"))) {
	console.log("[warn] shell-dist 缺失，自动构建宿主 ...");
	const r = spawnSync("pnpm", ["--filter", "@oj-module/cli", "build:shell"], { cwd: ROOT, stdio: "inherit" });
	if (r.status !== 0) {
		console.error("[FAIL] 宿主构建失败；请先手动跑 pnpm --filter @oj-module/cli build:shell");
		process.exit(1);
	}
}

// ─────────────────────────── 1. 夹具：最小模块工程 ───────────────────────────

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(path.join(SITE, "web/src"), { recursive: true });
fs.mkdirSync(path.join(SITE, "config"), { recursive: true });

// entry 只依赖共享表内的 react + runtime（都由宿主 importmap 提供，正好顺带验证
// 「带前缀的 importmap 仍能解析模块产物里的裸说明符」）。路由上挂一个 marker 节点，
// 浏览器段用它证明「深链刷新时 router 匹配到了模块路由」，而不只是渲染了宿主壳。
fs.writeFileSync(
	path.join(SITE, "web/src/entry.ts"),
	[
		"import * as React from \"react\";",
		"import { defineModule } from \"@oj-module/runtime\";",
		"",
		"const Page = () => React.createElement(\"div\", { \"data-testid\": \"fx-page\" }, \"subpath-fx\");",
		"",
		"export default defineModule({",
		"  name: \"subpath-fx\",",
		"  version: \"0.1.0\",",
		"  routes: [{ path: \"/subpath-fx\", element: React.createElement(Page) }],",
		"});",
		"",
	].join("\n"),
);
fs.writeFileSync(
	path.join(SITE, "package.json"),
	`${JSON.stringify({ name: "subpath-fx", private: true, type: "module" }, null, 2)}\n`,
);

/** siteBase 留空即根路径部署（旧行为）；写空串而非省略，保证两次构建走同一条代码路径 */
function writeWebConfig(siteBase) {
	fs.writeFileSync(
		path.join(SITE, "web.config.ts"),
		`export default { siteBase: ${JSON.stringify(siteBase)}, modules: [{ name: "subpath-fx", entry: "web/src/entry.ts" }] };\n`,
	);
}

function build(siteBase) {
	writeWebConfig(siteBase);
	const r = runOjm(["build"]);
	if (r.code !== 0) {
		console.error(r.out);
		throw new Error(`ojm build 失败（siteBase=${JSON.stringify(siteBase)}）`);
	}
	return r.out;
}

// ──────────────────────── 2. 子路径产物：三处缺口都要堵上 ────────────────────────

build(SUB);
const distDir = path.join(SITE, "web/dist");
const indexPath = path.join(distDir, "index.html");
const html = fs.readFileSync(indexPath, "utf8");

const injectMatch = html.match(/<script nonce="([^"]*)">window\.__OJ_BASE__=("[^"]*");<\/script>/);
check(
	`A1 index.html 注入 window.__OJ_BASE__=${JSON.stringify(`${SUB}/`)}`,
	injectMatch?.[2] === JSON.stringify(`${SUB}/`),
	injectMatch ? `实际 ${injectMatch[2]}` : "未找到注入脚本",
);

// 注入必须早于 importmap 与任何 module script：module script 一求值就会读该全局，
// 晚一步就是 `undefined` → basename 回落 "/"（子路径下深链全挂）
const posInject = html.indexOf("window.__OJ_BASE__");
const posImportmap = html.indexOf("<script type=\"importmap\"");
const posModule = html.indexOf("type=\"module\"");
check(
	"A2 注入脚本早于 importmap 与 module script",
	posInject >= 0 && posInject < posImportmap && posInject < posModule,
	`inject=${posInject} importmap=${posImportmap} module=${posModule}`,
);

// CSP 是 script-src 'self' … 'nonce-xxx'：注入脚本不带同一个 nonce 会被浏览器直接拦掉，
// 表现为「注入代码根本不存在」，比没注入更难查
const cspNonces = new Set([...html.matchAll(/'nonce-([^']+)'/g)].map(m => m[1]));
const importmapMatch = html.match(/<script type="importmap" nonce="([^"]*)">([\s\S]*?)<\/script>/);
check(
	"A3 注入脚本复用 importmap 的 nonce（CSP 放行）",
	!!injectMatch && injectMatch[1] === importmapMatch?.[1] && cspNonces.has(injectMatch[1]),
	`inject=${injectMatch?.[1]} importmap=${importmapMatch?.[1]} csp=${[...cspNonces].join(",")}`,
);

let imports = {};
try {
	imports = JSON.parse(importmapMatch?.[2] ?? "{}").imports ?? {};
}
catch {
	// 留给 A4 报红
}
const importValues = Object.values(imports);
check(
	"A4 importmap 全部映射值带 siteBase",
	importValues.length > 0 && importValues.every(v => typeof v === "string" && v.startsWith(`${SUB}/`)),
	`${importValues.length} 条，示例 react=${imports.react}`,
);

// 双前缀是最典型的拼接错（normalizeSiteBase 补尾斜杠后再拼一次）
check("A5 无 /oj// 双斜杠拼接", !html.includes(`${SUB}//`));

const iconMatch = html.match(/<link rel="icon" href="([^"]*)"/);
check("A6 <link rel=icon> 已加前缀", iconMatch?.[1] === `${SUB}/favicon.ico`, `实际 ${iconMatch?.[1]}`);

// 前缀写了但文件对不上同样白屏：逐个核对 importmap 指向的本地资产真的在 dist 里
const missingAssets = importValues
	.filter(v => typeof v === "string" && v.startsWith(`${SUB}/assets/`))
	.map(v => v.slice(SUB.length))
	.filter(rel => !fs.existsSync(path.join(distDir, rel)));
check(
	"A7 importmap 指向的资产在 dist 中全部存在",
	importValues.length > 0 && missingAssets.length === 0,
	missingAssets.length ? `缺 ${missingAssets.slice(0, 3).join(", ")}` : `${importValues.length} 条全部命中`,
);

// modules.json 是「模块产物 URL」，由 runtime 在运行期拼 `${siteBase}${entry}`；
// 若构建期就写死 /oj，运行期会拼成 /oj/oj/modules/...（路由空间/URL 空间混用）
const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "modules.json"), "utf8"));
const manifestUrls = manifest.flatMap(m => [m.entry, ...(m.css ?? []), ...(m.chunks ?? []).map(c => c.url)]);
check(
	"A8 modules.json 保持 baseUrl 前缀（不预先拼 siteBase）",
	manifest.length === 1 && manifestUrls.every(u => u.startsWith("/modules/")),
	`entry=${manifest[0]?.entry}`,
);

// ───────────────────── 3. 零回归：不配 siteBase 时逐字节一致 ─────────────────────

build("");
const plainIndex = path.join(distDir, "index.html");
check(
	"R1 siteBase 留空时 index.html 与 shell-dist 逐字节一致",
	sha256(plainIndex) === sha256(path.join(SHELL_DIST, "index.html")),
	`${sha256(plainIndex).slice(0, 12)}…`,
);
check(
	"R2 留空产物不含 __OJ_BASE__ 注入",
	!fs.readFileSync(plainIndex, "utf8").includes("__OJ_BASE__"),
);

// ──────────────────────── 4. 真服务：子路径挂载的请求矩阵 ────────────────────────

// 恢复子路径产物（服务段验的是「部署形态」，不是根路径形态）
build(SUB);

// oj serve 的证书是硬闸门（无任何绕过开关）：按 bootstrap-host 同款自签一套
{
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const now = Math.floor(Date.now() / 1000);
	const head = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({ nbf: now, exp: now + 3650 * 86400 })).toString("base64url");
	const sig = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(privateKey).toString("base64url");
	fs.writeFileSync(path.join(SITE, "config/private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
	fs.writeFileSync(path.join(SITE, "config/public.pem"), publicKey.export({ type: "spki", format: "pem" }));
	fs.writeFileSync(path.join(SITE, "config/cert.jws"), `${head}.${payload}.${sig}`);
}

// host 必须钉死 127.0.0.1：oj 默认绑 [::1]，探测端连 127.0.0.1 会一直 ECONNREFUSED
fs.writeFileSync(
	path.join(SITE, "serve.yaml"),
	[
		"server:",
		"  host: 127.0.0.1",
		`  port: ${PORT}`,
		"  public_key_path: config/public.pem",
		"  certificate_path: config/cert.jws",
		"mounts:",
		`  - prefix: "${SUB}"`,
		"    web: web/dist",
		"    spa: true",
		"",
	].join("\n"),
);

const serve = spawn(OJ_BIN, ["serve", "-c", "serve.yaml"], {
	cwd: SITE,
	stdio: ["ignore", "pipe", "pipe"],
});
let serveLog = "";
serve.stdout.on("data", (d) => {
	serveLog += d;
});
serve.stderr.on("data", (d) => {
	serveLog += d;
});
function stopServe() {
	try {
		serve.kill("SIGTERM");
	}
	catch {}
}
process.on("exit", stopServe);

let ready = false;
for (let i = 0; i < 60; i++) {
	await sleep(500);
	try {
		if ((await fetch(`${BASE}${SUB}/`)).ok) {
			ready = true;
			break;
		}
	}
	catch {
		// 尚未就绪
	}
}
check(`S0 oj serve 启动且 ${SUB}/ 可用`, ready, ready ? "" : serveLog.slice(-200));
if (!ready) {
	stopServe();
	summarize();
}

/** 只取状态码与 content-type 首段，避免把整包 HTML 读进内存 */
async function probe(urlPath) {
	try {
		const res = await fetch(BASE + urlPath);
		await res.arrayBuffer();
		return { status: res.status, type: (res.headers.get("content-type") ?? "").split(";")[0] };
	}
	catch (error) {
		return { status: 0, type: String(error) };
	}
}

const assetFile = fs.readdirSync(path.join(distDir, "assets")).find(f => f.endsWith(".js") && !f.endsWith(".map"));
const matrix = [
	["S1 站点根", `${SUB}/`, 200, "text/html"],
	["S2 深链（SPA 回落）", `${SUB}/subpath-fx/deep/link`, 200, "text/html"],
	["S3 静态资产", `${SUB}/assets/${assetFile}`, 200, ""],
	["S4 模块清单", `${SUB}/modules.json`, 200, "application/json"],
	["S5 favicon", `${SUB}/favicon.ico`, 200, ""],
	// 旧版产物 HTML 指向的正是这个地址：它 200 说明站点根本没在子路径下，404 才是对的
	["S6 旧产物地址（无前缀）", `/assets/${assetFile}`, 404, ""],
	["S7 无前缀深链", "/subpath-fx/deep/link", 404, ""],
];
for (const [name, urlPath, want, wantType] of matrix) {
	const r = await probe(urlPath);
	check(name, r.status === want && (!wantType || r.type === wantType), `GET ${urlPath} → ${r.status} ${r.type}`);
}

// ────────────────────────── 5. 浏览器：basename 真的生效 ──────────────────────────

await browserCheck();

stopServe();
summarize();

/**
 * headless chromium 段：证明「服务端给了 HTML」之后，客户端也真的把 /oj 当 basename。
 * 无 playwright / 无浏览器 / SKIP_BROWSER=1 时跳过（不算失败：这条依赖本机浏览器安装）。
 */
async function browserCheck() {
	if (process.env.SKIP_BROWSER === "1") {
		console.log("SKIP  浏览器段（SKIP_BROWSER=1）");
		return [];
	}
	let chromium;
	try {
		({ chromium } = await import("@playwright/test"));
	}
	catch {
		console.log("SKIP  浏览器段（未安装 @playwright/test）");
		return [];
	}

	let browser;
	try {
		browser = await chromium.launch();
	}
	catch (error) {
		console.log(`SKIP  浏览器段（chromium 不可用：${String(error).split("\n")[0]}）`);
		return [];
	}

	const problems = [];
	const page = await browser.newPage();
	page.on("pageerror", e => problems.push(`pageerror: ${String(e).slice(0, 160)}`));
	page.on("console", (msg) => {
		const text = msg.text();
		if (msg.type() === "error" && /Failed to resolve module specifier|Failed to load module/i.test(text))
			problems.push(`模块加载失败: ${text.slice(0, 160)}`);
	});

	await page.goto(`${BASE}${SUB}/`, { waitUntil: "networkidle" }).catch(() => {});
	const injectedBase = await page.evaluate(() => globalThis.__OJ_BASE__ ?? null);
	check("B1 运行期 __OJ_BASE__ 为 /oj/", injectedBase === `${SUB}/`, `实际 ${JSON.stringify(injectedBase)}`);

	// 宿主落地 `/` 时重定向到首个模块路由（`<Navigate to={getRoutes()[0].path}/>`）。
	// 这条重定向**必须**经过 router 的 basename：带前缀 = 生效；落到 `/subpath-fx`
	// （无 /oj）说明 basename 还是 "/"，生产上等于每次刷新都在站外。
	const url = page.url();
	check("B2 站内重定向仍落子路径内（router basename 生效）", url === `${BASE}${SUB}/subpath-fx`, url.replace(BASE, ""));

	// 深链刷新 = 子路径部署最常见的故障面：服务端给了 index.html 之后，还得靠
	// basename 剥前缀才匹配得到模块路由（否则命中 catch-all 404）。
	await page.goto(`${BASE}${SUB}/subpath-fx`, { waitUntil: "networkidle" }).catch(() => {});
	const marker = await page.locator("[data-testid=fx-page]").count();
	check("B3 深链刷新命中模块路由（非 catch-all 404）", marker === 1, `marker=${marker}`);

	const styles = await page.evaluate(() => document.styleSheets.length);
	check("B4 样式表已加载", styles > 0, `${styles} 个`);

	const rootHtml = await page.evaluate(() => document.querySelector("#root")?.childElementCount ?? 0);
	check("B5 #root 已挂载（未白屏）", rootHtml > 0, `${rootHtml} 个子节点`);

	check("B6 无 JS 异常 / 模块解析失败", problems.length === 0, problems.slice(0, 2).join(" | "));

	await browser.close();
	return problems;
}

function summarize() {
	const pass = results.filter(r => r.ok).length;
	const fail = results.length - pass;
	console.log(`\n=== 子路径部署验收: PASS=${pass}  FAIL=${fail}  (exit=${fail ? 1 : 0}) ===`);
	process.exit(fail ? 1 : 0);
}
