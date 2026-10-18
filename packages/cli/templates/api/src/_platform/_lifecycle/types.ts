// 生命周期编排面类型收敛（P1-10）：InstallContext 自 steps/preflight.ts 迁入（含可选 hostVersions，
// C2-09 比对真源注入位）；StageResult 收敛为全 stage 通用结构形状（各 step 模块保留自己的字面量
// stage 窄类型，结构相容即可赋值）；十阶段 InstallStage 名 = 契约附录 A 逐字（lock_commit 为
// D11①扩展组）；TaskRecord = 注册设计 §10.2 形状 + stages 明细日志 + appliedSeq（对账 floor 依据）。

import type { StateStore } from "./state";

/** 安装上下文（各 step 模块 ctx 的公共基座；依赖注入面经各 step 的 ctx 扩展，见 steps/*） */
export interface InstallContext {
	/** 已解析的 manifest.yaml（安装器读盘解析产物） */
	manifest: unknown
	/** 安装目标身份（与 manifest.name/version 同源；manifest 字段缺失/非字符串时兜底） */
	name: string
	version: string
	/** 站点 sidecar 状态（.solutions/state.yaml）；占用检测真源：solutions 键 = 已装方案名 */
	state: StateStore
	/** 宿主 versions.json（C2-09 peerRuntime 比对真源；键 = 包名，runtime 取 @oj-module/runtime） */
	hostVersions?: Record<string, string>
	/** 目标站点数据库句柄（本段不消费；P1-8 register 段起使用） */
	db?: unknown
	/**
	 * 同名重装/升级放行位（P1-10，AC-P1-3）：安装器检测到 sidecar 已有同名方案时置位——
	 * 同名命中是本方案自己的升级路径（升级/降级 = runInstall({version})，任务简报），
	 * 跨方案碰撞仍由 apiSeg/route_prefix 首段占用兜住；缺省 false 保持 P1-5「同名拒装」钉面。
	 */
	reinstall?: boolean
}

/** 阶段结果（全 stage 通用结构形状；stage 取值为各 step 自己的字面量，编排层以 StageDef.name 为准） */
export interface StageResult {
	stage: string
	ok: boolean
	message: string
	retryable?: boolean
	/** 签名失败六码（P2-3，契约附录 A.2；缺省 = 非签名类失败） */
	code?: SigCode
	/** 未知 key_id 待 TOFU 确认：任务停 needs_trust 终态，staging 不清场供确认后重试 */
	needsTrust?: boolean
	/** 待确认的发布方 key（TaskRecord.trust 同源；UI/CLI 展示指纹） */
	trust?: { key_id: string, public_key: string, fingerprint: string }
}

/**
 * 签名失败六码（契约 v1.3 附录 A.2，P2-3）：retryable 恒 false、零解压零落盘。
 * 文案 key = `lifecycle.stage.verifying.<code>`（双语值 P2-5 落 locales）。
 */
export type SigCode = "sig_missing" | "sig_alg" | "sig_key" | "tampered" | "unknown_key" | "sig_format";

/**
 * 安装阶段名（契约附录 A 十阶段逐字 + D11①扩展组 lock_commit + audit/done 终态）。
 * 附录 A 文案 key：`lifecycle.stage.<stage>.reason/.hint/.retryable`（audit 失败仅记日志不设 key）。
 */
export type InstallStage = "preflight" | "downloading" | "verifying" | "extracting" | "migrating" | "lock_commit" | "registering" | "deploying_web" | "reloading" | "smoke" | "audit" | "done";

/**
 * 任务状态（§10.2 三态 + partial：锁后失败部分生效——D11 失败语义② + needs_trust：
 * 未知发布方 key_id 待人工 TOFU 确认——P2-3 第五终态，预锁段停止、staging 不清场，
 * 确认入信任库后重试同一安装即可继续；一切消费面须把 needs_trust 当非成功态渲染）。
 */
export type TaskStatus = "running" | "done" | "failed" | "partial" | "needs_trust";

/** 安装任务记录（§10.2 + stages 明细日志；落 .install-tasks/<id>.json，800ms 轮询消费面） */
export interface TaskRecord {
	id: string
	name: string
	version: string
	status: TaskStatus
	stage: InstallStage | null
	/** 0-100 整体进度（按 STAGES 表完成数折算） */
	progress: number
	message: string
	/** 各 stage 明细日志（UI 详情日志区数据源） */
	stages: { stage: InstallStage, ok: boolean, message: string }[]
	/** 失败/partial 终态：reason + retryable + 指引文案 key（契约附录 A） */
	error?: { reason: string, retryable: boolean, hintKey?: string }
	/** needs_trust 终态：待确认的发布方 key（POST /market/trust {task_id} 消费；指纹供人确认） */
	trust?: { key_id: string, public_key: string, fingerprint: string }
	startedAt: number
	finishedAt?: number
	/** 本次迁移 applied max seq（migrating 段捕获；reconcile 账本对账 floor 依据） */
	appliedSeq?: number
}
