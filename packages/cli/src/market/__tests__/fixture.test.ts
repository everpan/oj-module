// market/fixture spec（T12）：合成方案树的版本差异——迁移阶梯是 upgrade/rollback op 的物理前提。
//
// 0.2.0 起（minor ≥ 2）多一段 0002__more.sql：upgrade 必须真的多走一段迁移，
// rollback 才有「包内最大 seq < 账本 head」可拦。确定性：同 name@version 输出恒同。
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildFixturePackage } from "../fixture";

describe("given 合成 fixture 方案树 When 看 migrations 目录", () => {
	it("then 0.1.0 只有 0001（head 上限 1）", () => {
		const pkg = buildFixturePackage({ stagingDir: mkdtempSync(join(tmpdir(), "ojm-fixture-")), name: "demo-solution", version: "0.1.0" });
		expect(readdirSync(join(pkg.dir, "api", "demo-solution-0.1.0", "migrations")).sort()).toEqual(["0001__init.sql"]);
	});

	it("then 0.2.0 多一段 0002（升级真的多走一段迁移）", () => {
		const pkg = buildFixturePackage({ stagingDir: mkdtempSync(join(tmpdir(), "ojm-fixture-")), name: "demo-solution", version: "0.2.0" });
		const files = readdirSync(join(pkg.dir, "api", "demo-solution-0.2.0", "migrations")).sort();
		expect(files).toEqual(["0001__init.sql", "0002__more.sql"]);
		// 0001 与 0.1.0 逐字节一致（upgrade op 断言依据）
		const pkg010 = buildFixturePackage({ stagingDir: mkdtempSync(join(tmpdir(), "ojm-fixture-")), name: "demo-solution", version: "0.1.0" });
		expect(readFileSync(join(pkg.dir, "api", "demo-solution-0.2.0", "migrations", "0001__init.sql")))
			.toEqual(readFileSync(join(pkg010.dir, "api", "demo-solution-0.1.0", "migrations", "0001__init.sql")));
	});

	it("then 0002 是合法 ALTER（作用于 fixture 声明的表）", () => {
		const pkg = buildFixturePackage({ stagingDir: mkdtempSync(join(tmpdir(), "ojm-fixture-")), name: "demo-solution", version: "0.2.0" });
		const sql = readFileSync(join(pkg.dir, "api", "demo-solution-0.2.0", "migrations", "0002__more.sql"), "utf-8");
		expect(sql).toContain("ALTER TABLE demo_solution_note");
	});
});
