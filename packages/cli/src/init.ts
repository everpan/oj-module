/**
 * `ojm init` —— 前后端一体化工程脚手架（设计 §3，D1/D3/D6/D10）。
 *
 * 产物（布局 `src/<name>/{api,web}`）：src/（模块源码单树）、config.yaml + config/（现场签发证书）、
 * seed.*.sql / tests / vitest.config.ts（后端工程面，与 config.yaml 同级）、
 * bin/（从 everpan/only-js 最新 release 联网下载：oj + plugins + devkit）、工程配置文件。
 *
 * 幂等补缺：对既有工程重跑只补缺失文件（bin/oj 已在则跳过下载，但先过 §7 能力闸门），
 * config.yaml 与用户文件永不覆盖——「重新 init 覆盖脚手架」是审阅记录二明令禁止的行为。
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { resolveCertDir, resolveConfigPath } from "./layout";
import { probeOjCaps } from "./oj-caps";
import { mintDevCert } from "./oj-cert";
import { isSupportedOjVersion, MIN_OJ_VERSION, resolveOjBin, vendorCommand } from "./vendor";
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
	warnings: string[]
}

/**
 * 凭据密封执行器：把 config.yaml 里的明文 `auth.jwt_secret` 换成 `ENC[...]`。
 * 返回 null = 未密封（oj 缺失/不支持），调用方据此保留明文并告警。
 */
export type Sealer = (destDir: string, plainSecret: string) => Promise<string | null>;

/**
 * 既有 `bin/oj` 的能力预检（设计 §7「双探」；评审 BLOCKING #8）。
 *
 * 只查**已存在**的二进制：刚由 `vendorCommand` 装下的那份已被 `MIN_OJ_VERSION` 挡过一遍，
 * 而「从别处拷来的旧二进制」正是这条闸门要拦的形态。
 *
 * 三档处置：
 *   - `-V` 读不出版本（桩/损坏二进制）→ 告警放行，不阻断幂等补缺；
 *   - 版本 < MIN_OJ_VERSION → 抛错（`ojm vendor --force` 可覆盖标记）；
 *   - 版本够但 `--module-root` 缺失 → 抛错，这是「声明新、能力旧」的真实形态。
 */
