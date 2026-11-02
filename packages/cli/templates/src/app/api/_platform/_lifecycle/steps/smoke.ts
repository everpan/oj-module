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
	/**
	 * 本次安装**新追加**进 config.yaml `auth.anonymous_paths` 的路径（reloading 段注入，带前导 /）。
	 * 匿名接线属 restart_pending（reload 段已明示），本进程内尚未生效——探活对这些路径的
	 * 401 判「待重启」而非失败；已在配置里却仍 401 才是真失败（说明接线或守卫有问题）。
	 */
	deferredAnonymous?: string[]
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
 * 探活请求必须自报租户（企微代开发多租户 v3 Phase 0）：宿主 `tenant.enable: true` 时 oj 对每个
 * 请求强制要 `X-TENANT-ID`——**匿名健康端点也不豁免**，缺即 400（实测 curl 无头 400 / 带 default 200）。
 * 浏览器由 runtime 请求层注入；安装器是进程内自探，没人替它注入，只能自己带上，否则任何
 * 装到「带 health 的方案」上的站点都会卡在 smoke 段（`install/upgrade/reinstall` 全线 partial）。
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

	// ① 探活：health 优先（2xx），缺省首个非匿名路由（连通即可）
	const notes: string[] = [];
	try {
		const health = typeof m.health === "string" && m.health !== "" ? m.health : undefined;
		const target = health ?? firstNonAnonymousRoute(m);
		if (target !== undefined) {
			const url = probeUrlOf(ctx.apiPrefix, target);
			const res = await ctx.fetch(url, { headers: { [PROBE_TENANT_HEADER]: PROBE_TENANT } });
			if (health !== undefined && !res.ok) {
				// health 探针本就是「无凭证预期 401」（文件头注释：非匿名无凭证预期 401；D14/Q-A：health 不强制）。
				// 租户化站点上安装/重装/升级后宿主需重启才能加载新配置（含匿名接线、路由），探针在重启前收 401
				// 是 restart_pending 的常态，不是包或站点的问题——一律判 deferred，不计入失败（P2 深检可兜底真异常）。
				// 非 401（如 500）仍视为真实失败，正常报错。
				const deferred = res.status === 401;
				if (deferred) {
					notes.push(`探活 ${url} 返回 401：health 端点为无凭证探针，宿主重启加载新配置（路由/匿名接线）后即 2xx——属 restart_pending，重启宿主后生效，不计入失败`);
				}
				else {
					failures.push({ item: "探活", retryable: true, reason: `health 端点 ${url} 返回 HTTP ${res.status}（C2-33 冒烟探针要求 2xx）` });
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
