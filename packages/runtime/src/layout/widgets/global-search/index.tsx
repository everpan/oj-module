import type { InputRef } from "antd";
import type { ReactElement } from "react";

import type { MenuItemType } from "#src/layout/layout-menu/types";
import { SearchOutlined } from "@ant-design/icons";
import { useDebounceFn, useKeyPress, useLocalStorageState } from "ahooks";
import { Divider, Empty, Input, Modal } from "antd";

import { isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Scrollbar } from "#src/components/scrollbar";
import { useDeviceType } from "#src/hooks/use-device-type";
import { useAccessStore } from "#src/store/access";
import { isString } from "#src/utils/is";

import { SearchFooter } from "./components/search-footer";
import { SearchPanel } from "./components/search-panel";

/**
 * @zh 偏平化可跳转的菜单项
 * @en Flat menu item that can be jumped
 */
function transformMenuToFlatMenu(menus: MenuItemType[], flatMap: MenuItemType[] = []) {
	if (menus && menus.length === 0)
		return [];
	return menus.reduce((acc, cur) => {
		if (!cur.children) {
			acc.push(cur);
		}
		if (cur.children && cur.children.length > 0) {
			transformMenuToFlatMenu(cur.children, flatMap);
		}
		return acc;
	}, flatMap);
}

const searchHistoryLocalStorageKey = `__search-history-${location.hostname}__`;

/**
 * pinyin-pro 按需加载（2026-11-04 首屏体积治理）。
 *
 * 它只在「用户真的敲了搜索词、且不是纯子串命中」时才用得上，却是首屏 159KB(gz)
 * 的固定开销。改为首次搜索时动态 import：共享依赖仍在 importmap 里（宿主单例），
 * 未搜索过的会话一个字节都不下载。模块加载器自身会缓存，故只需在本地记住 match。
 */
let pinyinMatch: typeof import("pinyin-pro").match | undefined;
async function getPinyinMatch() {
	if (!pinyinMatch)
		pinyinMatch = (await import("pinyin-pro")).match;
	return pinyinMatch;
}

