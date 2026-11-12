// 冒烟步骤（P1-9，十阶段 stage smoke；设计 §4.1 四项之三 + 一项钉口径不实现），collect-all：
// ①探活：manifest.health（C2-33）声明则探 <apiPrefix>/<health 去前导斜杠> 断言 2xx；缺省探首个
//   **非匿名**路由同形 URL——连通即可不做语义断言（非匿名无凭证预期 401；D14/Q-A：health 不强制）。
//   URL 形态与 C2-26 段内收敛一致：api 相对路径首段 = 模块段（fixture: health /demo-solution/ping
//   ↔ anonymous demo-solution/ping）。无 health 无路由：无事可验视为通过。
// ②integrity（R10：验签后包内容口径）：对**部署落位后**的 entry 文件重算 sha384 与 modules.json
//   条目 integrity（sha384-<base64>，C2-28）相等；条目缺 integrity fail-closed（P1-10 必传，缺失即
//   装配线破损）；声明 css 逐一验落位存在性（modules.json 单一 integrity 仅覆盖 entry——C2-28 构建
//   器只对 entry 产物计算）。manifest 无 web 段本项不适用。
// ③注册一致性：queryRegistered 快照（ctx.query 可注入，缺省回落 register.ts db 全局）vs 本次
//   manifest 声明——升级态「包含非相等」：快照逐数组 ⊇ 声明全集（可多不可少，少 = 注册丢失判失败；
//   相等当然过）；快照 null = 首装，声明全空过、非空败。
// ④entry 浏览器加载不在安装器验（Node import 必假绿——设计 §4.1）：宿主 error boundary 兜底 +
//   P2 深检可见，本步不实现，仅此处钉口径。
// 任一失败不首条即停：三项全跑，原因逐项中文齐报（preflight 同纪律）。

import type { InstallContext } from "./preflight";
import type { SolutionSnapshot } from "./register";
import { fsFace } from "../atomic";
import { queryRegistered } from "./register";

export interface SmokeContext extends InstallContext {
	/** API 前缀（C2-13 api.prefix，缺省 /api/<name>；探针 URL 前缀，注入不硬编码） */
	apiPrefix: string
	/** 注入式探针 fetch 面（生产 = isolate 全局 fetch 同源调用；测试 stub 不真发请求） */
	fetch: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean, status: number }>
	/** 注入式 sha384 摘要面（base64 裸摘要，不带 sha384- 前缀；同 verify.ts DIP） */
	sha384B64: (data: Uint8Array) => string
	/** 站点 modules.json 路径（integrity 比对真源 + 落位文件定位基准：<dist>/modules.json） */
	modulesJsonPath: string
	/** 注册快照查询；缺省回落 queryRegistered（isolate db 全局；测试注入 stub） */
	query?: (name: string) => Promise<SolutionSnapshot | null>
}

export interface StageResult {
	stage: "smoke"
	ok: boolean
	message: string
	retryable?: boolean
}

