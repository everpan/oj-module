import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readline } from "node:readline/promises";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

function validateModuleName(name: string): string | null {
	if (!name) {
		return "模块名称不能为空";
	}
	if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
		return "模块名称须为 kebab-case 格式（如 my-module）";
	}
	return null;
}

async function question(rl: any, prompt: string, defaultVal?: string): Promise<string> {
	const suffix = defaultVal ? ` (${defaultVal})` : "";
	const answer = await rl.question(`${prompt}${suffix}: `);
	return answer.trim() || defaultVal || "";
}

async function main() {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	console.log("\n🧩 模块初始化向导\n");

	const moduleName = await question(rl, "模块名称（kebab-case）");
	const nameError = validateModuleName(moduleName);
	if (nameError) {
		console.error(`\n✖ ${nameError}`);
		process.exit(1);
	}

	const moduleDir = path.join(PROJECT_ROOT, "web", moduleName);
	if (fs.existsSync(moduleDir)) {
		console.error(`\n✖ 模块目录已存在: ${moduleDir}`);
		process.exit(1);
	}

	const description = await question(rl, "模块描述", `${moduleName} 模块`);
	const version = await question(rl, "初始版本号", "1.0.0");
	const hasI18n = (await question(rl, "是否需要国际化（y/n）", "y")).toLowerCase() === "y";
	const orderInput = await question(rl, "菜单排序权重（数字，越大越靠后）", "50");
	const order = Number.parseInt(orderInput, 10) || 50;
	const requiredRoles = await question(rl, "需要的角色（逗号分隔，留空无限制）");

	rl.close();

	const modulePascalName = moduleName
		.split("-")
		.map(s => s.charAt(0).toUpperCase() + s.slice(1))
		.join("");

	// 创建目录结构
	const dirs = ["pages"];
	if (hasI18n) {
		dirs.push("locales");
	}
	for (const dir of dirs) {
		fs.mkdirSync(path.join(moduleDir, dir), { recursive: true });
	}

	// 页面组件（P7.13：现行契约——从 runtime 包导入，禁用 #src/*）
	const pageContent = `import { BasicContent } from "@oj-module/runtime";

export default function ${modulePascalName}() {
	return <BasicContent>${description}</BasicContent>;
}
`;
	fs.writeFileSync(path.join(moduleDir, "pages", "index.tsx"), pageContent);

	// P7.13 / 评审 F9：locales 目录与翻译文件只在 hasI18n 时创建
	// （此前目录条件创建、文件无条件写入，选 n 必然 ENOENT 并残留半成品）
	if (hasI18n) {
		const zhCn = `${JSON.stringify({ menu: { [moduleName]: description } }, null, "\t")}\n`;
		const enUs = `${JSON.stringify({ menu: { [moduleName]: description } }, null, "\t")}\n`;
		fs.writeFileSync(path.join(moduleDir, "locales", "zh-CN.json"), zhCn);
		fs.writeFileSync(path.join(moduleDir, "locales", "en-US.json"), enUs);
	}

	// entry.ts（模块元信息的唯一来源）
	const i18nBlock = hasI18n
		? `,
\ti18n: {
\t\t"zh-CN": () => import("./locales/zh-CN.json"),
\t\t"en-US": () => import("./locales/en-US.json"),
\t}`
		: "";

	const configBlock = requiredRoles
		? `,
\tconfig: {
\t\trequiredRoles: [${requiredRoles.split(",").map(r => `"${r.trim()}"`).join(", ")}],
\t}`
		: "";

	// P7.13 / 评审 F10：模板对齐现行契约——
	// 包导入（非 #src/*）、handle.layout 显式声明（不再由模块自挂布局组件）、
	// icon 为 ReactNode（非字符串）
	const entryContent = `import type { AppRouteRecordRaw, ModuleDefinition } from "@oj-module/runtime";

import { AppstoreOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

const ${modulePascalName}Page = lazy(() => import("./pages/index"));

const routes: AppRouteRecordRaw[] = [
\t{
\t\tpath: "/${moduleName}",
\t\thandle: {
\t\t\tlayout: "container",
\t\t\torder: ${order},
\t\t\ttitle: "${moduleName}:menu.${moduleName}",
\t\t\ticon: createElement(AppstoreOutlined),
\t\t},
\t\tchildren: [
\t\t\t{
\t\t\t\tindex: true,
\t\t\t\tComponent: ${modulePascalName}Page,
\t\t\t\thandle: {
\t\t\t\t\ttitle: "${moduleName}:menu.${moduleName}",
\t\t\t\t\ticon: createElement(AppstoreOutlined),
\t\t\t\t},
\t\t\t},
\t\t],
\t},
];

const mod: ModuleDefinition = {
\tname: "${moduleName}",
\tdescription: "${description}",
\tversion: "${version}",
\troutes${i18nBlock}${configBlock}
};

export default mod;
`;
	fs.writeFileSync(path.join(moduleDir, "entry.ts"), entryContent);

	// 更新 manifest.json
	const manifestPath = path.join(PROJECT_ROOT, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
	manifest.modules.push({
		name: moduleName,
		entry: `/web/${moduleName}/entry.ts`,
		enabled: true,
	});
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

	console.log(`\n✔ 模块已创建: web/${moduleName}/`);
	console.log("  目录结构:");
	console.log(`    web/${moduleName}/`);
	console.log("    ├── entry.ts");
	console.log("    ├── pages/");
	console.log("    │   └── index.tsx");
	if (hasI18n) {
		console.log("    ├── locales/");
		console.log("    │   ├── zh-CN.json");
		console.log("    │   └── en-US.json");
	}
	console.log("\n已自动更新:");
	console.log(`  • manifest.json (添加 ${moduleName})`);
	console.log("\n下一步:");
	console.log("  1. 运行 pnpm dev 启动开发");
	console.log("");
}

// P7.10 同款：失败必须非 0 退出（含向导中途 ENOENT 等异常）
main().catch((error) => {
	console.error(error);
	process.exit(1);
});