function assertExistingOjUsable(destDir: string, report: InitReport): void {
	const ojBin = resolveOjBin(destDir);
	if (!fs.existsSync(ojBin))
		return;

	let printed: string;
	try {
		printed = execFileSync(ojBin, ["-V"], { encoding: "utf-8", timeout: 10_000 }).trim();
	}
	catch (error) {
		report.warnings.push(`无法执行 ${ojBin} -V（${(error as Error).message}），跳过版本校验`);
		return;
	}

	const version = /(\d+\.\d+\.\d+)/.exec(printed)?.[1];
	if (!version) {
		report.warnings.push(`无法解析 ${ojBin} -V 的输出（${printed || "空"}），跳过版本校验`);
		return;
	}
	if (!isSupportedOjVersion(version)) {
		throw new Error(
			`[ojm] ${ojBin} 是 v${version}，低于 ojm 要求的最低版本 v${MIN_OJ_VERSION}。\n`
			+ "原因：init 不再对已存在的 bin/oj 静默跳过——旧二进制生成的新布局工程会在 `ojm build` 时才失败。\n"
			+ `处置：\`ojm vendor --force v${MIN_OJ_VERSION}\` 重装，或删除 ${ojBin} 后重跑 init。`,
		);
	}

	try {
		if (probeOjCaps(ojBin).moduleRoot)
			return;
	}
	catch (error) {
		report.warnings.push(`能力探针失败（${(error as Error).message}），跳过 --module-root 校验`);
		return;
	}
	throw new Error(
		`[ojm] ${ojBin}（v${version}）不接受 --module-root，无法支撑 src/<name>/{api,web} 布局。\n`
		+ "原因：版本号是声明，能跑通才是事实——`oj build --help` 里没有该旗标。\n"
		+ `处置：\`ojm vendor --force v${MIN_OJ_VERSION}\` 重装。`,
	);
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

	const report: InitReport = { created: [], skipped: [], warnings: [] };
	const cliRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

	// 0) 已有 bin/oj 先过能力闸门（评审 BLOCKING #8）：早前「bin/oj 存在即跳过」
	//    会让从旧工程带来的 0.1.84 静默过关，等 `ojm build` 才死在 --module-root 不认。
	assertExistingOjUsable(destDir, report);

	// 1) 模板（占位符替换 + 幂等跳过）
	const templatesDir = path.join(cliRoot, "templates");
	const jwtSecret = crypto.randomBytes(32).toString("hex");
	const projectName = path.basename(destDir);
	const include = readInitInclude(templatesDir);
	copyTemplates(templatesDir, destDir, {
		__JWT_SECRET__: jwtSecret,
		__PROJECT_NAME__: projectName,
	}, report, include, templatesDir);
	pruneUnincludedApiPaths(destDir, include, report);

	// 2) 证书三件套（现场签发，D6）——落点即 resolveCertDir()（config.yaml 同级的 config/；
	//    新布局 config.yaml 在工程根，故为 <工程根>/config/）
	const certDir = resolveCertDir(destDir);
	if (fs.existsSync(path.join(certDir, "cert.jws"))) {
		report.skipped.push("config/cert.jws");
	}
	else {
		await mintDevCert(certDir);
		report.created.push("config/{private.pem,public.pem,cert.jws}");
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
		// v0.1.82 起 devkit 新增两份专题指南（api-manual/SKILL 均引用它们）：
		// SQL 构造器能力矩阵/方言差异、oj test L1 测试指南。它们是**增量文档**、
		// 不影响 ojm 运行，故「有则拷、无则记跳过」——bin/devkit 来自用户本地
		// oj 版本（MIN_OJ_VERSION 只钉到 0.1.73），旧版 devkit 没有这两个文件，
		// 为两份文档把整个 init 打挂不值当（用户升 oj 后重跑 init 即补上）。
		for (const name of ["sql-builder-guide.md", "oj-test-guide.md"])
			copyIfPresent(path.join(devkit, name), path.join(skillDir, name), report);
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

	// 5c) .gitignore：模板自带一份（模板兼作可运行 demo 用），但 npm/pnpm pack
	//     会剥离 `.gitignore` 点文件（npm-packlist always-exclude，`files` 字段
	//     绕不过），收录进 init.include.yaml 只会让安装包缺文件、readInitInclude
	//     fail-fast 把整个 init 打挂（0.2.5 发布实测：目标目录只剩空壳）——
	//     与 pnpm-workspace.yaml 同型，改由 init 现场生成
	ensureGitignore(destDir, report);

	console.log(`[ojm] init 完成：${destDir}`);
	console.log(`[ojm]   新增 ${report.created.length} 项，跳过（已存在）${report.skipped.length} 项`);
	for (const item of report.skipped)
		console.log(`[ojm]   · 跳过 ${item}`);
	for (const item of report.warnings)
		console.warn(`[ojm]   ! ${item}`);
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
	report.created.push("config/{secrets-private.pem,secrets-public.pem} + auth.jwt_secret 已密封（ENC[...]）");
}

/**
 * 递归拷贝模板；文本文件做占位符替换；已存在的目标文件一律跳过。
 *
 * 白名单语义（init.include.yaml）：清单内路径整棵拷贝；清单外一律不拷、不计入
 * created/skipped（demo 模块/模板自运行产物/元数据的大头在清单外）。清单外的
 * 目录仅在「有收录子孙」时才穿行（如 `api/`、`web/src/`、`web/src/demo/`——
 * 只收录了后者底下的 entry/locales/pages），穿行时未收录的子项继续被挡下。
 */
function copyTemplates(
	srcDir: string,
	destDir: string,
	placeholders: Record<string, string>,
	report: InitReport,
	include: Set<string>,
	rootDir: string,
	underIncluded = false,
): void {
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		const src = path.join(srcDir, entry.name);
		const dest = path.join(destDir, entry.name);
		const srcRel = path.relative(rootDir, src);
		const listed = include.has(srcRel);
		if (!underIncluded && !listed && !hasIncludedDescendant(include, srcRel))
			continue;
		if (entry.isDirectory()) {
			// 空目录不进工程：git 不跟踪空目录，模板里残留的空目录（如误建的
			// api/src/_shared）会被 oj build 当作缺 manifest.yaml 的模块 fail-fast
			if (!dirHasFiles(src))
				continue;
			fs.mkdirSync(dest, { recursive: true });
			copyTemplates(src, dest, placeholders, report, include, rootDir, underIncluded || listed);
			continue;
		}
		const destRel = path.relative(destDir, dest);
		if (fs.existsSync(dest)) {
			report.skipped.push(destRel);
			continue;
		}
		let content = fs.readFileSync(src, "utf-8");
		for (const [token, value] of Object.entries(placeholders))
			content = content.replaceAll(token, value);
		content = stripRegion(content, "demo-only");
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, content);
		report.created.push(destRel);
	}
}

