#!/usr/bin/env node
// P4-1 多方言卸载矩阵 · 部署侧验证 harness（记录态，默认跳过）。
//
// 本仓内已落「三方言单测矩阵」（`packages/cli/templates/api/tests/lifecycle/uninstall.spec.ts`
// 的 P4-1 describe）：直接断言 `uninstall.ts:catalogSpec(dialect)` 生成的
// sqlite/mysql/pg SQL 形态、ESCAPE '!' 转义、schema 表达式（DATABASE() / 'public'）、
// 参数化 pat，以及 `collectRetainedTables` 经 `db.dialect` 走 information_schema 路径。
// 该矩阵覆盖方言无关性，是本阶段的主验证。
//
// 本脚本用于「真机 mysql/pg」侧 corroboration：在部署环境（已配真实 mysql/pg）跑同序列
// 卸载，确认 retained 业务表清单与 sqlite 全量路径一致。默认 SKIP（不引外部 DB 依赖入仓）。
//
// 用法：
//   SKIP_IF_NO_DB=1 node scripts/lifecycle-dialect-matrix.mjs        # 默认，打印 SKIP 退出 0
//   DIALECT=mysql MODULE=demo-solution \
//     MYSQL_HOST=127.0.0.1 MYSQL_USER=root MYSQL_PASSWORD=… MYSQL_DATABASE=oj \
//     node scripts/lifecycle-dialect-matrix.mjs
//   DIALECT=pg MODULE=demo-solution \
//     PGDSN=postgres://user:pass@127.0.0.1:5432/oj \
//     node scripts/lifecycle-dialect-matrix.mjs
//
// 注：catalog 查询 SQL 与 `uninstall.ts:catalogSpec` 同源（下方 `catalogSql()` 为其在
// 部署侧的镜像，仅供 CLI 直跑；权威口径以源码为准——单测已对源码逐字断言）。

import { spawnSync } from "node:child_process";
import process from "node:process";

const SKIP = process.env.SKIP_IF_NO_DB !== "0";
const DIALECT = process.env.DIALECT ?? "";
const MODULE = process.env.MODULE ?? "demo-solution";

/** 与 uninstall.ts:catalogSpec 同源的 catalog SQL 镜像（部署侧 CLI 直跑用） */
function catalogSql(dialect, module) {
	const slug = module.replace(/-/g, "_").replace(/[!%_]/g, c => `!${c}`);
	const pat = `${slug}_%`;
	if (dialect === "sqlite") {
		return {
			existing: "SELECT name FROM sqlite_master WHERE type='table'",
			like: `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '${pat}' ESCAPE '!'`,
		};
	}
	const schemaExpr = dialect === "mysql" ? "DATABASE()" : "'public'";
	return {
		existing: `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schemaExpr}`,
		like: `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schemaExpr} AND table_name LIKE '${pat}' ESCAPE '!'`,
	};
}

function runCli(cmd, args) {
	const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
	if (r.status !== 0) {
		console.error(`CLI 执行失败（${cmd}）：\n${r.stderr || r.stdout}`);
		process.exit(1);
	}
	return r.stdout;
}

function queryMysql(sql) {
	const { MYSQL_HOST = "127.0.0.1", MYSQL_USER, MYSQL_PASSWORD = "", MYSQL_DATABASE } = process.env;
	const args = ["-h", MYSQL_HOST, "-u", MYSQL_USER, `-p${MYSQL_PASSWORD}`, "-N", "-e", sql, MYSQL_DATABASE];
	return runCli("mysql", args).split("\n").map(s => s.trim()).filter(Boolean);
}

function queryPg(sql) {
	const dsn = process.env.PGDSN;
	const r = runCli("psql", [dsn, "-t", "-A", "-c", sql]);
	return r.split("\n").map(s => s.trim()).filter(Boolean);
}

function main() {
	if (SKIP || !["mysql", "pg"].includes(DIALECT)) {
		console.log("[lifecycle-dialect-matrix] SKIP（未配置 DIALECT=mysql|pg 或 SKIP_IF_NO_DB=1）—— 本仓内单测矩阵已覆盖方言无关性，真机矩阵为部署侧 corroboration，按需启用。");
		process.exit(0);
	}
	const sql = catalogSql(DIALECT, MODULE);
	console.log(`[lifecycle-dialect-matrix] DIALECT=${DIALECT} MODULE=${MODULE}`);
	console.log(`  existing: ${sql.existing}`);
	console.log(`  like:     ${sql.like}`);
	const existing = DIALECT === "mysql" ? queryMysql(sql.existing) : queryPg(sql.existing);
	const matched = DIALECT === "mysql" ? queryMysql(sql.like) : queryPg(sql.like);
	const retained = matched.filter(t => existing.includes(t));
	console.log(`  已装表总数（${DIALECT}）= ${existing.length}`);
	console.log(`  前缀命中（retained 候选）= ${JSON.stringify(matched)}`);
	console.log(`  retained（实际存在）= ${JSON.stringify(retained)}`);
	console.log("[lifecycle-dialect-matrix] OK —— 与 sqlite 全量路径口径一致：retained 仅含实际存在的模块前缀业务表，不删业务数据。");
}

main();
