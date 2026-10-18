#!/usr/bin/env node
// P1-16 交付 D：真机走查（照 ../oj-market/docs/walkthrough-market-fullchain.md AC0-7 curl 流程）。
// 用法：node scripts/lifecycle-walkthrough.mjs [--keep]
// 站点 = 当前仓库 templates/api（P1-16 接线面）oj release 形态 :9781；CDN :9782 承载 oj-market 0.1.0 包。
// oj-market 仓只读不改（纪律）：分发包取自修复副本构建产物（仓内 api 模块 manifest 尚名 demo-market，
// 走查发现，详见报告）；本脚本只消费 tgz 路径 OJ_MARKET_TGZ（默认 /tmp/oj-market-walk/dist/oj-market-0.1.0.tgz）。
// 留档：logs/walkthrough-P1-16-fullchain.md（逐 AC 请求/响应全录）。
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createSign, sign as edSign, generateKeyPairSync, randomBytes } from "node:crypto";
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
const TRANSCRIPT = path.join(ROOT, "logs", "walkthrough-P3-fullchain.md"); // P3-12 留档（P2 期 walkthrough-P2-16-fullchain.md 保留不动）
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

// ── Ed25519 签名链（P2-16：契约 v1.3 §2.11 canonical = <name>@<version>:<sha256hex>）──
const WALK_KEY = (() => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const der = publicKey.export({ format: "der", type: "spki" });
	return {
		keyId: "walk.publisher",
		publicKeyHex: Buffer.from(der.subarray(der.length - 32)).toString("hex"),
		privateKeyObj: privateKey,
	};
})();
function sigFor(name, version, tgzBytes) {
	const canonical = `${name}@${version}:${createHash("sha256").update(tgzBytes).digest("hex")}`;
	const value = edSign(null, Buffer.from(canonical, "utf8"), WALK_KEY.privateKeyObj).toString("base64");
	return { alg: "Ed25519", key_id: WALK_KEY.keyId, public_key: WALK_KEY.publicKeyHex, value, canon: "v1" };
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
		if (["done", "failed", "partial", "needs_trust"].includes(r.data?.status))
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
	// P3-1 在 platform: 下插入 U6 注释块致 `platform:\n  exec:` 字面补丁失配（e2e 同款修复）——锚定行首两个空格的 exec:
	cfg = cfg.replace(/^ {2}exec:/m, "  modules: [_platform]\n  root: dist\n  exec:");
	if (!cfg.includes("modules: [_platform]"))
		throw new Error("platform 段补丁未命中");
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
		// P2-16 实证备注：oj-market 仓 manifest 声明 peerPlatform >=1.0.0，宿主 API_VERSION=0.1.0 →
		// C2-11 预检拒（P2-9 强制生效的真机首证，e2e 前置版本已在案）。走查镜像按宿主口径修订为
		// >=0.1.0（其仓收口时同步；本走查验的是签名链/TOFU/深检语义，非 C2-11）。
		peerPlatform: ">=0.1.0",
		api: { module: "oj-market", prefix: "/api/oj-market", tables: ["note", "market_history"], deps: { _platform: ">=0.1.0" }, anonymous: ["oj-market/ping"] },
		web: { route_prefix: "/oj-market", entry: "modules/oj-market/0.1.0/entry.js", integrity: "sha384-KU1QC9B9tr+ytO94iON/LGpXt7y4FZgxLdtxEvHjW/3etI3GMiw2tvZFwHB+nbE1", css: [] },
		permissions: [{ code: "oj-market.view", title_key: "oj-market:perm.view" }],
		roles: [{ name: "oj-market.viewer", title_key: "oj-market:role.viewer", permissions: ["oj-market.view"] }],
		routes: [{ path: "/oj-market", category: "main", order: 200, title_key: "oj-market:menu.main" }],
		health: "/oj-market/ping",
		settings: { groups: [{ group: "display", label_key: "oj-market:settings.group.display", items: [{ key: "oj-market.display.greeting", type: "string", default: "hello", label_key: "oj-market:settings.display.greeting" }] }] },
		archive: { file: "oj-market-0.1.0.tgz", sha256: sha, size, signature: sigFor("oj-market", "0.1.0", tgz) },
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

	// ── AC-P2-1 未签名装不上（G4 fail-closed）：摘除 manifest 签名 → sig_missing 拒；锁零改动 ──
	const signedManifests = readFileSync(path.join(CDN_DIR, "manifests.yaml"), "utf8");
	const unsigned = JSON.parse(signedManifests);
	delete unsigned[0].archive.signature;
	writeFileSync(path.join(CDN_DIR, "manifests.yaml"), JSON.stringify(unsigned, null, 2));
	const tU = await install("oj-market", "", token);
	const lockU = await readText(path.join(API, "dist", "manifests.yaml"));
	const unsignedMsg = `${tU.message ?? ""} ${tU.stages?.map(x => x.message ?? "").join(" ") ?? ""}`;
	ac("P2-1", "未签名装不上（sig_missing，零落盘）", tU.status === "failed" && tU.stage === "verifying" && unsignedMsg.includes("sig_missing") && !String(lockU).includes("oj-market"), `install（无签名 manifest）→ ${tU.status}@${tU.stage}；锁含 oj-market=${String(lockU).includes("oj-market")}；msg=${unsignedMsg.slice(0, 90)}`);
	writeFileSync(path.join(CDN_DIR, "manifests.yaml"), signedManifests);

	// ── AC-P2-2 篡改包不落盘：服务侧翻转 tgz 字节 → 实收 sha ≠ 索引声明 → failed@verifying ──
	const honestTgz = readFileSync(path.join(CDN_DIR, "oj-market-0.1.0.tgz"));
	const corrupt = Buffer.from(honestTgz);
	corrupt[16] ^= 0xFF;
	writeFileSync(path.join(CDN_DIR, "oj-market-0.1.0.tgz"), corrupt);
	const tT = await install("oj-market", "", token);
	const lockT = await readText(path.join(API, "dist", "manifests.yaml"));
	const tamperedMsg = `${tT.message ?? ""} ${tT.stages?.map(x => x.message ?? "").join(" ") ?? ""}`;
	ac("P2-2", "篡改包不落盘（sha 不符拒@verifying）", tT.status === "failed" && tT.stage === "verifying" && !String(lockT).includes("oj-market"), `install（篡改 tgz）→ ${tT.status}@${tT.stage}；锁含 oj-market=${String(lockT).includes("oj-market")}；msg=${tamperedMsg.slice(0, 90)}`);
	writeFileSync(path.join(CDN_DIR, "oj-market-0.1.0.tgz"), honestTgz);

	// ── AC2 安装（cdn latest；陌生发布方 → TOFU 确认 → done）──
	const t2a = await install("oj-market", "", token);
	if (t2a.status !== "needs_trust")
		throw new Error(`TOFU 首装终态=${t2a.status}（期望 needs_trust）：${t2a.message}`);
	log(`- TOFU：needs_trust 指纹=${t2a.trust?.fingerprint?.slice(0, 16)}… key_id=${t2a.trust?.key_id}`);
	const confirm = await api("/api/_platform/market/trust", { method: "POST", token, body: { task_id: t2a.id } });
	const t2 = await install("oj-market", "", token);
	const ping2 = await fetch(`${BASE}/api/oj-market/ping`, { signal: AbortSignal.timeout(10_000) }).then(r => r.status).catch(e => String(e));
	const lock2 = await readText(path.join(API, "dist", "manifests.yaml"));
	ac(2, "install(latest)：TOFU 确认后 → task done", t2.status === "done" && confirm.status === 200, `install → needs_trust → POST trust{task_id}=${confirm.status} → 重装 ${t2.status}；锁含 oj-market: 0.1.0=${String(lock2).includes("oj-market: 0.1.0")}；/api/oj-market/ping=${ping2}（未重启，restart_pending）${t2.stages ? `；stages=${t2.stages.map(x => `${x.stage}:${x.ok ? "ok" : "fail"}`).join(",")}` : ""}`);

	// ── AC3 禁用（锁摘除）──
	const off = await api("/api/_platform/market/enable", { method: "POST", token, body: { name: "oj-market", enabled: false } });
	const lockOff = await readText(path.join(API, "dist", "manifests.yaml"));
	ac(3, "禁用四处同写（锁摘除）", off.data?.ok === true && !String(lockOff).includes("oj-market"), `POST enable{enabled:false} → ok=${off.data?.ok}；锁含 oj-market=${String(lockOff).includes("oj-market")}`);

	// ── AC4 启用（锁恢复）──
	const on = await api("/api/_platform/market/enable", { method: "POST", token, body: { name: "oj-market", enabled: true } });
	const lockOn = await readText(path.join(API, "dist", "manifests.yaml"));
	ac(4, "启用四处同写（锁恢复）", on.data?.ok === true && String(lockOn).includes("oj-market: 0.1.0"), `POST enable{enabled:true} → ok=${on.data?.ok}；锁恢复=${String(lockOn).includes("oj-market: 0.1.0")}`);

	// ── AC-P2-6 匿名握手（restart 后生效：anonymous_paths 热改属 restart_pending，S1-5）──
	await stopSite();
	await startSite();
	const pingAnon = await fetch(`${BASE}/api/oj-market/ping`, { signal: AbortSignal.timeout(10_000) }).then(r => r.status).catch(e => String(e));
	ac("P2-6", "匿名握手（重启后无凭据 200）", pingAnon === 200, `重启 oj serve → GET /api/oj-market/ping（无 Authorization）→ ${pingAnon}（config 预声明 + P2-15 接线幂等并存；S1-5 restart_pending 语义实证）`);

	// ── AC5 升级（再装 latest；CDN 仅 0.1.0 → no-op 重装收敛）──
	const t5 = await install("oj-market", "", token);
	ac(5, "install(latest) 升级", t5.status === "done", `install oj-market@latest → ${t5.status}（CDN 单版本 0.1.0：no-op 重装收敛，R12 升级=重装到 latest 的 P1 口径）`);

	// ── AC-P2-3 吊销后拒升级（G5：revoked = unknown → needs_trust；锁版本不动）+ 恢复 ──
	const rev = await api("/api/_platform/market/trust/key?key_id=walk.publisher", { method: "DELETE", token });
	const tRev = await install("oj-market", "", token);
	const lockRev = await readText(path.join(API, "dist", "manifests.yaml"));
	ac("P2-3", "吊销后拒升级（needs_trust，锁版本不动）", rev.data?.revoked === true && tRev.status === "needs_trust" && String(lockRev).includes("oj-market: 0.1.0"), `DELETE trust/key → revoked=${rev.data?.revoked}；install → ${tRev.status}；锁含 0.1.0=${String(lockRev).includes("oj-market: 0.1.0")}`);
	await api("/api/_platform/market/trust/key", { method: "POST", token, body: { key_id: WALK_KEY.keyId, public_key: WALK_KEY.publicKeyHex } }); // 恢复信任（AC5/AC7 无依赖，落库留证）

	// ── AC-P2-4 深检（报告结构 + verify/last）──
	const vf = await api("/api/_platform/solutions/verify?name=oj-market", { method: "POST", token });
	const vfLast = await api("/api/_platform/solutions/verify/last?name=oj-market", { token });
	// 语义同 e2e P2-6：API-only 走查站点无 SPA 宿主 → routes 404 被深检如实上报（ok=false 是检测能力的证据）
	const vfRoutes = (vf.data?.checks ?? []).filter(c => c.id === "routes");
	ac("P2-4", "深检报告 {ok,checks,advise} + verify/last（如实检出 routes 不可达）", vf.status === 200 && typeof vf.data?.ok === "boolean" && vfRoutes.length >= 1 && vfRoutes.every(c => c.severity === "error" && c.advise_key === "lifecycle.verify.routes.anomaly") && vfLast.status === 200 && vfLast.data?.ok === vf.data?.ok, `verify=${vf.status} ok=${vf.data?.ok}（API-only 站点 → routes 404 如实上报）checks=${JSON.stringify(vf.data?.checks)?.slice(0, 200)} last=${vfLast.status}`);

	// ── AC-P2-5 索引聚合（available[]/trust_state/key_id/operator，P2-11 扩展）──
	const idxP2 = await api("/api/_platform/market/index", { token });
	const om = (idxP2.data ?? []).find(r => r.name === "oj-market");
	ac("P2-5", "索引聚合字段齐", idxP2.status === 200 && Array.isArray(om?.available) && om.trust_state === "trusted" && om.key_id === WALK_KEY.keyId, `available=${JSON.stringify(om?.available)} trust=${om?.trust_state} key=${om?.key_id} operator=${om?.operator}`);

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

	// ══ P3 走查（P3-12，AC-P3-1/2/4 真机；P3-3/5/6 备案指向 e2e——见段末备案注记）══
	const OJM_CLI = path.join(ROOT, "packages/cli/bin/ojm.mjs");
	// ── AC-P3-4 ojm publish：索引重算 + Ed25519 签名侧车 + 宿主验签正/反两向 ──
	log("\n## P3 走查（AC-P3-1/2/4 真机；P3-3/5/6 见段末备案）\n");
	const pemPath = path.join(WORK, "walk-publisher-private.pem");
	writeFileSync(pemPath, WALK_KEY.privateKeyObj.export({ type: "pkcs8", format: "pem" }));
	const pub = spawnSync(process.execPath, [OJM_CLI, "publish", CDN_DIR, "--id", WALK_KEY.keyId, "--key", pemPath, "--check"], { encoding: "utf8" });
	const sigB = existsSync(path.join(CDN_DIR, "bundles.yaml.sig"));
	const sigM = existsSync(path.join(CDN_DIR, "manifests.yaml.sig"));
	const tPub = await install("oj-market", "", token);
	ac("P3-4", "ojm publish 索引重算+签名（.sig 侧车）+ 宿主验签重装 done", pub.status === 0 && sigB && sigM && tPub.status === "done", `ojm publish ${CDN_DIR} --id ${WALK_KEY.keyId} --check → exit=${pub.status}；bundles.yaml.sig=${sigB} manifests.yaml.sig=${sigM}；install（签名在场）→ ${tPub.status}（宿主验签通过才可达 resolveCdn）`);
	// 反向（G4 fail-closed）：篡改 bundles.yaml → 实收字节与 .sig 不符 → install 502
	const bundlesBak = readFileSync(path.join(CDN_DIR, "bundles.yaml"), "utf8");
	writeFileSync(path.join(CDN_DIR, "bundles.yaml"), `${bundlesBak}\n# tampered-by-walkthrough\n`);
	const tamperRes = await api("/api/_platform/market/install", { method: "POST", token, body: { name: "oj-market", version: "0.1.0", source: "cdn" } });
	writeFileSync(path.join(CDN_DIR, "bundles.yaml"), bundlesBak);
	ac("P3-4b", "索引篡改 → 宿主验签 fail-closed 502（G4）", tamperRes.status === 502, `install（篡改 bundles.yaml）→ ${tamperRes.status} ${String(tamperRes.message ?? "").slice(0, 80)}`);
	// ── AC-P3-1 卸载影响面预检计数（授 admin 以 oj-market.viewer → 1 角色 1 用户）──
	const { DatabaseSync: WalkDb } = await import("node:sqlite");
	{
		const dbo = new WalkDb(path.join(API, "db.sqlite"));
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "oj-market.viewer");
		dbo.close();
	}
	const impact = await api("/api/_platform/market/uninstall-impact?name=oj-market", { token });
	ac("P3-1", "卸载影响面预检计数（affectedRoles/affectedUsers）", impact.status === 200 && impact.data?.affectedRoles === 1 && impact.data?.affectedUsers === 1, `curl $BASE/api/_platform/market/uninstall-impact?name=oj-market → ${impact.status}，${JSON.stringify(impact.data)}（授 admin 以 oj-market.viewer 后计数非零）`);
	// ── AC-P3-2 superadmin 门（非 super 身份 → 403）──
	await api("/api/system/users", { method: "POST", token, body: { username: "staff", password: "staff-pass-123", displayName: "walk staff" } });
	const staffLogin = await api("/api/auth/login", { method: "POST", body: { username: "staff", password: "staff-pass-123" } });
	const staffChanged = await api("/api/auth/password", { method: "PUT", token: staffLogin.data?.access_token, body: { old_password: "staff-pass-123", new_password: "staff-pass-456" } });
	const staffToken = staffChanged.data?.access_token;
	const staffImpact = await api("/api/_platform/market/uninstall-impact?name=oj-market", { token: staffToken });
	const staffUninstall = await api("/api/_platform/market/uninstall", { method: "POST", token: staffToken, body: { name: "oj-market" } });
	ac("P3-2", "superadmin 门：非 super 身份 uninstall-impact / uninstall → 403", staffImpact.status === 403 && staffUninstall.status === 403, `staff（无 superadmin 角色）impact=${staffImpact.status} uninstall=${staffUninstall.status}（拒权不泄露存在性）`);
	log("\n### P3 备案\n\n- AC-P3-3（GC N=3）/ AC-P3-5（卸载重装不复活授权）/ AC-P3-6（取消安装）：走查站点仅 oj-market 一个已锁方案——卸载触发空锁拒启（S1-1.2）、GC/取消需多版本安装链，真机覆盖见 scripts/lifecycle-e2e.mjs AC-P3-3/5/6（oj 0.1.80 同宿主）。");

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

	log(`\n## 结果（AC0-7 + AC-P2-1~6 + AC-P3-1/2/4）\n\n- ${outcomes.filter(o => o.pass).length}/${outcomes.length} PASS${outcomes.every(o => o.pass) ? "（全绿）" : "（存在 FAIL）"}`);
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
