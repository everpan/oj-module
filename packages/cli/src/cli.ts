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
import { emit, failEnvelope, OK_CODE } from "./cli-output";
import { EXIT_FAILURE, EXIT_USAGE, exitCodeOf, UsageError } from "./exit-codes";
import { findCommand, groupHelpText, HELP_GROUPS, resolveLang, topHelpSections, usageText } from "./usage";

export interface CliDeps {
	exit?: (code: number) => never
	/** 本次调用的参数（`--json` 失败信封归因用）；缺省 process.argv.slice(2) */
	argv?: string[]
}

/** `ojm help [cmd [sub]]` → `<cmd> [sub] --help`：词形归一，交给 cac 的 help 机制。 */
export function rewriteHelpArgv(argv: string[]): string[] {
	if (argv[0] !== "help")
		return argv;
	if (argv.length === 1)
		return ["--help"];
	return [...argv.slice(1), "--help"];
}

/**
 * 未知命令兜底结果（index.ts 打印 + 退出用）。
 * help 形态（ojm nope --help / ojm help nope）：报「未知命令」exit 2——拼错属于**用法错误**，
 * 与业务失败（1）分开，CI 才不会把「脚本写错」当成「发版被拒」。
 * `summary` 是给机器通道的一句话（`--json` 信封的 message），`text` 是给人看的（可能是一屏帮助）。
 */
export function unknownCommandResult(cmd: string, lang: Lang, helpRequested: boolean): { text: string, code: number, summary: string } {
	const summary = lang === "zh-CN"
		? `[ojm] 未知命令：${cmd}（ojm --help 查看全部命令）`
		: `[ojm] Unknown command: ${cmd} (run ojm --help for the full command list)`;
	if (helpRequested)
		return { text: summary, code: EXIT_USAGE, summary };
	return { text: usageText(lang), code: EXIT_USAGE, summary };
}

/**
 * 未知命令的兜底输出。`--json` 下帮助文本改走 stderr、stdout 只留失败信封——
 * 机器通道的承诺是「一行 JSON 或空」，不能让一屏帮助混进去（实测踩过：CI 在 `ojm nope --json`
 * 上拿到的是整页帮助，`JSON.parse` 直接炸）。
 */
export function reportUnknownCommand(cmd: string, lang: Lang, helpRequested: boolean, argv: string[] = process.argv.slice(2)): { text: string, code: number } {
	const r = unknownCommandResult(cmd, lang, helpRequested);
	if (argv.includes("--json")) {
		console.error(r.text);
		console.log(JSON.stringify(failEnvelope(cmd, "usage_error", r.summary)));
	}
	else if (helpRequested) {
		console.error(r.text);
	}
	else {
		console.log(r.text);
	}
	return { text: r.text, code: r.code };
}

/**
 * cac 的内置报错是英文裸消息（Unknown option / missing required arg）——按语言重写成人话，带修复指引。
 * 同时**升格为 UsageError**：这些错误一律是「命令行写错了」（exit 2），不是业务失败。
 */
