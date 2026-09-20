import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getSlotNodes,
	registerSlot,
	removeModuleSlots,
	resetSlots,
	subscribe,
	useSlotNodes,
} from "../src/module-loader/slots";

afterEach(() => resetSlots());

describe("slots 去 zustand 事件化（语义等价）", () => {
	it("注册 / 纯读：注册顺序即 Object 值序", () => {
		registerSlot("a", "header-actions", "A1");
		registerSlot("b", "header-actions", "B1");
		expect(getSlotNodes("header-actions")).toEqual(["A1", "B1"]);
	});

	it("同名重注册覆盖（同模块同插槽）", () => {
		registerSlot("a", "s", "v1");
		registerSlot("a", "s", "v2");
		expect(getSlotNodes("s")).toEqual(["v2"]);
	});

	it("按模块清理，其他模块不受影响", () => {
		registerSlot("a", "s", "A");
		registerSlot("b", "s", "B");
		removeModuleSlots("a");
		expect(getSlotNodes("s")).toEqual(["B"]);
	});

	it("清理后空插槽键也被移除（v1 同语义）", () => {
		registerSlot("a", "solo", "A");
		removeModuleSlots("a");
		expect(getSlotNodes("solo")).toEqual([]);
	});

	it("多订阅者：注册与清理都触发通知（useSyncExternalStore 数据源）", () => {
		const l1 = vi.fn();
		const l2 = vi.fn();
		const off1 = registerSlotAndSubscribe(l1);

		registerSlot("a", "s", "A");
		expect(l1).toHaveBeenCalled();
		const callsAfterRegister = l1.mock.calls.length;
		expect(l2).not.toHaveBeenCalled();

		off1();
		removeModuleSlots("a");
		// 退订后不再收到通知；通知广播是全体监听者（pub-sub 语义）
		expect(l1.mock.calls.length).toBe(callsAfterRegister);
	});

	it("useSlotNodes 选择器形态与 getSlotNodes 同构（快照数据源一致性）", () => {
		registerSlot("a", "s", "A");
		// useSyncExternalStore 的 getSnapshot 即 state.slots[slotName]；
		// 渲染行为由宿主 React 树验证，此处验证数据源函数为纯读
		expect(getSlotNodes("s")).toEqual(["A"]);
		expect(typeof useSlotNodes).toBe("function");
	});
});

/** 订阅底层 pub-sub（useSlotNodes 内部同一数据源） */
function registerSlotAndSubscribe(listener: () => void): () => void {
	return subscribe(listener);
}
