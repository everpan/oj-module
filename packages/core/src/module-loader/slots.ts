import type { ReactNode } from "react";

import { useSyncExternalStore } from "react";

/**
 * 布局插槽（v1 P3.6/US-8 去 zustand 事件化，PRD §4）：模块经
 * ctx.registerSlot(slotName, node) 挂载布局片段，useSlotNodes 订阅渲染，
 * 卸载即消失。slotName → moduleName 两级组织：同名重注册覆盖，卸载按模块清理。
 */
interface SlotState {
	slots: Record<string, Record<string, ReactNode>>
}

let state: SlotState = { slots: {} };
const listeners = new Set<() => void>();

function setSlots(next: SlotState): void {
	state = next;
	listeners.forEach(l => l());
}

/** 订阅插槽变化（useSyncExternalStore 数据源；测试与高级宿主可用） */
export function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** 供模块上下文调用：注册/覆盖本模块在某插槽上的节点 */
export function registerSlot(moduleName: string, slotName: string, node: ReactNode): void {
	const byModule = state.slots[slotName] ?? {};
	setSlots({ slots: { ...state.slots, [slotName]: { ...byModule, [moduleName]: node } } });
}

/** 模块卸载时清理其注册的全部插槽节点 */
export function removeModuleSlots(moduleName: string): void {
	const next: SlotState["slots"] = {};
	let changed = false;
	for (const [name, byModule] of Object.entries(state.slots)) {
		if (!(moduleName in byModule)) {
			next[name] = byModule;
			continue;
		}
		changed = true;
		const rest = { ...byModule };
		delete rest[moduleName];
		if (Object.keys(rest).length > 0) {
			next[name] = rest;
		}
	}
	if (changed) {
		setSlots({ slots: next });
	}
}

/** 纯读：某插槽当前挂载的全部节点（注册顺序即 Object 值序） */
export function getSlotNodes(slotName: string): ReactNode[] {
	return Object.values(state.slots[slotName] ?? {});
}

/** 布局组件订阅：插槽节点变化（注册/卸载）时触发重渲染 */
export function useSlotNodes(slotName: string): ReactNode[] {
	const byModule = useSyncExternalStore(
		subscribe,
		() => state.slots[slotName],
		() => state.slots[slotName],
	);
	return Object.values(byModule ?? {});
}

/** 测试与宿主重置用 */
export function resetSlots(): void {
	setSlots({ slots: {} });
}
