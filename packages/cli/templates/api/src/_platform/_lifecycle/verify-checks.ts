import type { FetchInitFace } from "../_shared/site-facade";
// 深检后端四项（P2-7，C2-42）+ SSRF 防护钉（R9 纪律：全程不触 exec，迁移账本走 db.query + journalHeadOf）。
// 职责（ISP）：纯 diff 函数（diffPermRows/diffSettingRows/diffLedger/diffWebIntegrity）与 I/O 探针
// （verifyRouteReachability）分离；端点只编排取参 + 调四项 + 组装 checks（报告结构/persist/trust 项归 P2-8）。
// 设值永不进 checks（subject 只报 key/path/code；secret 同只报 key）——「看得见但不知怎么做」即不合格。
import { fsFace } from "./atomic";
import { createStateStore } from "./state";

export { sha384B64 } from "./sha384";

/** 深检项（契约 §2.13 item 结构） */
export interface VerifyItem {
	id: string
	severity: "error" | "warn" | "info"
	subject: string
	advise_key: string
}

/** 线格式路由行（与 solutions/api.ts 的 SolutionRouteRow 同构，避免循环依赖在此定义） */
export interface SolutionRouteRow {
	path: string
	module: string
	category: "main" | "admin" | "hidden"
	order: number
	title_key: string | null
	required_permission: string | null
	enabled: boolean
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * SSRF 钉①：探测 URL 永不出站——拒绝 scheme:// 与协议相对 //，要求站点相对路径（以单 / 起）；
 * 绝对化用请求源（siteOrigin）补全，确保探针永不指向本站之外的主机。
 */
export function probeUrlOf(routePath: string, origin: { proto: string, host: string }): string {
	if (/:\/\//.test(routePath) || routePath.startsWith("//"))
		throw Object.assign(new Error(`路由探测拒绝出站/协议相对 URL（SSRF 防护）：${routePath}`), { status: 400 });
	if (!routePath.startsWith("/"))
		throw Object.assign(new Error(`路由探测路径须为站点相对路径（以 / 开头，SSRF 防护）：${routePath}`), { status: 400 });
	return `${origin.proto}://${origin.host}${routePath}`;
}

/** SSRF 钉③：探针不跟随重定向（手动处理，3xx 按异常对待） */
function noRedirectFetch(fetchFn: FetchInitFace): FetchInitFace {
	return (url, init) => fetchFn(url, { ...init, redirect: "manual" } as Record<string, unknown>);
}

/**
 * 路由可达性探针（I/O）：逐路由探活；分类（契约 §2.13 + 计划 §3 P2-7）：
 * 2xx / 401（需登录仍可达）→ 不打项；
 * 404 / 5xx → error（anomaly）；
 * 403 → 声明 `required_permission` = 未以目标身份验证、未校验（warn，非通过非失败）；否则 error（被拦截）。
 * 抛错（连不通）→ error（unreachable）。origin 为 null（非 HTTP 请求上下文）→ 跳过探针，打 info 项。
 */
export async function verifyRouteReachability(
	fetchFn: FetchInitFace,
	routes: SolutionRouteRow[],
	origin: { proto: string, host: string } | null,
): Promise<VerifyItem[]> {
	const items: VerifyItem[] = [];
	if (origin === null) {
		items.push({ id: "routes", severity: "info", subject: "*", advise_key: "lifecycle.verify.routes.skipped" });
		return items;
	}
	const fetch = noRedirectFetch(fetchFn);
	for (const r of routes) {
		let status: number;
		try {
			const res = await fetch(probeUrlOf(r.path, origin), { headers: { "cache-control": "no-cache" } });
			status = res.status;
		}
		catch (e) {
			if (e instanceof Error && (e as { status?: number }).status != null)
				throw e; // SSRF 拦截（400）原样上抛，端点收口为 400
			items.push({ id: "routes", severity: "error", subject: r.path, advise_key: "lifecycle.verify.routes.unreachable" });
			continue;
		}
		if (status === 404 || status >= 500) {
			items.push({ id: "routes", severity: "error", subject: r.path, advise_key: "lifecycle.verify.routes.anomaly" });
		}
		else if (status >= 300 && status < 400) {
			// 3xx 重定向：探针不跟随（SSRF 钉③，init.redirect="manual"），裸 3xx 即异常
			items.push({ id: "routes", severity: "error", subject: r.path, advise_key: "lifecycle.verify.routes.redirect" });
		}
		else if (status === 403) {
			if (r.required_permission != null)
				items.push({ id: "routes", severity: "warn", subject: r.path, advise_key: "lifecycle.verify.routes.unauthenticated" });
			else
				items.push({ id: "routes", severity: "error", subject: r.path, advise_key: "lifecycle.verify.routes.blocked" });
		}
		// 2xx / 401 → 可达，不打项
	}
	return items;
}

/** RBAC 完整性（纯函数）：路由声明权限点 ↔ sys_permission 实有；缺失即 error */
export function diffPermRows(declared: string[], actual: Set<string>): VerifyItem[] {
	return declared
		.filter(p => !actual.has(p))
		.map(p => ({ id: "rbac", severity: "error" as const, subject: p, advise_key: "lifecycle.verify.rbac.missing_perm" }));
}

/** 设置完整性（纯函数）：方案声明设置 key ↔ sys_setting 实有；缺失即 error（永不含值） */
export function diffSettingRows(declared: string[], actual: Set<string>): VerifyItem[] {
	return declared
		.filter(k => !actual.has(k))
		.map(k => ({ id: "settings", severity: "error" as const, subject: k, advise_key: "lifecycle.verify.settings.missing_key" }));
}

/** 迁移账本（纯函数）：声明迁移模块版本 ↔ `_oj_migrations` 实有 max(version)；缺失/落后即 error */
export function diffLedger(declared: Array<{ module: string, version: number }>, applied: Map<string, number | null | undefined>): VerifyItem[] {
	const items: VerifyItem[] = [];
	for (const d of declared) {
		const got = applied.get(d.module);
		if (got == null)
			items.push({ id: "ledger", severity: "error", subject: d.module, advise_key: "lifecycle.verify.ledger.not_applied" });
		else if (got < d.version)
			items.push({ id: "ledger", severity: "error", subject: d.module, advise_key: "lifecycle.verify.ledger.stale" });
	}
	return items;
}

/** manifest 声明设置 key 提取（不报值）；groups[].items[].key 摊平 */
export function declaredSettingsOf(manifest: unknown): string[] {
	const groups = isObj(manifest) ? manifest.settings : undefined;
	if (!isObj(groups) || !Array.isArray(groups.groups))
		return [];
	const keys: string[] = [];
	for (const g of groups.groups) {
		if (!isObj(g) || !Array.isArray(g.items))
			continue;
		for (const it of g.items) {
			if (isObj(it) && typeof it.key === "string")
				keys.push(it.key);
		}
	}
	return keys;
}

/** 迁移文件名 → 声明最高版本（module 由调用方给定；缺迁移文件返回空） */
export function declaredMigrationsOf(files: string[], module: string): Array<{ module: string, version: number }> {
	const versions: number[] = [];
	for (const f of files) {
		const m = /^(\d+)__/.exec(f);
		if (m)
			versions.push(Number(m[1]));
	}
	if (versions.length === 0)
		return [];
	return [{ module, version: Math.max(...versions) }];
}

/** 读取已装方案 manifest（state 取版本 → 版本目录读盘）；不可得返回 null（端点据 404 降级） */
export async function readSolutionManifest(env: SolutionsEnv, name: string): Promise<{ version: string, manifest: unknown } | null> {
	const state = await createStateStore(env.statePath);
	const entry = state.read().solutions[name];
	if (!entry)
		return null;
	const version = entry.version;
	if (typeof version !== "string")
		return null;
	try {
		const yaml = (globalThis as { yaml?: { parse: (t: string) => Promise<unknown> } }).yaml;
		if (!yaml?.parse)
			return null;
		const bytes = await fsFace().readFile(`${env.sharedRoot}/${name}-${version}/manifest.yaml`);
		return { version, manifest: await yaml.parse(new TextDecoder().decode(bytes)) };
	}
	catch {
		return null;
	}
}

/** web 入口条目（modules.json）形态（与 deployWeb 落地形状对齐；此处仅取深检所需字段） */
export interface ModuleEntryIntegrity {
	name: string
	entry?: string
	integrity?: string
}

/**
 * 深检 web 入口 integrity（P4-2，P3-10#2 收口）：声明 entry 的 sha384（本地 dist 资产）↔
 * modules.json 条目 integrity 比对；不符 = error（被篡改/损坏），缺失 integrity 声明 = info
 * （未声明，非阻断），资产不存在 = info（web 入口缺失，非阻断）。SSRF 钉：只比对本地 dist
 * 资产，绝不经 fetch 出站（与路由可达性探针严格隔离——复用 native 资产校验，不引入外联面）。
 */
export async function diffWebIntegrity(
	entries: ModuleEntryIntegrity[],
	distRoot: string,
	sha384: (data: Uint8Array) => string,
): Promise<VerifyItem[]> {
	const items: VerifyItem[] = [];
	const me = entries.find(e => e.name != null && typeof e.entry === "string" && e.entry !== "");
	if (me === undefined) {
		items.push({ id: "web", severity: "info", subject: "*", advise_key: "lifecycle.verify.web.no_entry" });
		return items;
	}
	if (typeof me.integrity !== "string" || !me.integrity.startsWith("sha384-")) {
		items.push({ id: "web", severity: "info", subject: me.name ?? "*", advise_key: "lifecycle.verify.web.no_integrity" });
		return items;
	}
	try {
		const bytes = await fsFace().readFile(`${distRoot}/${me.entry}`);
		const actual = `sha384-${sha384(new Uint8Array(bytes))}`;
		if (actual !== me.integrity) {
			items.push({ id: "web", severity: "error", subject: me.entry, advise_key: "lifecycle.verify.web.integrity_mismatch" });
		}
	}
	catch {
		// 资产缺失（web 入口未落位或路径变更）——info 非阻断（路由可达性已另测）
		items.push({ id: "web", severity: "info", subject: me.entry, advise_key: "lifecycle.verify.web.asset_missing" });
	}
	return items;
}

/** 站点源（深检端点依赖；sharedRoot/statePath 为读面，fetch 可注入） */
export interface SolutionsEnv {
	sharedRoot: string
	statePath: string
	modulesJsonPath?: string
	apiPrefix?: string
	/** 深检报告留存目录（默认随 statePath 同目录 verify-reports；P2-8） */
	verifyReportsDir?: string
	fetch?: FetchInitFace
}
