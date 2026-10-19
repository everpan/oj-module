// market_history 留痕（P1-15a 缺口 A，P4 上收 _platform）：install / enable / disable / uninstall
// 四类动作共用的平台级留痕出口（前端 HistoryDrawer 消费面）。表由 _platform 自带迁移创建
// （0012__market_history），归平台核心所有；守卫式 insert 仍兜底表缺失/写失败，静默跳过，
// 不阻断主流程（历史是观测面，不是业务正确性依赖；与终态审计附录 B-5 同语义）。
// 参数化 insert，与 audit.ts 同纪律（值不拼字符串）。

// db 为 oj isolate 注入全局（同模板 service 层惯例，installer.ts 同款；测试由夹具装 globalThis.db）
declare const db: { exec: (sql: string, params: unknown[]) => Promise<unknown>, table: (name: string) => any };

export interface HistoryRow {
	solution: string
	version: string
	action: "install" | "enable" | "disable" | "uninstall"
	status: string
	/** 操作人（用户名；编排层可得则传，缺省 null） */
	operator: string | null
	message: string
}

/** 守卫式 insert：表不存在/写失败一律静默（留痕失败不影响主流程） */
export async function recordHistory(row: HistoryRow): Promise<void> {
	try {
		await db.table("market_history").insert({
			solution: row.solution,
			version: row.version,
			action: row.action,
			status: row.status,
			operator: row.operator,
			message: row.message,
			created_at: Math.floor(Date.now() / 1000),
		}).run();
	}
	catch {
		// 表不存在（市场方案未装）或写失败：静默跳过，不阻断主流程
	}
}
