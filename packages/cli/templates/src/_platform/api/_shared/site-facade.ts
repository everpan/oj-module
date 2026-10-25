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
