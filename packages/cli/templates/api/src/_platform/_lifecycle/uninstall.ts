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
};

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
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

	// 安装在哪：锁与 sidecar 均无记录 = 未安装
	if (lock[name] === undefined && side === undefined) {
		return { ok: false, message: `卸载失败：「${name}」未安装（锁与 sidecar 均无记录）` };
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

	// ② sidecar 删条目（patch 值 null = 删除该方案键）
	try {
		await input.state.write({ solutions: { [name]: null } });
	}
	catch (e) {
		audit(false, `sidecar 写失败：${String(e)}`);
		return { ok: false, message: `卸载失败：sidecar 写失败（${String(e)}）` };
	}

	// ③ route 行删除
	try {
		await db.exec("delete from sys_solution_route where module = ?", [name]);
	}
	catch (e) {
		audit(false, `route 删除失败：${String(e)}`);
		return { ok: false, message: `卸载失败：sys_solution_route 删除失败（${String(e)}）——sidecar 已删除，路由残留` };
	}

	// ④ modules.json 删条目（条目不存在 = api-only 方案，天然一致）
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
		return { ok: false, message: `卸载失败：modules.json 写失败（${String(e)}）——锁/sidecar/route 已更新，前端条目残留` };
	}

	// 权限唯一减法出口（双维度级联：角色 + 绑定 + 用户成员 + 权限点）
	try {
		await uninstallSolution(name);
	}
	catch (e) {
		audit(false, `权限级联清理失败：${String(e)}`);
		return { ok: false, message: `卸载失败：权限级联清理失败（${String(e)}）` };
	}

	// ① 锁摘除（最后执行：模块停止装配）
	try {
		await writeLock(input.lockPath, remaining);
	}
	catch (e) {
		audit(false, `锁写失败：${String(e)}`);
		return { ok: false, message: `卸载失败：锁写失败（${String(e)}）——其余三处已更新，锁残留` };
	}

	// 版本目录移除（缺失不报错，幂等）
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
		message: `卸载完成：锁摘除 + sidecar + sys_solution_route + modules.json 四处同删 + 权限级联清理 + 版本目录移除（${name}@${version}）`,
	};
}
