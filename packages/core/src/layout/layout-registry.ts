import type { ComponentType } from "react";

/**
 * 布局注册表（v1 G1 直蒸）：模块经 ctx.register.layout(name, component) 注册
 * 新布局名。先到先得、重复警告忽略、按 moduleName 卸载清理。内建名
 * （container/parent/fullscreen）由宿主 bootstrap 时以 registerLayout 登记
 * （core 不引 v1 布局实现，PRD §4 纯注册表解析）。
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

/** 卸载模块时清掉其登记的全部布局（只影响「再解析」，不热回落，v1 N8） */
export function unregisterLayouts(moduleName: string): void {
	for (const [name, registration] of registrations) {
		if (registration.moduleName === moduleName)
			registrations.delete(name);
	}
}
