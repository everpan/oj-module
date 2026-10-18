// 卸载编排器（P1-15a，SRP/OCP）：与 installer.ts 对称——安装 = runInstall，卸载 = runUninstall。
// 端点（market/api.ts）只做门禁 + 取参 + 调本编排器，不重复编排（与 install 同纪律）。
// 删除纪律（D12 反向，与 setEnabled 四处同写对称）：①锁摘除 ②sidecar 删条目 ③sys_solution_route 删
// ④modules.json 删条目；另：权限唯一减法出口 uninstallSolution（双维度级联，solution-perms.ts）；
// 版本目录移除；终态审计 + 全用户失效（权限已变，D10 撤销即强退）+ market_history 留痕。
// 空锁拒启（S1-1.2）：摘除后锁为空 → 拒绝卸载最后一个模块（站点至少保留一个已锁模块）。
// 任一步失败返回 {ok:false, message}（与 setEnabled 同纪律）；部分残差由 admin 重试或重装自愈。
// SQL 全部参数化（与 audit.ts / setEnabled 同纪律，值不拼字符串）。

import type { OpEntry } from "../_shared/service/audit";
import type { StateStore } from "./state";
import { invalidateAllUsers } from "../_shared/service/access";
import { auditOp } from "../_shared/service/audit";
import { uninstallSolution } from "../_shared/service/solution-perms";
import { atomicWriteText, fsFace } from "./atomic";
import { recordHistory } from "./history";
import { readLock, writeLock } from "./lock";

