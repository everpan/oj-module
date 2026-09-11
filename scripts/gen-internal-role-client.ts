/**
 * 一次性脚本（Task 5.1）：为框架内部 system/role 契约生成 internal 目标 client。
 * ojm api 的发现机制只覆盖 api/src 与 web/src，runtime 树内契约由本脚本手工驱动。
 * 用法：pnpm tsx scripts/gen-internal-role-client.ts
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { emitClient } from "../packages/cli/src/contract/emit-client";
import { evaluateContract } from "../packages/cli/src/contract/evaluate";
import { buildIr } from "../packages/cli/src/contract/ir";

const cwd = process.cwd();
const roleDir = path.join(cwd, "packages/runtime/src/api/system/role");

const exports_ = await evaluateContract(path.join(roleDir, "contract.ts"), cwd);
const ir = buildIr(exports_);
const files = emitClient(ir, { target: "internal" });

const outDir = path.join(roleDir, "client");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
	fs.writeFileSync(path.join(outDir, name), content);
	console.log(`written: packages/runtime/src/api/system/role/client/${name}`);
}
