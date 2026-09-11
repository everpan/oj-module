import type { MenuItemType } from "#src/api/system/menu/types";
// 全部为类型导入（编译期擦除），不会在运行时与消费模块（role/menu/notifications）
// 形成循环依赖。
import type {
	FetchAddRoleItemBody,
	FetchAddRoleItemData,
	FetchDeleteRoleItemBody,
	FetchDeleteRoleItemData,
	FetchMenuByRoleIdData,
	FetchMenuByRoleIdQuery,
	FetchRoleListData,
	FetchRoleListQuery,
	FetchRoleMenuData,
	FetchUpdateRoleItemBody,
	FetchUpdateRoleItemData,
} from "#src/api/system/role/client/api";
import type { NotificationItem } from "#src/layout/widgets/notification/types";

/**
 * 系统 API provider（D9）：模块经 ctx.register.systemApi 接管角色/菜单类
 * 内置 API。系统角色/菜单/通知/上传这些原本硬编码在 runtime 根级路径的
 * 内部端点，通过注册表可被模块注入为带自身 apiPrefix 的实现（如 playground
 * 模块把 /system/* 收敛到其 /<dir> 前缀下），消费点（role/menu/notifications/
 * 头像上传）在运行时委托，未注册时回落到内置 root 级实现（沿用既有 fetch*）。
 *
 * 三者全必填——「接管系统 API」是全量接管，不做部分托管（与 authProvider 同规则）。
 * provider 对返回值自负责：runtime 在 provider 路径上不做任何成功/字段校验。
 */
export interface SystemApiProvider {
	fetchRoleList: (query: FetchRoleListQuery) => Promise<FetchRoleListData>
	fetchAddRoleItem: (body: FetchAddRoleItemBody) => Promise<FetchAddRoleItemData>
	fetchUpdateRoleItem: (body: FetchUpdateRoleItemBody) => Promise<FetchUpdateRoleItemData>
	fetchDeleteRoleItem: (body: FetchDeleteRoleItemBody) => Promise<FetchDeleteRoleItemData>
	fetchRoleMenu: () => Promise<FetchRoleMenuData>
	fetchMenuByRoleId: (query: FetchMenuByRoleIdQuery) => Promise<FetchMenuByRoleIdData>
	fetchMenuList: (data: any) => Promise<ListData<MenuItemType>>
	fetchAddMenuItem: (data: MenuItemType) => Promise<string>
	fetchUpdateMenuItem: (data: MenuItemType) => Promise<string>
	fetchDeleteMenuItem: (id: number) => Promise<string>
}

/** 通知 provider（D9）：模块经 ctx.register.notificationsApi 接管通知拉取 */
export interface NotificationsApiProvider {
	fetchNotifications: () => Promise<NotificationItem[]>
}

/** 上传 provider（D9）：模块经 ctx.register.uploadApi 接管头像/附件上传端点 */
export interface UploadApiProvider {
	/** 上传 action URL */
	action: string
	/** 每次上传动态取请求头（如注入 Bearer）；返回普通对象 */
	headers: () => Record<string, string>
}

/**
 * 模块作用域注册表。刻意不用 zustand（同 auth-provider）：provider 只在
 * store action / 守卫 effect 中被读（非渲染期），模块作用域单一 provider
 * 即可，先到先得。
 */
interface Registration<T> {
	moduleName: string
	provider: T
}

let systemCurrent: Registration<SystemApiProvider> | undefined;
let notificationsCurrent: Registration<NotificationsApiProvider> | undefined;
let uploadCurrent: Registration<UploadApiProvider> | undefined;

export function registerSystemApiProvider(moduleName: string, provider: SystemApiProvider): void {
	if (systemCurrent) {
		console.warn(
			`[api] 重复的系统 API provider 忽略：已由模块 "${systemCurrent.moduleName}" 提供，`
			+ `忽略 "${moduleName}"（先到先得）。`,
		);
		return;
	}
	systemCurrent = { moduleName, provider };
}

export function getSystemApiProvider(): SystemApiProvider | undefined {
	return systemCurrent?.provider;
}

export function registerNotificationsApiProvider(moduleName: string, provider: NotificationsApiProvider): void {
	if (notificationsCurrent) {
		console.warn(
			`[api] 重复的通知 provider 忽略：已由模块 "${notificationsCurrent.moduleName}" 提供，`
			+ `忽略 "${moduleName}"（先到先得）。`,
		);
		return;
	}
	notificationsCurrent = { moduleName, provider };
}

export function getNotificationsApiProvider(): NotificationsApiProvider | undefined {
	return notificationsCurrent?.provider;
}

export function registerUploadApiProvider(moduleName: string, provider: UploadApiProvider): void {
	if (uploadCurrent) {
		console.warn(
			`[api] 重复的上传 provider 忽略：已由模块 "${uploadCurrent.moduleName}" 提供，`
			+ `忽略 "${moduleName}"（先到先得）。`,
		);
		return;
	}
	uploadCurrent = { moduleName, provider };
}

export function getUploadApiProvider(): UploadApiProvider | undefined {
	return uploadCurrent?.provider;
}

/**
 * 卸载模块时复位其登记的全部 API provider（系统/通知/上传）。以 moduleName
 * 作命名隔离——不同模块各自登记互不干扰，卸载只清自己的。
 */
export function unregisterApiProviders(moduleName: string): void {
	if (systemCurrent?.moduleName === moduleName)
		systemCurrent = undefined;
	if (notificationsCurrent?.moduleName === moduleName)
		notificationsCurrent = undefined;
	if (uploadCurrent?.moduleName === moduleName)
		uploadCurrent = undefined;
}
