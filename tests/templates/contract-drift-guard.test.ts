import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { checkApi } from "../../packages/cli/src/contract/check";
import { resolveOjBin } from "../../packages/cli/src/vendor";
import { TEMPLATE_DIR } from "../helpers/paths";

/**
 * U1/T3：模板契约三重一致性门禁（防再漂移）。
 *
 * 背景：模板自身的 handler .schema 曾与 openapi.json / __client 生成物漂移，
 * 导致下游 `ojm build`（assertDefaultModulesUntouched）与 `ojm api --check`
 * 互斥死锁——下游无任何合法路径。此处的两道检查把「模板自洽」钉成断言：
 *   1. `oj openapi --check`：handler .schema ↔ 已提交 openapi.json（需 vendored oj；
 *      CI 未 provision oj 二进制时跳过，本地/发布机 `ojm vendor` 后生效）；
 *   2. `ojm api --check`（in-process）：openapi.json ↔ __client 生成物 + stub。
 */

const ojBin = resolveOjBin(TEMPLATE_DIR);
const hasOj = fs.existsSync(ojBin);

describe("模板契约三重一致性（U1 防漂移门禁）", () => {
	it.skipIf(!hasOj)("oj openapi --check：handler .schema 与 openapi.json 零漂移", () => {
		expect(() =>
			execFileSync(ojBin, ["openapi", "-c", "config.yaml", "--module-root", "src", "-b", "/api", "--check", "-o", "openapi.json"], { cwd: TEMPLATE_DIR, stdio: "pipe" }),
		).not.toThrow();
	});

	it("ojm api --check：openapi.json ↔ __client 生成物零漂移", async () => {
		const { violations } = await checkApi({ cwd: TEMPLATE_DIR });
		expect(violations.filter(v => v.level === "error")).toEqual([]);
	});
});
