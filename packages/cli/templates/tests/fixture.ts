// 后端 BDD 夹具：node:sqlite 内存库 + **真实迁移文件**建表，装到 globalThis.db——
// 与 oj 运行时注入的全局同名同面（query/exec/tx/dialect），service 代码不改一行即可被测。
// 夹具直接读 src/<模块>/api/migrations/*.sql，与迁移不可能漂移（沿用 oj-wiki 先例）。
//
// **构造器边界（架构定论，勿在此夹具里补 table()）**：db.table()/listTables() 等构造器是
// oj 二进制内的纯 Rust 实现，无 JS 模块可导出，Node 侧垫不出来——本夹具刻意只给
// {query, exec, tx, dialect}。两层测试的分工因此定型：
//   · L2（本目录 *.spec.ts）：构造器面用**记录型假 builder**（记 where/orderBy/limit 调用
//     序列做编排断言）；真 SQL 执行断言走 db.query 直查。
//   · L1（同目录 *.test.ts，`oj test` 收集）：真 v8 + 真构造器闭环，守 SQL 渲染/过滤/转义
//     的真执行面（样板见 tests/l1-builder.test.ts；方法论见 devkit oj-test-guide.md）。
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { DatabaseSync } = req("node:sqlite");
const { readdirSync, readFileSync, existsSync } = req("node:fs");
const { join, dirname } = req("node:path");
const { fileURLToPath } = req("node:url");

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

export const ADMIN = 1;

/** 建内存库 + 注入全局；返回 DatabaseSync 供用例直插数据/断言。 */
export function installDb(): any {
	const dbo = new DatabaseSync(":memory:");
	// 重放 src 下全部模块的迁移（方言专属文件除外）
	for (const mod of readdirSync(SRC)) {
		const dir = join(SRC, mod, "api", "migrations");
		if (!existsSync(dir))
			continue;
		for (const f of readdirSync(dir).filter((f: string) => f.endsWith(".sql") && !/\.(?:mysql|pg)\.sql$/.test(f)).sort())
			dbo.exec(readFileSync(join(dir, f), "utf8"));
	}

	dbo.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, 'x')").run(ADMIN, "admin");

	const query = async (sql: string, params: unknown[] = []) => dbo.prepare(sql).all(...(params as never[]));
	const exec = async (sql: string, params: unknown[] = []) => Number(dbo.prepare(sql).run(...(params as never[])).changes);
	const txInstance = { query, exec, isTx: true };
	// db.tx 镜像运行时面：BEGIN/COMMIT/ROLLBACK 包裹回调（versions.ts 注释同语义）
	const tx = async (fn: (t: typeof txInstance) => unknown) => {
		dbo.exec("BEGIN");
		try {
			const r = await fn(txInstance);
			dbo.exec("COMMIT");
			return r;
		}
		catch (e) {
			dbo.exec("ROLLBACK");
			throw e;
		}
	};

	const g = globalThis as any;
	g.db = { query, exec, tx, dialect: () => "sqlite" };
	return dbo;
}
