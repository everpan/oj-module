#!/usr/bin/env node
// P1-16 e2e（AC-P1-1~20 总验）：真宿主（oj release 形态）全链 BDD 断言。
// 用法：node scripts/lifecycle-e2e.mjs [--keep]
//   --keep  保留现场目录 logs/lifecycle-e2e/（默认跑完即清；报告恒保留 logs/lifecycle-e2e-report.md）。
// 布局：站点 = logs/lifecycle-e2e/site（ojm init 等价物：模板 api + dev 证书 + oj build + oj serve release 形态），
//       CDN 分发源 = logs/lifecycle-e2e/cdn（本脚本内建 http 服务 :9782）。
// 端口纪律：站点 9781 / CDN 9782（9778 主线保留禁用），finally 兜底 kill。
// 前置：oj 0.1.78 在 ~/.local/share/oj/oj（plugins 同目录可发现；`oj` 在 PATH 供 exec 白名单 migrate）。
// 场景时间线：boot → 登录改密 → 配 CDN → install 0.1.0（AC1/14/15/16/17/19）→ 升级 0.2.0（AC4/12，捕 db bak）
//   → 同版重装（AC3）→ partial 演练（AC13/14-partial）→ M004 账本回退自愈（AC7）→ 显式回滚收敛（AC5 备案）
//   → 禁用/启用（AC6）→ 恶意 tgz / 契约违规拒装（AC8/10/11）→ release 重启不拒启（AC2）→ 报告（AC18/20 汇总）。
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createSign, sign as edSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORK = path.join(ROOT, "logs", "lifecycle-e2e");
const SITE = path.join(WORK, "site");
const API = path.join(SITE, "api");
const CDN_DIR = path.join(WORK, "cdn");
const BASE = "http://127.0.0.1:9781";
const CDN_BASE = "http://127.0.0.1:9782";
const OJ_BIN = process.env.OJ_BIN ?? `${process.env.HOME}/.local/share/oj/oj`;
const KEEP = process.argv.includes("--keep");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = d => createHash("sha256").update(d).digest("hex");

// ── BDD 断言账本（exit 1 若有 FAIL）──
const results = [];
function ac(id, name, pass, evidence) {
	results.push({ id, name, pass, evidence });
	const tag = String(id).startsWith("P2") || String(id).startsWith("P3") ? "AC-" : "AC-P1-";
	console.log(`${pass ? "PASS" : "FAIL"} ${tag}${id}\t${name}\t— ${evidence}`);
}
function must(cond, msg) {
	if (!cond)
		throw new Error(`断言失败：${msg}`);
}

// ── oj dev 证书三件套（ojm init mintDevCert 同构：现场生成，JWS 仅 nbf/exp）──
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

// ── Ed25519 签名链（P2-3 契约 v1.3 §2.11：canonical = <name>@<version>:<sha256hex>；G4 硬 fail-closed）──
const E2E_KEY = (() => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const der = publicKey.export({ format: "der", type: "spki" });
	return {
		keyId: "e2e.publisher",
		publicKeyHex: Buffer.from(der.subarray(der.length - 32)).toString("hex"),
		privateKeyObj: privateKey,
	};
})();
const STRANGER_KEY = (() => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const der = publicKey.export({ format: "der", type: "spki" });
	return {
		keyId: "stranger.publisher",
		publicKeyHex: Buffer.from(der.subarray(der.length - 32)).toString("hex"),
		privateKeyObj: privateKey,
	};
})();
function sigFor(name, version, tgzBytes, key = E2E_KEY) {
	const canonical = `${name}@${version}:${sha256(tgzBytes)}`;
	const value = edSign(null, Buffer.from(canonical, "utf8"), key.privateKeyObj).toString("base64");
	return { alg: "Ed25519", key_id: key.keyId, public_key: key.publicKeyHex, value, canon: "v1" };
}

// ── HTTP 小客户端（oj 信封 {data,...}；恒 10s 超时——站点死亡快速失败不挂死）──
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
	return { status: res.status, json, data: json?.data ?? null, message: json?.message ?? null };
}

async function pollTask(id, token, { timeoutMs = 90_000 } = {}) {
	const t0 = Date.now();
	for (;;) {
		const r = await api(`/api/_platform/market/task?id=${id}`, { token });
		if (["done", "failed", "partial", "needs_trust"].includes(r.data?.status))
			return r.data;
		if (Date.now() - t0 > timeoutMs)
			throw new Error(`task ${id} 轮询超时：${JSON.stringify(r.json)?.slice(0, 300)}`);
		await sleep(300);
	}
}

