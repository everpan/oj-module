import type { MenuItemType } from "./types";
import { getSystemApiProvider } from "#src/store/api-provider";
import { request } from "#src/utils/request";
import { unwrap } from "#src/utils/request/envelope";

export * from "./types";

/* 获取菜单列表 */
export function fetchMenuList(data: any): Promise<ListData<MenuItemType>> {
	const p = getSystemApiProvider();
	if (p)
		return p.fetchMenuList(data);
	return unwrap(request.get("menu-list", { searchParams: data, ignoreLoading: true }).json());
}

/* 新增菜单 */
export function fetchAddMenuItem(data: MenuItemType): Promise<string> {
	const p = getSystemApiProvider();
	if (p)
		return p.fetchAddMenuItem(data);
	return unwrap(request.post("menu-item", { json: data, ignoreLoading: true }).json());
}

/* 修改菜单 */
export function fetchUpdateMenuItem(data: MenuItemType): Promise<string> {
	const p = getSystemApiProvider();
	if (p)
		return p.fetchUpdateMenuItem(data);
	return unwrap(request.put("menu-item", { json: data, ignoreLoading: true }).json());
}

/* 删除菜单 */
export function fetchDeleteMenuItem(id: number): Promise<string> {
	const p = getSystemApiProvider();
	if (p)
		return p.fetchDeleteMenuItem(id);
	return unwrap(request.delete("menu-item", { json: id, ignoreLoading: true }).json());
}
