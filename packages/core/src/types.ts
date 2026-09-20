import type { ComponentType, ReactNode } from "react";

import type { MenuFactory } from "./menu";
import type {
	AuthProvider,
	HeaderProvider,
	NotificationsApiProvider,
	SystemApiProvider,
	UploadApiProvider,
} from "./providers/types";
import type { AppRouteRecordRaw } from "./router/types";

/** 模块级 scoped request（v1 utils/request 同形的结构最小契约，ky 兼容） */
export interface ModuleRequest {
	(url: string | URL, options?: unknown): Promise<unknown>
	get: (url: string | URL, options?: unknown) => Promise<unknown>
	post: (url: string | URL, options?: unknown) => Promise<unknown>
	put: (url: string | URL, options?: unknown) => Promise<unknown>
	patch: (url: string | URL, options?: unknown) => Promise<unknown>
	delete: (url: string | URL, options?: unknown) => Promise<unknown>
	head: (url: string | URL, options?: unknown) => Promise<unknown>
}

/**
 * 模块上下文 — 宿主向模块注入的能力（v1 同名同义 + menu 超集，PRD §4）；
 * register.* 均先到先得（menu 覆盖语义），模块卸载时自动注销
 */
export interface ModuleContext {
	module: {
		name: string
		version: string
	}
	/** request 为按 apiPrefix 收敛的 scoped client，越界即拒 */
	utils: {
		request: ModuleRequest
	}
	register: {
		/** 注册额外的 store（供宿主 getRegisteredStore 桥接） */
		store: (name: string, store: unknown) => void
		/** API 前缀（追加语义，一模块可多个）；ctx.utils.request 放行命中任一前缀的 URL */
		apiPrefix: (prefix: string) => void
		authProvider: (provider: AuthProvider) => void
		headerProvider: (provider: HeaderProvider) => void
		systemApi: (provider: SystemApiProvider) => void
		notificationsApi: (provider: NotificationsApiProvider) => void
		uploadApi: (provider: UploadApiProvider) => void
		layout: (name: string, component: ComponentType) => void
		/** 菜单贡献（v1 无，core 新增）：贡献**工厂**而非静态数组，href 渲染期现算（PRD §5.1） */
		menu: (factory: MenuFactory) => void
	}
	registerSlot: (slotName: string, node: ReactNode) => void
}

/** 模块配置 */
export interface ModuleConfig {
	/** 模块级角色门：用户须满足其一才能激活 */
	requiredRoles?: string[]
	/** 模块级权限码门：须全部满足 */
	requiredPermissions?: string[]
	/** 依赖的其他模块 name 列表，须在 beforeInit 之前完成加载 */
	dependencies?: string[]
}

/** 生命周期钩子（loadAll Phase 3 执行 beforeInit → onInit → i18n 合并；v1 同序） */
export interface ModuleLifecycle {
	beforeInit?: (ctx: ModuleContext) => Promise<void>
	onInit?: (ctx: ModuleContext) => Promise<void>
	onActivate?: (ctx: ModuleContext) => Promise<void>
	onDeactivate?: (ctx: ModuleContext) => Promise<void>
	onDestroy?: (ctx: ModuleContext) => Promise<void>
}

/** i18n 资源声明 */
export interface ModuleI18n {
	[locale: string]: () => Promise<Record<string, unknown>>
}

/**
 * 模块定义 — entry.ts 导出类型；R = 路由记录类型（默认框架路由，
 * compat 桥可换入宿主原形路由，PRD §4 泛型化）
 */
export interface ModuleDefinition<R = AppRouteRecordRaw> {
	name: string
	description: string
	version: string
	routes: R[]
	lifecycle?: ModuleLifecycle
	i18n?: ModuleI18n
	config?: ModuleConfig
	/** 兼容的宿主 runtime 版本（semver 范围），不兼容则拒绝加载并显式报错 */
	peerRuntime?: string
}

/** 运行时模块实例 */
export interface ModuleInstance<R = AppRouteRecordRaw> {
	definition: ModuleDefinition<R>
	/** missing-deps：依赖缺失或加载失败，本模块未执行生命周期（禁止半加载） */
	status: "pending" | "loading" | "loaded" | "active" | "error" | "missing-deps"
	error?: Error
}

/** manifest.json 模块条目 */
export interface ManifestModuleEntry {
	/** 模块名称，需与 entry.ts 中 name 一致 */
	name: string
	/** 模块资源路径（本地相对路径或远程 URL） */
	entry: string
	enabled?: boolean
	/** 依赖（清单层冗余声明，供运维观测） */
	dependencies?: string[]
	/** 兼容的宿主 runtime 版本范围，加载后即刻校验 */
	peerRuntime?: string
}

/** manifest.json 格式 */
export interface Manifest {
	modules: ManifestModuleEntry[]
	/** 宿主 runtime 实际版本；提供即启用 peerRuntime 校验 */
	runtimeVersion?: string
}
