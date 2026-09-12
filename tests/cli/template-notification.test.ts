import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkApi } from "../../packages/cli/src/contract/check";
import { runApi } from "../../packages/cli/src/contract/run";

/**
 * G5 模板 notification 模块（BDD 5.4#1 + 评审 b5）：
 * ① ojm api 生成 + --check 零违规（notification 走标准契约流，豁免清单不新增）
 * ② 签入模板的生成 client 与现场生成物逐字节一致（钉版/--check 流对得上）
 */

const TEMPLATES_API = join(process.cwd(), "packages/cli/templates/api");
const TEMPLATES_WEB = join(process.cwd(), "packages/cli/templates/web");

const tmpDirs: string[] = [];

function makeTemplateProject(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-tpl-notif-test-"));
	tmpDirs.push(dir);
	cpSync(TEMPLATES_API, join(dir, "api"), { recursive: true });
	return dir;
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("模板 notification 模块（G5，BDD 5.4#1）", () => {
	it("ojm api 生成后 --check 零违规（豁免清单维持 web/notifications/auth 不变）", async () => {
		const cwd = makeTemplateProject();
		await runApi({ cwd });
		const { violations } = await checkApi({ cwd });
		expect(violations.filter(v => v.level === "error")).toEqual([]);
	});

	it("签入模板的 client 生成物与现场生成逐字节一致（评审 b5）", async () => {
		const cwd = makeTemplateProject();
		await runApi({ cwd });
		for (const file of ["api.ts", "api.schemas.ts"]) {
			const generated = readFileSync(join(cwd, `web/src/notification/client/${file}`), "utf-8");
			const committed = readFileSync(join(TEMPLATES_WEB, `src/notification/client/${file}`), "utf-8");
			expect(generated).toBe(committed);
		}
	});
});
