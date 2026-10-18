// 站点编排面共享真源（P2-16 真机构建钉出：oj build 禁「模块内 import api.ts」——
// market/api.ts 是路由入口，verify-checks/solutions 复用的非路由原语必须落本模块）。
// 单一真源：market/api.ts re-export 保持既有引用面；深检/方案域直接 import 本模块。

import type { FetchFace } from "../_lifecycle/steps/download";

/** 带缓存指令的拉取面（FetchFace 的超集：oj 全局 fetch/测试 stub 天然满足，少参函数可赋多参形） */
export type FetchInitFace = (url: string, init?: { headers?: Record<string, string>, redirect?: string }) => Promise<{
	ok: boolean
	status: number
	arrayBuffer: () => Promise<ArrayBuffer>
}>;

/** 站点源（SSRF 钉②：x-forwarded-proto 取首个、去空白）。非请求上下文（CLI/测试无 Host）→ null */
export function siteOrigin(): { proto: string, host: string } | null {
	const h = (http as { headers?: Record<string, string | undefined> }).headers ?? {};
	const host = h.host;
	if (!host) {
		return null;
	}
	const proto = String(h["x-forwarded-proto"] ?? "http").split(",")[0]!.trim() || "http";
	return { proto, host };
}

/** 站点源补全（深检探针复用 siteOrigin；相对 URL → 绝对同源 URL） */
export function withSiteOrigin(fetch: FetchInitFace): FetchFace {
	const o = siteOrigin();
	if (o === null) {
		return fetch as FetchFace;
	}
	return url => fetch(/^https?:\/\//i.test(url) ? url : `${o.proto}://${o.host}${url}`) as ReturnType<FetchFace>;
}

/** 站点迁移账本 head（oj journal 真源 `_oj_migrations`；表缺失/查询失败 → null = 跳过禁降版判定，不猜） */
export async function journalHeadOf(name: string): Promise<number | bigint | null> {
	try {
		const rows = await db.query("select max(version) as head from _oj_migrations where module = ?", [name]) as Array<{ head: unknown }>;
		const head = rows[0]?.head;
		return head == null ? null : Number(head);
	}
	catch {
		return null;
	}
}
