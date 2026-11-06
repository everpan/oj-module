// 方案安装入口的纯推导（Phase B T3）：页面只做 query + 渲染，状态口径收这里，
// 与 roles/visible-roles 同范式（展示层逻辑可单测，不入 React 组件）。
// 数据源：GET /api/oj-market/index 的行（superadmin；R29 第一方编排面，平台内置）。

/** index 行中本入口消费的最小形状（完整行见 oj-market api IndexRow，catchall 契约） */
export interface SolutionsRow {
	name: string
	latest: string | null
	installed: string | null
	upgradable: boolean
}

export type MarketEntry = { kind: "absent" } | { kind: "installable", latest: string } | { kind: "installed", installed: string, latest: string | null, upgradable: boolean };

/** 市场包入口状态：目录无行（出厂未装且未回填）/ 可安装 / 已装（含可升级位） */
export function marketEntryOf(list: SolutionsRow[]): MarketEntry {
	const row = list.find(r => r.name === "oj-market");
	if (row === undefined)
		return { kind: "absent" };
	if (row.installed === null)
		return row.latest === null ? { kind: "absent" } : { kind: "installable", latest: row.latest };
	return { kind: "installed", installed: row.installed, latest: row.latest, upgradable: row.upgradable };
}

/** 任务记录的最小消费形状（TaskRecord 真源：api/_platform/_lifecycle/types.ts） */
export interface TaskLike {
	status: string
	progress: number
	message: string
}

export type TaskOutcome = { kind: "running", progress: number, message: string } | { kind: "done" } | { kind: "needsTrust" } | { kind: "failed", message: string };

/** 任务终态 → 入口渲染口径：needs_trust 是非成功态（TOFU 确认前不得绿） */
export function taskOutcomeOf(rec: TaskLike): TaskOutcome {
	switch (rec.status) {
		case "running":
			return { kind: "running", progress: rec.progress, message: rec.message };
		case "done":
			return { kind: "done" };
		case "needs_trust":
			return { kind: "needsTrust" };
		default:
			return { kind: "failed", message: rec.message };
	}
}
