/**
 * `ojm init` —— 前后端一体化工程脚手架（设计 §3，D1/D3/D6/D10）。
 *
 * 产物：api/（oj 后端 + 现场签发证书 + seed）、modules/src/（前端模块）、
 * bin/（从 everpan/only-js 最新 release 联网下载：oj + plugins + devkit）、
 * 工程配置文件。
 *
 * 幂等补缺：对既有工程重跑只补缺失文件（bin/oj 已在则跳过下载），config.yaml 与
 * 用户文件永不覆盖——「重新 init 覆盖脚手架」是审阅记录二明令禁止的行为。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { mintDevCert } from "./oj-cert";
import { vendorCommand } from "./vendor";
import { readHostVersions } from "./versions";

export interface InitOptions {
	/** 跳过非空目录确认（自动化/测试用） */
	yes?: boolean
	/** 注入桩 oj 安装器（测试）；默认 vendorCommand 经 npm 包 @oj-bin/oj 联网安装 */
	ojInstaller?: (binDir: string) => Promise<void>
}

interface InitReport {
	created: string[]
	skipped: string[]
}

export async function initProject(destDir: string, opts: InitOptions = {}): Promise<void> {
	fs.mkdirSync(destDir, { recursive: true });
	const existing = fs.readdirSync(destDir);
	if (existing.length > 0 && !opts.yes) {
		throw new Error(
			`[ojm] 目标目录非空（${destDir}）。\n`
			+ "init 只做幂等补缺、不会覆盖已有文件；确认继续请加 --yes。",
		);
	}

	const report: InitReport = { created: [], skipped: [] };
	const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

	// 1) 模板（占位符替换 + 幂等跳过）
	const templatesDir = path.join(cliRoot, "templates");
	const jwtSecret = crypto.randomBytes(32).toString("hex");
	const projectName = path.basename(destDir);
	copyTemplates(templatesDir, destDir, {
		__JWT_SECRET__: jwtSecret,
		__PROJECT_NAME__: projectName,
	}, report);

	// 2) 证书三件套（现场签发，D6）
	const certDir = path.join(destDir, "api/config");
	if (fs.existsSync(path.join(certDir, "cert.jws"))) {
		report.skipped.push("api/config/cert.jws");
	}
	else {
		await mintDevCert(certDir);
		report.created.push("api/config/{private.pem,public.pem,cert.jws}");
	}

	// 3) oj 二进制：从最新 release 联网下载（sha256 校验 → tar 解包 → chmod），
	//    无内置兜底；bin/oj 已在则幂等跳过，缺 .oj-version 标记视为未装
	const binDir = path.join(destDir, "bin");
	if (fs.existsSync(path.join(binDir, "oj"))) {
		report.skipped.push("bin/oj");
	}
	else {
		const installer = opts.ojInstaller ?? ((dir: string) => vendorCommand(path.dirname(dir), { force: false }));
		await installer(binDir);
		report.created.push("bin/{oj,plugins/,devkit/}（release 下载）");
	}

	// 4) devkit 分发：agent skill + 全局类型
	const devkit = path.join(binDir, "devkit");
	if (fs.existsSync(path.join(devkit, "SKILL.md"))) {
		const skillDir = path.join(destDir, ".claude/skills/oj-api-dev");
		fs.mkdirSync(skillDir, { recursive: true });
		for (const name of ["SKILL.md", "api-manual.md"])
			copyIfAbsent(path.join(devkit, name), path.join(skillDir, name), report);
		copyIfAbsent(path.join(devkit, "global.d.ts"), path.join(destDir, "global.d.ts"), report);
	}
	else {
		report.skipped.push(".claude/skills/oj-api-dev（bin/devkit 缺失，跳过）");
	}

	// 5) package.json：不存在则生成；已存在则合并补缺（scripts/devDeps/pnpm
	// 只补缺失键，既有内容永不覆盖——0.1.0 发布实测：用户常先建最小
	// package.json 装 cli，整体跳过会让 pnpm dev 无脚本可用）
	const pkgPath = path.join(destDir, "package.json");
	if (fs.existsSync(pkgPath)) {
		const before = fs.readFileSync(pkgPath, "utf-8");
		const merged = mergePackageJson(JSON.parse(before), generatePackageJson(cliRoot, projectName));
		const after = `${JSON.stringify(merged, null, "\t")}\n`;
		if (after !== before) {
			fs.writeFileSync(pkgPath, after);
			report.created.push("package.json（合并补缺）");
		}
		else {
			report.skipped.push("package.json");
		}
	}
	else {
		fs.writeFileSync(
			pkgPath,
			`${JSON.stringify(generatePackageJson(cliRoot, projectName), null, "\t")}\n`,
		);
		report.created.push("package.json");
	}

	// 5b) pnpm-workspace.yaml：模板对全新工程已落盘；pnpm v11 会在首次
	// install 时自动生成该文件（含 esbuild 审批占位行），copyTemplates
	// 的「已存在即跳过」会把审批挡在门外（0.1.0 发布实测）——必须合并
	ensureAllowBuilds(destDir, report);

	console.log(`[ojm] init 完成：${destDir}`);
	console.log(`[ojm]   新增 ${report.created.length} 项，跳过（已存在）${report.skipped.length} 项`);
	for (const item of report.skipped)
		console.log(`[ojm]   · 跳过 ${item}`);
	console.log("[ojm] 下一步：pnpm install && pnpm dev（登录 admin / 123456）");
}