// db 为 oj isolate 注入全局（同模板 service 层惯例，installer.ts 同款；测试由夹具装 globalThis.db）
declare const db: {
	exec: (sql: string, params: unknown[]) => Promise<unknown>
	query: (sql: string, params?: unknown[]) => Promise<unknown>
	/** 当前方言（sqlite/mysql/pg）；缺省 sqlite。Q4 业务表目录查询方言无关 */
	dialect?: () => string
	/** 单一 DB 事务包裹（P3-3）：回调内语句共享一个 BEGIN/COMMIT/ROLLBACK 边界，异常即整段回滚 */
	tx: <T>(fn: (t: { exec: (sql: string, params?: unknown[]) => Promise<unknown>, query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>) => Promise<T>
};

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// P3-4（Q4 业务表保留提示）：卸载只删代码/锁/路由/sidecar/权限，绝不 DROP 业务数据；
// 受影响业务表经双重来源得到——① manifest.tables 声明式权威源 ② 模块 slug 规范化前缀兜底扫描——
// 仅回传「实际存在」的表名，供运维手工清理。检测全程失败静默兜底，不阻断卸载主流程。

/** 从 manifest 文本抽取顶层 `tables:` 标量列表（manifest 形态稳定，避免引入 yaml 全局依赖） */
function manifestTables(yamlText: string): string[] {
	const out: string[] = [];
	let inTables = false;
	for (const raw of yamlText.split("\n")) {
		const line = raw.replace(/\r$/, "");
		if (!inTables) {
			if (/^tables\s*:/.test(line)) {
				inTables = true;
				continue;
			}
			continue;
		}
		if (line.trim() === "")
			continue;
		const m = /^\s+-\s+(\S.*)$/.exec(line);
		if (m) {
			out.push(m[1].replace(/^['"]|['"]$/g, ""));
			continue;
		}
		if (/^\S/.test(line))
			break; // 顶层新键，tables 块结束
	}
	return out;
}

/** 当前方言（oj 注入 db.dialect，缺省 sqlite） */
function currentDialect(): string {
	const d = (db as { dialect?: () => string }).dialect;
	return typeof d === "function" ? d() : "sqlite";
}

/** 表目录查询片段（方言无关：sqlite=sqlite_master，mysql/pg=information_schema） */
export function catalogSpec(dialect: string): { existing: string, like: (pat: string) => [string, unknown[]] } {
	if (dialect === "sqlite") {
		return {
			existing: "SELECT name FROM sqlite_master WHERE type='table'",
			like: pat => ["SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ESCAPE '!'", [pat]],
		};
	}
	const schemaExpr = dialect === "mysql" ? "DATABASE()" : "'public'";
	return {
		existing: `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schemaExpr}`,
		like: pat => [`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schemaExpr} AND table_name LIKE ? ESCAPE '!'`, [pat]],
	};
}

/** 当前库实际存在的表名集合 */
async function listExistingTables(dialect: string): Promise<Set<string>> {
	const rows = (await db.query(catalogSpec(dialect).existing)) as Array<{ name: string }>;
	return new Set(rows.map(r => r.name));
}

/** 模块 slug 规范化 + LIKE 转义（沿用 RBAC 权限命名空间约定：!%_ 转义，连字符→下划线作表前缀） */
export function tablePrefixPattern(name: string): string {
	const slug = name.replace(/-/g, "_").replace(/[!%_]/g, c => `!${c}`);
	// 表名用下划线分隔（非权限码的 `.`）：slug_ + 通配符 %（末尾 % 不转义，保持通配语义）
	return `${slug}_%`;
}

/** 收集需保留的业务表（Q4）：声明 + 前缀兜底；仅返回实际存在的表名 */
export async function collectRetainedTables(name: string, manifestPath: string): Promise<string[]> {
	const dialect = currentDialect();
	const existing = await listExistingTables(dialect);
	const candidates = new Set<string>();
	// ① 声明式权威源：manifest.tables（通知等模块已在 manifest 声明业务表归属）
	try {
		const text = new TextDecoder().decode(await fsFace().readFile(manifestPath));
		for (const t of manifestTables(text))
			candidates.add(t);
	}
	catch {
		// manifest 缺失（api-only 方案）→ 仅前缀兜底
	}
	// ② 前缀兜底：扫描当前库匹配模块前缀的表，覆盖未声明场景
	try {
		const [sql, params] = catalogSpec(dialect).like(tablePrefixPattern(name));
		const rows = (await db.query(sql, params)) as Array<{ name: string }>;
		for (const r of rows)
			candidates.add(r.name);
	}
	catch {
		// 兜底扫描失败不阻断卸载
	}
	return [...candidates].filter(t => existing.has(t));
}

/** 卸载影响面预检（GET uninstall-impact 消费面）：返回前端二次确认所需的影响计数 */
export interface UninstallImpact {
	name: string
	affectedRoles: number
	affectedUsers: number
}

export interface UninstallInput {
	name: string
	/** 可选显式版本；缺省回落锁/sidecar 版本 */
	version?: string
	sharedRoot: string
	lockPath: string
	state: StateStore
	modulesJsonPath: string
	/** 操作人（用户名，历史留痕；缺省 null） */
	operator?: string | null
	now?: number
	/** 审计出口（缺省 auditOp；测试注入记录器） */
	audit?: (entry: OpEntry) => void
}

export interface UninstallResult {
	ok: boolean
	message: string
	/** P3-11 失败细分：not-installed = 方案已不存在（锁与 sidecar 均无记录）——端点据此回 404（资源缺失语义），其余拒绝仍 200 {ok:false} */
	reason?: "not-installed"
	/** P3-4（Q4）业务表保留清单：卸载不删业务数据，仅回传实际存在的业务表名供运维手工清理 */
	retained?: string[]
}

/** 计算卸载影响面（角色数 + 持有这些角色的用户数） */
export async function computeUninstallImpact(input: UninstallInput): Promise<UninstallImpact> {
	const { name } = input;
	const roles = await db.query("select name from sys_role where module = ?", [name]) as Array<{ name: string }>;
	const roleNames = roles.map(r => r.name);
	let affectedUsers = 0;
	if (roleNames.length > 0) {
		const rows = await db.query(
			`select distinct user_id from sys_user_role where role_name in (${roleNames.map(() => "?").join(",")})`,
			roleNames,
		) as Array<{ user_id: number }>;
		affectedUsers = rows.length;
	}
	return { name, affectedRoles: roleNames.length, affectedUsers };
}

/**
 * 卸载编排（四处同删 + 权限级联 + 版本目录移除 + 审计 + 全用户失效 + 历史留痕）。
 * 任一步失败返回 {ok:false, message}（操作已执行、被域逻辑拒绝，人话在 message，前端照 ok 位渲染，
 * 与 setEnabled 同纪律）；锁/sidecar/route/modules 可能留部分残差（admin 手动重试或重装自愈）。
 */
export async function runUninstall(input: UninstallInput): Promise<UninstallResult> {
	const { name } = input;
	const f = fsFace();
	const lock = await readLock(input.lockPath);
	const side = input.state.read().solutions[name];

	// 安装在哪：锁与 sidecar 均无记录 = 未安装（P3-11：细分 reason，端点据此回 404 资源缺失语义）
	if (lock[name] === undefined && side === undefined) {
		return { ok: false, reason: "not-installed", message: `卸载失败：「${name}」未安装（锁与 sidecar 均无记录）` };
	}
	const version = input.version ?? lock[name] ?? side?.version;
	if (version === undefined) {
		return { ok: false, message: `卸载失败：「${name}」版本不可得（锁与 sidecar 均无版本）` };
	}

	// 空锁拒启（S1-1.2）：摘除后锁为空 → 拒绝卸载最后一个模块
	const remaining = { ...lock };
	delete remaining[name];
	if (Object.keys(remaining).length === 0) {
		return { ok: false, message: "卸载失败：摘除后锁为空（空锁拒启，S1-1.2）——站点至少保留一个已锁模块，不能卸载最后一个" };
	}

	const audit = (ok: boolean, detail: string): void =>
		(input.audit ?? auditOp)({ action: "solution.uninstall", module: name, target: name, detail: { ok, detail }, level: ok ? 6 : 4 });

	// ① DB 级联单一事务（P3-3）：route 删除 + 权限双维度级联（uninstallSolution）纳入同一 BEGIN/COMMIT/ROLLBACK
	// 边界。任一步失败 → 整段回滚（无角色/权限/路由半残），锁不摘（fail-closed：模块仍挂载、可重试或重装自愈）。
	try {
		await db.tx(async (t) => {
			await t.exec("delete from sys_solution_route where module = ?", [name]);
			await uninstallSolution(name, t);
		});
	}
	catch (e) {
		audit(false, `权限级联清理失败：${String(e)}`);
		return { ok: false, message: `卸载失败：权限级联清理失败（${String(e)}）——事务已回滚，锁/路由/角色/权限未改动（fail-closed）` };
	}

	// ② sidecar 删条目（patch 值 null = 删除该方案键）
	try {
		await input.state.write({ solutions: { [name]: null } });
	}
	catch (e) {
		audit(false, `sidecar 写失败：${String(e)}`);
		return { ok: false, message: `卸载失败：sidecar 写失败（${String(e)}）——DB 级联已提交，锁未摘（fail-closed）` };
	}

	// ③ modules.json 删条目（条目不存在 = api-only 方案，天然一致）
	try {
		const list = JSON.parse(new TextDecoder().decode(await f.readFile(input.modulesJsonPath))) as unknown[];
		if (!Array.isArray(list)) {
			throw new TypeError("modules.json 顶层不是数组");
		}
		const next = list.filter(e => !(isObj(e) && e.name === name));
		await atomicWriteText(input.modulesJsonPath, `${JSON.stringify(next, null, 2)}\n`);
	}
	catch (e) {
		audit(false, `modules.json 写失败：${String(e)}`);
		return { ok: false, message: `卸载失败：modules.json 写失败（${String(e)}）——DB 级联已提交、sidecar 已删，锁未摘（fail-closed）` };
	}

	// ① 锁摘除（最后执行：模块停止装配；在此之前任一失败锁均保留 = fail-closed）
	try {
		await writeLock(input.lockPath, remaining);
	}
	catch (e) {
		audit(false, `锁写失败：${String(e)}`);
		return { ok: false, message: `卸载失败：锁写失败（${String(e)}）——DB 级联/sidecar/modules 已更新，锁残留` };
	}

	// 版本目录移除（缺失不报错，幂等）
	// —— 但 Q4 业务表清单须在版本目录移除前从 manifest 取得（manifest 在版本目录内）——
	let retained: string[] = [];
	try {
		retained = await collectRetainedTables(name, `${input.sharedRoot}/${name}-${version}/manifest.yaml`);
	}
	catch {
		retained = [];
	}
	try {
		await f.remove(`${input.sharedRoot}/${name}-${version}`, { recursive: true });
	}
	catch {
		// 目录缺失 = 已清理，忽略
	}

	// 权限已变 → 强退所有会话（D10：撤销即强退）
	invalidateAllUsers();

	// 终态审计
	audit(true, `卸载完成：${name}@${version}`);

	// 历史留痕（守卫式：表不存在/写失败静默，history.ts 同语义）
	await recordHistory({
		solution: name,
		version,
		action: "uninstall",
		status: "success",
		operator: input.operator ?? null,
		message: `卸载完成：${name}@${version}`,
	});

	return {
		ok: true,
		message: `卸载完成：锁摘除 + sidecar + sys_solution_route + modules.json 四处同删 + 权限级联清理 + 版本目录移除（${name}@${version}）；业务表 ${retained.length} 张已保留（未删除，需运维手工清理）`,
		retained,
	};
}
