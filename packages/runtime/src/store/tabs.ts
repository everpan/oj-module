import type { TabPaneProps } from "antd";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { usePreferencesStore } from "#src/store/preferences";
import { getAppNamespace } from "#src/utils/get-app-namespace";

/**
 * @zh 关闭前守卫：返回 false（或 Promise<false>）取消关闭；抛错按取消处理（fail-safe）
 * @en Close guard: return false (or Promise<false>) to cancel the close; a thrown error is treated as cancel (fail-safe).
 */
export type BeforeTabCloseGuard = () => boolean | Promise<boolean>;

/**
 * @zh 标签页项目属性接口
 * @en Tab item properties interface.
 */
export interface TabItemProps extends Omit<TabPaneProps, "tab"> {
	key: string
	label: React.ReactNode
	/**
	 * @zh 是否可拖拽
	 * @en Whether it can be dragged.
	 */
	draggable?: boolean
	/**
	 * 可选的历史状态值，如 search 和 hash，可存储于此
	 * 在目标路由中可通过 useLocation 钩子访问该状态
	 * @see {@link https://reactrouter.com/en/main/hooks/use-navigate#optionsstate | usenavigate - options state}
	 */
	historyState?: Record<string, any>
	/**
	 * @zh 关闭前守卫：单个或数组（顺序执行，按函数引用去重，null 清除全部守卫）。
	 * 五个关闭动作（单个/右/左/其他/全部）关闭前 await 守卫，任一否决或抛错整批取消。
	 * @en Guard before close: a single guard or an array (executed in order, deduped by reference; null clears all guards). All five close actions await guards before closing — any veto or thrown error cancels the whole batch.
	 */
	beforeClose?: BeforeTabCloseGuard | BeforeTabCloseGuard[] | null
}

export interface TabStateType extends Omit<TabItemProps, "label"> {
	label: string
	/**
	 * @zh 标签页的新标题，用于修改标签页的标题
	 * @en The new title of the tab, used to modify the title of the tab.
	 */
	newTabTitle?: React.ReactNode
}

/**
 * @zh 初始状态
 * @en Initial state.
 */
const initialState = {
	/**
	 * @zh 标签页集合
	 * @en Tab collection.
	 */
	openTabs: new Map<string, TabStateType>([]),
	/**
	 * @zh 当前激活的标签页
	 * @en The currently active tab.
	 */
	activeKey: "",
	/**
	 * @zh 标签页是否处于刷新状态
	 * @en Whether it is in a refresh state.
	 */
	isRefresh: false,
	/**
	 * @zh 标签页是否最大化
	 * @en Whether the tab is maximized.
	 */
	isMaximize: false,
};

type TabsState = typeof initialState;

/**
 * @zh 标签页的操作方法
 * @en Tab operation methods.
 */
interface TabsAction {
	setIsRefresh: (state: boolean) => void
	addTab: (routePath: string, tabProps: TabStateType) => void
	insertBeforeTab: (routePath: string, tabProps: TabStateType) => void
	removeTab: (routePath: string) => Promise<void>
	closeRightTabs: (routePath: string) => Promise<void>
	closeLeftTabs: (routePath: string) => Promise<void>
	closeOtherTabs: (routePath: string) => Promise<void>
	closeAllTabs: () => Promise<void>
	setActiveKey: (routePath: string) => void
	resetTabs: () => void
	changeTabOrder: (from: number, to: number) => void
	toggleMaximize: (state: boolean) => void
	setTableTitle: (routePath: string, title: string) => void
	resetTableTitle: (routePath: string) => void
};

/** 关闭流程进行中的 key（并发去重：同 key 的关闭在进行中时再次触发被忽略） */
const closingKeys = new Set<string>();

/**
 * @zh 标签页状态管理
 * @en Tab state management.
 */
