// `ojm config ls [--show-origin] [--json]`（REG-R12）：把「这次命令到底会用哪个源、凭据从哪来」
// 一次性摆出来。
//
// 为什么值得一条命令：需求 §10.3 的附加规则是「执行日志必须打印最终生效的源 + 来源级别」——
// 踩过的坑是「以为在发公司仓，其实发了缺省源」。这里把解析结果**做成可查的事实**，而不是等出错再猜。
//
// 三条纪律：
//   · **永不回显 token**：只报来源（env / 用户配置 / 缺失），值一个字都不打（`describeCredential` 单点）；
//   · **未配置不是错误**：诊断命令的职责就是把「没配」显示出来（退出码 0）；坏配置文件才是失败（1）；
//   · `--json` 走 `emit`：stdout 只有一份信封，人话列在 `--json` 下改走 stderr。

import type { EmitStreams } from "./cli-output";

import process from "node:process";
import { emit } from "./cli-output";
import { UsageError } from "./exit-codes";
import { describeCredential, describeSourceLevel, REGISTRY_TOKEN_ENV, resolveRegistryCredential, resolveRegistrySourceOptional } from "./registry-source";
import { DEFAULT_SITE_URL } from "./site";

export interface ConfigRow {
	key: string
	value: string
	/** 该值的来源（`--show-origin` 一列；机器通道恒有，方便 CI 断言） */
	origin: string
}

export interface ConfigOptions {
	json?: boolean
	showOrigin?: boolean
	cwd?: string
	home?: string
	env?: NodeJS.ProcessEnv
	out?: (line: string) => void
	err?: (line: string) => void
}

/** 未配置的源：显式一行，而不是抛错（诊断命令要能说「这里空着」） */
const UNSET = "（未配置）";

/**
 * 解析当前生效配置。`registry.url` 未配置时整行显示 `（未配置）`，
 * 其余与源相关的行跟着退化——不拿缺省值假装配好了。
 */
export function configRows(opts: ConfigOptions = {}): ConfigRow[] {
	const env = opts.env ?? process.env;
	const rows: ConfigRow[] = [];

	// null = 一条源都没配（诊断命令要能显示这个事实）；坏配置照旧抛，不吞成「未配置」
	const source = resolveRegistrySourceOptional({ cwd: opts.cwd, home: opts.home, env });
	rows.push({
		key: "registry.url",
		value: source?.url ?? UNSET,
		origin: source === null ? "（--registry / .ojmrc / ~/.ojm/config.json 都未提供）" : describeSourceLevel(source),
	});
	rows.push({
		key: "registry.token",
		value: source === null ? "（无源可绑定）" : describeCredential(resolveRegistryCredential(source, { home: opts.home, env })),
		origin: source === null ? "—" : `${REGISTRY_TOKEN_ENV} / ~/.ojm/config.json`,
	});
	rows.push({
		key: "site.url",
		value: env.OJM_SITE_URL?.trim() ? String(env.OJM_SITE_URL).trim() : DEFAULT_SITE_URL,
		origin: env.OJM_SITE_URL?.trim() ? "OJM_SITE_URL" : "缺省",
	});
	const siteCreds = (env.OJM_USER ?? "") !== "" && (env.OJM_PASS ?? "") !== "";
	rows.push({
		key: "site.credentials",
		value: siteCreds ? "OJM_USER / OJM_PASS（已设置）" : "缺失（用 --user/--pass 或 OJM_USER/OJM_PASS）",
		// 只报「设没设」，永不回显账号密码
		origin: siteCreds ? "env" : "—",
	});
	return rows;
}

/** 人类可读的对齐列（key 22 宽，够放 `site.credentials` 这类长键） */
function renderRows(rows: ConfigRow[], showOrigin: boolean): string[] {
	const width = Math.max(...rows.map(r => r.key.length));
	return rows.map(r => `${r.key.padEnd(width)}  ${r.value}${showOrigin ? `  ← ${r.origin}` : ""}`);
}

/**
 * `ojm config ls`（`ls` 可省略）。未知子命令 → 用法错误（2），不静默当 ls 跑——
 * 「ojm config set」在拼错时被当成 ls 打印一堆东西，是最容易让人以为设置成功的一类假象。
 */
export async function configCommand(sub: string | undefined, opts: ConfigOptions = {}): Promise<void> {
	const cmd = (sub ?? "ls").trim();
	if (cmd !== "ls")
		throw new UsageError(`[ojm] config 只支持 ls（当前：${cmd}）；用法：ojm config ls [--show-origin] [--json]`);

	const rows = configRows(opts);
	const streams: EmitStreams = {
		out: opts.out ?? (line => console.log(line)),
		err: opts.err ?? (line => console.error(line)),
	};
	emit({
		command: "config ls",
		data: { rows },
		human: renderRows(rows, opts.showOrigin === true),
	}, { json: opts.json === true }, streams);
}