/** srcRel 是否为白名单里某条收录路径的祖先目录——决定清单外目录要不要穿行 */
function hasIncludedDescendant(include: Set<string>, srcRel: string): boolean {
	const prefix = `${srcRel}/`;
	for (const p of include) {
		if (p.startsWith(prefix))
			return true;
	}
	return false;
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
 * 读取模板根 `init.include.yaml` 的 `include` 白名单，归一为相对模板根的路径集合。
 * 清单随模板一起发布，缺失即安装包损坏——直接 fail-fast，不留「静默少拷」的
 * 退化路径。条目指向不存在的路径同样 fail-fast：拼错一个目录名不会当场报错，
 * 只会在用户工程里留下难以追溯的缺文件（旧 exclude 清单没有这类校验面）。
 */
function readInitInclude(templatesDir: string): Set<string> {
	const yamlPath = path.join(templatesDir, "init.include.yaml");
	if (!fs.existsSync(yamlPath))
		throw new Error(`模板缺少 init.include.yaml：${yamlPath}（安装包损坏？）`);
	const doc = yaml.parse(fs.readFileSync(yamlPath, "utf-8")) as { include?: string[] } | null;
	const out = new Set<string>();
	for (const raw of doc?.include ?? []) {
		const p = path.normalize(raw).replace(/^(\.\/)+/, "");
		out.add(p);
		if (!fs.existsSync(path.join(templatesDir, p)))
			throw new Error(`init.include.yaml 收录了不存在的路径：${p}（拼写错误或模板缺文件？）`);
	}
	return out;
}

/**
 * 从脚手架产出的 openapi.json 里删掉未进白名单的 api 模块端点。
 *
 * 模板的 openapi.json 是「全量演示工程」的产物，含 demo-only 模块（demo/home）
 * 的端点；这些模块的文件不拷进新工程，契约里留着它们会让 `ojm api --check`
 * 一上手就报「openapi 多」（有契约无 handler）。故只保留白名单内 api 模块
 * 名下的 `/api/<mod>/` 路径，其余裁掉——契约与脚手架实际模块严格一致。
 */
function pruneUnincludedApiPaths(destDir: string, include: Set<string>, report: InitReport): void {
	// 只裁本次新建的 openapi.json：init 是幂等补缺，不改动既有工程文件
	if (!report.created.includes("openapi.json"))
		return;
	// 白名单里 `src/<name>/api` 这条（整模块收录）决定「脚手架有哪些后端模块」
	const mods = new Set([...include]
		.map(p => /^src\/([^/]+)\/api$/.exec(p)?.[1])
		.filter((m): m is string => !!m));
	if (mods.size === 0)
		return;
	const openapiPath = path.join(destDir, "openapi.json");
	const doc = JSON.parse(fs.readFileSync(openapiPath, "utf-8")) as { paths?: Record<string, unknown> };
	const paths = doc.paths ?? {};
	const dropped = Object.keys(paths).filter((p) => {
		const mod = /^\/api\/([^/]+)\//.exec(p)?.[1];
		return !!mod && !mods.has(mod);
	});
	if (dropped.length === 0)
		return;
	for (const p of dropped)
		delete paths[p];
	fs.writeFileSync(openapiPath, `${JSON.stringify(doc, null, "\t")}\n`);
	report.created.push(`openapi.json 裁掉未收录 api 模块端点 ${dropped.length} 条`);
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
 * 同 copyIfAbsent，但**源缺失**时记一条跳过而非抛错。
 *
 * 用于从 bin/devkit 拷第三方版本化内容（两份专题指南）：devkit 随用户本地 oj
 * 版本而变，旧版没有新文件属正常版本 skew，不是安装包损坏——缺了只少份文档，
 * 不该让 init 失败。源在而目标已存在仍走 copyIfAbsent 的幂等跳过。
 */
function copyIfPresent(src: string, dest: string, report: InitReport): void {
	if (!fs.existsSync(src)) {
		report.skipped.push(`${path.basename(src)}（bin/devkit 无此文件，跳过）`);
		return;
	}
	copyIfAbsent(src, dest, report);
}

/**
 * 新工程 .gitignore：不存在则生成；已存在则幂等跳过（用户规则永不覆盖）。
 *
 * 内容与 templates/.gitignore 对齐（模板兼作可运行 demo，ignore 的是同一套
 * 现场产物）：dev 下载的 bin/oj、sqlite/日志/现场签发的私钥与证书、构建产物。
 * 它不能随模板拷贝——npm/pnpm pack 剥离 `.gitignore`，详见 initProject 5c。
 */
const SCAFFOLD_GITIGNORE = `# 由 ojm init 生成。
node_modules/
bin/
.ojm-tmp-*
# ojm preview 的派生 config（临时产物，进程退出即删；见 preview-config.ts）
.ojm-preview.yaml
# 本地 sqlite 与运行日志（config.yaml 在工程根，路径都相对工程根）
db.sqlite
db.sqlite-shm
db.sqlite-wal
logs/
# 现场签发的开发证书与凭据私钥（ojm dev 缺证时自动签发，见 oj-cert.ts）；私钥绝不入仓
config/*.pem
config/cert.jws
# 构建产物
api/dist/
web/dist/
modules/dist/
`;

function ensureGitignore(destDir: string, report: InitReport): void {
	const gitignorePath = path.join(destDir, ".gitignore");
	if (fs.existsSync(gitignorePath)) {
		report.skipped.push(".gitignore");
		return;
	}
	fs.writeFileSync(gitignorePath, SCAFFOLD_GITIGNORE);
	report.created.push(".gitignore");
}

/**
 * 确保工程根 pnpm-workspace.yaml 的 allowBuilds 含 `esbuild: true`。
 *  - 文件不存在（本函数即唯一来源，见下）→ 按 SCAFFOLD_WORKSPACE_YAML 生成
 *  - pnpm v11 自动生成的占位行（"set this to true or false"）→ 填 true
 *  - 有 allowBuilds 段无 esbuild 行 → 段内追加
 *  - 无 allowBuilds 段 → 文末追加整段
 *  - 显式 `esbuild: false` → 用户的选择，尊重不动
 *
 * 本文件由 init 生成而非模板拷贝：模板目录本身是根 workspace 的成员，若带一份
 * pnpm-workspace.yaml，pnpm 会就近把它当 workspace 根，`cd templates && pnpm i`
 * 就找不到父级 catalog（ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC）。
 */
const SCAFFOLD_WORKSPACE_YAML = `# 由 ojm init 生成。
# pnpm v11 起构建审批只读 pnpm-workspace.yaml（package.json 的 pnpm 字段
# 已废弃）。缺了 allowBuilds，esbuild 的 postinstall 会被默认拦截，之后所有
# pnpm 命令报 ERR_PNPM_IGNORED_BUILDS。
allowBuilds:
  esbuild: true

# @oj-module/cli 经 catalog: 拉 @redocly/cli，而 catalog 只作用于 workspace
# 自有 package.json 的依赖，对 cli（外部包）的 catalog: 传递依赖无效；不钉的话
# 会漂到 latest，撞本机 minimumReleaseAge 供应链策略被拒
# （ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION）。钉到 cli 实测通过的 2.51.0。
overrides:
  '@redocly/cli': 2.51.0
`;

function ensureAllowBuilds(destDir: string, report: InitReport): void {
	const yamlPath = path.join(destDir, "pnpm-workspace.yaml");
	if (!fs.existsSync(yamlPath)) {
		fs.writeFileSync(yamlPath, SCAFFOLD_WORKSPACE_YAML);
		report.created.push("pnpm-workspace.yaml（构建审批 + redocly 钉版）");
		return;
	}
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
