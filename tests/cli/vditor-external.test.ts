import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildModules } from "../../packages/cli/src/build";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * vditor 回升共享表（0.1.16）后的模块侧契约：
 *   1. `import Vditor from "vditor"` 与 `import "vditor/dist/index.css"` 走 external，
 *      产物只留裸说明符，由宿主 importmap 解析（单文件，不内联 UMD 实现）；
 *   2. 深路径不再触发「前缀命中但无 importmap 键」的构建期报错——两个已登记键
 *      （vditor / vditor/dist/index.css）必须能原样通过 `ojm build`。
 *
 * 夹具走 build-layout.test.ts 同款 buildModules + .tmp-fx 模式；vditor 不在
 * 根 node_modules（仅 cli devDependencies），夹具本地 symlink 到 cli 的解析处，
 * 模拟「模块工程已安装 vditor」。
 */
const FIXTURE_ROOT = path.join(PROJECT_ROOT, ".tmp-fx");

const ENTRY = [
	"import React from \"react\";",
	"import Vditor from \"vditor\";",
	"import \"vditor/dist/index.css\";",
	"import { defineModule } from \"@oj-module/runtime\";",
	"",
	"export default defineModule({",
	"  name: \"vdfx\",",
	"  description: \"vditor external fixture\",",
	"  version: \"0.1.0\",",
	"  routes: [{",
	"    path: \"/md\",",
	"    element: React.createElement(\"div\", { onClick: () => void new Vditor(document.createElement(\"div\")) }),",
	"  }],",
	"});",
	"",
].join("\n");

const roots: string[] = [];

function makeFixture(): string {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, "vditor-"));
	roots.push(root);
	const modulesDir = path.join(root, "web/src");
	fs.mkdirSync(modulesDir, { recursive: true });
	fs.writeFileSync(path.join(modulesDir, "entry.tsx"), ENTRY);
	fs.writeFileSync(
		path.join(root, "web.config.ts"),
		`export default { baseUrl: "", modules: [{ name: "vdfx", entry: "${modulesDir}/entry.tsx" }] };\n`,
	);
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "vdfx-proj", type: "module" }));
	// cli 是 vditor 唯一的声明方（devDependencies → catalog）；夹具经 symlink 获得同版本包
	const nodeModules = path.join(root, "node_modules");
	fs.mkdirSync(nodeModules);
	fs.symlinkSync(
		path.join(PROJECT_ROOT, "packages/cli/node_modules/vditor"),
		path.join(nodeModules, "vditor"),
		"dir",
	);
	return root;
}

afterAll(() => {
	for (const root of roots)
		fs.rmSync(root, { recursive: true, force: true });
});

describe("vditor 共享化后模块产物 external（0.1.16）", () => {
	it("vditor 与其 CSS 留作裸说明符，UMD 实现不内联", async () => {
		const root = makeFixture();
		await buildModules(root);

		const entry = fs.readFileSync(path.join(root, "dist/web/modules/vdfx/0.1.0/entry.js"), "utf-8");
		// external：裸说明符原样保留（宿主 importmap 解析）
		expect(entry).toMatch(/from\s*["']vditor["']/);
		expect(entry).toMatch(/import\s*["']vditor\/dist\/index\.css["']/);
		// 不内联：vditor 的 webpack UMD 标记不得出现在模块产物
		expect(entry).not.toContain("webpackUniversalModuleDefinition");
		expect(entry).not.toContain("Vditor v4.0.0");
	});
});
