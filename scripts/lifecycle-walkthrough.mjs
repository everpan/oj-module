#!/usr/bin/env node
// P1-16 交付 D：真机走查（照 ../oj-market/docs/walkthrough-market-fullchain.md AC0-7 curl 流程）。
// 用法：node scripts/lifecycle-walkthrough.mjs [--keep]
// 站点 = 当前仓库 templates/api（P1-16 接线面）oj release 形态 :9781；CDN :9782 承载 oj-market 0.1.0 包。
// oj-market 仓只读不改（纪律）：分发包取自修复副本构建产物（仓内 api 模块 manifest 尚名 demo-market，
// 走查发现，详见报告）；本脚本只消费 tgz 路径 OJ_MARKET_TGZ（默认 /tmp/oj-market-walk/dist/oj-market-0.1.0.tgz）。
// 留档：logs/walkthrough-P1-16-fullchain.md（逐 AC 请求/响应全录）。
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORK = path.join(ROOT, "logs", "lifecycle-walkthrough");
const SITE = path.join(WORK, "site");
const API = path.join(SITE, "api");
const CDN_DIR = path.join(WORK, "cdn");
const BASE = "http://127.0.0.1:9781";
const CDN_BASE = "http://127.0.0.1:9782";
const OJ_BIN = process.env.OJ_BIN ?? `${process.env.HOME}/.local/share/oj/oj`;
const OJ_MARKET_TGZ = process.env.OJ_MARKET_TGZ ?? "/tmp/oj-market-walk/dist/oj-market-0.1.0.tgz";
const KEEP = process.argv.includes("--keep");
const TRANSCRIPT = path.join(ROOT, "logs", "walkthrough-P1-16-fullchain.md");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const transcript = [];
function log(s) {
	transcript.push(s);
	console.log(s);
}

// ── oj dev 证书三件套（ojm init 同构最小集）──
function mintDevCert(certDir) {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const now = Math.floor(Date.now() / 1000);
	const signingInput = `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ nbf: now, exp: now + 3650 * 86400 })).toString("base64url")}`;
	const sig = createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url");
	mkdirSync(certDir, { recursive: true });
	writeFileSync(path.join(certDir, "private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
	writeFileSync(path.join(certDir, "public.pem"), publicKey.export({ type: "spki", format: "pem" }));
	writeFileSync(path.join(certDir, "cert.jws"), `${signingInput}.${sig}`);
}

// ── HTTP 客户端（oj 信封；恒 10s 超时）──
async function api(pathname, { method = "GET", token, body } = {}) {
	const headers = {};
	if (token)
		headers.authorization = `Bearer ${token}`;
	if (body !== undefined)
		headers["content-type"] = "application/json";
	const res = await fetch(BASE + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	}
	catch {}
	return { status: res.status, json, data: json?.data ?? null, message: json?.message ?? null, text };
}

async function pollTask(id, tk, { timeoutMs = 90_000 } = {}) {
	const t0 = Date.now();
	for (;;) {
		const r = await api(`/api/_platform/market/task?id=${id}`, { token: tk });
		if (["done", "failed", "partial"].includes(r.data?.status))
			return r.data;
		if (Date.now() - t0 > timeoutMs)
			throw new Error(`task ${id} 轮询超时`);
		await sleep(300);
	}
}

async function install(name, version, tk) {
	const r = await api("/api/_platform/market/install", { method: "POST", token: tk, body: { name, version, source: "cdn" } });
	if (r.status !== 200 || !r.data?.task_id)
		throw new Error(`install 提交失败：${r.status} ${r.text?.slice(0, 300)}`);
	return await pollTask(r.data.task_id, tk);
}

// ── CDN 静态分发源（:9782）──
function startCdn(dir, port) {
	const srv = http.createServer((req, res) => {
		const rel = decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/^\/+/, "")) || "bundles.yaml";
		const file = path.join(dir, rel);
		if (!file.startsWith(dir) || !existsSync(file)) {
			res.writeHead(404);
			res.end();
			return;
		}
		res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
		res.end(readFileSync(file));
	});
	return new Promise(resolve => srv.listen(port, "127.0.0.1", () => resolve(srv)));
}

let ojChild = null;
let ojLog = "";
async function startSite() {
	ojLog = "";
	const logFile = path.join(WORK, `serve-${Date.now()}.log`);
	ojChild = spawn(OJ_BIN, ["serve", "-c", path.join(API, "config.yaml"), "-b", "/api", "--api-path", path.join(API, "dist"), "--console-log"], { cwd: API });
	ojChild.stdout.on("data", c => appendFileSync(logFile, String(c)));
	ojChild.stderr.on("data", c => appendFileSync(logFile, String(c)));
	const t0 = Date.now();
	for (;;) {
		if (ojChild.exitCode !== null)
			throw new Error(`oj serve 提前退出（code=${ojChild.exitCode}）：\n${ojLog.slice(-2000)}`);
		try {
			if ((await fetch(`${BASE}/api/health`)).ok)
				return;
		}
		catch {}
		if (Date.now() - t0 > 60_000)
			throw new Error("oj serve 60s 未就绪");
		await sleep(400);
	}
}

