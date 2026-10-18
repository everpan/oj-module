import type { SolutionRouteRow, SolutionsEnv, VerifyItem } from "../_lifecycle/verify-checks";
import type { VerifyReport } from "../_lifecycle/verify-report";
import type { FetchInitFace } from "../_shared/site-facade";
// 平台方案路由读端点 /api/_platform/solutions/routes（P1-14，R21 前端归并数据源）+ 深检端点
// /api/_platform/solutions/verify?name=（P2-7，C2-42；admin 域、全程不触 exec）。
// 登录即可、只读、无权限点（contacts/api.ts 同纪律）；读操作不记审计。
// routes：只下发未 deprecated 行全列（required_permission 仅供深检对比，前端不做权限级菜单过滤，R22）。
// verify：四项检查（路由可达/RBAC/设置/迁移账本）编排 + 可信性项（P2-8 trust_state）+ i18n 依赖项；
// 返回 VerifyReport{ok,checks,advise} 并落盘 verify-reports（时间序 N=10 留存）。
// 行序稳定：module → order → path。
import { fsFace } from "../_lifecycle/atomic";
import { createStateStore } from "../_lifecycle/state";
import {
	declaredMigrationsOf,
	declaredSettingsOf,
	diffLedger,
	diffPermRows,
	diffSettingRows,
	readSolutionManifest,

	verifyRouteReachability,
} from "../_lifecycle/verify-checks";
import { getLastReport, persistReport, verifyReportsDirOf } from "../_lifecycle/verify-report";
import { respond } from "../_shared/respond";
import { assertSystemAdmin } from "../_shared/service/access";
import { journalHeadOf, siteOrigin } from "../_shared/site-facade";

/** 线格式行（与 packages/runtime/src/api/rbac/types.ts 的 SolutionRouteRow 对齐） */
export type { SolutionRouteRow } from "../_lifecycle/verify-checks";

/** oj serve release 布局生产缺省 */
export function solutionsEnv(): SolutionsEnv {
	return {
		sharedRoot: "dist",
		statePath: "modules/.solutions/state.yaml",
		modulesJsonPath: "dist/modules.json",
		apiPrefix: "/api",
	};
}

function fetchOf(env: SolutionsEnv): FetchInitFace {
	return env.fetch ?? (globalThis as { fetch?: FetchInitFace }).fetch as FetchInitFace;
}

/** 路由行映射（sys_solution_route → SolutionRouteRow） */
function rowOf(r: Record<string, unknown>): SolutionRouteRow {
	return {
		path: String(r.path),
		module: String(r.module),
		category: r.category === "admin" || r.category === "hidden" ? r.category : "main",
		order: Number(r.order),
		title_key: r.title_key == null ? null : String(r.title_key),
		required_permission: r.required_permission == null ? null : String(r.required_permission),
		enabled: Number(r.enabled) === 1,
	};
}

/** 取并校验深检 name 参数（空 → 400；端点门之一） */
function verifyNameOf(): string {
	const name = String((globalThis as { http?: { query?: Record<string, unknown> } }).http?.query?.name ?? "").trim();
	if (name === "")
		throw Object.assign(new Error("name is required"), { status: 400 });
	return name;
}

/**
 * 可信性项（P2-8）：发布方 key 状态（G5 吊销后已装方案继续运行却无人知晓的补位）。
 * trusted → 干净不打项；untrusted → error（key 已吊销仍在跑）；absent/未写（P1 遗留）→ info（无法校验来源，非阻断）。
 */
async function trustItemOf(env: SolutionsEnv, name: string): Promise<VerifyItem | null> {
	const state = await createStateStore(env.statePath);
	const ts = state.read().solutions[name]?.trust_state;
	if (ts === "trusted")
		return null;
	if (ts === "untrusted")
		return { id: "trust", severity: "error", subject: name, advise_key: "lifecycle.verify.trust.untrusted" };
	return { id: "trust", severity: "info", subject: name, advise_key: "lifecycle.verify.trust.absent" };
}

