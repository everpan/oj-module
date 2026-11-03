import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildModules } from "../../packages/cli/src/build";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * vditor 的模块侧契约（2026-11-02 起标 `bundle: true`，不再进宿主 shell-dist）：
 *   1. `import Vditor from "vditor"` 由模块自带副本——产物内联 UMD 实现，
 *      不留裸说明符（宿主 importmap 已无 vditor 键，否则运行期 Failed to resolve）；
 *   2. `import "vditor/dist/index.css"` 同样由模块侧 CSS 管线处理，不产出裸导入。
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
		// Windows 绝对路径含反斜杠，裸插值会被当 JS 转义吃掉，须 JSON.stringify 转义。
		`export default { baseUrl: "", modules: [{ name: "vdfx", entry: ${JSON.stringify(path.join(modulesDir, "entry.tsx"))} }] };\n`,
	);
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "vdfx-proj", type: "module" }));
	// cli 是 vditor 唯一的声明方（devDependencies → catalog）；夹具经 symlink 获得同版本包
	const nodeModules = path.join(root, "node_modules");
	fs.mkdirSync(nodeModules);
	fs.symlinkSync(
		path.join(PROJECT_ROOT, "packages/cli/node_modules/vditor"),
		path.join(nodeModules, "vditor"),
		// Windows 目录 symlink 需提权；junction 无此限制。
		process.platform === "win32" ? "junction" : "dir",
	);
	return root;
}

afterAll(() => {
	for (const root of roots)
		fs.rmSync(root, { recursive: true, force: true });
});

describe("vditor bundle 后模块产物自带实现（2026-11-02）", () => {
	it("vditor 内联进模块产物，不留裸说明符", async () => {
		const root = makeFixture();
		await buildModules(root);

		const entry = fs.readFileSync(path.join(root, "dist/web/modules/vdfx/0.1.0/entry.js"), "utf-8");
		// bundle：宿主不再提供 vditor 资产，模块必须自带实现（裸导入会 Failed to resolve）
		expect(entry).not.toMatch(/from\s*["']vditor["']/);
		expect(entry).not.toMatch(/import\s*["']vditor\/dist\/index\.css["']/);
		// 内联实现的特征串（UMD 包装会被 rolldown 改写，靠 vditor 自身类名判定）
		expect(entry).toContain("vditor-reset");
	});
});
