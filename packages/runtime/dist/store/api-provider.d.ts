import type { MenuItemType } from "../api/system/menu/types";
import type { FetchAddRoleItemBody, FetchAddRoleItemData, FetchDeleteRoleItemBody, FetchDeleteRoleItemData, FetchMenuByRoleIdData, FetchMenuByRoleIdQuery, FetchRoleListData, FetchRoleListQuery, FetchRoleMenuData, FetchUpdateRoleItemBody, FetchUpdateRoleItemData } from "../api/system/role/client/api";
import type { NotificationItem } from "../layout/widgets/notification/types";
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
    fetchRoleList: (query: FetchRoleListQuery) => Promise<FetchRoleListData>;
    fetchAddRoleItem: (body: FetchAddRoleItemBody) => Promise<FetchAddRoleItemData>;
    fetchUpdateRoleItem: (body: FetchUpdateRoleItemBody) => Promise<FetchUpdateRoleItemData>;
    fetchDeleteRoleItem: (body: FetchDeleteRoleItemBody) => Promise<FetchDeleteRoleItemData>;
    fetchRoleMenu: () => Promise<FetchRoleMenuData>;
    fetchMenuByRoleId: (query: FetchMenuByRoleIdQuery) => Promise<FetchMenuByRoleIdData>;
    fetchMenuList: (data: any) => Promise<ListData<MenuItemType>>;
    fetchAddMenuItem: (data: MenuItemType) => Promise<string>;
    fetchUpdateMenuItem: (data: MenuItemType) => Promise<string>;
    fetchDeleteMenuItem: (id: number) => Promise<string>;
}
/** 通知 provider（D9）：模块经 ctx.register.notificationsApi 接管通知拉取 */
export interface NotificationsApiProvider {
    fetchNotifications: () => Promise<NotificationItem[]>;
}
/** 上传 provider（D9）：模块经 ctx.register.uploadApi 接管头像/附件上传端点 */
export interface UploadApiProvider {
    /** 上传 action URL */
    action: string;
    /** 每次上传动态取请求头（如注入 Bearer）；返回普通对象 */
    headers: () => Record<string, string>;
}
export declare function registerSystemApiProvider(moduleName: string, provider: SystemApiProvider): void;
export declare function getSystemApiProvider(): SystemApiProvider | undefined;
export declare function registerNotificationsApiProvider(moduleName: string, provider: NotificationsApiProvider): void;
export declare function getNotificationsApiProvider(): NotificationsApiProvider | undefined;
export declare function registerUploadApiProvider(moduleName: string, provider: UploadApiProvider): void;
export declare function getUploadApiProvider(): UploadApiProvider | undefined;
/**
 * 卸载模块时复位其登记的全部 API provider（系统/通知/上传）。以 moduleName
 * 作命名隔离——不同模块各自登记互不干扰，卸载只清自己的。
 */
export declare function unregisterApiProviders(moduleName: string): void;
