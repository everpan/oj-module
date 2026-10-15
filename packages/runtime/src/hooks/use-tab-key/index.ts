import { useRef } from "react";
import { useLocation } from "react-router";

import { removeTrailingSlash } from "#src/router/utils/remove-trailing-slash";

/**
 * 本页自己的页签 key（`removeTrailingSlash(pathname)`），供 `setTableTitle` /
 * `resetTableTitle` / `addTab` 定位页签。
 *
 * keepAlive 陷阱：keepalive-for-react 把页面缓存在隐藏 portal 里，而 LocationContext
 * 在 KeepAlive **之上**——切 tab 时缓存树随**激活页**位置重渲染，缓存页里的
 * `useLocation()` 返回的是别家页签的路径。若拿它当页签 key，`setTableTitle` 会把
 * 本页标题写到当前激活页签上（最后打开的文档页把之后切换到的每个页签都改成自己的标题）。
 *
 * 页签存活期内 key 不变（宿主 cacheKey = pathname+search，一页一路径），故首渲染
 * （此时本页必是激活页）捕获一次即可；缓存树后续多少次重渲染都不会漂移。
 * 需要跟随导航的位置信息请直接用 `useLocation`，不要用本 hook。
 */
export function useTabKey(): string {
	const { pathname } = useLocation();
	const keyRef = useRef<string | undefined>(undefined);
	if (keyRef.current === undefined)
		keyRef.current = removeTrailingSlash(pathname);
	return keyRef.current;
}
