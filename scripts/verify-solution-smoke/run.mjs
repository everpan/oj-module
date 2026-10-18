// run.mjs — 解决方案市场「真·CLI 链」一键冒烟。
//
// 自举宿主 → 起 oj serve → 造签名方案 → ojm sign/install（含 TOFU 确认）→ curl 核对清单 → 关服务。
// 全绿退出 0，任一项断言失败退出 1。幂等：每次重跑都会清空 /tmp/oj-smoke 与旧 serve。
//
// 用法：
//   node scripts/verify-solution-smoke/run.mjs
//   OJ_BIN=/abs/oj PORT=9782 node scripts/verify-solution-smoke/run.mjs   # 自定义运行时/端口
//
// 前置：oj 在 PATH（或 OJ_BIN 指向二进制），Node ≥ 18。不依赖外部 oj-market。

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OJ_BIN = process.env.OJ_BIN ?? "oj";
const OJM = path.join(ROOT, "packages/cli/bin/ojm.mjs");
const HARNESS = __dirname;
const SITE = process.env.SITE ?? "/tmp/oj-smoke/api";
const PORT = Number(process.env.PORT ?? 9781);
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const KEY_ID = "smoke.local";
const TGZ = process.env.TGZ ?? "/tmp/demo-solution-0.1.0.tgz";
const ADMIN_PASS = "123456";
const NEW_PASS = "smoke-pass-123";
const KEY_HOME = path.join(os.homedir(), ".ojm", "keys", KEY_ID);

const results = [];
function check(name, ok, detail = "") {
	results.push({ name, ok, detail });
	const tag = ok ? "PASS" : "FAIL";
	const extra = detail ? `  — ${detail}` : "";
	console.log(`${tag}  ${name}${extra}`);
}
function runSync(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
	const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
	return { code: r.status, out, raw: r };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// 0. 清场：杀掉可能占用同端口/同目录的旧 serve
for (const pat of [`${SITE}/config.yaml`]) {
	try {
		runSync("pkill", ["-f", pat]);
	}
	catch {
		// 忽略：没有可杀的进程
	}
	await sleep(300);
}

// 1. 自举宿主
console.log("\n[1/6] bootstrap host");
let s = runSync("node", [path.join(HARNESS, "bootstrap-host.mjs")], { env: { ...process.env, OJ_BIN, ROOT, SITE, PORT: String(PORT) } });
if (s.code !== 0) {
	console.error(s.out);
	process.exit(1);
}
console.log(s.out.trim());

// 2. 起 serve
console.log("\n[2/6] start oj serve");
const serve = spawn(OJ_BIN, ["serve", "-c", "config.yaml", "-b", "/api", "--api-path", "dist", "--console-log"], {
	cwd: SITE,
	detached: true,
	stdio: ["ignore", "pipe", "pipe"],
});
serve.stdout.on("data", () => {});
serve.stderr.on("data", d => process.stderr.write(`[serve] ${d}`));
const servePid = serve.pid;

let healthOk = false;
for (let i = 0; i < 60; i++) {
	await sleep(500);
	try {
		const r = await api("GET", "/api/health");
		if (r.status === 200) {
			healthOk = true;
			break;
		}
	}
	catch {
		// 尚未就绪
	}
}
check("宿主 serve 启动且 /api/health 200", healthOk);
if (!healthOk) {
	try {
		process.kill(servePid);
	}
	catch {}
	process.exit(1);
}

// 3. 造方案包
console.log("\n[3/6] build demo-solution tgz");
s = runSync("node", [path.join(HARNESS, "make-solution.mjs")], { env: { ...process.env, TGZ, V: "0.1.0" } });
if (s.code !== 0) {
	console.error(s.out);
	try {
		process.kill(servePid);
	}
	catch {}
	process.exit(1);
}
console.log(s.out.trim());

// 4. 签名（密钥每次重建，保证幂等）
console.log("\n[4/6] keygen + sign");
rmSync(KEY_HOME, { recursive: true, force: true });
runSync("node", [OJM, "keygen", "--id", KEY_ID]);
s = runSync("node", [OJM, "sign", TGZ, "--id", KEY_ID, "--check"]);
console.log(s.out.trim());
check("ojm sign 产出 .tgz.sig 侧车", s.code === 0 && existsFile(`${TGZ}.sig`));

// 5. 登录 + 首登强制改密 + 安装（含 TOFU）
console.log("\n[5/6] login / password change / install");
let r = await api("POST", "/api/auth/login", { username: "admin", password: ADMIN_PASS });
check("首登拿到 token", !!r.json?.data?.access_token, `status=${r.status}`);
const token0 = r.json?.data?.access_token;
await api("PUT", "/api/auth/password", { old_password: ADMIN_PASS, new_password: NEW_PASS }, token0);
r = await api("POST", "/api/auth/login", { username: "admin", password: NEW_PASS });
const token = r.json?.data?.access_token;
check("改密后重新登录", !!token, `status=${r.status}`);

let inst = runSync("node", [OJM, "install", TGZ, "--url", BASE, "--user", "admin", "--pass", NEW_PASS]);
if (/待信任确认|needs_trust|fingerprint/i.test(inst.out)) {
	const m = inst.out.match(/install-[\w-]+/);
	if (m) {
		runSync("node", [OJM, "trust", "confirm", "--task", m[0], "--url", BASE, "--user", "admin", "--pass", NEW_PASS]);
	}
	inst = runSync("node", [OJM, "install", TGZ, "--url", BASE, "--user", "admin", "--pass", NEW_PASS]);
}
check("ojm install 成功（含 TOFU 确认）", /安装完成|done|install ok/i.test(inst.out), inst.out.trim().split("\n").pop());

// 6. 核对清单
console.log("\n[6/6] verification checklist");
try {
	const meta = await api("GET", "/api/_platform/market/meta", null, token);
	check("① 平台握手 data.apiVersion", !!meta.json?.data?.apiVersion, `apiVersion=${meta.json?.data?.apiVersion}`);

	const verify = await api("POST", "/api/_platform/solutions/verify?name=demo-solution", null, token);
	const okFlag = typeof verify.json?.data?.ok === "boolean";
	const checksArr = Array.isArray(verify.json?.data?.checks);
	check("② 深检返回 {ok,checks}", okFlag && checksArr, `ok=${verify.json?.data?.ok}`);

	const ping = await api("GET", "/api/demo-solution/ping");
	const pingOk = ping.status === 200 && ping.json?.data?.pong === true;
	check("④ 匿名健康探针 /ping 200 且 pong", pingOk, `status=${ping.status} body=${JSON.stringify(ping.json)}`);

	const mf = readFileSync(path.join(SITE, "dist", "manifests.yaml"), "utf8");
	check("⑤ 磁盘扁平锁含 demo-solution: 0.1.0", /demo-solution:\s*0\.1\.0/.test(mf));

	const health = await api("GET", "/api/health");
	const genOk = health.status === 200 && Number.isInteger(health.json?.generation);
	check("⑥ 健康带 generation", genOk, `generation=${health.json?.generation}`);
}
catch (e) {
	check("核对清单执行", false, String(e));
}

// 收尾
try {
	process.kill(servePid);
}
catch {}
const pass = results.filter(x => x.ok).length;
const fail = results.length - pass;
console.log(`\n=== 冒烟结果: PASS=${pass}  FAIL=${fail}  (exit=${fail ? 1 : 0}) ===`);
process.exit(fail ? 1 : 0);

function existsFile(p) {
	try {
		readFileSync(p);
		return true;
	}
	catch {
		return false;
	}
}