/** 递归拷贝模板；文本文件做占位符替换；已存在的目标文件一律跳过 */
function copyTemplates(
	srcDir: string,
	destDir: string,
	placeholders: Record<string, string>,
	report: InitReport,
): void {
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		const src = path.join(srcDir, entry.name);
		const dest = path.join(destDir, entry.name);
		if (entry.isDirectory()) {
			fs.mkdirSync(dest, { recursive: true });
			copyTemplates(src, dest, placeholders, report);
			continue;
		}
		const rel = path.relative(destDir, dest);
		if (fs.existsSync(dest)) {
			report.skipped.push(rel);
			continue;
		}
		let content = fs.readFileSync(src, "utf-8");
		for (const [token, value] of Object.entries(placeholders))
			content = content.replaceAll(token, value);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, content);
		report.created.push(rel);
	}
}

function copyIfAbsent(src: string, dest: string, report: InitReport): void {
	if (fs.existsSync(dest)) {
		report.skipped.push(path.basename(dest));
		return;
	}
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(src, dest);
	report.created.push(path.relative(process.cwd(), dest) || path.basename(dest));
}

/**
 * 确保 pnpm-workspace.yaml 的 allowBuilds 含 `esbuild: true`。
 *  - pnpm v11 自动生成的占位行（"set this to true or false"）→ 填 true
 *  - 有 allowBuilds 段无 esbuild 行 → 段内追加
 *  - 无 allowBuilds 段 → 文末追加整段
 *  - 显式 `esbuild: false` → 用户的选择，尊重不动
 */
function ensureAllowBuilds(destDir: string, report: InitReport): void {
	const yamlPath = path.join(destDir, "pnpm-workspace.yaml");
	let content = fs.readFileSync(yamlPath, "utf-8");
	if (/^\s+esbuild:\s*(?:true|false)\s*$/m.test(content)) {
		if (/^\s+esbuild:\s*true\s*$/m.test(content))
			report.skipped.push("pnpm-workspace.yaml（allowBuilds 已含 esbuild）");
		else
			report.skipped.push("pnpm-workspace.yaml（esbuild: false 为用户显式选择，不动）");
		return;
	}
	if (/^\s+esbuild:\s*set this to true or false\s*$/m.test(content)) {
		content = content.replace(/^(\s+)esbuild:\s*set this to true or false\s*$/m, "$1esbuild: true");
	}
	else if (/^allowBuilds:\s*$/m.test(content)) {
		content = content.replace(/^allowBuilds:\s*$/m, "allowBuilds:\n  esbuild: true");
	}
	else {
		content = `${content.replace(/\s*$/, "")}\nallowBuilds:\n  esbuild: true\n`;
	}
	fs.writeFileSync(yamlPath, content);
	report.created.push("pnpm-workspace.yaml（合并 esbuild 构建审批）");
}