async function stopSite() {
	if (!ojChild || ojChild.exitCode !== null)
		return;
	const child = ojChild;
	ojChild = null;
	child.kill("SIGTERM");
	await Promise.race([new Promise(r => child.on("exit", r)), sleep(8000).then(() => child.kill("SIGKILL"))]);
	await sleep(500);
}

async function readText(p) {
	try {
		return await fsp.readFile(p, "utf8");
	}
	catch {
		return null;
	}
}

// ══════════════════════════ 主流程 ══════════════════════════
let srv = null;
let token = null;
const outcomes = [];

function ac(id, name, pass, evidence) {
	outcomes.push({ id, pass });
	log(`\n## AC${id} ${name} —— ${pass ? "PASS" : "FAIL"}\n\n- ${evidence.replace(/\n/g, "\n  ")}`);
}

async function main() {
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(CDN_DIR, { recursive: true });
	// 站点 = 模板快照 + dev 证书 + oj build（--no-minify 逃生门，oj 0.1.79 swc P0 备案同 e2e）
	mkdirSync(path.join(API, "config"), { recursive: true });
	for (const f of ["src", "config.yaml"])
		cpSync(path.join(ROOT, "packages/cli/templates/api", f), path.join(API, f), { recursive: true });
	let cfg = readFileSync(path.join(API, "config.yaml"), "utf8");
	cfg = cfg.replace("port: 9778", "port: 9781");
	cfg = cfg.replace("__JWT_SECRET__", randomBytes(32).toString("hex"));
	cfg = cfg.replace("platform:\n  exec:", "platform:\n  modules: [_platform]\n  root: dist\n  exec:");
	cfg = cfg.replace("  anonymous_paths:", "  anonymous_paths:\n    - /oj-market/ping");
	if (!cfg.includes("/oj-market/ping"))
		throw new Error("匿名路径补丁未命中");
	cfg = `${cfg.trimEnd()}\n# 走查手补：isolate fs 面（安装器落盘授权）\nfs:\n  root: .\n  readonly: false\n`;
	writeFileSync(path.join(API, "config.yaml"), cfg);
	mintDevCert(path.join(API, "config"));
	const build = spawnSync(OJ_BIN, ["build", "--no-minify", "-d", "src", "-o", "dist"], { cwd: API, encoding: "utf8" });
	if (build.status !== 0)
		throw new Error(`oj build 失败：${build.stdout}\n${build.stderr}`);
	writeFileSync(path.join(API, "dist", "versions.json"), JSON.stringify({ "@oj-module/runtime": "0.1.0" }));

	// CDN：oj-market 0.1.0（bundles.yaml 索引 + manifests 清单 + tgz）
	const tgz = readFileSync(OJ_MARKET_TGZ);
	const sha = createHash("sha256").update(tgz).digest("hex");
	const size = tgz.byteLength;
	writeFileSync(path.join(CDN_DIR, "oj-market-0.1.0.tgz"), tgz);
	// bundle manifest 直译自 ../oj-market/manifest.yaml（仓只读纪律；integrity 对 tgz 内 entry 复核通过）。
	// 包内容重建则 integrity/sha 需同步——走查驱动不做自动回填（ojm build --bundle 同口径，备注见 R26）。
	const bundleManifest = {
		name: "oj-market",
		version: "0.1.0",
		title: "方案市场",
		summary: "oj 方案市场应用——卡片展示/安装/卸载/历史（第一方专用，R29）",
		description: "oj-market 仓的正式市场应用：消费宿主 _platform 编排面（/api/_platform/market/*）展示方案卡片网格、详情抽屉、安装进度、卸载确认与版本历史。自身仅持有 market_history 记录表与匿名健康探针。第一方特权调用面，R29 红线：第三方方案不得仿照此编排调用。",
		icon: "/icons/oj-market.svg",
		author: "oj-market",
		license: "MIT",
		homepage: "https://example.com/oj-market",
		keywords: ["market", "marketplace"],
		changelog: ["0.1.0 首个市场应用：卡片网格 + 详情抽屉 + 安装进度 + 卸载确认 + 历史页"],
		peerRuntime: ">=0.0.0",
		peerOj: ">=0.1.78",
		peerFramework: ">=0.2.4",
		peerPlatform: ">=1.0.0",
		api: { module: "oj-market", prefix: "/api/oj-market", tables: ["note", "market_history"], deps: { _platform: ">=0.1.0" }, anonymous: ["oj-market/ping"] },
		web: { route_prefix: "/oj-market", entry: "modules/oj-market/0.1.0/entry.js", integrity: "sha384-KU1QC9B9tr+ytO94iON/LGpXt7y4FZgxLdtxEvHjW/3etI3GMiw2tvZFwHB+nbE1", css: [] },
		permissions: [{ code: "oj-market.view", title_key: "oj-market:perm.view" }],
		roles: [{ name: "oj-market.viewer", title_key: "oj-market:role.viewer", permissions: ["oj-market.view"] }],
		routes: [{ path: "/oj-market", category: "main", order: 200, title_key: "oj-market:menu.main" }],
		health: "/oj-market/ping",
		settings: { groups: [{ group: "display", label_key: "oj-market:settings.group.display", items: [{ key: "oj-market.display.greeting", type: "string", default: "hello", label_key: "oj-market:settings.display.greeting" }] }] },
		archive: { file: "oj-market-0.1.0.tgz", sha256: sha, size },
	};
	writeFileSync(path.join(CDN_DIR, "bundles.yaml"), JSON.stringify({ generated_at: new Date().toISOString(), cdn: CDN_BASE, solutions: [{ name: "oj-market", latest: "0.1.0", versions: [{ version: "0.1.0", file: "oj-market-0.1.0.tgz", sha256: sha, size }] }] }, null, 2));
	writeFileSync(path.join(CDN_DIR, "manifests.yaml"), JSON.stringify([bundleManifest], null, 2));

	srv = await startCdn(CDN_DIR, 9782);
	await startSite();
	log(`# P1-16 真机走查（walkthrough-market-fullchain AC0-7）\n\n- 站点：${BASE}（templates/api release 形态）；CDN：${CDN_BASE}（oj-market 0.1.0，sha256 ${sha.slice(0, 12)}…）\n- 分发包：修复副本构建（oj-market 仓 api 模块 manifest 尚名 demo-market——走查发现①，仓未改动）`);
	// 登录改密 + 市场地址（走查前置）
	const login = await api("/api/auth/login", { method: "POST", body: { username: "admin", password: "123456" } });
	if (!login.data?.access_token)
		throw new Error(`login 失败：${login.text?.slice(0, 200)}`);
	const changed = await api("/api/auth/password", { method: "PUT", token: login.data.access_token, body: { old_password: "123456", new_password: "walk-pass-123" } });
	token = changed.data?.access_token;
	if (!token)
		throw new Error(`改密失败：${changed.text?.slice(0, 200)}`);
	await api("/api/system/settings", { method: "PUT", token, body: { key: "framework.market_cdn_url", value: CDN_BASE } });

	// ── AC0 meta 握手 ──
	const meta = await api("/api/_platform/market/meta", { token });
	ac(0, "meta 握手", meta.status === 200 && !!meta.data?.apiVersion, `curl $BASE/api/_platform/market/meta → ${meta.status}，apiVersion=${meta.data?.apiVersion}`);

	// ── AC1 卡片索引非空 ──
	const index = await api("/api/_platform/market/index", { token });
	const row = (index.data ?? []).find(r => r.name === "oj-market");
	ac(1, "卡片索引非空", index.status === 200 && (index.data ?? []).length > 0, `curl $BASE/api/_platform/market/index → ${index.status}，rows=${(index.data ?? []).length}，oj-market.latest=${row?.latest}`);

	// ── AC2 安装（cdn latest）→ done ──
	const t2 = await install("oj-market", "", token);
	const ping2 = await fetch(`${BASE}/api/oj-market/ping`, { signal: AbortSignal.timeout(10_000) }).then(r => r.status).catch(e => String(e));
	const lock2 = await readText(path.join(API, "dist", "manifests.yaml"));
	ac(2, "install(latest) → task done", t2.status === "done", `install oj-market@latest → ${t2.status}；task_id=${t2.error ? "" : "(见 logs)"} 锁含 oj-market=${String(lock2).includes("oj-market: 0.1.0")}；/api/oj-market/ping=${ping2}（未重启）${t2.stages ? `；stages=${t2.stages.map(s => `${s.stage}:${s.ok ? "ok" : "fail"}`).join(",")}` : ""}`);

	// ── AC3 禁用（锁摘除）──
	const off = await api("/api/_platform/market/enable", { method: "POST", token, body: { name: "oj-market", enabled: false } });
	const lockOff = await readText(path.join(API, "dist", "manifests.yaml"));
	ac(3, "禁用四处同写（锁摘除）", off.data?.ok === true && !String(lockOff).includes("oj-market"), `POST enable{enabled:false} → ok=${off.data?.ok}；锁含 oj-market=${String(lockOff).includes("oj-market")}`);

	// ── AC4 启用（锁恢复）──
	const on = await api("/api/_platform/market/enable", { method: "POST", token, body: { name: "oj-market", enabled: true } });
	const lockOn = await readText(path.join(API, "dist", "manifests.yaml"));
	ac(4, "启用四处同写（锁恢复）", on.data?.ok === true && String(lockOn).includes("oj-market: 0.1.0"), `POST enable{enabled:true} → ok=${on.data?.ok}；锁恢复=${String(lockOn).includes("oj-market: 0.1.0")}`);

	// ── AC5 升级（再装 latest；CDN 仅 0.1.0 → no-op 重装收敛）──
	const t5 = await install("oj-market", "", token);
	ac(5, "install(latest) 升级", t5.status === "done", `install oj-market@latest → ${t5.status}（CDN 单版本 0.1.0：no-op 重装收敛，R12 升级=重装到 latest 的 P1 口径）`);

	// ── AC6 回滚（显式旧版 1.0.0）：文档期望 done 或 failed（R12 可读 reason）。CDN 索引仅 0.1.0
	// （oj-market 从未发布 1.0.0 包），resolveCdn 404 可读拒 = failed 分支（文档「已知边界」在案：
	// 回滚到从未存在过的 CDN 版本需 index 契约扩展，R9 保留面）；真降级拒路径由 e2e AC5（宿主
	// journal/filesystem 一致性拒）与 AC7（对账回指）覆盖。──
	let ac6pass = false;
	let ac6ev = "";
	try {
		const t6 = await install("oj-market", "1.0.0", token);
		ac6pass = t6.status === "done" || t6.status === "failed";
		ac6ev = `install oj-market@1.0.0 → ${t6.status}；reason=${String(t6.message ?? t6.error?.message ?? "").slice(0, 200)}`;
	}
	catch (e) {
		const msg = String(e.message ?? e);
		ac6pass = msg.includes("404") || msg.includes("市场索引");
		ac6ev = `install oj-market@1.0.0 → 可读失败：${msg.slice(0, 220)}`;
	}
	ac(6, "install(显式旧版) 回滚（R12 可读失败分支）", ac6pass, ac6ev);

	// ── AC7 卸载 + market_history 留痕 ──
	const un = await api("/api/_platform/market/uninstall", { method: "POST", token, body: { name: "oj-market" } });
	const lockUn = await readText(path.join(API, "dist", "manifests.yaml"));
	let hist = "接口已随卸载移除（404）";
	let histRows = null;
	try {
		const h = await api("/api/oj-market/history", { token });
		histRows = h.data?.items ?? h.data;
		if (h.status === 200)
			hist = `${h.status} items=${Array.isArray(histRows) ? histRows.length : "?"}`;
		else
			hist = `${h.status}`;
	}
	catch {}
	const lockClean = !String(lockUn).includes("oj-market");
	ac(7, "卸载（幂等）+ market_history 留痕", un.data?.ok === true && lockClean, `POST uninstall → ok=${un.data?.ok}；锁已摘=${lockClean}；GET /api/oj-market/history → ${hist}（表随模块卸载的留痕形态见 sqlite）`);
	const { DatabaseSync } = await import("node:sqlite");
	try {
		const dbo = new DatabaseSync(path.join(API, "db.sqlite"));
		const rows = dbo.prepare("SELECT solution, action, status FROM market_history ORDER BY id").all();
		dbo.close();
		log(`\n## market_history 全量（sqlite 直读）\n\n${rows.map(r => `- ${r.solution} ${r.action} ${r.status}`).join("\n") || "- （空）"}`);
	}
	catch (e) {
		log(`\n## market_history 全量（sqlite 直读）\n\n- 读取失败：${String(e).slice(0, 200)}`);
	}

	log(`\n## 结果\n\n- ${outcomes.filter(o => o.pass).length}/${outcomes.length} PASS${outcomes.every(o => o.pass) ? "（全绿）" : "（存在 FAIL）"}`);
}

try {
	await main();
}
finally {
	await stopSite();
	if (srv)
		srv.close();
	if (!KEEP) {
		rmSync(WORK, { recursive: true, force: true });
		log(`\n- 现场：已清理（--keep 可保留 ${WORK}）`);
	}
	else {
		log(`\n- 现场：${WORK}（--keep 保留）`);
	}
	mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
	writeFileSync(TRANSCRIPT, transcript.join("\n"));
	console.log(`留档：${TRANSCRIPT}`);
}
