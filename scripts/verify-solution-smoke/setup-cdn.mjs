// setup-cdn.mjs — 拉起本地 CDN 并发布 demo-solution（供市场卡片网格演示）。
//
// 做法（与 scripts/lifecycle-e2e.mjs 同源）：
//   1) 生成 Ed25519 发布方密钥（demo.publisher）
//   2) 构建 demo-solution-0.1.0.tgz 写入 CDN 目录
//   3) 写入 bundles.yaml / manifests.yaml（含每包 Form B 签名）
//   4) ojm publish 重算为确定性 YAML 并产出 .sig 侧车
//   5) 起静态 CDN 服务（:9782），no-store
//   6) 向宿主登记发布方公钥 + 设置 framework.market_cdn_url
// 之后 /api/_platform/market/index 即返回受信的 demo-solution 卡片。
//
// 用法：node scripts/verify-solution-smoke/setup-cdn.mjs
//   env: OJM / BASE / CDN_PORT / CDN_DIR

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OJM = path.join(ROOT, "packages/cli/bin/ojm.mjs");
const BASE = process.env.BASE ?? "http://127.0.0.1:9781";
const CDN_PORT = Number(process.env.CDN_PORT ?? 9782);
const CDN_DIR = process.env.CDN_DIR ?? "/tmp/oj-cdn";
const KEY_ID = "demo.publisher";
const NAME = "demo-solution";
const VERSION = "0.1.0";

const sha256 = b => createHash("sha256").update(b).digest("hex");

// ── 发布方 Ed25519 密钥 ──
const kp = generateKeyPairSync("ed25519");
const publicKeyHex = Buffer.from(kp.publicKey.export({ format: "der", type: "spki" }).subarray(-32)).toString("hex");
const privatePem = kp.privateKey.export({ type: "pkcs8", format: "pem" });

function sigFor(name, version, tgzBytes) {
	const canonical = `${name}@${version}:${sha256(tgzBytes)}`;
	const value = sign(null, Buffer.from(canonical, "utf8"), kp.privateKey).toString("base64");
	return { alg: "Ed25519", key_id: KEY_ID, public_key: publicKeyHex, value, canon: "v1" };
}

function solutionManifest(v, sha, size, sig) {
	return {
		name: NAME,
		version: v,
		summary: "smoke solution (CDN)",
		peerRuntime: ">=0.1.0",
		archive: { file: `${NAME}-${v}.tgz`, sha256: sha, size, ...(sig ? { signature: sig } : {}) },
		health: "/demo-solution/ping",
		api: { prefix: "/api/demo-solution", anonymous: ["demo-solution/ping"] },
		web: { entry: `modules/${NAME}/${v}/entry.js`, css: [`modules/${NAME}/${v}/main.css`] },
		routes: [
			{ path: "/demo-solution", category: "main", order: 200, title_key: "demo-solution:menu.main" },
			{ path: "/demo-solution/ping", category: "hidden", order: 205, title_key: "demo-solution:menu.ping" },
		],
		permissions: [{ code: "demo-solution.view", title_key: "demo-solution:perm.view" }],
		roles: [{ name: "demo-solution.admin", title_key: "demo-solution:role.admin", permissions: ["demo-solution.view"] }],
		settings: { groups: [{ group: "display", label_key: "demo-solution:settings.group.display", items: [{ key: "demo-solution.display.theme", type: "enum", options: ["dark", "light"] }] }] },
	};
}

function buildDemoTree(stageDir) {
	const mod = path.join(stageDir, `${NAME}-${VERSION}`, "api", `${NAME}-${VERSION}`);
	const web = path.join(stageDir, `${NAME}-${VERSION}`, "web", "modules", NAME, VERSION);
	mkdirSync(path.join(mod, "migrations"), { recursive: true });
	mkdirSync(path.join(mod, "ping"), { recursive: true });
	mkdirSync(web, { recursive: true });
	writeFileSync(path.join(stageDir, `${NAME}-${VERSION}`, "manifest.yaml"), JSON.stringify(solutionManifest(VERSION, "", 0)));
	writeFileSync(path.join(mod, "manifest.yaml"), `name: ${NAME}\ndesc: smoke solution\nversion: ${VERSION}\ntables:\n  - demo_note\n`);
	writeFileSync(path.join(mod, "routes.js"), "export default [{ method: \"get\", pattern: \"demo-solution/ping\", file: \"ping/api.js\" }];\n");
	writeFileSync(path.join(mod, "ping", "api.js"), `export default { async get() { json.ok({ pong: true, module: "${NAME}", version: "${VERSION}" }); } };\n`);
	writeFileSync(path.join(mod, "migrations", "0001__init.sql"), "CREATE TABLE demo_note (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n");
	writeFileSync(path.join(web, "entry.js"), `console.log("${NAME} ${VERSION}");\n`);
	writeFileSync(path.join(web, "main.css"), `.${NAME}-v1-0-0 { color: red; }\n`);
}

