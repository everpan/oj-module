/**
 * `ojm new <name>` —— 脚手架内快速生成用户方案骨架（多方案 phase 3，设计 v2 §C）。
 *
 * 生成 module-root 布局的 `src/<name>/{api,web}` 最小骨架：solution.yaml（方案契约，
 * `ojm build --bundle` 入口）+ web（entry.ts 示例路由 / 占位页 / 双语 locales）+
 * 可选 api（oj 七键 manifest + ping 示例 handler）。生成物补产物后即过打包校验
 * （round-trip 承诺，N1 用例钉死）。
 *
 * 前置守卫（全 fail-fast，顺序即排查顺序）：
 *   1. N0 非 ojm 工程（无 web.config.ts / src/）→ 指向 `ojm init`；
 *   2. N6 历史布局（new/flat）→ 拒绝 + 迁移指引（生成 module-root 骨架会触发
 *      双源码树互斥，把 build/dev 打挂——宁可拒绝不留半套）；
 *   3. N3 名字四查：kebab-case 正则（与契约 C2-01 同条）→ 保留名 → 框架自带名
 *      （`src/.ojm-builtin.json`）→ 目录已存在；
 *   4. N7 原子性：任一步失败 best-effort 删除已建 `src/<name>/`，不留半截目录
 *      （半截目录会触发 scanModuleRoot 的坏模块报错）。
 *
 * 刻意不做：web.config.ts 登记——module-root 布局以 `src/<name>/web/entry.ts`
 * 扫描为真源（0.2.20 起登记只是可选排序覆盖），生成即被扫描收录，向用户 TS 源文件
 * 做文本插入既脆弱又零收益（六方评审一致结论）。
 */

import fs from "node:fs";
import path from "node:path";
import { readBuiltinModules } from "./builtin";
import { assertValidSolutionName } from "./bundle";
import { tryResolveLayout } from "./layout";
import { RESERVED_NAMES } from "./manifest-contract";

export interface NewSolutionOptions {
	/** 示例路由布局（默认 container；none = 无外壳裸页面） */
	layout?: "container" | "none"
	/** 同时生成 api 骨架（oj 七键 manifest + ping 示例 handler） */
	api?: boolean
}

export interface NewSolutionResult {
	/** 生成的方案目录（src/<name>） */
	dir: string
	/** 相对工程根的文件清单 */
	files: string[]
}

export function createSolution(projectRoot: string, name: string, opts: NewSolutionOptions = {}): NewSolutionResult {
	// N0：工程判定（web.config.ts 与 src/ 至少要有一个——空目录跑 new 是最常见误用）
	const hasConfig = fs.existsSync(path.join(projectRoot, "web.config.ts"));
	const hasSrc = fs.existsSync(path.join(projectRoot, "src"));
	if (!hasConfig && !hasSrc) {
		throw new Error(
			`[ojm] ${projectRoot} 不是 ojm 工程（没有 web.config.ts / src/）。`
			+ "先 `ojm init` 创建脚手架，再在里面 `ojm new <name>`。",
		);
	}

	// N6：布局守卫。tryResolveLayout 自带双树互斥/坏目录的人话报错，直接传播；
	// 历史布局（new/flat）拒绝——module-root 骨架落进去会触发互斥，把 build/dev 打挂
	const layout = tryResolveLayout(projectRoot);
	if (layout !== null && layout.kind !== "module-root") {
		throw new Error(
			`[ojm] ojm new 只支持 module-root 布局工程（src/<name>/{api,web}），当前为 ${layout.kind} 历史布局。`
			+ "在历史布局工程里生成骨架会触发两套源码树互斥、把 build/dev 打挂，故拒绝。"
			+ "请先迁移布局，或在新脚手架工程（ojm init）里使用。",
		);
	}

	// N3：名字四查
	assertValidSolutionName(name, "ojm new <name>");
	if (RESERVED_NAMES.has(name)) {
		throw new Error(
			`[ojm] 「${name}」是保留名（框架功能命名空间，如 system/auth/market），不能用作方案名。`
			+ "换一个不与框架能力撞名的名字。",
		);
	}
	if (readBuiltinModules(projectRoot).has(name)) {
		throw new Error(
			`[ojm] 「${name}」是框架自带方案（见 src/.ojm-builtin.json；ojm info --all 可看全名单）。`
			+ "想改造自带模块：`ojm new <新名>` 生成骨架后把代码复制过去（自带身份按目录名判定，复制即脱离）。",
		);
	}
	const dir = path.join(projectRoot, "src", name);
	if (fs.existsSync(dir))
		throw new Error(`[ojm] src/${name}/ 已存在。换个名字，或删掉该目录后重试。`);

	const shell = opts.layout ?? "container";
	const files: string[] = [];
	try {
		put(projectRoot, files, path.join(dir, "solution.yaml"), solutionYaml(name, opts.api));
		put(projectRoot, files, path.join(dir, "web", "entry.ts"), entryTs(name, shell));
		put(projectRoot, files, path.join(dir, "web", "pages", "index.tsx"), pageTsx(name));
		put(projectRoot, files, path.join(dir, "web", "locales", "zh-CN.json"), `${JSON.stringify({ menu: { main: `${name} 方案` } }, null, "\t")}\n`);
		put(projectRoot, files, path.join(dir, "web", "locales", "en-US.json"), `${JSON.stringify({ menu: { main: name } }, null, "\t")}\n`);
		if (opts.api) {
			put(projectRoot, files, path.join(dir, "api", "manifest.yaml"), apiManifest(name));
			put(projectRoot, files, path.join(dir, "api", "api.ts"), apiTs(name));
		}
	}
	catch (error) {
		// N7：不留半截目录（scanModuleRoot 会把「有 api/ 或 web/ 但缺标记」的目录判成坏模块）
		fs.rmSync(dir, { recursive: true, force: true });
		throw error;
	}
	return { dir, files };
}