/** 深检主体：四项检查编排 + 可信性项 + i18n 依赖项，组装 VerifyReport{ok,checks,advise}（persist 归端点） */
async function verifyBody(env: SolutionsEnv, name: string): Promise<VerifyReport> {
	// 已装校验：sys_solution_route 有该 module 行（未装 → 404，端点门之一）
	const routeRows = await db.query(
		`select path, module, category, "order", title_key, required_permission, enabled
		from sys_solution_route where deprecated = 0 and module = ?`,
		[name],
	) as Array<Record<string, unknown>>;
	if (routeRows.length === 0)
		throw Object.assign(new Error(`方案「${name}」未安装或无路由注册`), { status: 404 });

	const routes = routeRows.map(rowOf);

	// ① 路由可达性（I/O 探针；siteOrigin 复用 = SSRF 钉② header 清洗，probeUrlOf 内建钉①）
	const reach = await verifyRouteReachability(fetchOf(env), routes, siteOrigin());

	// ② RBAC 完整性：声明权限点 ↔ sys_permission 实有
	const declaredPerms = [...new Set(routes.map(r => r.required_permission).filter((p): p is string => p != null))];
	const permRows = await db.query("select code from sys_permission") as Array<{ code: string }>;
	const rbac = diffPermRows(declaredPerms, new Set(permRows.map(r => r.code)));

	// ③ 设置完整性：manifest 声明设置 key ↔ sys_setting 实有（永不含值）
	const manifest = await readSolutionManifest(env, name);
	const declaredSettings = manifest ? declaredSettingsOf(manifest.manifest) : [];
	const settingRows = await db.query("select key from sys_setting where module = ? and deprecated = 0", [name]) as Array<{ key: string }>;
	const settings = diffSettingRows(declaredSettings, new Set(settingRows.map(r => r.key)));

	// ④ 迁移账本：manifest 迁移目录最高版本 ↔ _oj_migrations 实有（journalHeadOf 复用，DRY）
	const declaredMig = manifest
		? declaredMigrationsOf(await listMigrationFiles(env, name, manifest.version), name)
		: [];
	const applied = new Map<string, number | null>();
	applied.set(name, Number(await journalHeadOf(name)));
	const ledger = diffLedger(declaredMig, applied);

	const checks: VerifyItem[] = [...reach, ...rbac, ...settings, ...ledger];
	const trust = await trustItemOf(env, name);
	if (trust !== null)
		checks.push(trust);

	// i18n 依赖项（info，非阻断）：本仓只下发待查 key 清单（advise），前端经 oj-market 解析文案；
	// 缺执行降级「未校验」不阻断。先据既有检查项判定是否需要 i18n 解析，再纳入 advise 清单。
	const baseAdvise = [...new Set(checks.map(c => c.advise_key))].sort();
	if (baseAdvise.length > 0)
		checks.push({ id: "i18n", severity: "info", subject: String(baseAdvise.length), advise_key: "lifecycle.verify.i18n.dependency" });

	const advise = [...new Set(checks.map(c => c.advise_key))].sort();
	const ok = !checks.some(c => c.severity === "error");
	return { ok, checks, advise };
}

/** 版本目录内迁移文件名清单（读不到目录 → 空，意为无迁移声明） */
async function listMigrationFiles(env: SolutionsEnv, name: string, version: string): Promise<string[]> {
	try {
		return await fsFace().readdir(`${env.sharedRoot}/${name}-${version}/migrations`);
	}
	catch {
		return [];
	}
}

export function createSolutionsApi(env: SolutionsEnv) {
	return {
		// GET /api/_platform/solutions/routes —— 前端归并数据源（登录即可）。
		routes: {
			async get() {
				if (!http.user?.id) {
					json.fail(401, "unauthorized");
					return;
				}
				await respond(async () => {
					const rows = await db.query(
						`select path, module, category, "order", title_key, required_permission, enabled
						from sys_solution_route where deprecated = 0 order by module, "order", path`,
					) as Array<Record<string, unknown>>;
					return rows.map(rowOf);
				});
			},
		},
		// POST /api/_platform/solutions/verify?name= —— 深检（admin 域；不触 exec）。
		verify: {
			async post() {
				await respond(async () => {
					if (!http.user?.id)
						throw Object.assign(new Error("unauthorized"), { status: 401 });
					await assertSystemAdmin();
					const name = verifyNameOf();
					const report = await verifyBody(env, name);
					// 落盘 verify-reports（时间序 N=10 留存；persist 失败不应阻断响应——但异常须上抛由 respond 收口）
					await persistReport(verifyReportsDirOf(env), name, report);
					return report;
				});
			},
			// GET /api/_platform/solutions/verify/last?name= —— 取该方案最新深检报告（登录即可，只读）。
			last: {
				async get() {
					if (!http.user?.id) {
						json.fail(401, "unauthorized");
						return;
					}
					await respond(async () => {
						const name = verifyNameOf();
						const report = await getLastReport(verifyReportsDirOf(env), name);
						if (report === null)
							throw Object.assign(new Error(`方案「${name}」暂无深检报告`), { status: 404 });
						return report;
					});
				},
			},
		},
	};
}

export default createSolutionsApi(solutionsEnv());