// ── 构建 CDN 目录 ──
rmSync(CDN_DIR, { recursive: true, force: true });
mkdirSync(path.join(CDN_DIR, "stage"), { recursive: true });
buildDemoTree(path.join(CDN_DIR, "stage"));
const tgzName = `${NAME}-${VERSION}.tgz`;
const tar = spawnSync("tar", ["-czf", tgzName, `${NAME}-${VERSION}`], { cwd: path.join(CDN_DIR, "stage"), encoding: "utf8" });
if (tar.status !== 0)
	throw new Error(`tar failed: ${tar.stderr}`);
const tgzBytes = readFileSync(path.join(CDN_DIR, "stage", tgzName));
writeFileSync(path.join(CDN_DIR, tgzName), tgzBytes);
const sha = sha256(tgzBytes);
const size = tgzBytes.byteLength;

const bundles = {
	generated_at: new Date().toISOString(),
	cdn: `http://127.0.0.1:${CDN_PORT}`,
	solutions: [{ name: NAME, latest: VERSION, versions: [{ version: VERSION, file: tgzName, sha256: sha, size }] }],
};
const manifests = [solutionManifest(VERSION, sha, size, sigFor(NAME, VERSION, tgzBytes))];
writeFileSync(path.join(CDN_DIR, "bundles.yaml"), JSON.stringify(bundles, null, 2));
writeFileSync(path.join(CDN_DIR, "manifests.yaml"), JSON.stringify(manifests, null, 2));
writeFileSync(path.join(CDN_DIR, "publisher.pem"), privatePem);
console.log("[ok] CDN 目录就绪:", CDN_DIR, `demo-solution@${VERSION} sha=${sha.slice(0, 12)}…`);

// ── ojm publish：重算确定性 YAML + 签名侧车 ──
const pub = spawnSync("node", [OJM, "publish", CDN_DIR, "--id", KEY_ID, "--key", path.join(CDN_DIR, "publisher.pem"), "--check"], { encoding: "utf8" });
console.log(pub.stdout.trim());
if (pub.status !== 0) {
	console.error(pub.stderr);
	process.exit(1);
}
console.log("[ok] bundles.yaml.sig:", existsSync(path.join(CDN_DIR, "bundles.yaml.sig")), "manifests.yaml.sig:", existsSync(path.join(CDN_DIR, "manifests.yaml.sig")));

// ── 静态 CDN 服务（no-store）──
const srv = http.createServer((req, res) => {
	const rel = decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/^\/+/, "")) || "bundles.yaml";
	const file = path.join(CDN_DIR, rel);
	if (!file.startsWith(CDN_DIR) || !existsSync(file)) {
		res.writeHead(404);
		res.end();
		return;
	}
	res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
	res.end(readFileSync(file));
});
await new Promise(r => srv.listen(CDN_PORT, "127.0.0.1", r));
console.log(`[ok] CDN 静态服务已起 :${CDN_PORT}`);

// ── 登记发布方公钥 + 设置 market_cdn_url ──
async function api(method, p, body, token) {
	const headers = { "content-type": "application/json" };
	if (token)
		headers.Authorization = `Bearer ${token}`;
	const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	}
	catch {
		json = text;
	}
	return { status: res.status, json };
}
const login = await api("POST", "/api/auth/login", { username: "admin", password: "smoke-pass-123" });
const token = login.json?.data?.access_token;
if (!token) {
	console.error("登录失败:", login.status, JSON.stringify(login.json));
	process.exit(1);
}

const trust = await api("POST", "/api/_platform/market/trust/key", { key_id: KEY_ID, public_key: publicKeyHex }, token);
console.log("[ok] 登记发布方公钥:", trust.status, JSON.stringify(trust.json)?.slice(0, 120));

const setUrl = await api("PUT", "/api/system/settings", { key: "framework.market_cdn_url", value: `http://127.0.0.1:${CDN_PORT}` }, token);
console.log("[ok] 设置 market_cdn_url:", setUrl.status);

// ── 验证索引 ──
const idx = await api("GET", "/api/_platform/market/index", null, token);
const dataArr = Array.isArray(idx.json?.data)
	? idx.json.data
	: (Array.isArray(idx.json?.data?.solutions) ? idx.json.data.solutions : (idx.json?.data?.items ?? []));
const row = dataArr.find(s => s.name === NAME);
console.log("[index]", idx.status, "demo-solution row:", JSON.stringify(row)?.slice(0, 200) ?? "undefined");

console.log(`\n[done] 本地 CDN 已发布 demo-solution，市场卡片网格现在应可见。CDN 服务保持运行中（:${CDN_PORT}）。Ctrl-C 或 kill 本进程即停。`);
// 保持进程存活以持续托管 CDN
setInterval(() => {}, 1 << 30);
