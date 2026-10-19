// 市场 API 客户端契约（DIP  seams）：组件/hooks 依赖此接口，而非具体 http 实现；
// 测试可注入内存 fake（见 __tests__/marketClient.fake.ts）。
// 第一方专用调用面（R29）：仅市场应用消费 /api/_platform/market/*，第三方方案不得仿照。
//
// 实现见同目录 defaultClient.ts——统一委托给 ojm 从契约生成的 __client，消除手写
// URL/信封解包与契约漂移（DEV 下生成 client 还会对响应做 zod 校验）。

import type {
	EnableInput,
	IndexRow,
	InstallInput,
	MarketHistory,
	TaskRecord,
	UninstallImpact,
} from "../types";

/** 市场客户端契约（组件/hooks 依赖此接口，而非具体 http 实现） */
export interface MarketClient {
	/** 登录即可：{ apiVersion }（peerPlatform 预检口径） */
	meta: () => Promise<{ apiVersion: string }>
	/** 卡片数据源（superadmin） */
	index: () => Promise<IndexRow[]>
	/** 触发安装，返回轮询用 task_id */
	install: (input: InstallInput) => Promise<{ task_id: string }>
	/** 任务轮询消费面（query 形态 ?id=） */
	task: (id: string) => Promise<TaskRecord>
	/** 生命周期开关（同步 setEnabled，无任务模型；{ok,message} 200 渲染 ok 位） */
	enable: (input: EnableInput) => Promise<{ ok: boolean, message: string }>
	/** 市场操作历史（_platform 只读端点 /_platform/market/history） */
	history: () => Promise<MarketHistory[]>
	/** 卸载影响面预检（P3 U1；服务端返回供二次确认，P1-15a 补齐后接通） */
	uninstallImpact: (name: string) => Promise<UninstallImpact>
	/** 卸载（P1-15a 补齐后接通） */
	uninstall: (name: string) => Promise<{ ok: boolean, message: string }>
}
