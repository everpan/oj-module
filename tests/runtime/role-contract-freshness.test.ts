import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emitClient } from "../../packages/cli/src/contract/emit-client";
import { evaluateContract } from "../../packages/cli/src/contract/evaluate";
import { buildIr } from "../../packages/cli/src/contract/ir";

/**
 * runtime internal 契约（system/role）不在 ojm api 发现范围内（生成由
 * scripts/gen-internal-role-client.ts 手工驱动），漂移没有 --check 门禁——
 * 本测试即其防漂移卡口：契约改动未重生成则红。
 */

const repoRoot = process.cwd();
const roleDir = join(repoRoot, "packages/runtime/src/api/system/role");

describe("system/role internal 契约生成物保鲜（ojm api 发现范围外的门禁补偿）", () => {
	it("api/client.ts 与 client.schemas.ts 和契约同步", async () => {
		const exports_ = await evaluateContract(join(roleDir, "contract.ts"), repoRoot);
		const files = emitClient(buildIr(exports_), { target: "internal" });
		for (const [name, content] of Object.entries(files)) {
			const committed = readFileSync(join(roleDir, "api", name), "utf8");
			expect(
				committed,
				`packages/runtime/src/api/system/role/api/${name} 与契约不同步——请重跑 pnpm tsx scripts/gen-internal-role-client.ts`,
			).toBe(content);
		}
	});
});
