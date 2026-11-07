// 站点编排面共享真源（P2-16 真机构建钉出：oj build 禁「模块内 import api.ts」——
// market/api.ts 是路由入口，verify-checks/solutions 复用的非路由原语必须落本模块）。
// 单一真源：market/api.ts re-export 保持既有引用面；深检/方案域直接 import 本模块。

import type { FetchFace } from "../_lifecycle/steps/download";
import { fsFace } from "../_lifecycle/atomic";

/** 带缓存指令的拉取面（FetchFace 的超集：oj 全局 fetch/测试 stub 天然满足，少参函数可赋多参形） */
export type FetchInitFace = (url: string, init?: { headers?: Record<string, string>, redirect?: string }) => Promise<{
	ok: boolean
	status: number
	arrayBuffer: () => Promise<ArrayBuffer>
	/**
	 * 响应头读取面（REG-CS5 读面缓存）：读 ETag 发 If-None-Match → 304 不重传正文。
	 * 可选字段：真实 fetch 的 Response.headers 天然满足；不暴露响应头的测试 stub 省略即按
	 * 「无 ETag 语义」退化为每次全量拉取——语义正确，只是少了条件请求的省字节。
	 */
	headers?: { get: (name: string) => string | null }
}>;

/**
 * 站点 canonical origin（REG-CS6 Host 头 SSRF 修复）：**绝不**读请求头 host / x-forwarded-proto——
 * 伪造 Host（如 169.254.169.254 云元数据）若被用来补全相对 URL，出站请求会被牵引到攻击者指定的
 * 源。一律走站点配置 `vars.canonical_origin`（模板 config.yaml 随发，部署侧填真实对外地址）。
 *
 * - 给定合法 origin（http(s)://host，无路径）→ 返回 {proto, host}；
 * - 缺失 / 非法 / 空 → 返回 null（不补全、不回落请求头；相对 URL 原样透传，由下层 fetch 判不可用）。
 *   这是 fail-closed：没有可信源就不替请求「猜」一个，避免把 Host 头当可信输入。
 */
