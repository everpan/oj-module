import type { UserConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { readModuleDefinition } from "../packages/cli/src/build";
import { isSharedDep } from "../packages/cli/src/shared-deps";

function getOutputDir(moduleName: string, version: string): string {
	return path.resolve("build", "modules", moduleName, version);
}

async function buildModule(moduleDir: string) {
	const entryPath = path.join(moduleDir, "entry.ts");
	if (!fs.existsSync(entryPath)) {
		console.warn(`[build-modules] Skip ${path.basename(moduleDir)}: entry.ts not found`);
		return null;
	}

	// P3.4 / B10：元数据由 esbuild bundle + 真实 import() 解析（复用 cli 实现），
	// 替换此前从源码抠 name/version 字符串的脆弱正则
	const definition = await readModuleDefinition(entryPath, path.resolve());
	const { name: moduleName, version } = definition;

	console.log(`[build-modules] Building ${moduleName}@${version}...`);

	await build({
		root: moduleDir,
		build: {
			lib: {
				entry: entryPath,
				formats: ["es"],
				fileName: () => "entry.js",
			},
			outDir: getOutputDir(moduleName, version),
			emptyOutDir: true,
			rollupOptions: {
				external: (id) => {
					if (id === "@oj-module/runtime") {
						// 框架运行时由宿主 importmap 提供（P3.2）
						return true;
					}
					// P4.7：共享表收敛到 cli 单一来源，本地 SHARED_EXTERNALS 已删（B1/B11）
					return isSharedDep(id);
				},
			},
		},
		plugins: [react()],
		logLevel: "warn",
	} as UserConfig);

	console.log(`[build-modules] ✓ ${moduleName}@${version} → build/modules/${moduleName}/${version}/`);
	return definition;
}

async function main() {
	const targetModule = process.argv.find(arg => arg.startsWith("--module="))?.split("=")[1];
	const modulesDir = path.resolve("modules");
	const built: NonNullable<Awaited<ReturnType<typeof buildModule>>>[] = [];

	if (targetModule) {
		const moduleDir = path.join(modulesDir, targetModule);
		if (!fs.existsSync(moduleDir)) {
			console.error(`[build-modules] Module "${targetModule}" not found in ${modulesDir}`);
			process.exit(1);
		}
		const definition = await buildModule(moduleDir);
		if (definition)
			built.push(definition);
	}
	else {
		const entries = fs.readdirSync(modulesDir, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => path.join(modulesDir, d.name));

		for (const moduleDir of entries) {
			const definition = await buildModule(moduleDir);
			if (definition)
				built.push(definition);
		}
	}

	// P7.15 / 评审 P5：产出生产清单 build/module-manifest.json——entry 指向版本化
	// 构建产物（相对路径，由 runtime 启动时按 base 补齐），替代根 manifest.json
	// 中的开发态源码路径（/modules/<name>/entry.ts，生产环境 404）。
	// 命名不能叫 manifest.json：vite build 会把 public/manifest.json（PWA 清单）
	// 拷进 build/ 覆盖同名文件，运行时 fetch 到 PWA 内容直接启动失败。
	const prodManifest = {
		modules: built.map(definition => ({
			name: definition.name,
			entry: `modules/${definition.name}/${definition.version}/entry.js`,
			enabled: true,
			dependencies: definition.config?.dependencies ?? [],
			...(definition.peerRuntime ? { peerRuntime: definition.peerRuntime } : {}),
		})),
	};
	fs.writeFileSync(
		path.resolve("build", "module-manifest.json"),
		`${JSON.stringify(prodManifest, null, 2)}\n`,
	);
	console.log("[build-modules] 生产清单已生成 → build/module-manifest.json");

	console.log("[build-modules] All modules built.");
}

// P7.10 / 评审 F8：构建失败必须以非 0 退出，否则 CI 静默放行坏产物
main().catch((error) => {
	console.error(error);
	process.exit(1);
});
