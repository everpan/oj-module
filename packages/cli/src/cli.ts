import type { CAC } from "cac";
import type { HelpEntry, Lang } from "./usage";
/**
 * `ojm` 的 cac 接线：命令注册 + action 薄分发（解析 → 既有 handler）。
 * 帮助文本（双语注册表）在 usage.ts；handler 真逻辑在各业务模块，本模块不掺业务。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import cac from "cac";
import { findCommand, groupHelpText, HELP_GROUPS, resolveLang, topHelpSections } from "./usage";

export interface CliDeps { exit?: (code: number) => never }

/** `ojm help [cmd [sub]]` → `<cmd> [sub] --help`：词形归一，交给 cac 的 help 机制。 */
export function rewriteHelpArgv(argv: string[]): string[] {
	if (argv[0] !== "help")
		return argv;
	if (argv.length === 1)
		return ["--help"];
	return [...argv.slice(1), "--help"];
}

/** 与旧 index.ts 顶层 catch 同源：message 已是人话，堆栈仅 OJM_DEBUG=1（兼容旧名 RAM_DEBUG）。 */
export function reportCliError(error: unknown, exit: (code: number) => never): void {
	const isDebug = !!(process.env.OJM_DEBUG ?? process.env.RAM_DEBUG);
	const body = error instanceof Error ? (isDebug ? error.stack ?? error.message : error.message) : String(error);
	console.error(/^\[ojm/.test(body) ? body : `[ojm] ${body}`);
	exit(1);
}

interface SiteOpts { url?: string, user?: string, pass?: string }

function makeAction(def: HelpEntry, projectRoot: string, lang: Lang, exit: (code: number) => never): (...args: any[]) => Promise<void> {
	switch (def.key) {
		case "init":
			return async (dir?: string, opts: { yes?: boolean } = {}) => {
				const { initProject } = await import("./init");
				await initProject(dir ? path.resolve(dir) : projectRoot, { yes: !!opts.yes });
			};
		case "dev":
			return async (port?: string) => {
				const { devServer } = await import("./dev");
				const portArg = Number(port);
				await devServer(projectRoot, { port: Number.isFinite(portArg) && portArg > 0 ? portArg : 5174 });
			};
		case "build":
			return async (opts: { bundle?: unknown, out?: string } = {}) => {
				// mri 可选值：裸 --bundle 得到 ""，--bundle name / --bundle=name 得到字符串
				const bundle = opts.bundle !== undefined;
				const bundleName = typeof opts.bundle === "string" && opts.bundle !== "" ? opts.bundle : undefined;
				if (bundle) {
					const { buildBundle } = await import("./bundle");
					const results = await buildBundle(projectRoot, { out: opts.out, name: bundleName });
					if (results.length > 1)
						console.log(`[ojm] 共打包 ${results.length} 份方案包（逐包签名：ojm sign dist/<name>-<version>.tgz --id <publisher>.<key> --check）`);
					return;
				}
				const { buildBackend, buildModules } = await import("./build");
				await buildBackend(projectRoot);
				await buildModules(projectRoot, { mergeSite: true });
			};
		case "new":
			return async (name: string | undefined, extra: string[] = [], opts: { layout?: string, api?: boolean } = {}) => {
				if (!name) {
					console.error("[ojm] 用法：ojm new <name> [--layout container|none] [--api]（非交互环境必须显式给 name）");
					exit(1);
					return;
				}
				// 统一审查 F8：多余位置参数显式拒绝，不能静默丢弃（ojm new crm erp 只建 crm 是事故）
				if (extra.length > 0)
					throw new Error(`[ojm] ojm new 只接受一个方案名（多余参数：${extra.join(" ")}）`);
				if (opts.layout !== undefined && opts.layout !== "container" && opts.layout !== "none")
					throw new Error(`[ojm] --layout 只接受 container | none（实际：${opts.layout}）`);
				const { createSolution } = await import("./new");
				const created = createSolution(projectRoot, name, { layout: opts.layout as "container" | "none" | undefined, api: !!opts.api });
				console.log(`[ojm] 已生成方案骨架：${path.relative(process.cwd(), created.dir)}`);
				for (const f of created.files)
					console.log(`[ojm]   + ${f}`);
				console.log(`[ojm] 下一步：pnpm dev 看效果 → ojm build && ojm build --bundle ${name} 打包`);
			};
		case "preview":
			return async (port?: string) => {
				const { runPreview } = await import("./preview");
				const portArg = Number(port);
				await runPreview(projectRoot, { port: Number.isInteger(portArg) && portArg > 0 ? portArg : undefined });
			};
		case "api":
			return async (dir?: string, opts: { check?: boolean, docs?: boolean, exempt?: string } = {}) => {
				// S5：显式目录必须先存在——否则静默在错的目录下生成/对账
				if (dir && !fs.existsSync(path.resolve(dir)))
					throw new Error(`[ojm-api] 项目目录不存在：${dir}`);
				const apiRoot = dir ? path.resolve(dir) : projectRoot;
				if (opts.docs) {
					const { runApiDocs } = await import("./contract/run");
					const out = await runApiDocs(apiRoot);
					console.log(`[ojm-api] 文档站已生成：${path.relative(projectRoot, out)}（浏览器直接打开即可）`);
					return;
				}
				if (opts.check) {
					const { checkApi } = await import("./contract/check");
					// --exempt <path>：相对路径按项目根解析；缺省按布局找 .ojm-api-exempt.json（工程根 → api/）
					const { violations, hints } = await checkApi({ cwd: apiRoot, exempt: opts.exempt ? path.resolve(projectRoot, opts.exempt) : undefined });
					for (const v of violations)
						console[v.level === "error" ? "error" : "warn"](`${v.level === "error" ? "✗" : "⚠"} ${v.message}`);
					for (const h of hints)
						console.log(h);
					if (violations.length === 0)
						console.log("[ojm-api] --check 通过：生成物同步、route 双向对账、routes.js 均无 drift。");
					const errors = violations.filter(v => v.level === "error").length;
					console.log(`[ojm-api] --check 结果：${errors} error / ${violations.length - errors} warn`);
					if (errors > 0)
						exit(1);
					return;
				}
				const { runApi } = await import("./contract/run");
				const result = await runApi({ cwd: apiRoot });
				console.log(`[ojm-api] 契约 ${result.contracts} 份；写入 ${result.written.length} 个文件，跳过（未变）${result.skipped.length} 个；stub 新建 ${result.stubs.created} / 更新 ${result.stubs.updated} / 跳过 ${result.stubs.skipped}`);
				for (const p of result.written)
					console.log(`  + ${path.relative(apiRoot, p)}`);
			};
		case "info":
			return async (opts: { all?: boolean } = {}) => {
				const { printInfo } = await import("./info");
				await printInfo(projectRoot, undefined, { all: !!opts.all });
			};
		case "vendor":
			return async (tag?: string, opts: { force?: boolean } = {}) => {
				if (tag !== undefined && !/^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(tag))
					throw new Error(`[ojm] 非法版本号：${tag}（形如 v0.1.11 或 0.1.11）`);
				const { vendorCommand } = await import("./vendor");
				await vendorCommand(projectRoot, { force: !!opts.force, tag: tag === undefined ? undefined : (tag.startsWith("v") ? tag : `v${tag}`) });
			};
		case "merge":
			return async (out?: string, inputs: string[] = []) => {
				const { mergeManifests } = await import("./info");
				await mergeManifests(out ?? "", inputs);
			};
		case "keygen":
			return async (opts: { id?: string, out?: string, yes?: boolean } = {}) => {
				const { keygenCommand } = await import("./keygen");
				keygenCommand({ id: opts.id, out: opts.out, yes: opts.yes });
			};
		case "sign":
			return async (file: string | undefined, opts: { id?: string, key?: string, check?: boolean } = {}) => {
				const { signCommand } = await import("./sign");
				signCommand(file ?? "", { id: opts.id, key: opts.key, check: opts.check });
			};
		case "publish":
			return async (dir: string | undefined, opts: { id?: string, key?: string, check?: boolean } = {}) => {
				const { publishCommand } = await import("./publish");
				publishCommand(dir ?? "", { id: opts.id, key: opts.key, check: opts.check });
			};
		case "install":
			return async (target: string | undefined, opts: SiteOpts & { locale?: string, name?: string, version?: string } = {}) => {
				const { installCommand } = await import("./install");
				await installCommand(target ?? "", { url: opts.url, user: opts.user, pass: opts.pass, locale: opts.locale, name: opts.name, version: opts.version });
			};
		case "enable":
		case "disable":
			return async (name: string | undefined, opts: SiteOpts = {}) => {
				const { setEnabledCommand } = await import("./enable");
				await setEnabledCommand(name ?? "", def.key === "enable", { url: opts.url, user: opts.user, pass: opts.pass });
			};
		case "uninstall":
			return async (name: string | undefined, opts: SiteOpts = {}) => {
				const { uninstallCommand } = await import("./uninstall");
				await uninstallCommand(name ?? "", { url: opts.url, user: opts.user, pass: opts.pass });
			};
		case "trust":
			return async (sub: string | undefined, keyId: string | undefined, pub: string | undefined, opts: SiteOpts & { task?: string } = {}) => {
				const { trustCommand } = await import("./trust");
				await trustCommand(sub ?? "", [keyId, pub].filter((v): v is string => v !== undefined), { url: opts.url, user: opts.user, pass: opts.pass, task: opts.task });
			};
		case "market":
			return async (sub: string | undefined) => {
				if (!sub) {
					// bare `ojm market`：打印该组帮助（子命令索引），同旧 marketUsage 语义
					console.log(groupHelpText("market-cdn", lang));
					return;
				}
				// market 子命令自带解析器（trial/walkthrough 等 flag 各异）：raw 转发 process.argv
				const { marketCommand } = await import("./market/command");
				await marketCommand(sub, process.argv.slice(4));
			};
		case "oj":
			return async () => {
				// 透传：参数原样转发（process.argv 未被 help 词形改写污染——真实调用才走到这里）
				const { runOjSubcommand } = await import("./oj-cmd");
				runOjSubcommand(projectRoot, def.name, process.argv.slice(3));
			};
		default:
			throw new Error(`[ojm] 未接线的命令键：${def.key}`);
	}
}

export function buildCli(projectRoot: string, lang: Lang = resolveLang(), deps: CliDeps = {}): CAC {
	const exit = deps.exit ?? ((code: number) => process.exit(code) as never);
	const cli = cac("ojm");
	for (const group of HELP_GROUPS) {
		for (const def of group.commands) {
			const cmd = cli.command(def.name, lang === "zh-CN" ? def.zh : def.en);
			for (const o of def.options ?? [])
				cmd.option(o.raw, lang === "zh-CN" ? o.zh : o.en);
			if (def.allowUnknownOptions)
				cmd.allowUnknownOptions();
			const action = makeAction(def, projectRoot, lang, exit);
			cmd.action((...args: unknown[]) => {
				Promise.resolve(action(...args)).catch((error: unknown) => reportCliError(error, exit));
			});
		}
	}

	// help 回调：顶层 = 分组 sections；单命令 = 本地化小节标题 + 详解/子命令详解注入
	const SECTION_TITLES: Record<string, { zh: string, en: string }> = {
		Usage: { zh: "用法", en: "Usage" },
		Options: { zh: "选项", en: "Options" },
		Examples: { zh: "示例", en: "Examples" },
	};
	cli.help((sections) => {
		const matched = cli.matchedCommand;
		if (!matched)
			return topHelpSections(lang);
		const def = findCommand(matched.rawName);
		const out = sections.map((s) => {
			const t = s.title && SECTION_TITLES[s.title];
			return t ? { ...s, title: lang === "zh-CN" ? t.zh : t.en } : s;
		});
		if (def?.detail)
			out.push({ title: lang === "zh-CN" ? "详细说明" : "Details", body: lang === "zh-CN" ? def.detail.zh : def.detail.en });
		const sub = cli.args[0];
		if (def?.subs && sub && def.subs[sub])
			out.push({ title: `${sub}:`, body: lang === "zh-CN" ? def.subs[sub].zh : def.subs[sub].en });
		return out;
	});
	return cli;
}
