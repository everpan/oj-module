// make-solution.mjs — 造一个带 web 的签名方案包（逻辑镜像 lifecycle-e2e 的 buildDemoTree）。
//
// 产出 TGZ（含 api+web+manifest），供 ojm sign/install 走真实 CLI 链。
// 注意 ping 处理器必须调用 oj 运行时的全局 json.ok(...)，直接 return 对象会被忽略（空 body）。
//
// 环境变量：
//   TGZ  输出包路径，默认 /tmp/demo-solution-0.1.0.tgz
//   V    版本号，默认 0.1.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const V = process.env.V ?? "0.1.0";
const OUT = process.env.TGZ ?? "/tmp/demo-solution-0.1.0.tgz";
const STAGE = "/tmp/sol-stage";
const root = path.join(STAGE, `demo-solution-${V}`);
const mod = path.join(root, "api", `demo-solution-${V}`);
const web = path.join(root, "web", "modules", "demo-solution", V);

mkdirSync(path.join(mod, "migrations"), { recursive: true });
mkdirSync(path.join(mod, "ping"), { recursive: true });
mkdirSync(web, { recursive: true });

writeFileSync(path.join(root, "manifest.yaml"), JSON.stringify({
	name: "demo-solution",
	version: V,
	summary: "smoke solution",
	peerRuntime: ">=0.1.0",
	health: "/demo-solution/ping",
	api: { prefix: "/api/demo-solution", anonymous: ["demo-solution/ping"] },
	web: { entry: `modules/demo-solution/${V}/entry.js`, css: [`modules/demo-solution/${V}/main.css`] },
	routes: [
		{ path: "/demo-solution", category: "main", order: 200, title_key: "demo-solution:menu.main" },
		{ path: "/demo-solution/ping", category: "hidden", order: 205, title_key: "demo-solution:menu.ping" },
	],
	permissions: [{ code: "demo-solution.view", title_key: "demo-solution:perm.view" }],
	roles: [{ name: "demo-solution.admin", title_key: "demo-solution:role.admin", permissions: ["demo-solution.view"] }],
	settings: { groups: [{ group: "display", label_key: "demo-solution:settings.group.display", items: [{ key: "demo-solution.display.theme", type: "enum", options: ["dark", "light"] }] }] },
}));
writeFileSync(path.join(mod, "manifest.yaml"), `name: demo-solution\ndesc: smoke solution\nversion: ${V}\ntables:\n  - demo_note\n`);
writeFileSync(path.join(mod, "routes.js"), "export default [{ method: \"get\", pattern: \"demo-solution/ping\", file: \"ping/api.js\" }];\n");
// oj 方案的 api 处理器用全局 json.ok 收口响应体，return 对象不会被序列化。
writeFileSync(path.join(mod, "ping", "api.js"), `export default { async get() { json.ok({ pong: true, module: "demo-solution", version: "${V}" }); } };\n`);
writeFileSync(path.join(mod, "migrations", "0001__init.sql"), "CREATE TABLE demo_note (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n");
writeFileSync(path.join(web, "entry.js"), `console.log("demo-solution ${V}");\n`);
writeFileSync(path.join(web, "main.css"), ".demo-solution-v1-0-0 { color: red; }\n");

const r = spawnSync("tar", ["-czf", OUT, `demo-solution-${V}`], { cwd: STAGE });
if (r.status !== 0)
	throw new Error(`tar failed: ${r.stderr}`);
console.log("[ok]", OUT, `${createHash("sha256").update(readFileSync(OUT)).digest("hex").slice(0, 12)}…`);
