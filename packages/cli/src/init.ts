/**
 * `ojm init` —— 前后端一体化工程脚手架（设计 §3，D1/D3/D6/D10）。
 *
 * 产物：api/（oj 后端 + seed）、config/（config.yaml + 现场签发证书，与 api/、web/ 同级）、
 * web/src/（前端模块）、bin/（从 everpan/only-js 最新 release 联网下载：oj + plugins + devkit）、
 * 工程配置文件。
 *
 * 幂等补缺：对既有工程重跑只补缺失文件（bin/oj 已在则跳过下载），config.yaml 与
 * 用户文件永不覆盖——「重新 init 覆盖脚手架」是审阅记录二明令禁止的行为。
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { resolveCertDir, resolveConfigPath } from "./layout";
import { mintDevCert } from "./oj-cert";
import { resolveOjBin, vendorCommand } from "./vendor";
import { readHostVersions } from "./versions";

export interface InitOptions {
	/** 跳过非空目录确认（自动化/测试用） */
	yes?: boolean
	/** 注入桩 oj 安装器（测试）；默认 vendorCommand 经 npm 包 @oj-bin/oj 联网安装 */
	ojInstaller?: (binDir: string) => Promise<void>
	/** 注入桩密封（测试）；缺省真跑 bin/oj secret keygen/seal */
	seal?: Sealer
}

interface InitReport {
	created: string[]
	skipped: string[]
}

/**
 * 凭据密封执行器：把 config.yaml 里的明文 `auth.jwt_secret` 换成 `ENC[...]`。
 * 返回 null = 未密封（oj 缺失/不支持），调用方据此保留明文并告警。
 */
