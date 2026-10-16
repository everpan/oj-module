// 后端 BDD 夹具：node:sqlite 内存库 + **真实迁移文件**建表，装到 globalThis.db——
// 与 oj 运行时注入的全局同名同面（query/exec/tx/dialect），service 代码不改一行即可被测。
// 夹具直接读 api/src/<模块>/migrations/*.sql，与迁移不可能漂移（沿用 oj-wiki 先例）。
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
		const dir = join(SRC, mod, "migrations");
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
