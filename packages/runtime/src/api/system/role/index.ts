import type {
	FetchAddRoleItemBody,
	FetchAddRoleItemData,
	FetchDeleteRoleItemBody,
	FetchDeleteRoleItemData,
	FetchMenuByRoleIdData,
	FetchMenuByRoleIdQuery,
	FetchRoleListData,
	FetchRoleListQuery,
	FetchRoleMenuData,
	FetchUpdateRoleItemBody,
	FetchUpdateRoleItemData,
} from "./client/api";
import { getSystemApiProvider } from "#src/store/api-provider";
import {
	fetchAddRoleItem as builtinFetchAddRoleItem,
	fetchDeleteRoleItem as builtinFetchDeleteRoleItem,
	fetchMenuByRoleId as builtinFetchMenuByRoleId,
	fetchRoleList as builtinFetchRoleList,
	fetchRoleMenu as builtinFetchRoleMenu,
	fetchUpdateRoleItem as builtinFetchUpdateRoleItem,
} from "./client/api";

// D9：消费点委托。未注册 systemProvider 时回落到内置 root 级实现（client.ts）。
export async function fetchRoleList(query: FetchRoleListQuery): Promise<FetchRoleListData> {
	return getSystemApiProvider()?.fetchRoleList(query) ?? builtinFetchRoleList(query);
}

export async function fetchAddRoleItem(body: FetchAddRoleItemBody): Promise<FetchAddRoleItemData> {
	return getSystemApiProvider()?.fetchAddRoleItem(body) ?? builtinFetchAddRoleItem(body);
}

export async function fetchUpdateRoleItem(body: FetchUpdateRoleItemBody): Promise<FetchUpdateRoleItemData> {
	return getSystemApiProvider()?.fetchUpdateRoleItem(body) ?? builtinFetchUpdateRoleItem(body);
}

export async function fetchDeleteRoleItem(body: FetchDeleteRoleItemBody): Promise<FetchDeleteRoleItemData> {
	return getSystemApiProvider()?.fetchDeleteRoleItem(body) ?? builtinFetchDeleteRoleItem(body);
}

export async function fetchRoleMenu(): Promise<FetchRoleMenuData> {
	return getSystemApiProvider()?.fetchRoleMenu() ?? builtinFetchRoleMenu();
}

export async function fetchMenuByRoleId(query: FetchMenuByRoleIdQuery): Promise<FetchMenuByRoleIdData> {
	return getSystemApiProvider()?.fetchMenuByRoleId(query) ?? builtinFetchMenuByRoleId(query);
}

// D9：SystemApiProvider 把角色与菜单类端点统一在同一 provider 下；
// 为让模块/测试统一从系统 API 入口取用，这里把菜单函数再导出（菜单模块自身
// 仍独立导出，二者实现同一委托逻辑）。
export {
	fetchAddMenuItem,
	fetchDeleteMenuItem,
	fetchMenuList,
	fetchUpdateMenuItem,
} from "../menu";

export * from "./types";