export type Sealer = (destDir: string, plainSecret: string) => Promise<string | null>;

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
	// demo-only 模块（init.exclude.yaml）：模板内置供演示，init 默认不拷入新工程
	const exclude = readInitExclude(templatesDir);
	copyTemplates(templatesDir, destDir, {
		__JWT_SECRET__: jwtSecret,
		__PROJECT_NAME__: projectName,
	}, report, exclude, templatesDir);
	pruneExcludedApiPaths(destDir, exclude, report);

	// 2) 证书三件套（现场签发，D6）——落点即 resolveCertDir()（config.yaml 同级的 config/）
	const certDir = resolveCertDir(destDir);
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

	// 3.5) 凭据密封（oj v0.1.33）：把模板里的明文 jwt_secret 换成 ENC[...]。
	//      oj 不可用/不支持 secret → 保留明文并告警（init 不因加密失败而失败）
	await sealJwtSecret(destDir, report, opts.seal);

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

	// 4b) ojm 模块开发 skill 分发：从 cli 包内置 devkit（prepack 同步的
	//     docs/devkit）拷到 .claude/skills/ojm-module-dev/；已存在则幂等跳过。
	const cliDevkit = path.join(cliRoot, "devkit");
	if (fs.existsSync(path.join(cliDevkit, "SKILL.md"))) {
		const ojmSkillDir = path.join(destDir, ".claude/skills/ojm-module-dev");
		fs.mkdirSync(ojmSkillDir, { recursive: true });
		for (const name of ["SKILL.md", "manual.md", "README.md"])
			copyIfAbsent(path.join(cliDevkit, name), path.join(ojmSkillDir, name), report);
	}
	else {
		report.skipped.push(".claude/skills/ojm-module-dev（cli 内置 devkit 缺失，跳过）");
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

/** 默认密封器：bin/oj secret keygen + seal（失败返回 null，不抛） */
const defaultSealer: Sealer = async (destDir, plainSecret) => {
	const ojBin = resolveOjBin(destDir);
	if (!fs.existsSync(ojBin))
		return null;
	const keysDir = resolveCertDir(destDir);
	const publicKey = path.join(keysDir, "secrets-public.pem");
	try {
		fs.mkdirSync(keysDir, { recursive: true });
		execFileSync(ojBin, ["secret", "keygen", "--out-dir", keysDir], { stdio: "pipe" });
		// 明文经 stdin 传入：命令行参数会进 shell history 与 ps（手册 §10 明确要求）
		const out = execFileSync(ojBin, ["secret", "seal", "-k", publicKey], {
			input: plainSecret,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const sealed = out.trim();
		return sealed.startsWith("ENC[") ? sealed : null;
	}
	catch {
		return null;
	}
};

/**
 * 把 config.yaml 的明文 `auth.jwt_secret` 换成 `ENC[...]`（oj v0.1.33 凭据密封），
 * 并补 `secrets:` 段指向私钥。失败一律降级为明文 + 告警——init 不因加密失败而失败。
 */
async function sealJwtSecret(destDir: string, report: InitReport, seal: Sealer = defaultSealer): Promise<void> {
	const configPath = resolveConfigPath(destDir);
	if (!fs.existsSync(configPath))
		return;
	const text = fs.readFileSync(configPath, "utf-8");
	const match = /^(?<indent>\s*)jwt_secret:\s*(?<value>"?[0-9a-f]{16,}"?)/m.exec(text);
	if (!match?.groups)
		return; // 已密封（ENC[…]）或被人工改过 → 不动
	const plain = match.groups.value.replaceAll("\"", "");
	const sealed = await seal(destDir, plain);
	if (!sealed) {
		console.warn("[ojm] ⚠️ 未能密封 jwt_secret（oj 缺失或不支持 secret）——config.yaml 里仍是明文，生产部署前请手动密封：oj secret keygen/seal（手册 §10）。");
		return;
	}
	const next = text.replace(match[0], `${match.groups.indent}jwt_secret: "${sealed}"`);
	// secrets 段：私钥只放部署机，路径相对 config 目录（config.yaml 同级）
	const withSecrets = `${next.trimEnd()}\nsecrets:\n  private_key_path: ./config/secrets-private.pem\n  public_key_path: ./config/secrets-public.pem\n`;
	fs.writeFileSync(configPath, withSecrets);
	report.created.push("api/config/{secrets-private.pem,secrets-public.pem} + auth.jwt_secret 已密封（ENC[...]）");
}

/** 递归拷贝模板；文本文件做占位符替换；已存在的目标文件一律跳过 */
function copyTemplates(
	srcDir: string,
	destDir: string,
	placeholders: Record<string, string>,
	report: InitReport,
	exclude: Set<string>,
	rootDir: string,
): void {
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		const src = path.join(srcDir, entry.name);
		const dest = path.join(destDir, entry.name);
		// demo-only 模块（init.exclude.yaml）：整棵子树不拷、不计入 created/skipped
		if (exclude.has(path.relative(rootDir, src)))
			continue;
		if (entry.isDirectory()) {
			// 空目录不进工程：git 不跟踪空目录，模板里残留的空目录（如误建的
			// api/src/_shared）会被 oj build 当作缺 manifest.yaml 的模块 fail-fast
			if (!dirHasFiles(src))
				continue;
			fs.mkdirSync(dest, { recursive: true });
			copyTemplates(src, dest, placeholders, report, exclude, rootDir);
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
		content = stripRegion(content, "demo-only");
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, content);
		report.created.push(rel);
	}
}

/** 目录（递归）是否含至少一个文件——空目录判定供 copyTemplates 跳过用 */
function dirHasFiles(dir: string): boolean {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile())
			return true;
		if (entry.isDirectory() && dirHasFiles(path.join(dir, entry.name)))
			return true;
	}
	return false;
}

/**
 * 读取模板根 `init.exclude.yaml` 的 `exclude` 清单，归一为相对模板根的路径集合。
 * 清单随模板一起发布，缺失即安装包损坏——直接 fail-fast，不留「静默拷入 demo
 * 模块/运行期产物」的退化路径。
 *
 * 另按「排除的 api 模块」派生一条：其前端 `__client` 生成物同样不拷——否则脚手架
 * 里会留下一份没有后端端点的 client 代码。
 */
