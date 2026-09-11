/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
import { ContractApiError } from "@oj-module/runtime/contract/errors";
import type { ScopedRequestLike } from "@oj-module/runtime/contract/errors";
import type { z } from "@oj-module/runtime";
import type { schemas } from "./client.schemas";

/** oj 信封（AC-D16）：code=0 成功；非 0 时 HTTP status=code，由 toApiError 归一为 ContractApiError */
interface OjEnvelope<T> { code: number, msg?: string, data?: T }

let req: ScopedRequestLike | undefined;

/** 模块入口 onInit 里调用：bindRequest(ctx.utils.request)（AC-D8 能力持有者） */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req)
		throw new ContractApiError(-1, "[ojm-api] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 bindRequest(ctx.utils.request)。");
	return req;
}

/** ky HTTPError → ContractApiError（错误体为信封时取 code/msg）；契约违例与原错误原样透传 */
async function toApiError(e: unknown): Promise<unknown> {
	if (e instanceof ContractApiError)
		return e;
	const res = (e as { response?: Response } | null)?.response;
	if (res instanceof Response) {
		try {
			const env = await res.clone().json() as { code?: number, msg?: string } | null;
			if (env && typeof env.code === "number")
				return new ContractApiError(env.code, env.msg ?? res.statusText);
		}
		catch { /* 非 JSON 错误体——回退原错误 */ }
	}
	return e;
}

export type FetchAddMenuItemBody = z.input<(typeof schemas)["fetchAddMenuItem"]["body"]>;
export type FetchAddMenuItemData = z.infer<(typeof schemas)["fetchAddMenuItem"]["data"]>;

export async function fetchAddMenuItem(body: FetchAddMenuItemBody): Promise<FetchAddMenuItemData> {
	const client = ensureReq();
	try {
		const env = await client.post(`system/menu-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchAddMenuItemData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchAddMenuItemData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchAddMenuItem.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchAddMenuItem 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchAddRoleItemBody = z.input<(typeof schemas)["fetchAddRoleItem"]["body"]>;
export type FetchAddRoleItemData = z.infer<(typeof schemas)["fetchAddRoleItem"]["data"]>;

export async function fetchAddRoleItem(body: FetchAddRoleItemBody): Promise<FetchAddRoleItemData> {
	const client = ensureReq();
	try {
		const env = await client.post(`system/role-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchAddRoleItemData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchAddRoleItemData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchAddRoleItem.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchAddRoleItem 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchDeleteMenuItemBody = z.input<(typeof schemas)["fetchDeleteMenuItem"]["body"]>;
export type FetchDeleteMenuItemData = z.infer<(typeof schemas)["fetchDeleteMenuItem"]["data"]>;

export async function fetchDeleteMenuItem(body: FetchDeleteMenuItemBody): Promise<FetchDeleteMenuItemData> {
	const client = ensureReq();
	try {
		const env = await client.delete(`system/menu-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchDeleteMenuItemData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchDeleteMenuItemData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchDeleteMenuItem.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchDeleteMenuItem 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchDeleteRoleItemBody = z.input<(typeof schemas)["fetchDeleteRoleItem"]["body"]>;
export type FetchDeleteRoleItemData = z.infer<(typeof schemas)["fetchDeleteRoleItem"]["data"]>;

export async function fetchDeleteRoleItem(body: FetchDeleteRoleItemBody): Promise<FetchDeleteRoleItemData> {
	const client = ensureReq();
	try {
		const env = await client.delete(`system/role-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchDeleteRoleItemData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchDeleteRoleItemData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchDeleteRoleItem.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchDeleteRoleItem 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchMenuByRoleIdQuery = z.input<(typeof schemas)["fetchMenuByRoleId"]["query"]>;
export type FetchMenuByRoleIdData = z.infer<(typeof schemas)["fetchMenuByRoleId"]["data"]>;

export async function fetchMenuByRoleId(query: FetchMenuByRoleIdQuery): Promise<FetchMenuByRoleIdData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/menu-by-role-id`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<FetchMenuByRoleIdData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchMenuByRoleIdData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchMenuByRoleId.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchMenuByRoleId 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchMenuListData = z.infer<(typeof schemas)["fetchMenuList"]["data"]>;

export async function fetchMenuList(): Promise<FetchMenuListData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/menu-list`, { ignoreLoading: true }).json<OjEnvelope<FetchMenuListData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchMenuListData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchMenuList.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchMenuList 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchRoleListQuery = z.input<(typeof schemas)["fetchRoleList"]["query"]>;
export type FetchRoleListData = z.infer<(typeof schemas)["fetchRoleList"]["data"]>;

export async function fetchRoleList(query: FetchRoleListQuery): Promise<FetchRoleListData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/role-list`, { searchParams: query as Record<string, string | number | boolean>, ignoreLoading: true }).json<OjEnvelope<FetchRoleListData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchRoleListData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchRoleList.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchRoleList 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchRoleMenuData = z.infer<(typeof schemas)["fetchRoleMenu"]["data"]>;

export async function fetchRoleMenu(): Promise<FetchRoleMenuData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/role-menu`, { ignoreLoading: true }).json<OjEnvelope<FetchRoleMenuData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchRoleMenuData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchRoleMenu.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchRoleMenu 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchUpdateMenuItemBody = z.input<(typeof schemas)["fetchUpdateMenuItem"]["body"]>;
export type FetchUpdateMenuItemData = z.infer<(typeof schemas)["fetchUpdateMenuItem"]["data"]>;

export async function fetchUpdateMenuItem(body: FetchUpdateMenuItemBody): Promise<FetchUpdateMenuItemData> {
	const client = ensureReq();
	try {
		const env = await client.put(`system/menu-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchUpdateMenuItemData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchUpdateMenuItemData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchUpdateMenuItem.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchUpdateMenuItem 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type FetchUpdateRoleItemBody = z.input<(typeof schemas)["fetchUpdateRoleItem"]["body"]>;
export type FetchUpdateRoleItemData = z.infer<(typeof schemas)["fetchUpdateRoleItem"]["data"]>;

export async function fetchUpdateRoleItem(body: FetchUpdateRoleItemBody): Promise<FetchUpdateRoleItemData> {
	const client = ensureReq();
	try {
		const env = await client.put(`system/role-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchUpdateRoleItemData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchUpdateRoleItemData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./client.schemas");
			const r = schemas.fetchUpdateRoleItem.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchUpdateRoleItem 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}