function put(projectRoot: string, files: string[], p: string, content: string): void {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content);
	files.push(path.relative(projectRoot, p));
}

function solutionYaml(name: string, withApi: boolean): string {
	const api = withApi
		? [
			"api:",
			`  module: ${name}`,
			`  prefix: /api/${name}`,
			"",
		].join("\n")
		: "";
	return `# 方案契约：ojm build --bundle 的入口（字段规范见 devkit 手册 §11.1；
# 优先级：本文件 > 工程根 solution.yaml > 同名 manifest.yaml 回退）。
name: ${name}
version: 0.1.0
title: ${name}
summary: ${name} 方案（ojm new 生成的骨架，替换为你的描述）
changelog:
  - 0.1.0 首个版本（ojm new 生成）
${api}web:
  route_prefix: /${name}
  entry: modules/${name}/0.1.0/entry.js
`;
}

function entryTs(name: string, shell: "container" | "none"): string {
	return `import { defineModule } from "@oj-module/runtime";
import { lazy } from "react";

const Index = lazy(() => import("./pages/index"));

/**
 * ${name} 方案：\`ojm new\` 生成的最小骨架。
 * 菜单顺序由 handle.order 决定（≥0 主菜单区升序；<0 底部固定区）；
 * 标题键对应 locales/<lang>.json 的 menu.main。
 */
export default defineModule({
	name: "${name}",
	description: "${name} 方案",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [
		{
			path: "/${name}",
			handle: { layout: "${shell}", order: 200, title: "${name}:menu.main" },
			children: [
				{
					index: true,
					Component: Index,
					handle: { title: "${name}:menu.main" },
				},
			],
		},
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
});
`;
}

function pageTsx(name: string): string {
	return `import { BasicContent } from "@oj-module/runtime";
import { Card, Typography } from "antd";

/** ${name} 方案首页：\`ojm new\` 生成的占位页，替换为你的实现。 */
export default function IndexPage() {
	return (
		<BasicContent>
			<Card>
				<Typography.Title level={4} style={{ marginTop: 0 }}>
					${name}
				</Typography.Title>
				<Typography.Text type="secondary">
					由 ojm new 生成的方案骨架——从这里开始你的实现。
				</Typography.Text>
			</Card>
		</BasicContent>
	);
}
`;
}

function apiManifest(name: string): string {
	return `# oj 原生七键清单：oj 按 src/<name>/api/manifest.yaml 枚举发现后端模块，
# 与方案契约（上级 solution.yaml）是两条互不干扰的枚举（devkit 手册 §1.2）。
name: ${name}
desc: ${name} 方案后端（ojm new 生成的骨架）
version: 0.1.0
tables: []
`;
}

function apiTs(name: string): string {
	return `// GET /api/${name}/ping —— 健康探针示例（保存即热更；出参挂平级 .response 即入 openapi.json）。
export async function ping() {
	json.ok({ pong: true, module: "${name}" });
}
`;
}