async function install(name, version, tk) {
	const r = await api("/api/_platform/market/install", { method: "POST", token: tk, body: { name, version, source: "cdn" } });
	if (r.status !== 200 || !r.data?.task_id)
		throw new Error(`install ${name}@${version} 提交失败：${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
	return await pollTask(r.data.task_id, tk);
}

// ── CDN 静态分发源（:9782）：记录请求 cache-control（no-cache 断言），响应恒 no-store ──
function startCdn(dir, port) {
	const hits = [];
	const srv = http.createServer((req, res) => {
		const rel = decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/^\/+/, "")) || "bundles.yaml";
		hits.push({ path: `/${rel}`, requestCacheControl: req.headers["cache-control"] ?? null });
		const file = path.join(dir, rel);
		if (!file.startsWith(dir) || !existsSync(file)) {
			res.writeHead(404);
			res.end();
			return;
		}
		res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
		res.end(readFileSync(file));
	});
	return new Promise((resolve) => {
		srv.listen(port, "127.0.0.1", () => resolve({ srv, hits }));
	});
}

// ── 方案包构建（§2.9 单根布局；0.1.0/0.2.0 迁移递进）──
function solutionManifest(v, sha, size, sig = null) {
	return {
		name: "demo-solution",
		version: v,
		summary: "e2e demo solution",
		peerRuntime: ">=0.1.0",
		archive: { file: `demo-solution-${v}.tgz`, sha256: sha, size, ...(sig ? { signature: sig } : {}) },
		health: "/demo-solution/ping",
		api: { prefix: "/api/demo-solution", anonymous: ["demo-solution/ping"] },
		web: { entry: `modules/demo-solution/${v}/entry.js`, css: [`modules/demo-solution/${v}/main.css`] },
		routes: [
			{ path: "/demo-solution", category: "main", order: 200, title_key: "demo-solution:menu.main" },
			{ path: "/demo-solution/ping", category: "hidden", order: 205, title_key: "demo-solution:menu.ping" },
		],
		permissions: [{ code: "demo-solution.view", title_key: "demo-solution:perm.view" }],
		roles: [{ name: "demo-solution.admin", title_key: "demo-solution:role.admin", permissions: ["demo-solution.view"] }],
		settings: { groups: [{ group: "display", label_key: "demo-solution:settings.group.display", items: [{ key: "demo-solution.display.theme", type: "enum", options: ["dark", "light"] }] }] },
	};
}

function buildDemoTree(stageDir, v) {
	const mod = path.join(stageDir, `demo-solution-${v}`, "api", `demo-solution-${v}`);
	const web = path.join(stageDir, `demo-solution-${v}`, "web", "modules", "demo-solution", v);
	mkdirSync(path.join(mod, "migrations"), { recursive: true });
	mkdirSync(path.join(mod, "ping"), { recursive: true });
	mkdirSync(web, { recursive: true });
	writeFileSync(path.join(stageDir, `demo-solution-${v}`, "manifest.yaml"), JSON.stringify(solutionManifest(v, "", 0)));
	writeFileSync(path.join(mod, "manifest.yaml"), `name: demo-solution\ndesc: e2e demo solution\nversion: ${v}\ntables:\n  - demo_note\n`);
	writeFileSync(path.join(mod, "routes.js"), "export default [{ method: \"get\", pattern: \"demo-solution/ping\", file: \"ping/api.js\" }];\n");
	writeFileSync(path.join(mod, "ping", "api.js"), `export default { async get() { return { pong: true, module: "demo-solution", version: "${v}" }; } };\n`);
	writeFileSync(path.join(mod, "migrations", "0001__init.sql"), "CREATE TABLE demo_note (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n");
	// P3-12 GC 链：0001~0005 跨版本逐字节一致（oj 迁移 checksum 要求）；每版只增不改
	if (v >= "0.2.0")
		writeFileSync(path.join(mod, "migrations", "0002__add_done.sql"), "ALTER TABLE demo_note ADD COLUMN done INTEGER NOT NULL DEFAULT 0;\n");
	if (v >= "0.3.0")
		writeFileSync(path.join(mod, "migrations", "0003__add_note3.sql"), "ALTER TABLE demo_note ADD COLUMN note3 INTEGER NOT NULL DEFAULT 0;\n");
	if (v >= "0.4.0")
		writeFileSync(path.join(mod, "migrations", "0004__add_note4.sql"), "ALTER TABLE demo_note ADD COLUMN note4 INTEGER NOT NULL DEFAULT 0;\n");
	if (v >= "0.5.0")
		writeFileSync(path.join(mod, "migrations", "0005__add_note5.sql"), "ALTER TABLE demo_note ADD COLUMN note5 INTEGER NOT NULL DEFAULT 0;\n");
	writeFileSync(path.join(web, "entry.js"), `console.log("demo-solution ${v}");\n`);
	writeFileSync(path.join(web, "main.css"), `.demo-solution-v${v.replace(/\./g, "-")} { color: red; }\n`);
}

function tarCzf(cwd, name, members, extraArgs = []) {
	const r = spawnSync("tar", ["-czf", name, ...extraArgs, ...members], { cwd });
	if (r.status !== 0)
		throw new Error(`tar 失败：${String(r.stderr)}`);
	const bytes = readFileSync(path.join(cwd, name));
	return { bytes, sha: sha256(bytes), size: bytes.byteLength };
}

function buildCdnBundles() {
	// demo-solution 0.1.0/0.2.0（0001 两版逐字节一致——oj 迁移 checksum 要求）
	const manifests = [];
	const versions = [];
	const index = { generated_at: new Date().toISOString(), cdn: CDN_BASE, solutions: [] };
	for (const v of ["0.1.0", "0.2.0"]) {
		const stage = path.join(CDN_DIR, `stage-${v}`);
		mkdirSync(stage, { recursive: true });
		buildDemoTree(stage, v);
		// AC-P1-18：同一棵树 tar 两次 → sha256 一致（确定性 tgz）
		const a = tarCzf(stage, "a.tgz", [`demo-solution-${v}`]);
		const b = tarCzf(stage, "b.tgz", [`demo-solution-${v}`]);
		rmSync(path.join(stage, "a.tgz"));
		rmSync(path.join(stage, "b.tgz"));
		writeFileSync(path.join(CDN_DIR, `demo-solution-${v}.tgz`), a.bytes);
		manifests.push(solutionManifest(v, a.sha, a.size, sigFor("demo-solution", v, a.bytes)));
		versions.push({ version: v, file: `demo-solution-${v}.tgz`, sha256: a.sha, size: a.size });
		results.push({ id: "18", name: "确定性 tgz（同树两次 tar sha 一致）", pass: a.sha === b.sha, evidence: `demo-solution-${v} sha=${a.sha.slice(0, 12)}…` });
	}
	index.solutions.push({ name: "demo-solution", latest: "0.2.0", versions: versions.reverse() });
	// evil A：契约违规（权限键越空间 other.view + 匿名越段 othermod/ping）→ failed@preflight
	const evilA = {
		name: "evil-solution",
		version: "9.9.9",
		summary: "contract violating bundle",
		archive: { file: "evil-solution-9.9.9.tgz", sha256: "0".repeat(64), size: 17 },
		api: { prefix: "/api/evil-solution", anonymous: ["othermod/ping"] },
		web: { entry: "modules/evil-solution/9.9.9/entry.js" },
		routes: [{ path: "/evil-solution", category: "main", order: 300, title_key: "evil-solution:menu.main" }],
		permissions: [{ code: "other.view", title_key: "evil-solution:perm.x" }],
		roles: [{ name: "evil-solution.admin", title_key: "evil-solution:role.admin", permissions: ["other.view"] }],
		settings: { groups: [] },
	};
	// evil B：manifest 干净但 tgz 含 ../ 越界成员 → failed@extracting（R1 三步范式拒收）
	const evilB = {
		name: "evil-pack",
		version: "1.0.0",
		summary: "zip-slip bundle",
		archive: { file: "evil-pack-1.0.0.tgz", sha256: "", size: 0 },
		api: { prefix: "/api/evil-pack", anonymous: [] },
		web: { entry: "modules/evil-pack/1.0.0/entry.js" },
		routes: [{ path: "/evil-pack", category: "main", order: 301, title_key: "evil-pack:menu.main" }],
		permissions: [{ code: "evil-pack.view", title_key: "evil-pack:perm.view" }],
		roles: [{ name: "evil-pack.admin", title_key: "evil-pack:role.admin", permissions: ["evil-pack.view"] }],
		settings: { groups: [] },
	};
	const evilStage = path.join(CDN_DIR, "stage-evil");
	mkdirSync(path.join(evilStage, "evil-pack-1.0.0", "web", "modules", "evil-pack", "1.0.0"), { recursive: true });
	writeFileSync(path.join(evilStage, "evil-pack-1.0.0", "manifest.yaml"), JSON.stringify(evilB));
	writeFileSync(path.join(evilStage, "evil-pack-1.0.0", "web", "modules", "evil-pack", "1.0.0", "entry.js"), "console.log('evil');\n");
	writeFileSync(path.join(evilStage, "evil.js"), "console.log('slipped');\n");
	// bsdtar 不直收 ../ 成员——-s 改名注入（zip-slip 攻击面等价构造）
	const eb = tarCzf(evilStage, "evil-pack-1.0.0.tgz", ["evil-pack-1.0.0", "evil.js"], ["-s", ",^evil\\.js$,../evil.js,"]);
	evilB.archive.sha256 = eb.sha;
	evilB.archive.size = eb.size;
	evilB.archive.signature = sigFor("evil-pack", "1.0.0", eb.bytes); // P2-3 起 verify 先于 extracting：zip-slip 场景须签名在场才可到达 R1 守卫
	writeFileSync(path.join(CDN_DIR, "evil-pack-1.0.0.tgz"), eb.bytes);
	writeFileSync(path.join(CDN_DIR, "evil-solution-9.9.9.tgz"), Buffer.from("never-downloaded\n"));
	// evil 方案也须进索引（resolveCdn 先查 bundles.yaml，缺条目 404 挡在 preflight 之前——
	// evil-solution 的 tgz 永不被下载：preflight 是第一阶段，sha256 校验在 downloading 之后）
	index.solutions.push(
		{ name: "evil-solution", latest: "9.9.9", versions: [{ version: "9.9.9", file: "evil-solution-9.9.9.tgz", sha256: evilA.archive.sha256, size: evilA.archive.size }] },
		{ name: "evil-pack", latest: "1.0.0", versions: [{ version: "1.0.0", file: "evil-pack-1.0.0.tgz", sha256: eb.sha, size: eb.size }] },
	);
	// ── P2-16 签名链三态夹具（nosig 未签名 / tampered 篡改 / stranger 陌生方 TOFU）──
	function simpleManifest(name, v, sha, size, sig) {
		return {
			name,
			version: v,
			summary: `e2e ${name}`,
			peerRuntime: ">=0.1.0",
			archive: { file: `${name}-${v}.tgz`, sha256: sha, size, ...(sig ? { signature: sig } : {}) },
			api: { prefix: `/api/${name}`, anonymous: [] },
			web: { entry: `modules/${name}/${v}/entry.js` },
			routes: [{ path: `/${name}`, category: "hidden", order: 260, title_key: `${name}:menu.main` }],
			permissions: [{ code: `${name}.view`, title_key: `${name}:perm.view` }],
			roles: [{ name: `${name}.viewer`, title_key: `${name}:role.viewer`, permissions: [`${name}.view`] }],
			settings: { groups: [] },
		};
	}
	function buildSimple(stageDir, name, v) {
		const mod = path.join(stageDir, `${name}-${v}`, "api", `${name}-${v}`);
		const web = path.join(stageDir, `${name}-${v}`, "web", "modules", name, v);
		mkdirSync(path.join(mod, "migrations"), { recursive: true });
		mkdirSync(path.join(mod, "ping"), { recursive: true });
		mkdirSync(web, { recursive: true });
		writeFileSync(path.join(stageDir, `${name}-${v}`, "manifest.yaml"), JSON.stringify(simpleManifest(name, v, "", 0)));
		writeFileSync(path.join(mod, "manifest.yaml"), `name: ${name}\ndesc: e2e ${name}\nversion: ${v}\n`);
		writeFileSync(path.join(mod, "routes.js"), `export default [{ method: "get", pattern: "${name}/ping", file: "ping/api.js" }];\n`);
		writeFileSync(path.join(mod, "ping", "api.js"), `export default { async get() { return { pong: true, module: "${name}" }; } };\n`);
		writeFileSync(path.join(mod, "migrations", "0001__init.sql"), `CREATE TABLE ${name.replace(/-/g, "_")}_note (id INTEGER PRIMARY KEY);\n`);
		writeFileSync(path.join(web, "entry.js"), `console.log("${name} ${v}");\n`);
	}
	const p2Variants = [];
	for (const [name, v, key] of [["nosig-solution", "1.0.0", null], ["tampered-solution", "1.0.0", E2E_KEY], ["stranger-solution", "1.0.0", STRANGER_KEY]]) {
		const stage = path.join(CDN_DIR, `stage-${name}`);
		mkdirSync(stage, { recursive: true });
		buildSimple(stage, name, v);
		const t = tarCzf(stage, `${name}-${v}.tgz`, [`${name}-${v}`]);
		const sig = key ? sigFor(name, v, t.bytes, key) : null;
		p2Variants.push(simpleManifest(name, v, t.sha, t.size, sig));
		index.solutions.push({ name, latest: v, versions: [{ version: v, file: `${name}-${v}.tgz`, sha256: t.sha, size: t.size }] });
		if (name === "tampered-solution") {
			// 服务侧篡改：索引 sha = 原包；落盘字节翻转 1B → 实收 sha 不符（verify 段 fail-closed）
			const corrupted = Buffer.from(t.bytes);
			corrupted[10] ^= 0xFF;
			writeFileSync(path.join(CDN_DIR, `${name}-${v}.tgz`), corrupted);
		}
		else {
			writeFileSync(path.join(CDN_DIR, `${name}-${v}.tgz`), t.bytes);
		}
	}
	writeFileSync(path.join(CDN_DIR, "bundles.yaml"), JSON.stringify(index, null, 2));
	writeFileSync(path.join(CDN_DIR, "manifests.yaml"), JSON.stringify([...manifests, evilA, evilB, ...p2Variants], null, 2));
}

// ── 站点进程（oj serve release 形态）──
let ojChild = null;
let ojLog = "";
let ojLogFile = null;
let serveSeq = 0;
async function startSite() {
	ojLog = "";
	serveSeq++;
	ojLogFile = path.join(WORK, `serve-${serveSeq}.log`);
	ojChild = spawn(OJ_BIN, ["serve", "-c", path.join(API, "config.yaml"), "-b", "/api", "--api-path", path.join(API, "dist"), "--console-log"], { cwd: API });
	ojChild.stdout.on("data", (c) => {
		ojLog += String(c);
		appendFileSync(ojLogFile, String(c));
	});
	ojChild.stderr.on("data", (c) => {
		ojLog += String(c);
		appendFileSync(ojLogFile, String(c));
	});
	ojChild.on("exit", (code, sig) => appendFileSync(ojLogFile, `\n[exit] code=${code} sig=${sig}\n`));
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
			throw new Error(`oj serve 60s 未就绪：\n${ojLog.slice(-2000)}`);
		await sleep(400);
	}
}

async function stopSite() {
	if (!ojChild || ojChild.exitCode !== null)
		return;
	const child = ojChild;
	ojChild = null;
	child.kill("SIGTERM");
	await Promise.race([
		new Promise(r => child.on("exit", r)),
		sleep(8000).then(() => child.kill("SIGKILL")),
	]);
	await sleep(500);
}

function patchConfig() {
	const p = path.join(API, "config.yaml");
	let cfg = readFileSync(p, "utf8");
	cfg = cfg.replace("port: 9778", "port: 9781");
	cfg = cfg.replace("__JWT_SECRET__", randomBytes(32).toString("hex"));
	// P3-1 在 platform: 下插入 U6 信任库加固注释块，故 `platform:\n  exec:` 字面补丁失配——改为锚定
	// 行首 `  exec:`（config 内唯一；挂载 modules/root 供安装器 api 模块加载 + 落盘根）
	cfg = cfg.replace(/^ {2}exec:/m, "  modules: [_platform]\n  root: dist\n  exec:");
	// oj 匿名模型 = config 独占（manifest api.anonymous 仅 C2 契约校验，运行时放行以 auth.anonymous_paths
	// 为准；安装器不热改 config——restart_pending）。部署契约 = 站点预声明已知方案的匿名路径（备案 P2 接线缺口）。
	cfg = cfg.replace("  anonymous_paths:", "  anonymous_paths:\n    - /demo-solution/ping");
	must(cfg.includes("modules: [_platform]"), "platform 段补丁未命中");
	must(cfg.includes("/demo-solution/ping"), "匿名路径补丁未命中");
	cfg = `${cfg.trimEnd()}\n# e2e 手补：isolate fs 面（安装器落盘授权）\nfs:\n  root: .\n  readonly: false\n`;
	writeFileSync(p, cfg);
}

function setMigrateOnStart(mode) {
	const p = path.join(API, "config.yaml");
	writeFileSync(p, readFileSync(p, "utf8").replace(/migrate_on_start: \w+/, `migrate_on_start: ${mode}`));
}

// ── P3-10：启用 SPA 静态宿主（在已装 demo-solution 的真机上验证 web 路由深检全绿）──
// 最小 SPA 外壳落 api/dist（与安装器 web 部署目标 siteModulesDir=dist/modules、modulesJsonPath=dist/modules.json
// 同根），并把 web 挂载（prefix /, web dist, spa:true）补进 config；重启后 /modules/* 与 /modules.json
// 由 oj 静态层真实服务，/demo-solution 经 SPA 历史回落 200 ⇒ 深检如实放行（绿）。
function enableStaticHosting() {
	const distDir = path.join(API, "dist");
	mkdirSync(distDir, { recursive: true });
	writeFileSync(path.join(distDir, "index.html"), "<!doctype html><html><head><meta charset=utf-8><title>oj</title></head><body><div id=app></div></body></html>\n");
	const p = path.join(API, "config.yaml");
	let cfg = readFileSync(p, "utf8");
	// 守卫查「已生效的 web 挂载」而非字面 prefix:/（模板注释块已含 prefix:"/" 字面，会误判已启用）
	if (!cfg.includes("web: dist")) {
		// 在 api 挂载前插入 web 挂载（prefix / + web dist + spa）；dist 与安装器 web 部署目标
		// siteModulesDir=dist/modules、modulesJsonPath=dist/modules.json 同根，静态层真实服务 /modules/*
		cfg = cfg.replace("  - prefix: /api", "  - prefix: \"/\"\n    web: dist\n    spa: true\n  - prefix: /api");
		writeFileSync(p, cfg);
	}
}

// ── sqlite 断言面（只读）──
function dbq(sql, params = []) {
	const dbo = new DatabaseSync(path.join(API, "db.sqlite"));
	try {
		return dbo.prepare(sql).all(...params);
	}
	finally {
		dbo.close();
	}
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
const cdn = { srv: null, hits: [] };
let token = null;
let step4Bak = null;

async function boot() {
	rmSync(WORK, { recursive: true, force: true });
	mkdirSync(CDN_DIR, { recursive: true });
	// 站点 = 模板快照（模板同步纪律：恒取当前仓库 templates/api）+ dev 证书（ojm init 等价最小集）
	mkdirSync(path.join(API, "config"), { recursive: true });
	for (const f of ["src", "config.yaml"])
		cpSync(path.join(ROOT, "packages/cli/templates/api", f), path.join(API, f), { recursive: true });
	patchConfig();
	mintDevCert(path.join(API, "config"));
	// 后端构建（--no-minify：oj 0.1.79 swc minify 有跨 await 内联 bug——`const r = await q(); const x = r[0]`
	// 被折叠成 `await q()[0]`（恒 undefined），auth login/refresh 等中毒；逃生门官方文档在案，宿主修复前 e2e 取此径）
	// + 手补 versions.json（坑⑦运维步；demo manifest 声明 peerRuntime → 装成功即证 B4 真源）
	const build = spawnSync(OJ_BIN, ["build", "--no-minify", "-d", "src", "-o", "dist"], { cwd: API, encoding: "utf8" });
	if (build.status !== 0)
		throw new Error(`oj build 失败：${build.stdout}\n${build.stderr}`);
	writeFileSync(path.join(API, "dist", "versions.json"), JSON.stringify({ "@oj-module/runtime": "0.1.0" }));
	buildCdnBundles();
	({ srv: cdn.srv, hits: cdn.hits } = await startCdn(CDN_DIR, 9782));
	await startSite();
	// 登录（seed admin/123456，must_change）→ 改密换正式 token
	const login = await api("/api/auth/login", { method: "POST", body: { username: "admin", password: "123456" } });
	must(login.data?.access_token, `login 失败：${JSON.stringify(login.json)?.slice(0, 200)}`);
	const changed = await api("/api/auth/password", { method: "PUT", token: login.data.access_token, body: { old_password: "123456", new_password: "e2e-pass-123" } });
	token = changed.data?.access_token;
	must(token, `改密失败：${JSON.stringify(changed.json)?.slice(0, 200)}`);
	// 市场地址（framework.market_cdn_url，security 组 super-only 写——AC-P1-16 后端位）
	const put = await api("/api/system/settings", { method: "PUT", token, body: { key: "framework.market_cdn_url", value: CDN_BASE } });
	must(put.status === 200, `设置写入失败：${put.status} ${JSON.stringify(put.json)?.slice(0, 200)}`);
	// P2-16：发布方 key 预登记（G3 add 路径——demo 包签名方；stranger 留给 TOFU 场景）
	const tk = await api("/api/_platform/market/trust/key", { method: "POST", token, body: { key_id: E2E_KEY.keyId, public_key: E2E_KEY.publicKeyHex } });
	must(tk.status === 200, `trust/key 登记失败：${tk.status} ${JSON.stringify(tk.json)?.slice(0, 200)}`);
}

async function main() {
	await boot();

	// ── AC2（前半）+ AC1（前半）：meta/index 生产口径可达（marketEnv 生产接线的直接证据）──
	const meta = await api("/api/_platform/market/meta", { token });
	ac(2, "meta 握手（health 404 修复面）", meta.status === 200 && !!meta.data?.apiVersion, `GET meta ${meta.status} apiVersion=${meta.data?.apiVersion}`);
	const index0 = await api("/api/_platform/market/index", { token });
	const row0 = (index0.data ?? []).find(r => r.name === "demo-solution");
	ac(1, "index 卡片非空 + latest", index0.status === 200 && row0?.latest === "0.2.0", `index ${index0.status} rows=${(index0.data ?? []).length} demo.latest=${row0?.latest}`);
	const noCacheHits0 = cdn.hits.filter(h => h.path === "/bundles.yaml" || h.path === "/manifests.yaml");
	must(noCacheHits0.every(h => /no-cache/i.test(h.requestCacheControl ?? "")), `索引请求缺 no-cache 头：${JSON.stringify(noCacheHits0[0])}`);

	// ── 安装 0.1.0：done + 不重启出菜单/路由（AC1 后半 + 14/15/16/17）──
	console.log("[phase] install 0.1.0 ...");
	const t1 = await install("demo-solution", "0.1.0", token);
	console.log("[phase] install 0.1.0 ->", t1.status);
	must(t1.status === "done", `install 0.1.0 终态=${t1.status}：${t1.message}`);
	const routes1 = await api("/api/_platform/solutions/routes", { token });
	const demoRoutes = (routes1.data ?? []).filter(r => r.module === "demo-solution");
	const modulesJson1 = JSON.parse(await fsp.readFile(path.join(API, "dist", "modules.json"), "utf8"));
	const ping1 = await fetch(`${BASE}/api/demo-solution/ping`, { signal: AbortSignal.timeout(10_000) }).then(r => r.status).catch(e => String(e));
	const oplog1 = dbq("SELECT detail FROM sys_oplog WHERE action = 'solution.install'");
	const smoke1 = t1.stages.find(s => s.stage === "smoke");
	ac(1, "合法 bundle 安装 done + 不重启出菜单/路由", demoRoutes.length === 2 && demoRoutes.every(r => r.enabled) && modulesJson1.some(e => e.name === "demo-solution") && ping1 === 200, `routes=${demoRoutes.length} modules.json=${modulesJson1.length}行 ping=${ping1}（未重启）`);
	ac(17, "冒烟段 ok（探活/integrity/注册一致性）", smoke1?.ok === true, String(smoke1?.message ?? "").slice(0, 120));
	ac(14, "终态审计 done 落 oplog", oplog1.some(r => String(r.detail).includes("\"status\":\"done\"")), `solution.install 行=${oplog1.length}`);
	const settings1 = await api("/api/system/settings", { token });
	const displayGroup = (settings1.data ?? []).find(g => g.items?.some(i => i.key === "demo-solution.display.theme"));
	ac(16, "设置三层嵌套（方案组随装可达 + super-only 写通过）", !!displayGroup && settings1.status === 200, `display 组=${!!displayGroup}（framework.market_cdn_url 已写）`);
	ac(15, "菜单归并数据源（routes 行 category/order/title_key 全列）", demoRoutes.some(r => r.category === "main" && Number(r.order) === 200 && r.title_key === "demo-solution:menu.main"), JSON.stringify(demoRoutes[0] ?? {}));
	const noCacheHits = cdn.hits.filter(h => h.path === "/bundles.yaml" || h.path === "/manifests.yaml");
	ac(19, "CDN 索引 no-cache（请求带 no-cache；源响应 no-store）", noCacheHits.length >= 2 && noCacheHits.every(h => /no-cache/i.test(h.requestCacheControl ?? "")), `bundles/manifests 请求 ${noCacheHits.length} 次均带 no-cache`);

	// ── 升级 0.2.0：锁迁移 + 版本目录共存 + 并发 modules.json 无半截（AC4/12）──
	let torn = 0;
	let reads = 0;
	let upgrading = true;
	const modulesJsonPath = path.join(API, "dist", "modules.json");
	const tightLoop = (async () => {
		// upgrading 由外层 main 在升级 install 终态后翻 false（跨 async 闭包，静态分析不可见）
		// eslint-disable-next-line no-unmodified-loop-condition
		while (upgrading) {
			try {
				JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
				reads++;
			}
			catch (e) {
				if (!String(e).includes("ENOENT"))
					torn++;
			}
			await sleep(4);
		}
	})();
	console.log("[phase] upgrade 0.2.0 ...");
	const t2 = await install("demo-solution", null, token); // latest = 0.2.0
	console.log("[phase] upgrade ->", t2.status);
	upgrading = false;
	await tightLoop;
	must(t2.status === "done", `升级终态=${t2.status}：${t2.message}`);
	const lock2 = await readText(path.join(API, "dist", "manifests.yaml"));
	const dirs2 = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("demo-solution-"));
	step4Bak = (await fsp.readdir(API)).filter(f => f.startsWith("db.sqlite.bak-")).sort().at(-1);
	// 立即抄存（migrate 备份「保留最近 3 份」滚动淘汰——后续 reinstall/重装会产生新 bak 顶掉步 4 这份）
	const step4BakCopy = path.join(WORK, "db-step4.bak");
	await fsp.copyFile(path.join(API, step4Bak), step4BakCopy);
	step4Bak = step4BakCopy;
	const journal2 = dbq("SELECT MAX(version) AS head FROM _oj_migrations WHERE module = ?", ["demo-solution"])[0]?.head;
	ac(4, "升级锁迁移 + 两版本目录共存（旧版永不 prune）", lock2.includes("demo-solution: 0.2.0") && dirs2.sort().join(",") === "demo-solution-0.1.0,demo-solution-0.2.0" && Number(journal2) === 2, `lock→0.2.0 dirs=${dirs2.sort().join(",")} journal.head=${journal2} bak=${step4Bak}`);
	ac(12, "升级期间并发读 modules.json 不见半截", torn === 0 && reads > 10, `reads=${reads} torn=${torn}`);

	// ── M004 账本回退自愈（AC7，紧跟升级——repoint 依赖 .bak 锁含旧版，同版重写会覆写 .bak）：──
	// 停服 → 库回退到升级前 bak（head 2→1）→ 起服（migrate off）→ index 触发对账回指旧版 0.1.0
	await stopSite();
	await fsp.copyFile(step4Bak, path.join(API, "db.sqlite"));
	setMigrateOnStart("off");
	await startSite();
	const index5 = await api("/api/_platform/market/index", { token });
	const lock5 = await readText(path.join(API, "dist", "manifests.yaml"));
	ac(7, "kill/账本分歧 → 重启对账自愈（锁回指旧版 0.1.0）", index5.status === 200 && lock5.includes("demo-solution: 0.1.0"), `index=${index5.status} lock=${String(lock5).replace(/\n/g, " ").trim()}`);
	setMigrateOnStart("auto");

	// ── 同版本重装 no-op（AC3；M004 后显式收敛 sidecar 0.2.0→0.1.0）──
	console.log("[phase] reinstall ...");
	const t3 = await install("demo-solution", "0.1.0", token);
	const dirs3 = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("demo-solution-"));
	ac(3, "同版本重装 no-op（done，目录不翻倍）", t3.status === "done" && dirs3.length === 2, `status=${t3.status} dirs=${dirs3.length}`);

	// ── partial 演练（AC13 失败语义② + AC14 含失败）：预写坏 modules.json → deploying_web fail-closed ──
	const modulesSnapshot = await fsp.readFile(modulesJsonPath, "utf8");
	await fsp.writeFile(modulesJsonPath, "{this is not json");
	console.log("[phase] partial-drill ...");
	const t4 = await install("demo-solution", "0.2.0", token);
	ac(13, "锁后失败 → partial + 修复指引 key（不清场不回滚）", t4.status === "partial" && t4.error?.hintKey === "lifecycle.stage.deploying_web.hint", `status=${t4.status} hintKey=${t4.error?.hintKey}`);
	const oplog4 = dbq("SELECT detail FROM sys_oplog WHERE action = 'solution.install'");
	ac(14, "终态审计含失败（partial 也落 oplog）", oplog4.some(r => String(r.detail).includes("\"status\":\"partial\"")), `install 行=${oplog4.length} 含 partial=${oplog4.some(r => String(r.detail).includes("partial"))}`);
	await fsp.writeFile(modulesJsonPath, modulesSnapshot);
	console.log("[phase] partial-reinstall ...");
	const t4b = await install("demo-solution", "0.2.0", token);
	must(t4b.status === "done", `修复 modules.json 后重装终态=${t4b.status}：${t4b.message}`);

	// ── 显式回滚（AC5）：账本已含 V2（head 2）时降级安装 0.1.0 → 宿主 journal/filesystem 一致性拒降
	// （oj migrate: "V2__add_done is missing"）failed@migrating；锁/sidecar/目录零扰动——回滚的正道 =
	// AC7 对账自愈回指（备案：no-op 降级（head==目标 seq）放行见单测 rollbackGuard 口径）──
	console.log("[phase] rollback ...");
	const t6 = await install("demo-solution", "0.1.0", token);
	const lock6 = await readText(path.join(API, "dist", "manifests.yaml"));
	const dirs6 = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("demo-solution-"));
	const side6 = await readText(path.join(API, "modules", ".solutions", "state.yaml"));
	ac(5, "降级安装被拒@migrating（账本超前）且零副作用", t6.status === "failed" && t6.stage === "migrating" && lock6.includes("demo-solution: 0.2.0") && dirs6.length === 2 && /version:\s*"?0\.2\.0"?/.test(String(side6)), `status=${t6.status}@${t6.stage} 锁行=[${String(lock6).split("\n").filter(l => l.includes("demo-solution"))}] dirs=${dirs6.length} side行=[${String(side6).split("\n").filter(l => l.includes("version") || l.includes("enabled"))}]（拒降=oj journal/filesystem 一致性；回滚正道=AC7 对账回指）`);

	// ── 禁用/启用四处同写（AC6）──
	const off = await api("/api/_platform/market/enable", { method: "POST", token, body: { name: "demo-solution", enabled: false } });
	const lockOff = await readText(path.join(API, "dist", "manifests.yaml"));
	const mjsonOff = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
	const routeOff = dbq("SELECT enabled FROM sys_solution_route WHERE module = ?", ["demo-solution"])[0]?.enabled;
	const sideOff = await readText(path.join(API, "modules", ".solutions", "state.yaml"));
	const on = await api("/api/_platform/market/enable", { method: "POST", token, body: { name: "demo-solution", enabled: true } });
	const lockOn = await readText(path.join(API, "dist", "manifests.yaml"));
	const routeOn = dbq("SELECT enabled FROM sys_solution_route WHERE module = ?", ["demo-solution"])[0]?.enabled;
	ac(6, "禁用/启用四处同写 + 恢复", off.data?.ok === true && !lockOff.includes("demo-solution") && mjsonOff[0]?.enabled === false && Number(routeOff) === 0 && String(sideOff).includes("enabled: false") && on.data?.ok === true && lockOn.includes("demo-solution: 0.2.0") && Number(routeOn) === 1, `off=${off.data?.ok} 锁摘/route0/modules false/sidecar false → on=${on.data?.ok} 锁恢复(0.2.0)/route1`);

	// ── 恶意 tgz / 契约违规拒装零副作用（AC8/10/11）──
	console.log("[phase] evil-A ...");
	const evilA = await install("evil-solution", "9.9.9", token);
	console.log("[phase] evil-B ...");
	const evilB = await install("evil-pack", "1.0.0", token);
	const evilRoutes = dbq("SELECT COUNT(*) AS c FROM sys_solution_route WHERE module LIKE 'evil%'")[0]?.c;
	const evilDirs = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("evil"));
	const oplogEvil = dbq("SELECT COUNT(*) AS c FROM sys_oplog WHERE action = 'solution.install' AND detail LIKE '%evil%'")[0]?.c;
	const evilAmsg = `${evilA.message ?? ""} ${evilA.stages?.map(s => s.message ?? "").join(" ") ?? ""}`;
	ac(8, "恶意 tgz（../ 成员）拒装零副作用", evilB.status === "failed" && evilB.stage === "extracting" && evilDirs.length === 0 && Number(evilRoutes) === 0, `stage=${evilB.stage} dirs=${evilDirs.length} routes=${evilRoutes} msg=${String(evilB.message ?? "").slice(0, 80)}`);
	ac(10, "权限键越空间拒装（failed@preflight）", evilA.status === "failed" && evilA.stage === "preflight" && Number(evilRoutes) === 0 && Number(oplogEvil) === 0, `stage=${evilA.stage} routes=${evilRoutes} oplog=${oplogEvil}（锁前失败零审计）`);
	ac(11, "匿名越段拒装（同包并报）", evilA.stage === "preflight" && evilAmsg.includes("othermod"), `violations 含 othermod/ping：${evilAmsg.slice(0, 100)}`);

	// ── P2-16 签名链三态 + 深检 + 索引聚合（AC-P2-1~8）──
	console.log("[phase] P2 sig-chain ...");
	// P2-1 未签名拒（sig_missing fail-closed，零落盘）
	const tNosig = await install("nosig-solution", "1.0.0", token);
	const nosigMsg = `${tNosig.message ?? ""} ${tNosig.stages?.map(x => x.message ?? "").join(" ") ?? ""}`;
	const nosigDirs = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("nosig"));
	ac("P2-1", "未签名包拒装（sig_missing，零落盘）", tNosig.status === "failed" && tNosig.stage === "verifying" && nosigMsg.includes("sig_missing") && nosigDirs.length === 0, `stage=${tNosig.stage} dirs=${nosigDirs.length} msg=${nosigMsg.slice(0, 100)}`);
	// P2-2 篡改拒（实收 sha ≠ 索引声明，零落盘）
	const tTampered = await install("tampered-solution", "1.0.0", token);
	const tamperedMsg = `${tTampered.message ?? ""} ${tTampered.stages?.map(x => x.message ?? "").join(" ") ?? ""}`;
	const tamperedDirs = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("tampered"));
	ac("P2-2", "篡改包拒装（sha 不符，零落盘）", tTampered.status === "failed" && tTampered.stage === "verifying" && tamperedDirs.length === 0, `stage=${tTampered.stage} dirs=${tamperedDirs.length} msg=${tamperedMsg.slice(0, 100)}`);
	// P2-3 陌生方 TOFU：needs_trust → 确认入库 → 重装 done
	const tStranger = await install("stranger-solution", "1.0.0", token);
	must(tStranger.status === "needs_trust" && !!tStranger.trust?.fingerprint, `TOFU 终态=${tStranger.status} trust=${JSON.stringify(tStranger.trust)?.slice(0, 120)}`);
	const strangerDirs = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("stranger"));
	ac("P2-3", "陌生发布方 → needs_trust（指纹在场，staging 不清场）", tStranger.status === "needs_trust" && strangerDirs.length === 0, `fingerprint=${tStranger.trust?.fingerprint?.slice(0, 16)}… key_id=${tStranger.trust?.key_id} dirs=${strangerDirs.length}`);
	const confirm = await api("/api/_platform/market/trust", { method: "POST", token, body: { task_id: tStranger.id } });
	must(confirm.status === 200, `trust confirm 失败：${confirm.status} ${JSON.stringify(confirm.json)?.slice(0, 200)}`);
	const tStranger2 = await install("stranger-solution", "1.0.0", token);
	ac("P2-4", "TOFU 确认后重装 done（G3 双轨第二轨闭环）", tStranger2.status === "done", `confirm=${confirm.status} reinstall=${tStranger2.status}`);
	// P2-5 吊销后拒升级（G5：revoked = unknown → needs_trust；版本不升）
	const revoke = await api("/api/_platform/market/trust/key?key_id=e2e.publisher", { method: "DELETE", token });
	must(revoke.status === 200, `吊销失败：${revoke.status}`);
	const tRevoked = await install("demo-solution", "0.2.0", token);
	const lockRevoked = await readText(path.join(API, "dist", "manifests.yaml"));
	ac("P2-5", "吊销后拒装/拒升级（needs_trust，版本不动）", revoke.data?.revoked === true && tRevoked.status === "needs_trust" && lockRevoked.includes("demo-solution: 0.2.0"), `revoke=${revoke.data?.revoked} install=${tRevoked.status} lock=0.2.0（升级面本无新版：重装路径 verify 同样 fail-closed）`);
	// 恢复信任（后续场景无依赖，落库留证）
	await api("/api/_platform/market/trust/key", { method: "POST", token, body: { key_id: E2E_KEY.keyId, public_key: E2E_KEY.publicKeyHex } });
	// ── release 重启不拒启（AC2）：带迁移模块 + 锁 0.1.0 + 账本 head=1 ──
	await stopSite();
	setMigrateOnStart("auto");
	await startSite();
	const meta2 = await api("/api/_platform/market/meta", { token });
	const routes2 = await api("/api/_platform/solutions/routes", { token });
	const ping2 = await fetch(`${BASE}/api/demo-solution/ping`).then(r => r.status);
	const index2 = await api("/api/_platform/market/index", { token });
	ac(2, "release 重启不拒启（meta/菜单/路由/市场索引全可达）", meta2.status === 200 && (routes2.data ?? []).some(r => r.module === "demo-solution") && ping2 === 200 && index2.status === 200, `meta=${meta2.status} routes=${(routes2.data ?? []).length} ping=${ping2} index=${index2.status}`);

	// ── P2-6/P2-7：深检语义裁决（真机）——本站点为 API-only 形态（无 SPA 静态宿主），
	// web 路由探针 404 被深检**如实上报**（routes anomaly error → ok=false）＝检测能力在工作的
	// 证据；「全绿」场景（探针 2xx）由 verify-checks.spec 单测钉面。端点报告结构 + verify/last
	// 留档读取为 e2e 钉面。──
	const verify = await api("/api/_platform/solutions/verify?name=demo-solution", { method: "POST", token });
	const verifyLast = await api("/api/_platform/solutions/verify/last?name=demo-solution", { token });
	const vdata = verify.data ?? {};
	const routesChecks = (vdata.checks ?? []).filter(c => c.id === "routes");
	ac("P2-6", "深检报告 {ok,checks,advise} + verify/last（如实检出 routes 不可达）", verify.status === 200 && typeof vdata.ok === "boolean" && routesChecks.length === 2 && routesChecks.every(c => c.severity === "error" && c.advise_key === "lifecycle.verify.routes.anomaly") && (vdata.advise ?? []).includes("lifecycle.verify.routes.anomaly") && verifyLast.status === 200 && verifyLast.data?.ok === vdata.ok && verifyLast.data?.checks?.length === vdata.checks?.length, `verify=${verify.status} ok=${vdata.ok}（API-only 站点无 SPA 宿主 → routes 404 如实上报）checks=${JSON.stringify(vdata.checks)?.slice(0, 220)} last=${verifyLast.status}`);
	const indexP2 = await api("/api/_platform/market/index", { token });
	const demoRow = (indexP2.data ?? []).find(r => r.name === "demo-solution");
	ac("P2-7", "索引聚合（available[]/trust_state/key_id/operator）", indexP2.status === 200 && Array.isArray(demoRow?.available) && demoRow.available.length === 2 && demoRow.trust_state === "trusted" && demoRow.key_id === E2E_KEY.keyId, `available=${JSON.stringify(demoRow?.available)} trust=${demoRow?.trust_state} key=${demoRow?.key_id} operator=${demoRow?.operator}`);

	// ── P3-10（P2-16#2）：深检静态托管真机增强——在已装 demo-solution 的真机上启用 SPA 静态宿主，
	// 验证 web 路由深检全绿（诚实 404 之外 web route 可达且健康）。P2-6 已先在 API-only 形态验证
	// 「深检如实检出 404」，此处转向静态托管形态验证「深检如实放行绿路由」——两者互补，检测能力不退化。──
	enableStaticHosting();
	await stopSite();
	await startSite();
	// 静态层真服务校验：modules.json + 已装方案 web 入口（siteModulesDir=dist/modules 与 web 挂载同根）
	const modulesJsonStatus = await fetch(`${BASE}/modules.json`).then(r => r.status);
	const entryStatus = await fetch(`${BASE}/modules/demo-solution/0.1.0/entry.js`).then(r => r.status);
	const mainCssStatus = await fetch(`${BASE}/modules/demo-solution/0.1.0/main.css`).then(r => r.status);
	// web 路由经 SPA 历史回落可达
	const webRouteStatus = await fetch(`${BASE}/demo-solution`).then(r => r.status);
	const verifyStatic = await api("/api/_platform/solutions/verify?name=demo-solution", { method: "POST", token });
	const vStatic = verifyStatic.data ?? {};
	const routeStaticErr = (vStatic.checks ?? []).filter(c => c.id === "routes" && c.severity === "error");
	ac("P3-10", "静态托管形态 web 路由深检全绿（ok=true，无 routes anomaly）+ 静态层真实服务 web 入口", verifyStatic.status === 200 && vStatic.ok === true && routeStaticErr.length === 0 && modulesJsonStatus === 200 && entryStatus === 200 && mainCssStatus === 200 && webRouteStatus === 200, `verify=${verifyStatic.status} ok=${vStatic.ok} routesErr=${routeStaticErr.length} modules.json=${modulesJsonStatus} entry=${entryStatus} css=${mainCssStatus} /demo-solution=${webRouteStatus}`);

	// ══ P3 阶段（AC-P3-1~6，P3-12）：减法与分发真机总验 ══
	const OJM_CLI = path.join(ROOT, "packages/cli/bin/ojm.mjs");
	const TASK_DIR = path.join(API, "modules", ".install-tasks");

	// ── AC-P3-4：ojm publish 发布 0.3.0~0.6.0（索引重算 + Ed25519 签名侧车）+ 宿主验签正/反两向 ──
	console.log("[phase] P3 publish 0.3.0~0.6.0 ...");
	for (const v of ["0.3.0", "0.4.0", "0.5.0", "0.6.0"]) {
		const stage = path.join(CDN_DIR, `stage-${v}`);
		mkdirSync(stage, { recursive: true });
		buildDemoTree(stage, v);
		const t = tarCzf(stage, "a.tgz", [`demo-solution-${v}`]);
		rmSync(path.join(stage, "a.tgz"));
		writeFileSync(path.join(CDN_DIR, `demo-solution-${v}.tgz`), t.bytes);
		// 索引追加（JSON 即 YAML；ojm publish 随后重算为确定性 YAML 并签名）
		const bundles = JSON.parse(readFileSync(path.join(CDN_DIR, "bundles.yaml"), "utf8"));
		const demoRowP = bundles.solutions.find(s => s.name === "demo-solution");
		demoRowP.latest = v;
		demoRowP.versions.unshift({ version: v, file: `demo-solution-${v}.tgz`, sha256: t.sha, size: t.size });
		writeFileSync(path.join(CDN_DIR, "bundles.yaml"), JSON.stringify(bundles, null, 2));
		const manifests = JSON.parse(readFileSync(path.join(CDN_DIR, "manifests.yaml"), "utf8"));
		manifests.push(solutionManifest(v, t.sha, t.size, sigFor("demo-solution", v, t.bytes)));
		writeFileSync(path.join(CDN_DIR, "manifests.yaml"), JSON.stringify(manifests, null, 2));
	}
	const pemPath = path.join(WORK, "publisher-private.pem");
	writeFileSync(pemPath, E2E_KEY.privateKeyObj.export({ type: "pkcs8", format: "pem" }));
	const pub = spawnSync(process.execPath, [OJM_CLI, "publish", CDN_DIR, "--id", E2E_KEY.keyId, "--key", pemPath, "--check"], { encoding: "utf8" });
	const sigBundles = existsSync(path.join(CDN_DIR, "bundles.yaml.sig"));
	const sigManifests = existsSync(path.join(CDN_DIR, "manifests.yaml.sig"));
	// 宿主正向：索引签名在场且有效 → install 0.3.0 done（缺签容忍、验签不过 502 的正向面）
	const tSigned = await install("demo-solution", "0.3.0", token);
	ac("P3-4", "ojm publish 索引重算+签名（.sig 侧车 + --check 自检）+ 宿主验签装成功", pub.status === 0 && sigBundles && sigManifests && tSigned.status === "done", `publish exit=${pub.status} sig(bundles/manifests)=${sigBundles}/${sigManifests} install0.3.0=${tSigned.status}`);
	// 宿主反向（G4 fail-closed）：篡改 bundles.yaml → 实收字节与 .sig 不符 → install 502 拒载
	const bundlesBak = readFileSync(path.join(CDN_DIR, "bundles.yaml"), "utf8");
	writeFileSync(path.join(CDN_DIR, "bundles.yaml"), `${bundlesBak}\n# tampered-by-e2e\n`);
	const tamperRes = await api("/api/_platform/market/install", { method: "POST", token, body: { name: "demo-solution", version: "0.4.0", source: "cdn" } });
	writeFileSync(path.join(CDN_DIR, "bundles.yaml"), bundlesBak); // 还原（publish 重签太重，回抄字节即恢复一致性）
	ac("P3-4b", "索引篡改 → 宿主验签 fail-closed 502（G4）", tamperRes.status === 502, `install（篡改 bundles.yaml）→ ${tamperRes.status} ${String(tamperRes.message ?? "").slice(0, 80)}`);

	// ── AC-P3-3：GC 保留 N=3（连装 0.4.0/0.5.0 → 目录窗口 [0.3.0,0.5.0]，0.1.0/0.2.0 被清）──
	console.log("[phase] P3 GC N=3 ...");
	const t04 = await install("demo-solution", "0.4.0", token);
	must(t04.status === "done", `install 0.4.0 终态=${t04.status}：${t04.message}`);
	const t05 = await install("demo-solution", "0.5.0", token);
	must(t05.status === "done", `install 0.5.0 终态=${t05.status}：${t05.message}`);
	const dirsGc = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("demo-solution-")).sort();
	const journalGc = dbq("SELECT MAX(version) AS head FROM _oj_migrations WHERE module = ?", ["demo-solution"])[0]?.head;
	ac("P3-3", "GC 内建 install 保留 N=3（state 时间序，锁版本受保护）", t05.status === "done" && dirsGc.join(",") === "demo-solution-0.3.0,demo-solution-0.4.0,demo-solution-0.5.0" && Number(journalGc) === 5, `dirs=${dirsGc.join(",")} journal.head=${journalGc}`);

	// ── AC-P3-1：卸载影响面预检计数（角色 1 + 受授用户 1）──
	dbq("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, ?)", [1, "demo-solution.admin"]); // 授 admin 以角色 → 计数非零
	const impact = await api("/api/_platform/market/uninstall-impact?name=demo-solution", { token });
	ac("P3-1", "卸载影响面预检计数（affectedRoles/affectedUsers）", impact.status === 200 && impact.data?.affectedRoles === 1 && impact.data?.affectedUsers === 1, `impact=${JSON.stringify(impact.data)}`);

	// ── AC-P3-2：superadmin 门（非 super 身份 → 403，拒权不泄露存在性）──
	console.log("[phase] P3 superadmin gate ...");
	await api("/api/system/users", { method: "POST", token, body: { username: "staff", password: "staff-pass-123", displayName: "e2e staff" } });
	const staffLogin = await api("/api/auth/login", { method: "POST", body: { username: "staff", password: "staff-pass-123" } });
	const staffChanged = await api("/api/auth/password", { method: "PUT", token: staffLogin.data?.access_token, body: { old_password: "staff-pass-123", new_password: "staff-pass-456" } });
	const staffToken = staffChanged.data?.access_token;
	const staffImpact = await api("/api/_platform/market/uninstall-impact?name=demo-solution", { token: staffToken });
	const staffUninstall = await api("/api/_platform/market/uninstall", { method: "POST", token: staffToken, body: { name: "demo-solution" } });
	ac("P3-2", "superadmin 门：非 super 身份 uninstall-impact / uninstall → 403", staffImpact.status === 403 && staffUninstall.status === 403, `staff impact=${staffImpact.status} uninstall=${staffUninstall.status}`);

	// ── AC-P3-5：卸载 → 重装不复活授权（Q4 业务表保留 + 授权减法不可逆）──
	console.log("[phase] P3 uninstall/reinstall ...");
	dbq("INSERT INTO demo_note (title) VALUES (?)", ["kept-row"]); // Q4：业务数据卸载不删——重装后仍在
	const un = await api("/api/_platform/market/uninstall", { method: "POST", token, body: { name: "demo-solution" } });
	const rolesAfter = dbq("SELECT COUNT(*) AS c FROM sys_role WHERE module = ?", ["demo-solution"])[0]?.c;
	const grantsAfter = dbq("SELECT COUNT(*) AS c FROM sys_user_role WHERE role_name = ?", ["demo-solution.admin"])[0]?.c;
	const noteAfterUn = dbq("SELECT COUNT(*) AS c FROM demo_note")[0]?.c;
	const re5 = await install("demo-solution", "0.5.0", token);
	const rolesBack = dbq("SELECT COUNT(*) AS c FROM sys_role WHERE module = ?", ["demo-solution"])[0]?.c;
	const grantsBack = dbq("SELECT COUNT(*) AS c FROM sys_user_role WHERE role_name = ?", ["demo-solution.admin"])[0]?.c;
	const noteBack = dbq("SELECT COUNT(*) AS c FROM demo_note")[0]?.c;
	const pingRe = await fetch(`${BASE}/api/demo-solution/ping`).then(r => r.status);
	ac("P3-5", "卸载（四处同删+级联+业务表保留）→ 重装 done：角色重建但授权不复活、业务行完好", un.data?.ok === true && (un.data?.retained ?? []).includes("demo_note") && Number(rolesAfter) === 0 && Number(grantsAfter) === 0 && Number(noteAfterUn) === 1 && re5.status === "done" && Number(rolesBack) === 1 && Number(grantsBack) === 0 && Number(noteBack) === 1 && pingRe === 200, `un=${un.data?.ok} retained=${JSON.stringify(un.data?.retained)} 卸后 roles=${rolesAfter} grants=${grantsAfter} note=${noteAfterUn} → 重装=${re5.status} roles=${rolesBack} grants=${grantsBack}（不复活）note=${noteBack} ping=${pingRe}`);

	// ── AC-P3-6：取消安装（install/cancel 端点接线 → U5 令牌 → h.kill + 回退装前态）──
	console.log("[phase] P3 cancel install ...");
	const cancelP = api("/api/_platform/market/install", { method: "POST", token, body: { name: "demo-solution", version: "0.6.0", source: "cdn" } });
	let cancelOk = false;
	for (let i = 0; i < 200 && !cancelOk; i++) {
		await sleep(50);
		try {
			const files = (await fsp.readdir(TASK_DIR)).filter(f => f.endsWith(".json"));
			for (const f of files) {
				const rec = JSON.parse(await fsp.readFile(path.join(TASK_DIR, f), "utf8"));
				if (rec.name === "demo-solution" && rec.version === "0.6.0" && rec.status === "running") {
					const cc = await api("/api/_platform/market/install/cancel", { method: "POST", token, body: { name: "demo-solution" } });
					cancelOk = cc.status === 200 && cc.data?.ok === true;
					break;
				}
			}
		}
		catch {}
	}
	const cancelRes = await cancelP;
	const cancelTaskId = cancelRes.data?.task_id;
	const cancelRec = cancelTaskId ? await pollTask(cancelTaskId, token) : null;
	const dirsCancel = (await fsp.readdir(path.join(API, "dist"))).filter(d => d.startsWith("demo-solution-")).sort();
	const lockCancel = await readText(path.join(API, "dist", "manifests.yaml"));
	const stagingCancel = await fsp.stat(path.join(API, "modules", ".staging")).then(() => true).catch(() => false);
	ac("P3-6", "取消安装：cancel 端点置位 → 终态 failed/partial + cancelled、staging 清场、锁/目录回退装前", cancelOk && ["failed", "partial"].includes(cancelRec?.status ?? "") && cancelRec?.cancelled === true && !stagingCancel && !dirsCancel.includes("demo-solution-0.6.0") && String(lockCancel).includes("demo-solution: 0.5.0"), `cancel=${cancelOk} task=${cancelRec?.status}@${cancelRec?.stage} cancelled=${cancelRec?.cancelled}（锁后取消=partial+cancelCleanup 回退，D11 双口径）staging=${stagingCancel ? "残留" : "已清"} dirs=${dirsCancel.join(",")} lock行=${String(lockCancel).split("\n").filter(l => l.includes("demo-solution")).join(";").trim()}`);

	// ── 报告 ──
	const failed = results.filter(r => !r.pass);
	const report = [
		"# P2-16 e2e 报告（AC-P1-1~20 + AC-P2-1~7）",
		"",
		`- 日期：${new Date().toISOString()}`,
		`- 宿主：${OJ_BIN}（${spawnSync(OJ_BIN, ["--version"], { encoding: "utf8" }).stdout.trim()}）`,
		`- 现场：${KEEP ? `${WORK}（--keep 保留）` : "已清理"}；本报告：logs/lifecycle-e2e-report.md`,
		`- 结果：${results.filter(r => r.pass).length}/${results.length} 绿${failed.length ? `，FAIL：${failed.map(f => f.id).join("、")}` : ""}`,
		"",
		...results.map(r => `${r.pass ? "✅" : "❌"} AC-${r.id} ${r.name} — ${r.evidence ?? ""}`),
		"",
		"## P2 备案",
		"- 签名链：CDN 全部合法包以 e2e.publisher（Ed25519）Form B 签名；发布方 key 经 POST trust/key 预登记（G3 add 路径）；stranger 走 TOFU 全闭环（needs_trust → confirm → 重装 done）。",
		"- 匿名握手：demo-solution/ping 经 patchConfig 预声明（S1-5：anonymous_paths 热改属 restart_pending）+ P2-15 安装器接线幂等并存；AC2 重启后无凭据 200 即握手生效。",
		"- P2-5 吊销语义：revoke 只阻断新装/重装（重装路径 verify 同样 fail-closed → needs_trust），已装方案继续运行（G5），sidecar trust_state 缓存不变。",
		"",
		"## 备案",
		"- AC-P1-5：账本超前时的显式降级安装由宿主拒（oj migrate journal/filesystem 一致性，failed@migrating，锁零扰动）——回滚的用户通道 = 对账自愈回指（AC7）；no-op 重装（head==目标 seq）放行，rollbackGuard 的 applied[] 近似口径与 D11③ 文件级 max seq 校验为升级项（单测覆盖）。",
		"- AC-P1-9（exec 白名单外拒执行）：由平台 NotCapable 语义 + 模板白名单单元覆盖（installer/text-edit 套件），e2e 未单列场景。",
		"- AC-P1-15/16 前端归并位（登录后重归并、脏组保存）属浏览器行为：由 runtime/store 单元覆盖，本 e2e 钉其后端数据源（solutions/routes 全列 + settings 分组）。",
		"- AC-P1-18 断言点在构建期（同树两次 tar sha 一致），随构建记录于此。",
	].join("\n");
	writeFileSync(path.join(ROOT, "logs", "lifecycle-e2e-report.md"), report);
	console.log(`\n${report.split("\n")[4]}`);
	if (failed.length)
		process.exitCode = 1;
}

main().finally(async () => {
	await stopSite();
	cdn.srv?.close();
	if (!KEEP)
		rmSync(WORK, { recursive: true, force: true });
}).catch((e) => {
	console.error(`\n[e2e] 中止：${e.message}\n${ojLog.slice(-1500)}`);
	process.exitCode = 1;
});
