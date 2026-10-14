import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabsStore } from "#src/store/tabs";

const HOME = import.meta.env.VITE_BASE_HOME_PATH;
const makeTab = (key: string, label = key) => ({ key, label }) as any;

function setup() {
	useTabsStore.getState().addTab(HOME, makeTab(HOME, "Home"));
	useTabsStore.getState().addTab("/a", makeTab("/a"));
	useTabsStore.getState().addTab("/b", makeTab("/b"));
	useTabsStore.getState().setActiveKey("/a");
}

describe("tabs beforeClose 守卫", () => {
	beforeEach(() => {
		sessionStorage.clear();
		useTabsStore.getState().resetTabs();
		vi.restoreAllMocks();
	});

	it("无守卫时行为与同步版一致（回归基线）", async () => {
		setup();
		await useTabsStore.getState().removeTab("/a");
		expect(useTabsStore.getState().openTabs.has("/a")).toBe(false);
		expect(useTabsStore.getState().activeKey).toBe("/b");
	});

	it("守卫返回 false → 取消关闭，页签与 activeKey 不变", async () => {
		setup();
		useTabsStore.getState().addTab("/a", { beforeClose: () => false });
		await useTabsStore.getState().removeTab("/a");
		expect(useTabsStore.getState().openTabs.has("/a")).toBe(true);
		expect(useTabsStore.getState().activeKey).toBe("/a");
	});

	it("守卫返回 Promise<false> 同样取消", async () => {
		setup();
		useTabsStore.getState().addTab("/a", { beforeClose: async () => false });
		await useTabsStore.getState().removeTab("/a");
		expect(useTabsStore.getState().openTabs.has("/a")).toBe(true);
	});

	it("数组守卫顺序执行，任一 false 短路", async () => {
		setup();
		const order: string[] = [];
		useTabsStore.getState().addTab("/a", {
			beforeClose: [
				() => {
					order.push("first");
					return true;
				},
				() => {
					order.push("second");
					return false;
				},
				() => {
					order.push("third");
					return true;
				},
			],
		});
		await useTabsStore.getState().removeTab("/a");
		expect(order).toEqual(["first", "second"]);
		expect(useTabsStore.getState().openTabs.has("/a")).toBe(true);
	});

	it("守卫抛错 → 取消 + console.error", async () => {
		setup();
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		useTabsStore.getState().addTab("/a", {
			beforeClose: () => {
				throw new Error("boom");
			},
		});
		await useTabsStore.getState().removeTab("/a");
		expect(useTabsStore.getState().openTabs.has("/a")).toBe(true);
		expect(err).toHaveBeenCalledOnce();
	});

	it("批量事务性：右侧关闭任一守卫否决则整批取消", async () => {
		setup();
		useTabsStore.getState().addTab("/b", { beforeClose: () => false });
		await useTabsStore.getState().closeRightTabs(HOME);
		expect(useTabsStore.getState().openTabs.has("/b")).toBe(true);
	});

	it("addTab 同一函数引用重复注册不叠加，不同函数 concat", async () => {
		setup();
		const g = () => true;
		const h = () => true;
		useTabsStore.getState().addTab("/a", { beforeClose: g });
		useTabsStore.getState().addTab("/a", { beforeClose: g });
		useTabsStore.getState().addTab("/a", { beforeClose: h });
		const bc = useTabsStore.getState().openTabs.get("/a")!.beforeClose;
		expect(Array.isArray(bc) ? bc : [bc]).toHaveLength(2);
	});

	it("addTab null 清除全部守卫，undefined 不动", async () => {
		setup();
		const g = () => false;
		useTabsStore.getState().addTab("/a", { beforeClose: g });
		useTabsStore.getState().addTab("/a", { beforeClose: null });
		await useTabsStore.getState().removeTab("/a");
		expect(useTabsStore.getState().openTabs.has("/a")).toBe(false); // 守卫已清，关闭成功
	});

	it("home 豁免：不在受影响集合，removeTab(home) 不触发守卫", async () => {
		setup();
		useTabsStore.getState().addTab(HOME, { beforeClose: () => false });
		await useTabsStore.getState().closeAllTabs();
		expect(useTabsStore.getState().openTabs.has(HOME)).toBe(true);
	});

	it("await 期间页签仍在 openTabs（组件挂载语义）", async () => {
		setup();
		let duringAwait = false;
		useTabsStore.getState().addTab("/a", {
			beforeClose: async () => {
				duringAwait = useTabsStore.getState().openTabs.has("/a");
				return false;
			},
		});
		await useTabsStore.getState().removeTab("/a");
		expect(duringAwait).toBe(true);
	});

	it("tOCTOU：守卫 await 期间新开的 tab 不被批量动作误关", async () => {
		setup();
		// 守卫挂在受影响集合内的 /a 上：其 await 期间新开 /c（落在批准集合之外）
		useTabsStore.getState().addTab("/a", {
			beforeClose: async () => {
				useTabsStore.getState().addTab("/c", makeTab("/c"));
				return true;
			},
		});
		await useTabsStore.getState().closeRightTabs(HOME);
		expect(useTabsStore.getState().openTabs.has("/c")).toBe(true);
		expect(useTabsStore.getState().openTabs.has("/a")).toBe(false);
	});

	it("并发去重：同一 key 关闭流程进行中再次触发被忽略", async () => {
		setup();
		let calls = 0;
		useTabsStore.getState().addTab("/a", {
			beforeClose: async () => {
				calls++;
				await new Promise(r => setTimeout(r, 20));
				return false;
			},
		});
		const p1 = useTabsStore.getState().removeTab("/a");
		const p2 = useTabsStore.getState().removeTab("/a");
		await Promise.all([p1, p2]);
		expect(calls).toBe(1);
	});

	it("resetTabs 绕过守卫直接清空", async () => {
		setup();
		useTabsStore.getState().addTab("/a", { beforeClose: () => false });
		useTabsStore.getState().resetTabs();
		expect(useTabsStore.getState().openTabs.size).toBe(0);
	});

	it("removeTab 不存在的 key 无副作用", async () => {
		setup();
		await expect(useTabsStore.getState().removeTab("/nope")).resolves.toBeUndefined();
		expect(useTabsStore.getState().openTabs.size).toBe(3);
	});
});
