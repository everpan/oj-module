import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkApi } from "../../packages/cli/src/contract/check";
import { runApi } from "../../packages/cli/src/contract/run";

/**
 * G5 模板 notification 模块（BDD 5.4#1 + 评审 b5）：
 * ① ojm api 生成 + --check 零违规（notification 走标准契约流，豁免清单不新增）
 * ② 签入模板的生成 client 与现场生成物逐字节一致（钉版/--check 流对得上）
 *
 * 布局：`src/<name>/{api,web}`（module-root）。临时工程按同一形状搭——config.yaml 在
 * 工程根（`resolveConfigPath` 只认它 + `src/` 单树），源码树整棵拷 `src/`；再拷
 * `web.config.ts`（`clientOwners` 把 notification 的 client 指到 `src/app/web/notification`）。
 * 老 `web/src/<name>/__client` 是历史布局回退分支，这里不能走。
 */

const TEMPLATES = join(process.cwd(), "packages/cli/templates");
const TEMPLATES_OPENAPI = join(TEMPLATES, "openapi.json");

const tmpDirs: string[] = [];

function makeTemplateProject(): string {
	// 临时工程放工程根下的 .tmp-*（Vite/vitest 能 transform 到 .ts；node_modules 下不行）
	const dir = mkdtempSync(join(process.cwd(), ".tmp-ojm-tpl-notif-"));
	tmpDirs.push(dir);
	cpSync(join(TEMPLATES, "src"), join(dir, "src"), { recursive: true });
	cpSync(join(TEMPLATES, "config.yaml"), join(dir, "config.yaml"));
	// web.config.ts 的 clientOwners 决定 __client 落盘位置（多根聚合：notification → app）
	cpSync(join(TEMPLATES, "web.config.ts"), join(dir, "web.config.ts"));
	// `ojm api` 单一事实源即 openapi.json（oj `oj openapi` 产物，落于工程根），须一并拷入临时工程根
	cpSync(TEMPLATES_OPENAPI, join(dir, "openapi.json"));
	// 豁免清单：auth/web 的 handler 有意无契约，缺它会让 --check 报「有 handler 无契约」
	cpSync(join(TEMPLATES, ".ojm-api-exempt.json"), join(dir, ".ojm-api-exempt.json"));
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
		for (const file of ["index.ts", "api.schemas.ts"]) {
			const generated = readFileSync(join(cwd, `src/app/web/notification/__client/${file}`), "utf-8");
			const committed = readFileSync(join(TEMPLATES, `src/app/web/notification/__client/${file}`), "utf-8");
			expect(generated).toBe(committed);
		}
	});
});