export function GlobalSearch() {
	const wholeMenus = useAccessStore(state => state.wholeMenus);
	const bottomMenus = useAccessStore(state => state.bottomMenus);
	const { isMobile } = useDeviceType();
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const [keyword, setKeyword] = useState("");
	const [activeKey, setActiveKey] = useState("");
	const [resultOptions, setResultOptions] = useState<MenuItemType[]>([]);
	const { t } = useTranslation();
	const inputRef = useRef<InputRef>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const [searchHistory = [], setSearchHistory] = useLocalStorageState<string[]>(searchHistoryLocalStorageKey, {
		defaultValue: [],
	});

	/* 底部固定区条目（order < 0）同样可被搜索（2026-10-20） */
	const searchMenuList = useMemo(
		() => transformMenuToFlatMenu([...wholeMenus, ...bottomMenus]),
		[wholeMenus, bottomMenus],
	);

	function onClose() {
		setOpen(false);
	}

	function handleClose() {
		onClose();
		setResultOptions([]);
		setKeyword("");
		setActiveKey("");
	}

	/**
	 * @zh 将指定索引的元素滚动到视图中
	 * @en Scroll the specified index element into view
	 */
	function scrollSelectedIntoView(index: number) {
		if (listRef.current) {
			const item = listRef.current.children[index] as HTMLElement;
			item?.scrollIntoView({
				behavior: "smooth",
				block: "nearest",
			});
		}
	}

	/**
	 * @zh 从搜索历史中移除指定的记录
	 * @en Remove the specified record from search history
	 */
	function removeHistoryItem(key: string) {
		setSearchHistory(prev => prev!.filter(item => item !== key));
	}

	function getActivePathIndex() {
		return resultOptions.findIndex(item => item.key === activeKey);
	}

	function handleKeyPress(direction: 1 | -1) {
		const { length } = resultOptions;
		if (length === 0)
			return;

		const index = getActivePathIndex();
		if (index === -1)
			return;

		const activeIndex = (index + direction + length) % length; // 确保 index 在范围内循环
		const activeNameKey = resultOptions[activeIndex].key;

		setActiveKey(activeNameKey);
		scrollSelectedIntoView(activeIndex);
	}

	const { run: setSearch } = useDebounceFn(async (e) => {
		const inputValue = e.target.value?.trim()?.toLocaleLowerCase();
		if (!inputValue) {
			setResultOptions([]);
			setActiveKey("");
			return;
		}
		// 先按子串筛（不依赖 pinyin-pro），剩下的才需要拼音匹配
		const candidates = searchMenuList.map((menuItem) => {
			let labelText = "";
			if (isValidElement(menuItem.label)) {
				labelText = (menuItem.label as ReactElement<{ children: string }>).props.children;
			}
			if (isString(menuItem.label)) {
				labelText = menuItem.label;
			}
			return { menuItem, label: t(labelText)?.toLocaleLowerCase() };
		});
		const bySubstring = candidates.filter(c => c.label?.includes(inputValue));
		const rest = candidates.filter(c => !c.label?.includes(inputValue));
		if (rest.length > 0) {
			const match = await getPinyinMatch();
			bySubstring.push(...rest.filter(c => match(c.label, inputValue)));
		}
		// 保持菜单原顺序（子串命中与拼音命中交错时不因分组而重排）
		const hitKeys = new Set(bySubstring.map(c => c.menuItem.key));
		const matchRoutes = searchMenuList.filter(item => hitKeys.has(item.key));
		const activeName = matchRoutes[0]?.key ?? "";
		setActiveKey(activeName);
		setResultOptions(matchRoutes);
	}, { wait: 100 });

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const inputValue = e.target.value?.trim();
		setKeyword(inputValue);
	};

	/** key up */
	function handleUp() {
		handleKeyPress(-1); // 方向 -1 表示向上
	}

	/** key down */
	function handleDown() {
		handleKeyPress(1); // 方向 1 表示向下
	}

	/**
	 * @zh 快捷键打开搜索面板
	 * @en Shortcut key to open the search panel
	 */
	useKeyPress(["meta.K"], () => {
		if (!open) {
			setOpen(true);
		}
	});

	/** key enter */
	function handleEnter(isExternalLink?: boolean) {
		if (resultOptions.length === 0 || activeKey === "")
			return;
		if (!searchHistory?.includes(activeKey)) {
			setSearchHistory([...(searchHistory ?? []), activeKey]);
		}
		handleClose();
		if (isExternalLink) {
			window.open(activeKey);
		}
		else {
			navigate(activeKey);
		}
	}

	useKeyPress("Escape", handleClose);
	useKeyPress("Enter", () => handleEnter());
	useKeyPress("uparrow", handleUp);
	useKeyPress("downarrow", handleDown);

	useEffect(() => {
		if (!keyword.length && Array.isArray(searchHistory)) {
			// 关键字为空时把搜索历史同步进结果列表，属于有意的外部状态同步
			// eslint-disable-next-line react/set-state-in-effect
			setResultOptions(searchMenuList.filter(item => searchHistory?.includes(item.key)));
		}
	}, [keyword, searchHistory, searchMenuList]);

	return (
		<>
			<div
				onClick={() => setOpen(open => !open)}
				className="group flex justify-center items-center gap-2 md:bg-colorBgLayout px-3 py-1.5 rounded-full cursor-pointer text-colorTextSecondary hover:text-colorText md:mr-2.5"
			>
				<SearchOutlined />
				<span className="hidden text-xs duration-300 md:block">
					{t("common.search")}
				</span>
				<span className="bg-colorBgContainer relative hidden rounded-sm rounded-r-xl px-1.5 py-1 text-xs leading-none group-hover:opacity-100 md:block">
					&#x2318;
					<kbd>K</kbd>
				</span>
			</div>

			<Modal
				open={open}
				onCancel={() => handleClose()}
				afterOpenChange={(open) => {
					if (open) {
						inputRef.current?.focus();
					}
				}}
				keyboard
				title={(
					<>
						<div className="mr-17">
							<Input
								ref={inputRef}
								value={keyword}
								onChange={handleChange}
								onInput={setSearch}
								variant="outlined"
								placeholder={t("widgets.search.placeholder")}
								allowClear
								autoFocus
								prefix={<SearchOutlined />}
								name="global-search-input"
								className="mx-4 mt-4"
							/>
						</div>
						<Divider className="my-4" />
					</>
				)}
				footer={isMobile ? null : <SearchFooter searchItems={resultOptions.length} />}
				style={isMobile ? { margin: 0, maxWidth: "100%", top: 0, paddingBottom: 0 } : undefined}
				styles={{
					body: {
						flexGrow: "1",
						overflow: "hidden",
					},
					container: {
						padding: 0,
						height: isMobile ? "100vh" : undefined,
						display: isMobile ? "flex" : "block",
						flexDirection: isMobile ? "column" : "row",
					},
				}}
				width={isMobile ? "100%" : 580}
			>
				<Scrollbar style={{
					maxHeight: isMobile ? "100%" : "450px",
				}}
				>
					<ul
						className="px-4 pb-4 md:pb-0"
						ref={listRef}
					>
						{resultOptions.length === 0
							? (
								<Empty
									className="my-8"
									styles={{ image: { height: 40 } }}
									image={keyword.length ? <SearchOutlined className="text-colorTextTertiary" style={{ fontSize: 40 }} /> : Empty.PRESENTED_IMAGE_SIMPLE}
									description={keyword.length ? `${t("widgets.search.noResults")} ${JSON.stringify(keyword)}` : t("widgets.search.noRecent")}
								>
								</Empty>
							)
							: (
								resultOptions.map(item => (
									<SearchPanel
										key={item.key}
										active={item.key === activeKey}
										enter={handleEnter}
										removeHistoryItem={removeHistoryItem}
										setActiveKey={setActiveKey}
										menuItem={item}
										showCloseButton={keyword.length === 0}
									/>
								))
							)}
					</ul>
				</Scrollbar>
			</Modal>
		</>
	);
}
