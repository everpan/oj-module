// 市场领域类型（形状对齐宿主 _platform 编排面真源 + 本仓 market_history 表）。
// 真源：templates/api/src/_platform/_lifecycle/types.ts:47 (TaskRecord) 与 market/api.ts:IndexRow。
// 任何形状漂移以 templates 源码为准——实现前已核对（2026-10-17）。

/** 安装阶段名（契约附录 A 十阶段逐字 + lock_commit/audit/done 终态） */
export type InstallStage = "preflight" | "downloading" | "verifying" | "extracting" | "migrating" | "lock_commit" | "registering" | "deploying_web" | "reloading" | "smoke" | "audit" | "done";

/**
 * 任务状态（§10.2 三态 + partial：锁后失败部分生效 + needs_trust：未知发布方 key 待人工
 * TOFU 确认，staging 不清场，确认入库后重试同一安装即可续跑）。
 * needs_trust 是非成功态：消费面不得按绿色成功渲染（真源 api/src/_platform/_lifecycle/types.ts:64）。
 */
export type TaskStatus = "running" | "done" | "failed" | "partial" | "needs_trust";

/** 阶段明细日志（UI 详情日志区数据源） */
export interface TaskStageLog {
	stage: InstallStage
	ok: boolean
	message: string
}

/** 失败/partial 终态：reason + retryable + 指引文案 key（契约附录 A） */
export interface TaskError {
	reason: string
	retryable: boolean
	hintKey?: string
}

/** needs_trust 终态：待确认的发布方 key（指纹 = sha256(public_key) 十六进制，供人核对） */
export interface TaskTrust {
	key_id: string
	public_key: string
	fingerprint: string
}

/** 安装任务记录（§10.2 + stages 明细日志；落 .install-tasks/<id>.json，800ms 轮询消费面） */
export interface TaskRecord {
	id: string
	name: string
	version: string
	status: TaskStatus
	stage: InstallStage | null
	/** 0-100 整体进度 */
	progress: number
	message: string
	stages: TaskStageLog[]
	error?: TaskError
	/** needs_trust 终态才有：待确认的发布方 key（POST /market/trust {task_id} 消费） */
	trust?: TaskTrust
	startedAt: number
	finishedAt?: number
	appliedSeq?: number
}

/** 卡片数据源行（GET /_platform/market/index）：CDN 三级索引（catalog + shards）⊕ 本地 sidecar state */
export interface IndexRow {
	name: string
	latest: string | null
	installed: string | null
	enabled: boolean | null
	upgradable: boolean
}

/** 安装输入（POST /_platform/market/install） */
export interface InstallInput {
	name: string
	version?: string | null
	source?: "cdn" | "file"
}

/** 启用/停用输入（POST /_platform/market/enable） */
export interface EnableInput {
	name: string
	enabled: boolean
}

/** 市场操作历史动作 */
export type HistoryAction = "install" | "uninstall" | "enable" | "disable" | "upgrade" | "rollback";

/** 市场操作历史记录（本仓 market_history 表，只读消费） */
export interface MarketHistory {
	id: number
	solution: string
	version: string
	action: HistoryAction
	status: string
	operator: string | null
	message: string | null
	created_at: number
}

/** 卸载影响面预检（P3 U1 语义；服务端返回供前端二次确认） */
export interface UninstallImpact {
	name: string
	affectedRoles: number
	affectedUsers: number
}
