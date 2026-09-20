import type { ReactNode } from "react";

/**
 * 菜单贡献项（TNavigationItem 对齐，shape 收敛于 R1c 菜单工厂；PRD §4）。
 * ctx.register.menu(...) 贡献，宿主菜单工厂消费；卸载按 moduleName 清理。
 */
export interface NavigationItem {
	/** 稳定 id（缺省由菜单工厂按 path 生成） */
	id?: string
	title: ReactNode
	/** i18n 键（宿主菜单工厂翻译） */
	translateTitle?: string
	icon?: ReactNode
	color?: string
	/** 目标路径（外部链接时为 URL） */
	path?: string
	/** 排序（小者在前） */
	sortOrder?: number
	hideInMenu?: boolean
	children?: NavigationItem[]
	[key: string]: unknown
}

interface MenuRegistration {
	moduleName: string
	items: NavigationItem[]
}

const registrations = new Map<string, MenuRegistration>();

/** 供模块上下文调用：登记/覆盖本模块的菜单项（重复调用覆盖旧值） */
export function registerModuleMenu(moduleName: string, items: NavigationItem[]): void {
	registrations.set(moduleName, { moduleName, items });
}

/** 全部模块菜单项（按登记顺序聚合；排序归宿主菜单工厂） */
export function getRegisteredMenus(): NavigationItem[] {
	return Array.from(registrations.values()).flatMap(r => r.items);
}

/** 卸载模块时清理其菜单贡献 */
export function unregisterModuleMenus(moduleName: string): void {
	registrations.delete(moduleName);
}