export function localizeCacError(error: unknown, lang: Lang): unknown {
	if (!(error instanceof Error))
		return error;
	const unknownOption = /^Unknown option `([^`]+)`/.exec(error.message);
	if (unknownOption) {
		return new UsageError(lang === "zh-CN"
			? `[ojm] 未知选项：${unknownOption[1]}（ojm <cmd> --help 查看可用选项）`
			: `[ojm] Unknown option: ${unknownOption[1]} (run ojm <cmd> --help for available options)`);
	}
	const missingArg = /^missing required arg for `([^`]+)`/.exec(error.message);
	if (missingArg) {
		return new UsageError(lang === "zh-CN"
			? `[ojm] 缺少必需参数：${missingArg[1]}（ojm <cmd> --help 查看语法）`
			: `[ojm] Missing required argument: ${missingArg[1]} (run ojm <cmd> --help for the syntax)`);
	}
	return error;
}

/**
 * 与旧 index.ts 顶层 catch 同源：message 已是人话，堆栈仅 OJM_DEBUG=1（兼容旧名 RAM_DEBUG）。
 * 退出码走 `exitCodeOf`：UsageError → 2，其余 → 1（REG-R12 三档契约）。
 *
 * `--json` 下失败也要给信封：CI 读完 stdout 就能分支，不必「先看退出码再猜哪条是人话」。
 * 三种失败各一个稳定机器码：`usage_error`（2）/ `failed`（1）；成功恒 `ok`。
 * 人话**始终**走 stderr——stdout 在有 `--json` 时恒为「一行可解析 JSON 或空」。
 */
export function reportCliError(error: unknown, exit: (code: number) => never, argv: string[] = process.argv.slice(2)): void {
	const isDebug = !!(process.env.OJM_DEBUG ?? process.env.RAM_DEBUG);
	const body = error instanceof Error ? (isDebug ? error.stack ?? error.message : error.message) : String(error);
	console.error(/^\[ojm/.test(body) ? body : `[ojm] ${body}`);
	if (argv.includes("--json")) {
		const command = argv.find(a => !a.startsWith("-")) ?? "";
		const message = error instanceof Error ? error.message : String(error);
		const code = error instanceof UsageError ? "usage_error" : "failed";
		// 走 console.log 与 `emit` 同一条输出通道：机器通道只有一处实现，测试也能捕获
		console.log(JSON.stringify(failEnvelope(command, code, message)));
	}
	exit(exitCodeOf(error));
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
					// 用法错误（exit 2）：缺位置参数，改命令行就能解决
					throw new UsageError("[ojm] 用法：ojm new <name> [--layout container|none] [--api]（非交互环境必须显式给 name）");
				}
				// 统一审查 F8：多余位置参数显式拒绝，不能静默丢弃（ojm new crm erp 只建 crm 是事故）
				if (extra.length > 0)
					throw new UsageError(`[ojm] ojm new 只接受一个方案名（多余参数：${extra.join(" ")}）`);
				if (opts.layout !== undefined && opts.layout !== "container" && opts.layout !== "none")
					throw new UsageError(`[ojm] --layout 只接受 container | none（实际：${opts.layout}）`);
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
					throw new UsageError(`[ojm] 非法版本号：${tag}（形如 v0.1.11 或 0.1.11）`);
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
		case "config":
			return async (sub: string | undefined, opts: { json?: boolean, showOrigin?: boolean } = {}) => {
				const { configCommand } = await import("./config-cmd");
				await configCommand(sub, { json: !!opts.json, showOrigin: !!opts.showOrigin, cwd: projectRoot });
			};
		case "publish":
			return async (dir: string | undefined, opts: { id?: string, key?: string, check?: boolean, registry?: string, dryRun?: boolean, json?: boolean } = {}) => {
				const { publishCommand } = await import("./publish");
				const { describeCredential, describeSourceLevel, resolveRegistryCredential, resolveRegistrySourceOptional } = await import("./registry-source");
				// 源：给了就必须合法（`--registry` 拼错 → exit 2）；没配则明说「只写本地、不上传」。
				// 这里不抛「未指定仓库源」：`ojm publish` 今天仍是本地索引落盘（上传随 S4 落地），
				// 逼它必须有源会把「本地自建 CDN」这条既有链路打死。
				const source = resolveRegistrySourceOptional({ flag: opts.registry, cwd: projectRoot });
				const credential = source === null ? null : resolveRegistryCredential(source, { cwd: projectRoot });
				const human: string[] = [];
				human.push(source === null
					? "[ojm] 未配置仓库源：本次只重算并签名本地索引目录（不上传）；CI 用 --registry 或工程根 .ojmrc 指定"
					: `[ojm] 仓库源 ${source.url}（来源 ${describeSourceLevel(source)}）；凭据 ${describeCredential(credential!)}`);
				const result = publishCommand(dir ?? "", {
					id: opts.id,
					key: opts.key,
					check: opts.check,
					dryRun: !!opts.dryRun,
					cwd: projectRoot,
					log: line => human.push(line),
				});
				const rel = (p: string) => path.relative(projectRoot, p);
				// `--check` 没过 = 业务失败（1）：签名与内容对不上，改数据就不了，得重签
				const checkFailed = result.checkPassed === false;
				emit({
					command: "publish",
					code: checkFailed ? "check_failed" : OK_CODE,
					message: checkFailed ? "索引自检失败：签名与内容不匹配" : undefined,
					data: {
						dryRun: result.dryRun,
						seq: result.seq,
						keyId: result.keyId,
						fingerprint: result.fingerprint,
						registry: source === null ? null : { url: source.url, level: source.level },
						credential: credential?.kind ?? null,
						catalog: rel(result.catalogPath),
						shards: result.shardPaths.map(rel),
						writes: result.writes.map(rel),
						checkPassed: result.checkPassed ?? null,
					},
					human,
				}, { json: !!opts.json });
				if (checkFailed)
					exit(EXIT_FAILURE);
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
			return async (name: string | undefined, opts: SiteOpts & { registry?: string } = {}) => {
				const { uninstallCommand } = await import("./uninstall");
				await uninstallCommand(name ?? "", { url: opts.url, user: opts.user, pass: opts.pass, registry: opts.registry });
			};
		case "view":
			return async (target: string | undefined, opts: SiteOpts & { json?: boolean } = {}) => {
				const { viewCommand } = await import("./view");
				await viewCommand(target, { url: opts.url, user: opts.user, pass: opts.pass, json: opts.json });
			};
		case "trust":
			return async (sub: string | undefined, keyId: string | undefined, pub: string | undefined, opts: SiteOpts & { task?: string } = {}) => {
				const { trustCommand } = await import("./trust");
				await trustCommand(sub ?? "", [keyId, pub].filter((v): v is string => v !== undefined), { url: opts.url, user: opts.user, pass: opts.pass, task: opts.task });
			};
		case "registry":
			return async (sub: string | undefined, file: string | undefined, opts: { id?: string, key?: string, out?: string, json?: boolean } = {}) => {
				if (!sub) {
					console.log(groupHelpText("registry", lang));
					return;
				}
				if (sub !== "sign")
					throw new UsageError(`[ojm] 未知 registry 子命令：${sub}（只有 sign：把导出的未签索引签成回传请求体）`);
				const { registrySignCommand, RegistrySignError } = await import("./registry-sign");
				const human: string[] = [];
				let result: ReturnType<typeof registrySignCommand>;
				try {
					result = registrySignCommand({ file: file ?? "", id: opts.id, key: opts.key, out: opts.out, json: !!opts.json, cwd: projectRoot });
				}
				catch (error) {
					if (!(error instanceof RegistrySignError))
						throw error;
					// 业务失败（1）带稳定码：CI 靠 code 分支（usage_error 补参数，这些码只能改数据/换钥匙）
					emit({ command: "registry sign", code: error.code, message: error.message, data: null, human: [`[ojm] ${error.message}`] }, { json: !!opts.json });
					// `return` 是必要的：测试里 exit 是 spy（不真的终止），否则会掉回下面的成功分支再抛一次
					return exit(EXIT_FAILURE);
				}
				if (result.signed === 0) {
					human.push(`[ojm] 第 ${result.gen} 代没有待签文件（已签全或全部沿用旧片）——幂等成功，未触碰私钥`);
				}
				else {
					human.push(`[ojm] 第 ${result.gen} 代：签了 ${result.signed} 个文件（catalog + ${result.signed - 1} 片）`);
					human.push(`[ojm] 签名者 ${result.keyId}（指纹 ${String(result.fingerprint).slice(0, 16)}…）`);
				}
				if (result.outPath !== null)
					human.push(`[ojm] 回传体已写入 ${path.relative(projectRoot, result.outPath) || result.outPath}（POST /api/oj-registry/index/signature 的请求体）`);
				emit({
					command: "registry sign",
					data: {
						gen: result.gen,
						keyId: result.keyId,
						fingerprint: result.fingerprint,
						signed: result.signed,
						signatures: result.signatures,
						out: result.outPath === null ? null : path.relative(projectRoot, result.outPath),
					},
					human,
				}, { json: !!opts.json });
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
	const argv = deps.argv ?? process.argv.slice(2);
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
				Promise.resolve(action(...args)).catch((error: unknown) => reportCliError(error, exit, argv));
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
