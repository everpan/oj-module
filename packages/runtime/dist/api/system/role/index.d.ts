import type { FetchAddRoleItemBody, FetchAddRoleItemData, FetchDeleteRoleItemBody, FetchDeleteRoleItemData, FetchMenuByRoleIdData, FetchMenuByRoleIdQuery, FetchRoleListData, FetchRoleListQuery, FetchRoleMenuData, FetchUpdateRoleItemBody, FetchUpdateRoleItemData } from "./client/api";
export declare function fetchRoleList(query: FetchRoleListQuery): Promise<FetchRoleListData>;
export declare function fetchAddRoleItem(body: FetchAddRoleItemBody): Promise<FetchAddRoleItemData>;
export declare function fetchUpdateRoleItem(body: FetchUpdateRoleItemBody): Promise<FetchUpdateRoleItemData>;
export declare function fetchDeleteRoleItem(body: FetchDeleteRoleItemBody): Promise<FetchDeleteRoleItemData>;
export declare function fetchRoleMenu(): Promise<FetchRoleMenuData>;
export declare function fetchMenuByRoleId(query: FetchMenuByRoleIdQuery): Promise<FetchMenuByRoleIdData>;
export { fetchAddMenuItem, fetchDeleteMenuItem, fetchMenuList, fetchUpdateMenuItem, } from "../menu";
export * from "./types";
