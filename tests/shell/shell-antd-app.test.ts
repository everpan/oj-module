import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

const HOST_TSX = path.join(PROJECT_ROOT, "packages/cli/shell/src/host.tsx");

/**
 * 设计 [[202609112121-shell-dark-css-vars-design]] US-4：
 * 宿主必须用 runtime 的 AntdApp（同步 --oo-* 变量 + StaticAntd），
 * 不得回退为 antd 原生 App（否则暗黑模式 tailwind 语义色全灭、footer 露白）。
 * host.tsx 不参与 vitest 渲染（宿主入口直接挂载 #root），以源码断言守护。
 */
describe("shell 宿主 AntdApp 来源（暗黑 footer 修复）", () => {
	const source = fs.readFileSync(HOST_TSX, "utf-8");

	it("从 @oj-module/runtime 导入 AntdApp", () => {
		expect(source).toMatch(/import\s*\{[^}]*\bAntdApp\b[^}]*\}\s*from\s*"@oj-module\/runtime"/);
	});

	it("不再从 antd 导入 App", () => {
		const antdImport = source.match(/import\s*\{[^}]*\}\s*from\s*"antd"/)?.[0] ?? "";
		expect(antdImport).not.toMatch(/\bApp\b/);
	});
});