export const useTabsStore = create<TabsState & TabsAction>()(
	persist(
		(set, get) => {
			/**
			 * 关闭前守卫：待关闭集合里任一标签页声明了 beforeClose 且返回 false / 抛错时，整体中止。
			 * fail-safe：守卫抛错按中止处理，防误关丢内容；console.error 留排查线索。
			 */
			const guardClose = async (keys: string[]): Promise<boolean> => {
				for (const key of keys) {
					const fn = get().openTabs.get(key)?.beforeClose;
					if (fn == null)
						continue;
					const fns = Array.isArray(fn) ? fn : [fn];
					for (const f of fns) {
						try {
							if (!(await f()))
								return false;
						}
						catch (e) {
							console.error("[tabs] beforeClose 守卫抛错，按中止关闭处理", e);
							return false;
						}
					}
				}
				return true;
			};

			/**
			 * 共用关闭路径：in-flight 去重 → 守卫 → 精确删除获批集合（TOCTOU 防护：
			 * 不对 live state 重算，await 期间新开的 tab 不受影响）→ activeKey 修正。
			 */
			const guardAndClose = async (removed: string[], fallbackActive: (remaining: string[]) => string): Promise<void> => {
				if (removed.length === 0)
					return;
				for (const k of removed)
					closingKeys.add(k);
				try {
					if (!(await guardClose(removed)))
						return;
					set((state) => {
						const toClose = new Set(removed);
						const newTabs = new Map([...state.openTabs].filter(([k]) => !toClose.has(k)));
						if (newTabs.size === state.openTabs.size)
							return state;
						const remaining = [...newTabs.keys()];
						const newActiveKey = (toClose.has(state.activeKey) || !newTabs.has(state.activeKey))
							? fallbackActive(remaining)
							: state.activeKey;
						return { openTabs: newTabs, activeKey: newActiveKey };
					});
				}
				finally {
					for (const k of removed)
						closingKeys.delete(k);
				}
			};

			return {
				...initialState,

				/**
				 * @zh 设置标签页是否处于刷新状态
				 * @en Set whether the tab is in a refresh state.
				 */
				setIsRefresh: (state: boolean) => {
					set({ isRefresh: state });
				},

				/**
				 * @zh 设置标签页
				 * @en Set the tab.
				 */
				setActiveKey: (routePath: string) => {
					set({ activeKey: routePath });
				},

				/**
				 * @zh 在最前面插入标签页
				 * @en Insert a tab at the front.
				 */
				insertBeforeTab: (routePath: string, tabProps: TabStateType) => {
					set((state) => {
						if (routePath?.length) {
							const newMap = new Map([[routePath, tabProps]]);
							for (const [key, value] of state.openTabs) {
								newMap.set(key, value);
							}
							return { openTabs: newMap };
						}
						return state;
					});
				},

				/**
				 * @zh 添加标签页
				 * @en Add a tab.
				 */
				addTab: (routePath: string, tabProps: TabStateType) => {
					set((state) => {
						if (routePath?.length) {
							const newTabs = new Map(state.openTabs);
							/**
							 * 1. 如果 tab 已经存在，则更新 historyState 属性，所以不去重，且 ...newTabs.get(routePath) 是为了保证首页的 closable 属性不被覆盖
							 * 2. 如果 tab 不存在，则添加到 Map 中
							 * 3. beforeClose 是注册语义而非覆盖语义：数组 concat + 按引用去重
							 *    （keep-alive 重挂载重复注册不叠加）；null 显式清除全部守卫
							 */
							const prev = newTabs.get(routePath);
							const merged: TabStateType = { ...prev, ...tabProps };
							if (tabProps.beforeClose === null) {
								merged.beforeClose = undefined; // null = 清除该 tab 全部守卫（含他人注册的）
							}
							else if (prev?.beforeClose != null && tabProps.beforeClose !== undefined) {
								const all = [
									...(Array.isArray(prev.beforeClose) ? prev.beforeClose : [prev.beforeClose]),
									...(Array.isArray(tabProps.beforeClose) ? tabProps.beforeClose : [tabProps.beforeClose]),
								];
								merged.beforeClose = all.filter((f, i, a) => a.indexOf(f) === i); // 按引用去重
							}
							newTabs.set(routePath, merged);
							return { openTabs: newTabs };
						}
						return state;
					});
				},

				/**
				 * @zh 移除标签页
				 * @en Remove a tab.
				 */
				removeTab: async (routePath: string) => {
					const homePath = import.meta.env.VITE_BASE_HOME_PATH;

					// 如果是首页，不允许关闭
					if (!routePath?.length || routePath === homePath || closingKeys.has(routePath))
						return;

					// 移除当前激活的标签页时，fallback 选剩余最后一个（home 不可删，集合必非空）
					await guardAndClose([routePath], keys => keys.at(-1) ?? homePath);
				},

				/**
				 * @zh 关闭右侧标签页
				 * @en Close tabs on the right.
				 */
				closeRightTabs: async (routePath: string) => {
					if (closingKeys.has(routePath))
						return;
					const keys = [...get().openTabs.keys()];
					const idx = keys.indexOf(routePath);
					if (idx < 0)
						return;
					// 当前激活页在关闭集合内时，锚点成为新的激活页
					await guardAndClose(keys.slice(idx + 1), () => routePath);
				},

				/**
				 * @zh 关闭左侧标签页
				 * @en Close tabs on the left.
				 */
				closeLeftTabs: async (routePath: string) => {
					if (closingKeys.has(routePath))
						return;
					const homePath = import.meta.env.VITE_BASE_HOME_PATH;
					const keys = [...get().openTabs.keys()];
					const idx = keys.indexOf(routePath);
					if (idx < 0)
						return;
					// home 永不在受影响集合
					await guardAndClose(keys.slice(0, idx).filter(k => k !== homePath), () => routePath);
				},

				/**
				 * @zh 关闭其他标签页
				 * @en Close other tabs.
				 */
				closeOtherTabs: async (routePath: string) => {
					if (closingKeys.has(routePath))
						return;
					const homePath = import.meta.env.VITE_BASE_HOME_PATH;
					await guardAndClose(
						[...get().openTabs.keys()].filter(k => k !== homePath && k !== routePath),
						() => routePath,
					);
				},

				/**
				 * @zh 关闭所有标签页
				 * @en Close all tabs.
				 */
				closeAllTabs: async () => {
					const homePath = import.meta.env.VITE_BASE_HOME_PATH;
					await guardAndClose([...get().openTabs.keys()].filter(k => k !== homePath), () => homePath);
				},

				/**
				 * @zh 更改标签页顺序
				 * @en Change tab order.
				 */
				changeTabOrder: (from: number, to: number) => {
					set((state) => {
					// 也可以使用 import { arrayMove } from "@dnd-kit/sortable"; 来交换位置
						const newTabs = Array.from(state.openTabs.entries());
						const [movedTab] = newTabs.splice(from, 1); // 直接解构获取移动的标签
						newTabs.splice(to, 0, movedTab); // 插入到新位置

						const newOpenTabs = new Map(newTabs); // 直接使用 Map 构造函数
						return { openTabs: newOpenTabs };
					});
				},

				/**
				 * @zh 切换标签页最大化状态
				 * @en Toggle tab maximization status
				 * @param {boolean} state - 最大化状态
				 */
				toggleMaximize: (state: boolean) => {
					set({ isMaximize: state });
				},

				/**
				 * @zh 设置标签页标题
				 * @en Set the tab title
				 */
				setTableTitle: (routePath: string, title: React.ReactNode) => {
					set((state) => {
						const newTabs = new Map(state.openTabs);
						const targetTab = newTabs.get(routePath);
						if (targetTab) {
							targetTab.newTabTitle = title;
							newTabs.set(routePath, targetTab);
							return { openTabs: newTabs };
						}
						return state;
					});
				},

				/**
				 * @zh 重置标签页标题（删除自定义的标题）
				 * @en Reset the tab title (delete custom titles)
				 */
				resetTableTitle: (routePath: string) => {
					set((state) => {
						const newTabs = new Map(state.openTabs);
						const targetTab = newTabs.get(routePath);
						if (targetTab) {
							delete targetTab.newTabTitle;
							newTabs.set(routePath, targetTab);
							return { openTabs: newTabs };
						}
						return state;
					});
				},

				/**
				 * @zh 重置所有标签页的状态
				 * @en Reset all tab states
				 */
				resetTabs: () => {
					set(() => {
						return { ...initialState };
					});
				},

			};
		},
		{
			name: getAppNamespace("tabbar"),
			/**
			 * activeKey 不需要持久化存储
			 *
			 * 假如页面路由为 /home
			 * 手动在地址栏输入 /about
			 * activeKey 仍为 /home 导致 src/layout/layout-tabbar/index.tsx 的自动导航功能失效
			 * @see https://github.com/condorheroblog/react-antd-admin/issues/1
			 */
			partialize: (state) => {
				return Object.fromEntries(
					Object.entries(state).filter(([key]) => !["activeKey"].includes(key)),
				);
			},
			/**
			 * openTabs 是一个 Map，持久化存储需要手动管理
			 * How do I use it with Map and Set
			 * @see https://github.com/pmndrs/zustand/blob/v5.0.1/docs/integrations/persisting-store-data.md#how-do-i-use-it-with-map-and-set
			 */
			storage: {
				getItem: (name) => {
					const str = sessionStorage.getItem(name);
					// 是否开启持久化存储，如果未开启则在页面初次进入时返回 null 即可
					const isPersist = usePreferencesStore.getState().tabbarPersist;
					if (!str || !isPersist)
						return null;
					const existingValue = JSON.parse(str);
					return {
						...existingValue,
						state: {
							...existingValue.state,
							openTabs: new Map(existingValue.state.openTabs),
						},
					};
				},
				setItem: (name, newValue) => {
					// functions cannot be JSON encoded
					const str = JSON.stringify({
						...newValue,
						state: {
							...newValue.state,
							openTabs: Array.from(newValue.state.openTabs.entries()),
						},
					});
					sessionStorage.setItem(name, str);
				},
				removeItem: name => sessionStorage.removeItem(name),
			},
		},
	),

);
