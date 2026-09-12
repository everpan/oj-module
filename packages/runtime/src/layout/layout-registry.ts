import type { ComponentType } from "react";

/**
 * 布局注册表（G1，设计文档 §4.1）：模块经 `ctx.register.layout(name, component)`
 * 注册新布局名，或覆盖内建名（`container` / `fullscreen` / `parent`）。
 *
 * 与 api-provider 同构的模块作用域注册表：先到先得、重复警告忽略、
 * 按 moduleName 卸载清理。内建三名不做登记（仅作回落，见
 * router/utils/resolve-layout.ts）。
 *
 * 覆盖内建名 = 自担 chrome 全部职责（keepAlive 页签缓存、通知铃、
 * header-actions 插槽、preferences 抽屉等内建 chrome 能力全部失效需自建），
 * 适用于 intentionally 更简的 chrome（设计文档 G1）。
 */
interface LayoutRegistration {
	moduleName: string
	component: ComponentType
}

const registrations = new Map<string, LayoutRegistration>();

export function registerLayout(moduleName: string, name: string, component: ComponentType): void {
	const current = registrations.get(name);
	if (current) {
		console.warn(
			`[layout] 重复的布局名 "${name}" 忽略：已由模块 "${current.moduleName}" 提供，`
			+ `忽略 "${moduleName}"（先到先得）。`,
		);
		return;
	}
	registrations.set(name, { moduleName, component });
}

export function getRegisteredLayout(name: string): ComponentType | undefined {
	return registrations.get(name)?.component;
}

/**
 * 卸载模块时清掉其登记的全部布局（以 moduleName 隔离，不影响其他模块）。
 * 只影响「再解析」语义——已注入运行中 router 的路由不热回落（设计文档 N8）。
 */
export function unregisterLayouts(moduleName: string): void {
	for (const [name, registration] of registrations) {
		if (registration.moduleName === moduleName)
			registrations.delete(name);
	}
}