function readInitExclude(templatesDir: string): Set<string> {
	const yamlPath = path.join(templatesDir, "init.exclude.yaml");
	if (!fs.existsSync(yamlPath))
		throw new Error(`模板缺少 init.exclude.yaml：${yamlPath}（安装包损坏？）`);
	const doc = yaml.parse(fs.readFileSync(yamlPath, "utf-8")) as { exclude?: string[] } | null;
	const out = new Set<string>();
	for (const raw of doc?.exclude ?? []) {
		const p = path.normalize(raw).replace(/^(\.\/)+/, "");
		out.add(p);
		if (p.startsWith("api/src/") && !p.slice(8).includes("/"))
			out.add(`web/src/${p.slice(8)}/__client`);
	}
	return out;
}

/**
 * 从脚手架产出的 openapi.json 里删掉被排除的 api 模块端点。
 *
 * 模板的 openapi.json 是「全量演示工程」的产物，含 demo-only 模块的端点；这些
 * 模块的文件既不拷进新工程，契约里留着它们会让 `ojm api --check` 一上手就报
 * 「openapi 多」（有契约无 handler）。故按排除清单里的 api 模块名裁掉对应路径。
 */
function pruneExcludedApiPaths(destDir: string, exclude: Set<string>, report: InitReport): void {
	// 只裁本次新建的 openapi.json：init 是幂等补缺，不改动既有工程文件
	if (!report.created.includes("openapi.json"))
		return;
	const mods = [...exclude]
		.map(p => (p.startsWith("api/src/") ? p.slice("api/src/".length) : null))
		.filter((m): m is string => !!m && !m.includes("/"));
	if (mods.length === 0)
		return;
	const openapiPath = path.join(destDir, "openapi.json");
	const prefixes = mods.map(m => `/api/${m}/`);
	const doc = JSON.parse(fs.readFileSync(openapiPath, "utf-8")) as { paths?: Record<string, unknown> };
	const paths = doc.paths ?? {};
	const dropped = Object.keys(paths).filter(p => prefixes.some(prefix => p.startsWith(prefix)));
	if (dropped.length === 0)
		return;
	for (const p of dropped)
		delete paths[p];
	fs.writeFileSync(openapiPath, `${JSON.stringify(doc, null, "\t")}\n`);
	report.created.push(`openapi.json 裁掉 demo-only 端点 ${dropped.length} 条`);
}

/**
 * 删除文本里的 `#region <name>` … `#endregion` 区间（含标记行本身）。
 * 用于把模板内置的 demo-only 模块条目从脚手架产出的配置里剥离，避免留下
 * 指向未拷贝文件的死条目。标记写不成对时原样返回，不做猜测。
 */
function stripRegion(text: string, name: string): string {
	const lines = text.split("\n");
	const start = new RegExp(`^\\s*//\\s*#region\\s+${name}\\b`);
	const end = /^\s*\/\/\s*#endregion\b/;
	const kept: string[] = [];
	let inRegion = false;
	for (const line of lines) {
		if (inRegion) {
			if (end.test(line))
				inRegion = false;
			continue;
		}
		if (start.test(line)) {
			inRegion = true;
			continue;
		}
		kept.push(line);
	}
	return inRegion ? text : kept.join("\n");
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
		// runtime 必须显式声明：生成的 __client 与 web 模块直接 import
		// `@oj-module/runtime`（契约层在 oj handler 的 .schema/.response 上，
		// 经 openapi.json 进 client，不再经过 runtime/contract 的 Node 侧求值）。
		"@oj-module/runtime": pin("@oj-module/runtime"),
		"@ant-design/icons": pin("@ant-design/icons"),
		// personal-center 的 ProForm 用到——仅取**类型**（运行时由宿主 importmap 提供单例）
		"@ant-design/pro-components": pin("@ant-design/pro-components"),
		// system 模块页面数据层 + i18n 类型（TFunction）用到——仅取**类型**（运行时由宿主提供单例）
		"@tanstack/react-query": pin("@tanstack/react-query"),
		"@types/react": pin("@types/react"),
		"antd": pin("antd"),
		"i18next": pin("i18next"),
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