interface Failure {
	item: string
	reason: string
	retryable: boolean
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 探活请求头策略（2026-11-12 强绑定实测重订）：
 * - **默认不带** `X-TENANT-ID`。强绑定（`tenant.require_signed_claim: true`，模板默认）下裸租户头
 *   没有 claim 可复核，oj 直接 403 `tenant requires a signed claim`——带了这个头反而把自己挡在门外；
 *   `tenant.anonymous_paths` 的豁免只认「**确实没带**租户头」的请求（未带头 → 标 anonymous 放行）。
 *   装载阶段已把探针路径同时追加进 auth/tenant 两份匿名列表（text-edit），无头探活正是设计中的匿名面
 *   （auth 命中即前置管线短路，租户门不再介入）。
 * - 400/403 时**回退带默认租户头再探一次**：非强绑定宿主（`require_signed_claim: false`）的裸头仍可
 *   自证，旧站点照旧通过；强绑定宿主二次仍 403 则判 restart_pending（匿名接线未生效，宿主重启加载
 *   新配置后即 2xx），与 401 同口径，不计入冒烟失败。
 */
const PROBE_TENANT_HEADER = "X-TENANT-ID";
const PROBE_TENANT = "default";

/** 探针 URL 形态：<apiPrefix>/<path 去前导斜杠>（apiPrefix 尾斜杠归一；C2-26 段内收敛同构） */
export function probeUrlOf(apiPrefix: string, path: string): string {
	return `${apiPrefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** 首个非匿名路由 path：api.anonymous（相对路径）精确命中或前缀命中者跳过 */
function firstNonAnonymousRoute(m: Record<string, unknown>): string | undefined {
	const api = isObj(m.api) ? m.api : {};
	const anonymous = Array.isArray(api.anonymous) ? api.anonymous.filter((a): a is string => typeof a === "string") : [];
	const routes = Array.isArray(m.routes) ? m.routes : [];
	for (const r of routes) {
		if (!isObj(r) || typeof r.path !== "string") {
			continue;
		}
		const rel = r.path.replace(/^\/+/, "");
		if (!anonymous.some(a => rel === a || rel.startsWith(`${a}/`))) {
			return r.path;
		}
	}
	return undefined;
}

/** manifest 数组声明提取（routes[].path / roles[].name / permissions[].code） */
function declaredStrings(m: Record<string, unknown>, key: string, field: string): string[] {
	const list = Array.isArray(m[key]) ? m[key] : [];
	const out: string[] = [];
	for (const e of list) {
		if (isObj(e) && typeof e[field] === "string") {
			out.push(e[field]);
		}
	}
	return out;
}

/** settings.groups[].items[].key 声明提取（C2-22 分组嵌套） */
function declaredSettingKeys(m: Record<string, unknown>): string[] {
	const s = m.settings;
	if (!isObj(s) || !Array.isArray(s.groups)) {
		return [];
	}
	const out: string[] = [];
	for (const g of s.groups) {
		if (!isObj(g) || !Array.isArray(g.items)) {
			continue;
		}
		for (const it of g.items) {
			if (isObj(it) && typeof it.key === "string") {
				out.push(it.key);
			}
		}
	}
	return out;
}

interface ManifestEntry {
	name?: string
	entry?: string
	css?: string[]
	integrity?: string
}

export async function smoke(ctx: SmokeContext): Promise<StageResult> {
	const failures: Failure[] = [];
	const m = isObj(ctx.manifest) ? ctx.manifest : {};
	const web = isObj(m.web) ? m.web : undefined;

	// ① 探活：health 优先（2xx），缺省首个非匿名路由（连通即可）。
	// 探活只对有 api 面的方案成立：纯 web 包的 routes[] 是页面路由（如 /oj-market），
	// 塞进 api 前缀必 404——2026-11-07 oj-market 重装实锤（误探 /api/oj-market → smoke 失败 +
	// 全量补偿回滚含 modules.json → 重装死循环）。无 api 段 = 无 api 面可探，无事可验视为过。
	const notes: string[] = [];
	try {
		const api = isObj(m.api) ? m.api : undefined;
		const health = typeof m.health === "string" && m.health !== "" ? m.health : undefined;
		const target = api === undefined ? undefined : (health ?? firstNonAnonymousRoute(m));
		if (target === undefined && api === undefined)
			notes.push("纯 web 方案无 api 面，探活跳过");
		if (target !== undefined) {
			const url = probeUrlOf(ctx.apiPrefix, target);
			// 先无头探（强绑定宿主唯一合法的匿名形态）；400/403 再回退裸租户头自证（非强绑定宿主）。
			let res = await ctx.fetch(url);
			if (!res.ok && (res.status === 400 || res.status === 403)) {
				res = await ctx.fetch(url, { headers: { [PROBE_TENANT_HEADER]: PROBE_TENANT } });
			}
			if (!res.ok) {
				// 无凭证探针收 401 / 强绑定下 403（匿名接线未生效）都是 restart_pending 常态——
				// 宿主重启加载新配置（路由/匿名接线）后即 2xx，不是包或站点问题，一律判 deferred 不计入失败。
				// 其余（如 404/500）视为真实失败（P0 §3.5：首个路由 404/连通失败 = 冒烟失败，避免假成功）。
				if (res.status === 401 || res.status === 403) {
					notes.push(`探活 ${url} 返回 ${res.status}：无凭证探针，宿主重启加载新配置（路由/匿名接线）后即 2xx——属 restart_pending，重启宿主后生效，不计入失败`);
				}
				else {
					failures.push({ item: "探活", retryable: true, reason: `探针 ${url} 返回 HTTP ${res.status}（期望 2xx；404/5xx 视为冒烟失败）` });
				}
			}
		}
	}
	catch (e) {
		failures.push({ item: "探活", retryable: true, reason: `探针请求失败（连通性不成立）：${String(e)}` });
	}

	// ② integrity：落位后重算 vs modules.json 条目（web 段存在才适用）
	if (web !== undefined) {
		try {
			const f = fsFace();
			const slash = ctx.modulesJsonPath.lastIndexOf("/");
			const distRoot = slash === -1 ? "." : ctx.modulesJsonPath.slice(0, slash);
			const list = JSON.parse(new TextDecoder().decode(await f.readFile(ctx.modulesJsonPath))) as ManifestEntry[];
			const mine = Array.isArray(list) ? list.find((e: ManifestEntry) => isObj(e) && e.name === ctx.name) : undefined;
			if (mine === undefined) {
				failures.push({ item: "integrity", retryable: false, reason: `modules.json 无 ${ctx.name} 条目（部署清单缺位，deployWeb 未生效？）` });
			}
			else {
				if (typeof mine.entry !== "string" || mine.entry === "") {
					failures.push({ item: "integrity", retryable: false, reason: "modules.json 条目缺 entry（C2-27 web 段存在时必填）" });
				}
				if (typeof mine.integrity !== "string" || !mine.integrity.startsWith("sha384-")) {
					failures.push({ item: "integrity", retryable: false, reason: "modules.json 条目缺 integrity（fail-closed：R10 要求基于包内容重算传入，缺失即装配线破损）" });
				}
				else if (typeof mine.entry === "string" && mine.entry !== "") {
					const actual = `sha384-${ctx.sha384B64(await f.readFile(`${distRoot}/${mine.entry}`))}`;
					if (actual !== mine.integrity) {
						failures.push({ item: "integrity", retryable: false, reason: `entry 落位产物 sha384 与清单不符（R10 包内容口径）期望 ${mine.integrity} 实得 ${actual}` });
					}
				}
				for (const c of Array.isArray(mine.css) ? mine.css : []) {
					if (typeof c !== "string") {
						continue;
					}
					try {
						await f.readFile(`${distRoot}/${c}`);
					}
					catch {
						failures.push({ item: "integrity", retryable: false, reason: `声明 css ${c} 未落位（部署不完整）` });
					}
				}
			}
		}
		catch (e) {
			failures.push({ item: "integrity", retryable: false, reason: `modules.json 不可读（${String(e)}）——部署清单缺位` });
		}
	}

	// ③ 注册一致性：快照 ⊇ 声明（升级态「包含非相等」；null = 首装按声明空满判）
	try {
		const declared = {
			routes: declaredStrings(m, "routes", "path"),
			settings: declaredSettingKeys(m),
			roles: declaredStrings(m, "roles", "name"),
			permissions: declaredStrings(m, "permissions", "code"),
		};
		const snap = await (ctx.query ?? queryRegistered)(ctx.name);
		if (snap === null) {
			const total = declared.routes.length + declared.settings.length + declared.roles.length + declared.permissions.length;
			if (total > 0) {
				failures.push({ item: "注册一致性", retryable: false, reason: `注册快照为空（null）而本次声明 ${total} 项非空——声明未注册生效（D10 出口未落地？）` });
			}
		}
		else {
			for (const key of ["routes", "settings", "roles", "permissions"] as const) {
				const have = new Set(snap[key]);
				const missing = declared[key].filter(d => !have.has(d));
				if (missing.length > 0) {
					failures.push({ item: "注册一致性", retryable: false, reason: `快照 ${key} 缺少声明项（升级态「包含非相等」：快照可多不可少，少 = 注册丢失）：${missing.join("、")}` });
				}
			}
		}
	}
	catch (e) {
		failures.push({ item: "注册一致性", retryable: false, reason: `注册快照查询失败：${String(e)}` });
	}

	// ④ entry 浏览器加载不在安装器验（设计 §4.1）——无判定，口径钉于成功 message。

	if (failures.length === 0) {
		const passed = "冒烟通过：探活 / integrity / 注册一致性 三项全过（entry 浏览器加载不在安装器验——设计 §4.1，宿主 error boundary + P2 深检兜底）";
		return { stage: "smoke", ok: true, message: notes.length === 0 ? passed : `${passed}\n${notes.map(n => `- ${n}`).join("\n")}` };
	}
	return {
		stage: "smoke",
		ok: false,
		retryable: failures.every(x => x.retryable),
		message: `冒烟未通过（${failures.length} 项失败，全量列出）：\n${failures.map(x => `- 【${x.item}】${x.reason}`).join("\n")}`,
	};
}