export function siteOrigin(canonicalOrigin?: string | null): { proto: string, host: string } | null {
	if (!canonicalOrigin || !canonicalOrigin.trim()) {
		return null;
	}
	const m = /^(https?):\/\/([^/?#]+)$/i.exec(canonicalOrigin.trim());
	if (m === null) {
		return null;
	}
	return { proto: m[1]!.toLowerCase(), host: m[2]! };
}

/**
 * 读站点 canonical origin（config.yaml `vars.canonical_origin`；缺文件/缺字段/解析失败 → null）。
 * 隔离运行时无 node:fs/yaml：统一走 fsFace() + globalThis.yaml（与 _platform 其余读盘一致）。
 * 异步：config 读取在隔离环境只有异步面，故 caller（marketEnv/solutionsEnv 是同步的）改为惰性、请求内解析。
 * 进程级缓存：canonical_origin 是部署期安全设置，不会随请求热更，按 configPath 缓存避免每次请求重复读盘。
 */
const canonicalOriginCache = new Map<string, Promise<string | null>>();

export function readCanonicalOrigin(configPath?: string): Promise<string | null> {
	if (!configPath) {
		return Promise.resolve(null);
	}
	const cached = canonicalOriginCache.get(configPath);
	if (cached !== undefined) {
		return cached;
	}
	const p = (async () => {
		try {
			const bytes = await fsFace().readFile(configPath);
			// yaml.parse 是异步面（oj 隔离全局，全仓消费方同一口径）——必须 await：
			// 漏 await 时 doc 是 Promise，vars 恒 undefined，config 里的 canonical_origin 永远读不到。
			const doc = await (globalThis as { yaml?: { parse: (t: string) => Promise<unknown> } }).yaml?.parse(new TextDecoder().decode(bytes)) as { vars?: { canonical_origin?: unknown } } | undefined;
			const v = doc?.vars?.canonical_origin;
			return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
		}
		catch {
			return null;
		}
	})();
	canonicalOriginCache.set(configPath, p);
	return p;
}

/** 站点源补全（深检探针复用 siteOrigin；相对 URL → 绝对同源 URL；无可信源则不补全） */
export function withSiteOrigin(fetch: FetchInitFace, canonicalOrigin?: string | null): FetchFace {
	const o = siteOrigin(canonicalOrigin);
	if (o === null) {
		return fetch as FetchFace;
	}
	// init（如 REG-CS5 条件请求的 if-none-match）必须透传——否则按源补全会静默丢掉调用方的请求头。
	// init 形参可选，故仍可赋给单参的 FetchFace。
	return (url: string, init?: { headers?: Record<string, string>, redirect?: string }) => fetch(/^https?:\/\//i.test(url) ? url : `${o.proto}://${o.host}${url}`, init) as ReturnType<FetchFace>;
}

/**
 * 读站点 `vars.<key>`（部署期常量；缺文件/缺字段/解析失败 → null）。
 * 优先 framework 注入的 `vars` 全局（oj 已按**真实加载的配置文件**填充 vars: 段，文件名无关——
 * `oj serve -c config-release.yaml` 之类任意命名也能读到）；回落旧 readSiteVar（依赖硬编码
 * configPath，文件名非 config.yaml 时读不到，仅作兼容兜底）。
 * 背景：marketEnv/solutionsEnv 曾把 configPath 钉死成 "config.yaml"，站点用 -c 换名后
 * readSiteVar 全读不到 → registry_id / canonical_origin 恒 null（发布 503、目录缺 registry_id、
 * 安装缺 canonical origin）。vars 全局是 config 文件名无关的唯一正确通道。
 */
export function readDeploymentVar(configPath: string | undefined, key: string): Promise<string | null> {
	const fromVars = (globalThis as { vars?: { get?: (k: string) => string | null } }).vars?.get?.(key) ?? null;
	if (fromVars !== null)
		return Promise.resolve(fromVars);
	return readSiteVar(configPath, key);
}

/**
 * 读站点 config.yaml `vars.<key>`（缺文件/缺字段/解析失败 → null）。
 * 与 readCanonicalOrigin 同机制（fsFace + yaml 异步面 + 按 configPath 进程级缓存）：
 * vars 下部署期常量皆走此口，勿各写一份读盘。
 */
const siteVarCache = new Map<string, Promise<string | null>>();

export function readSiteVar(configPath: string | undefined, key: string): Promise<string | null> {
	if (!configPath) {
		return Promise.resolve(null);
	}
	const cacheKey = `${configPath}::${key}`;
	const cached = siteVarCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}
	const p = (async () => {
		try {
			const bytes = await fsFace().readFile(configPath);
			const doc = await (globalThis as { yaml?: { parse: (t: string) => Promise<unknown> } }).yaml?.parse(new TextDecoder().decode(bytes)) as { vars?: Record<string, unknown> } | undefined;
			const v = doc?.vars?.[key];
			return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
		}
		catch {
			return null;
		}
	})();
	siteVarCache.set(cacheKey, p);
	return p;
}

/**
 * 解析站点真实加载的 config 路径（跨平台、配置名无关；供 migrating 段 `oj migrate -c` 复用运行服务
 * 同一份 config，规避自动发现回退 config.yaml（sqlite/密文）造成与运行服务库不一致——4bc4620b 修
 * 读面、此处补写面）。
 *
 * 取值优先级：
 * ① 操作员显式覆盖：config `vars.config_path`（最简、零网络，部署侧主动声明）。
 * ② 回落：运行服务 `_system/health` 返回的 `config_path`（与 `_system/config` 同源；api-manual §10
 *   明确 `ojInfo()` JS 不出此字段、framework 亦未向模块注入，仅 HTTP 端点出）。
 *   经已配置的 canonical_origin 自拉（SSRF 安全：用部署侧可信 origin，绝不读请求 Host 头，REG-CS6），
 *   取回后归一 `./` 前缀。
 * ③ 俱缺（canonical_origin 未配 / 拉取失败 / 字段缺失）→ undefined，调用方回落默认 "config.yaml"。
 */
export async function resolveDeploymentConfigPath(apiPrefix: string): Promise<string | undefined> {
	// ① 操作员显式覆盖（零网络）
	const override = (globalThis as { vars?: { get?: (k: string) => string | null } }).vars?.get?.("config_path") ?? null;
	if (override && override.trim() !== "") {
		return override.trim();
	}
	// ② 自拉 _system/health（可信 origin，非请求 Host）
	const origin = await readCanonicalOrigin(undefined);
	if (!origin) {
		return undefined;
	}
	try {
		const res = await fetch(`${origin}${apiPrefix}/_system/health`);
		if (!res.ok) {
			return undefined;
		}
		const doc = await res.json() as { config_path?: unknown };
		const p = typeof doc.config_path === "string" ? doc.config_path : undefined;
		if (!p || p.trim() === "") {
			return undefined;
		}
		const trimmed = p.trim();
		return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
	}
	catch {
		return undefined;
	}
}

/** 站点迁移账本 head（oj journal 真源 `_oj_migrations`；表缺失/查询失败 → null = 跳过禁降版判定，不猜） */
export async function journalHeadOf(name: string): Promise<number | bigint | null> {
	try {
		const rows = await db.table("_oj_migrations").select([{ fn: "max", field: "version", as: "head" }]).where({ field: "module", op: "eq", value: name }).all() as Array<{ head: unknown }>;
		const head = rows[0]?.head;
		return head == null ? null : Number(head);
	}
	catch {
		return null;
	}
}
