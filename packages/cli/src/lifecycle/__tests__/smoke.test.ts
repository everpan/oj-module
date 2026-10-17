// 真机冒烟（P1-13，skip-if-env-missing）：对真实站点 file 源安装 fixture-valid 包，断言终态 done。
// 环境齐备才跑（OJM_SMOKE_URL / OJM_SMOKE_USER / OJM_SMOKE_PASS，站点需已有 superadmin 账号；
// 站点起停属部署层职责——P1-16 e2e 钉定生产口径，此处不拉起进程），缺省整体跳过，CI 不红。
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildBundle } from "../../bundle";
import { installCommand } from "../../install";
import { DEFAULT_SITE_URL } from "../../site";

const SMOKE_URL = process.env.OJM_SMOKE_URL;
const SMOKE_USER = process.env.OJM_SMOKE_USER ?? process.env.OJM_USER;
const SMOKE_PASS = process.env.OJM_SMOKE_PASS ?? process.env.OJM_PASS;
const smokeReady = SMOKE_URL !== undefined && SMOKE_USER !== undefined && SMOKE_PASS !== undefined;

const FIXTURE_VALID = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fixture-valid");

let project: string;

beforeAll(() => {
	project = mkdtempSync(join(tmpdir(), "ojm-smoke-proj-"));
	cpSync(FIXTURE_VALID, project, { recursive: true });
});

afterEach(() => {
	// 只清本测试的临时工程（站点侧安装产物不回滚——真机站点是外部环境）
	if (project !== undefined)
		rmSync(project, { recursive: true, force: true });
	project = undefined as unknown as string;
});

describe.skipIf(!smokeReady)("真机冒烟（需 OJM_SMOKE_URL/OJM_SMOKE_USER/OJM_SMOKE_PASS）", () => {
	it("file 源安装 fixture-valid 包 → 终态 done", { timeout: 600_000 }, async () => {
		// 先出可安装 tgz（同 bundle.test.ts：预置已构建产物再 --bundle 组装）
		const apiDist = join(project, "api/dist/demo-solution-0.1.0");
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(join(apiDist, "ping"), { recursive: true });
		// 迁移 SQL 随夹具 src 真源（0001__init.sql 建 note 表）；B-11 硬验收：appliedSeq > 0 可断言
		cpSync(join(FIXTURE_VALID, "api/src/demo-solution/migrations"), join(apiDist, "migrations"), { recursive: true });
		// schema.yaml 同随夹具真源（列集与迁移 SQL 一致）：oj migrate 在 apply 后跑 schema
		// reconcile（migrate_cmd.rs migrate_one），声明缺列而实库多列 = Err——合成空列集会炸
		writeFileSync(join(apiDist, "manifest.yaml"), "name: demo-solution\ndesc: manifest.yaml 契约全字段合法夹具\nversion: 0.1.0\ntables:\n  - note\n");
		cpSync(join(FIXTURE_VALID, "api/src/demo-solution/schema.yaml"), join(apiDist, "schema.yaml"));
		writeFileSync(join(apiDist, "routes.js"), "export {};\n");
		writeFileSync(join(apiDist, "ping/api.js"), "export async function ping() {}\n");
		const webDist = join(project, "web/dist/modules/demo-solution/0.1.0");
		mkdirSync(webDist, { recursive: true });
		writeFileSync(join(webDist, "entry.js"), "export default {};\n");
		writeFileSync(join(webDist, "demo-solution.css"), ".demo{}\n");
		const { tgz } = await buildBundle(project, { out: join(project, "dist") });

		const record = await installCommand(tgz, { url: SMOKE_URL ?? DEFAULT_SITE_URL, user: SMOKE_USER, pass: SMOKE_PASS });
		expect(record.status).toBe("done");
		expect(record.name).toBe("demo-solution");
		expect(record.version).toBe("0.1.0");
		// B-11 硬验收：迁移真实执行过（oj migrate applied 非空），非 web-only 空跑
		expect(record.appliedSeq).toBeGreaterThan(0);
	});
});
