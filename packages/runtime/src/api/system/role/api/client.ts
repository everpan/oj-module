/* eslint-disable */
// 生成物：ram api 从契约生成，勿手改（改动请改契约文件后重跑 ram api）
import { ContractApiError } from "@react-antd-module/runtime/contract/errors";
import type { ScopedRequestLike } from "@react-antd-module/runtime/contract/errors";
import { request } from "#src/utils/request";
import type { z } from "zod";
import type { schemas } from "./client.schemas";

/** oj 信封（AC-D16）：code=0 成功；非 0 时 HTTP status=code，由 toApiError 归一为 ContractApiError */
interface OjEnvelope<T> { code: number, msg?: string, data?: T }

function ensureReq(): ScopedRequestLike {
	return request;
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

export type FetchAddRoleItemBody = z.input<(typeof schemas)["fetchAddRoleItem"]["body"]>;
export type FetchAddRoleItemData = z.infer<(typeof schemas)["fetchAddRoleItem"]["data"]>;

export async function fetchAddRoleItem(body: FetchAddRoleItemBody): Promise<FetchAddRoleItemData> {
	const client = ensureReq();
	try {
		const env = await client.post(`role-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchAddRoleItemData>>();
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

export type FetchDeleteRoleItemBody = z.input<(typeof schemas)["fetchDeleteRoleItem"]["body"]>;
export type FetchDeleteRoleItemData = z.infer<(typeof schemas)["fetchDeleteRoleItem"]["data"]>;

export async function fetchDeleteRoleItem(body: FetchDeleteRoleItemBody): Promise<FetchDeleteRoleItemData> {
	const client = ensureReq();
	try {
		const env = await client.delete(`role-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchDeleteRoleItemData>>();
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
		const env = await client.get(`menu-by-role-id`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<FetchMenuByRoleIdData>>();
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

export type FetchRoleListQuery = z.input<(typeof schemas)["fetchRoleList"]["query"]>;
export type FetchRoleListData = z.infer<(typeof schemas)["fetchRoleList"]["data"]>;

export async function fetchRoleList(query: FetchRoleListQuery): Promise<FetchRoleListData> {
	const client = ensureReq();
	try {
		const env = await client.get(`role-list`, { searchParams: query as Record<string, string | number | boolean>, ignoreLoading: true }).json<OjEnvelope<FetchRoleListData>>();
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
		const env = await client.get(`role-menu`, { ignoreLoading: true }).json<OjEnvelope<FetchRoleMenuData>>();
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

export type FetchUpdateRoleItemBody = z.input<(typeof schemas)["fetchUpdateRoleItem"]["body"]>;
export type FetchUpdateRoleItemData = z.infer<(typeof schemas)["fetchUpdateRoleItem"]["data"]>;

export async function fetchUpdateRoleItem(body: FetchUpdateRoleItemBody): Promise<FetchUpdateRoleItemData> {
	const client = ensureReq();
	try {
		const env = await client.put(`role-item`, { json: body, ignoreLoading: true }).json<OjEnvelope<FetchUpdateRoleItemData>>();
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
