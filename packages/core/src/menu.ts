import type { ElementType } from "react";

/**
 * 菜单工厂入参（PRD §5.1）：上游 href 渲染期现算（组件内 `useParams()`），故贡献面是函数而非
 * 静态数组——静态数组把 workspaceSlug/projectId 烤死在注册时刻（v1 菜单 path-as-key 病根，PRD §1）。
 */
export interface MenuFactoryParams {
	workspaceSlug?: string
	projectId?: string
}

/**
 * 菜单项（shape 采上游 TNavigationItem，字段同名同义；PRD §5.1）。`access` 只声明
 * `readonly unknown[]`——上游枚举 ↔ oj roles 的映射表归 plane-runtime 门禁层，core 不引该意见。
 */
export interface NavigationItem {
	key: string
	name: string
	href: string
	icon: ElementType
	access: readonly unknown[]
	shouldRender: boolean
	sortOrder: number
	i18n_key: string
	[key: string]: unknown
}

export type MenuFactory = (params: MenuFactoryParams) => NavigationItem[];

const registrations = new Map<string, { moduleName: string, factory: MenuFactory }>();

/** 登记/覆盖本模块的菜单工厂（重复调用覆盖旧值） */
export function registerModuleMenu(moduleName: string, factory: MenuFactory): void {
	registrations.set(moduleName, { moduleName, factory });
}

/** 全部模块菜单项（按登记顺序聚合）。工厂每次调用现算——params 一变即得新 href；filter/sort 归宿主工厂（PRD §5.1）。 */
export function getRegisteredMenus(params: MenuFactoryParams = {}): NavigationItem[] {
	return Array.from(registrations.values()).flatMap(r => r.factory(params));
}

/** 卸载模块时清理其菜单贡献 */
export function unregisterModuleMenus(moduleName: string): void {
	registrations.delete(moduleName);
}