/**
 * 依赖版本钉死（审阅记录二 F5）：workspace 协议与 catalog 协议在外部工程
 * 不可解析——cli/runtime 取真实安装/包版本，共享依赖取宿主 versions.json
 * （版本矩阵真源），缺项回退 "*" 并告警。
 *
 * 钉版数据源（P1 起宿主并入 cli）：cli 内置 `shell-dist/versions.json`
 * （构建产物）→ cli 内置 `vendor/host-versions.json`（prepack 同步的快照，
 * shell-dist 尚未构建时兜底）。
 */
export function resolveVersionMatrix(cliRoot: string): { matrix: Record<string, string> } {
	const shellDist = path.join(cliRoot, "shell-dist");
	if (fs.existsSync(path.join(shellDist, "versions.json")))
		return { matrix: readHostVersions(shellDist) };
	const bundled = JSON.parse(fs.readFileSync(path.join(cliRoot, "vendor/host-versions.json"), "utf-8"));
	return { matrix: bundled.matrix };
}

/** 合并补缺：scripts/devDependencies 只补缺失键，既有内容不动 */
function mergePackageJson(existing: Record<string, any>, generated: Record<string, any>): Record<string, any> {
	const merged = { ...existing };
	merged.scripts = { ...generated.scripts, ...existing.scripts };
	merged.devDependencies = { ...generated.devDependencies, ...existing.devDependencies };
	return merged;
}

function generatePackageJson(cliRoot: string, projectName: string) {
	const { matrix: hostVersions } = resolveVersionMatrix(cliRoot);
	const cliPkg = JSON.parse(fs.readFileSync(path.join(cliRoot, "package.json"), "utf-8"));

	const pin = (name: string): string => {
		const version = hostVersions[name];
		if (version)
			return version;
		console.warn(`[ojm] ⚠️ ${name} 未在宿主 versions.json 中，模板回退 "*"（安装后请手动钉版本）`);
		return "*";
	};

	const devDeps: Record<string, string> = {
		"@oj-module/cli": cliPkg.version,
		// runtime 必须显式声明：uni-dev 工程的 contract.ts 与生成 client 直接 import
		// `@oj-module/runtime/contract[/errors]`，`ojm api` 在 Node 侧求值契约时
		// 需从工程 node_modules 解析真实现（evaluateContract 把裸说明符 external）。
		"@oj-module/runtime": pin("@oj-module/runtime"),
		"@ant-design/icons": pin("@ant-design/icons"),
		// personal-center 的 ProForm 用到——仅取**类型**（运行时由宿主 importmap 提供单例）
		"@ant-design/pro-components": pin("@ant-design/pro-components"),
		"@types/react": pin("@types/react"),
		"antd": pin("antd"),
		// home 首页图表演示用到——仅取**类型**（运行时由宿主 importmap 提供单例）
		"dayjs": pin("dayjs"),
		"echarts": pin("echarts"),
		"echarts-for-react": pin("echarts-for-react"),
		"react": pin("react"),
		"react-countup": pin("react-countup"),
		"react-dom": pin("react-dom"),
		"react-i18next": pin("react-i18next"),
		"react-router": pin("react-router"),
		"typescript": pin("typescript"),
	};
	// 版本矩阵没有的包回退 "*"：不该默默发生，统一提示一次
	const unpinned = Object.entries(devDeps).filter(([, v]) => v === "*");
	if (unpinned.length > 0) {
		console.warn(
			`[ojm] ⚠️ 以下依赖未在宿主 versions.json 中，请安装后手动钉版本：${unpinned.map(([n]) => n).join(", ")}`,
		);
	}

	return {
		name: projectName,
		type: "module",
		private: true,
		scripts: {
			dev: "ojm dev",
			build: "ojm build",
			preview: "ojm preview",
			info: "ojm info",
			typecheck: "tsc --noEmit -p tsconfig.json",
		},
		devDependencies: devDeps,
	};
}
