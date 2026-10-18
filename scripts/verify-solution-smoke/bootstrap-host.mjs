// bootstrap-host.mjs — 从仓库模板自举一个可运行的 oj 宿主工程。
//
// 与 packages/cli/templates/api 同构：拷贝模板 → 补 config（端口/模块/匿名路径/fs 段）
// → 生成开发用 RSA 证书 → oj build → 写 versions.json。产物落在 SITE 下 dist/。
//
// 环境变量（均有默认值，CI/本地通用）：
//   OJ_BIN  运行时二进制，默认 "oj"（需在 PATH，否则用绝对路径）
//   ROOT    仓库根，默认按脚本位置推导
//   SITE    宿主工程目录，默认 /tmp/oj-smoke/api
//   PORT    服务端口，默认 9781
//
// 退出码非 0 = 自举失败。

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OJ_BIN = process.env.OJ_BIN ?? "oj";
const ROOT = process.env.ROOT ?? path.resolve(__dirname, "../..");
const SITE = process.env.SITE ?? "/tmp/oj-smoke/api";
const PORT = Number(process.env.PORT ?? 9781);
const TEMPLATE = path.join(ROOT, "packages/cli/templates/api");

rmSync(SITE, { recursive: true, force: true });
mkdirSync(path.join(SITE, "config"), { recursive: true });
for (const f of ["src", "config.yaml"])
	cpSync(path.join(TEMPLATE, f), path.join(SITE, f), { recursive: true });

let cfg = readFileSync(path.join(SITE, "config.yaml"), "utf8");
cfg = cfg.replace("port: 9778", `port: ${PORT}`);
cfg = cfg.replace("__JWT_SECRET__", randomBytes(32).toString("hex"));
cfg = cfg.replace(/^ {2}exec:/m, "  modules: [_platform]\n  root: dist\n  exec:");
if (!cfg.includes("modules: [_platform]"))
	throw new Error("platform 段补丁未命中");
cfg = cfg.replace("  anonymous_paths:", "  anonymous_paths:\n    - /demo-solution/ping");
cfg = `${cfg.trimEnd()}\nfs:\n  root: .\n  readonly: false\n`;
writeFileSync(path.join(SITE, "config.yaml"), cfg);

const certDir = path.join(SITE, "config");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const now = Math.floor(Date.now() / 1000);
const head = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
const payload = Buffer.from(JSON.stringify({ nbf: now, exp: now + 3650 * 86400 })).toString("base64url");
const sig = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(privateKey).toString("base64url");
writeFileSync(path.join(certDir, "private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(path.join(certDir, "public.pem"), publicKey.export({ type: "spki", format: "pem" }));
writeFileSync(path.join(certDir, "cert.jws"), `${head}.${payload}.${sig}`);

const build = spawnSync(OJ_BIN, ["build", "--no-minify", "-d", "src", "-o", "dist"], { cwd: SITE, encoding: "utf8" });
if (build.status !== 0)
	throw new Error(`oj build 失败:\n${build.stdout}\n${build.stderr}`);
writeFileSync(path.join(SITE, "dist", "versions.json"), JSON.stringify({ "@oj-module/runtime": "0.1.0" }));

const mf = readFileSync(path.join(SITE, "dist", "manifests.yaml"), "utf8");
console.log("[ok] host bootstrapped at", SITE);
console.log("[ok] manifests.yaml 含 _platform:", mf.includes("_platform"));
