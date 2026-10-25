// `ojm list`（站点已装方案的可查面）：登录 → GET /api/_platform/market/index → 只挑已装的打表。
//
// 为什么需要它：到 0.3.2 为止，CLI **没有任何一条命令能回答「这个站点上装了什么」**——
// 装完只有一条终态文案，之后要核对版本/启用态得登站点翻市场页。运维与 CI 都需要一个
// 可脚本化的清单（升级前看谁落后、禁用后确认状态、卸载前确认名字）。
//
// 为什么复用 `GET /_platform/market/index` 而不是新增端点：这一条已经把三件事聚合好了——
// sidecar 里的 installed/enabled、索引里的 latest/available（算 upgradable）、信任库判定
// 出的 trust_state。新增一个「只列已装」的端点等于让两个真相源各自漂移，而站点侧那边
// 本来就要维护全量行（市场页在用）。
//
// 缺省只列**已装**（installed != null）：`ojm list` 的语义是「我这台机器上有什么」，
// 不是「市场里有什么」；要后者用 `--all`（未装的行 installed 显示 `-`）。
import { emit } from "./cli-output";
import { UsageError } from "./exit-codes";
import { callApi, login, resolveSite } from "./site";

/** 市场索引行里本命令消费的字段（其余字段站点可能扩，不读即不依赖） */
interface MarketIndexRow {
	name?: unknown
	installed?: unknown
	enabled?: unknown
	latest?: unknown
	upgradable?: unknown
	trust_state?: unknown
}

export type TrustState = "trusted" | "untrusted" | "absent" | null;

export interface SolutionRow {
	/** 物理名（= 磁盘目录/路由前缀/包名，站点侧 identity） */
	name: string
	/** 已装版本；null = 未装 */
	installed: string | null
	/** 启用态；null = 未装或站点未给 */
	enabled: boolean | null
	/** 索引里的最新版；null = 该方案只在本地存在（源自建包） */
	latest: string | null
	/** 已装且落后于最新版 */
	upgradable: boolean
	/** 站点信任库对已装包签名 key 的判定 */
	trustState: TrustState
}

export interface ListOptions {
	siteUrl?: string
	user?: string
	pass?: string
	/** 连未安装的索引行一起列（缺省只列已装） */
	all?: boolean
	json?: boolean
	/** 测试注入；缺省 globalThis.fetch */
	fetchFn?: typeof fetch
}

function asTrustState(raw: unknown): TrustState {
	return raw === "trusted" || raw === "untrusted" || raw === "absent" ? raw : null;
}

/** 取一份已装清单（`--all` 时含未装）。不打印、不 exit 的纯函数层，便于 CI 直接在进程内用。 */
export async function fetchInstalled(fetchFn: typeof fetch, base: string, token: string, all: boolean): Promise<SolutionRow[]> {
	const rows = await callApi<MarketIndexRow[]>(fetchFn, base, token, "GET", "/api/_platform/market/index");
	const out: SolutionRow[] = [];
	for (const raw of rows) {
		const name = String(raw.name ?? "").trim();
		if (name === "")
			continue;
		const installed = typeof raw.installed === "string" && raw.installed !== "" ? raw.installed : null;
		if (installed === null && !all)
			continue;
		out.push({
			name,
			installed,
			enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
			latest: typeof raw.latest === "string" && raw.latest !== "" ? raw.latest : null,
			upgradable: raw.upgradable === true,
			trustState: asTrustState(raw.trust_state),
		});
	}
	return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** 按单元格宽度补齐（ASCII slug + 数字，不做 CJK 宽度换算） */
function pad(text: string, width: number): string {
	return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function renderTable(rows: SolutionRow[]): string[] {
	const header = ["NAME", "INSTALLED", "ENABLED", "LATEST", "UPGRADABLE", "TRUST"];
	const cells = rows.map(r => [
		r.name,
		r.installed ?? "-",
		r.enabled === null ? "-" : r.enabled ? "yes" : "no",
		r.latest ?? "-",
		r.installed === null ? "-" : r.upgradable ? "yes" : "no",
		r.trustState ?? "-",
	]);
	const widths = header.map((h, i) => Math.max(h.length, ...cells.map(c => c[i]!.length)));
	const line = (cols: string[]): string => cols.map((c, i) => pad(c, widths[i]!)).join("  ").trimEnd();
	return [line(header), ...cells.map(line)];
}

/**
 * 列表命令体：登录 → 取市场索引 → 过滤 → 打印（`--json` 走统一信封）。
 * 返回行数组（测试/CI 断言用）。
 */
export async function listCommand(opts: ListOptions = {}): Promise<SolutionRow[]> {
	let site: { base: string, user: string, pass: string };
	try {
		site = resolveSite(opts);
	}
	catch (error) {
		// 缺凭据是用法错误（2）：补参数就能解决，不该和「站点报错」混成 1
		throw new UsageError((error as Error).message);
	}
	const fetchFn = opts.fetchFn ?? globalThis.fetch;
	const token = await login(fetchFn, site.base, site.user, site.pass);
	const solutions = await fetchInstalled(fetchFn, site.base, token, opts.all === true);

	const human: string[] = [];
	if (solutions.length === 0) {
		human.push(opts.all === true
			? `[ojm] 站点 ${site.base} 的市场索引是空的（既没有已装方案，也没有可装方案）`
			: `[ojm] 站点 ${site.base} 上还没有已装方案（要连可装的一起看：ojm list --all）`);
	}
	else {
		const installed = solutions.filter(r => r.installed !== null).length;
		human.push(opts.all === true
			? `[ojm] 站点 ${site.base}：${solutions.length} 个方案（已装 ${installed} 个）`
			: `[ojm] 站点 ${site.base}：已装 ${installed} 个方案`);
		human.push(...renderTable(solutions));
		const upgradable = solutions.filter(r => r.upgradable).map(r => r.name);
		if (upgradable.length > 0)
			human.push(`[ojm] 可升级：${upgradable.join(", ")}（ojm install <name> 装最新版）`);
		const untrusted = solutions.filter(r => r.trustState === "untrusted").map(r => r.name);
		if (untrusted.length > 0)
			human.push(`[ojm] 签名不受信：${untrusted.join(", ")}（先 ojm trust add 确认发布方公钥）`);
	}

	emit({
		command: "list",
		data: { site: site.base, all: opts.all === true, solutions },
		human,
	}, { json: !!opts.json });
	return solutions;
}
