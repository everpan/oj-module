/// <reference types="vite/client" />
// playground-oj 是模块工程：运行时经 dist（非源码）消费 @oj-module/runtime，
// 而 runtime dist 不携带以下全局类型（源码里才有），故在此补齐，使 copied 模块
// 的 fetch* 返回类型 / import.meta.env / 全局 $message 在本地可解析。

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL: string
	readonly VITE_BASE_HOME_PATH: string
	readonly VITE_GLOB_APP_TITLE: string
	readonly VITE_ROUTER_MODE: string
	readonly DEV: boolean
	readonly PROD: boolean
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}

declare global {
	interface Window {
		/** ant design message instance */
		$message?: import("antd/es/message/interface").MessageInstance
		/** ant design modal instance */
		$modal?: Omit<import("antd/es/modal/confirm").ModalStaticFunctions, "warn">
		/** ant design notification instance */
		$notification?: import("antd/es/notification/interface").NotificationInstance
	}

	// 运行时全局类型（packages/runtime/src/types/index.d.ts 的别名），dist 未携带：
	// 列表接口 data 载荷 / oj 信封 / 表格请求参数 / 通用 Record。
	interface ListData<T> {
		list: T[]
		total: number
		current?: number
	}
	interface OjEnvelope<T> {
		code: number
		msg?: string
		data?: T
	}
	interface ApiTableRequest extends Record<string, any> {
		cqs?: string
		pageSize?: number
		current?: number
	}
	type Recordable<T = any> = Record<string, T>;
}

export {};
