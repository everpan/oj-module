/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
import { ContractApiError } from "@oj-module/runtime/contract/errors";
import type { ScopedRequestLike } from "@oj-module/runtime/contract/errors";
import type { ModuleContext } from "@oj-module/runtime";
import type { z } from "@oj-module/runtime";
import type { schemas } from "./api.schemas";

/** oj 信封（AC-D16）：code=0 成功；非 0 时 HTTP status=code，由 toApiError 归一为 ContractApiError */
interface OjEnvelope<T> { code: number, msg?: string, data?: T }

let req: ScopedRequestLike | undefined;

/** 线上 API 前缀（ojm api 从契约抽取，唯一真源，勿手改）：请求基址 + 前缀登记用 */
export const API_PREFIX = "/system";

/** 认领身份前缀（契约 apiPrefix，字面等于模块目录名）：跨模块认领护栏对比基准 */
export const MODULE_PREFIX = "/system";

/**
 * 模块 entry 的 onInit 里一行创建（构造即 install）：完成 apiPrefix 登记 +
 * scoped request 绑定，返回绑好前缀的端点函数集合。一模块一 client；
 * 重复构造幂等安全（前缀重复登记同值、request 重绑同值）。
 */
export function createSystemClient(ctx: ModuleContext) {
	// 跨模块认领护栏（DEV）：工厂知道自己该属于谁（MODULE_PREFIX = 契约 apiPrefix），
	// ctx 又带 module.name——名实不符说明别的模块在替本模块创建 client，会共享 request
	// 单槽、卸载互相耦合；跨模块需求应由本模块创建后经 provider 暴露。
	// 注意对比基准是 MODULE_PREFIX（目录名）而非 API_PREFIX——D-M8 映射时线上前缀
	// 属于别的命名空间，认领身份仍按目录名。
	if (import.meta.env.DEV && ctx.module.name !== MODULE_PREFIX.slice(1)) {
		console.warn(`[ojm-api] 模块 "${ctx.module.name}" 正在认领 ${MODULE_PREFIX} 的 client——跨模块认领会共享 request 单槽、卸载互相耦合；应由 "${MODULE_PREFIX.slice(1)}" 模块在自身 onInit 创建，跨模块需求经 provider 暴露。`);
	}
	ctx.register.apiPrefix(API_PREFIX);
	bindRequest(ctx.utils.request);
	return { systemLoginMethodsGet, systemOplogGet, systemPermissionsGet, systemRolesGet, systemRolesPost, systemRolesDelete, systemRolesBindingsPut, systemSettingsGet, systemSettingsPut, systemUsersGet, systemUsersPost, systemUsersForbiddenPut, systemUsersPasswordPut, systemUsersRolesPut };
}

/**
 * @deprecated 请改用 createSystemClient(ctx)——工厂构造即完成
 * 前缀登记 + request 绑定，不会出现「登记了前缀没绑 request」的半接线状态。
 */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req)
		throw new ContractApiError(-1, "[ojm-api] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 createSystemClient(ctx)（或 bindRequest(ctx.utils.request)）。");
	return req;
}

/** ky HTTPError → ContractApiError（错误体为信封时取 code/msg）；契约违例与原错误原样透传 */
async function toApiError(e: unknown): Promise<unknown> {
	if (e instanceof ContractApiError)
		return e;
	// ky 2.x 构造 HTTPError 时已用 getReader() 消费掉原 response 体（res.clone().json() 按规范抛 TypeError，
	// 体方法一律失效），解析好的错误体在公开字段 error.data——故读 error.data，勿改回 clone().json()。
	const err = e as { data?: { code?: unknown, msg?: string }, response?: Response } | null;
	const res = err?.response;
	const d = err?.data;
	if (res instanceof Response && d && typeof d.code === "number")
		return new ContractApiError(d.code, d.msg ?? res.statusText);
	return e;
}

export type SystemLoginMethodsGetData = z.infer<(typeof schemas)["systemLoginMethodsGet"]["data"]>;

export async function systemLoginMethodsGet(): Promise<SystemLoginMethodsGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/login-methods`).json<OjEnvelope<SystemLoginMethodsGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as SystemLoginMethodsGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["systemLoginMethodsGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] systemLoginMethodsGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemOplogGetQuery = z.input<(typeof schemas)["systemOplogGet"]["query"]>;
export type SystemOplogGetData = z.infer<(typeof schemas)["systemOplogGet"]["data"]>;

export async function systemOplogGet(query: SystemOplogGetQuery): Promise<SystemOplogGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/oplog`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<SystemOplogGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as SystemOplogGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["systemOplogGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] systemOplogGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemPermissionsGetData = z.infer<(typeof schemas)["systemPermissionsGet"]["data"]>;

export async function systemPermissionsGet(): Promise<SystemPermissionsGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/permissions`).json<OjEnvelope<SystemPermissionsGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as SystemPermissionsGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["systemPermissionsGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] systemPermissionsGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemRolesGetData = z.infer<(typeof schemas)["systemRolesGet"]["data"]>;

export async function systemRolesGet(): Promise<SystemRolesGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/roles`).json<OjEnvelope<SystemRolesGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as SystemRolesGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["systemRolesGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] systemRolesGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemRolesPostBody = z.input<(typeof schemas)["systemRolesPost"]["body"]>;
export type SystemRolesPostData = z.infer<(typeof schemas)["systemRolesPost"]["data"]>;

export async function systemRolesPost(body: SystemRolesPostBody): Promise<SystemRolesPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`system/roles`, { json: body }).json<OjEnvelope<SystemRolesPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as SystemRolesPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["systemRolesPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] systemRolesPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemRolesDeleteQuery = z.input<(typeof schemas)["systemRolesDelete"]["query"]>;

export async function systemRolesDelete(query: SystemRolesDeleteQuery): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.delete(`system/roles`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<unknown>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as unknown;
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemRolesBindingsPutQuery = z.input<(typeof schemas)["systemRolesBindingsPut"]["query"]>;
export type SystemRolesBindingsPutBody = z.input<(typeof schemas)["systemRolesBindingsPut"]["body"]>;

export async function systemRolesBindingsPut(input: { query: SystemRolesBindingsPutQuery, body: SystemRolesBindingsPutBody }): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.put(`system/roles/bindings`, { searchParams: input.query as Record<string, string | number | boolean>, json: input.body }).json<OjEnvelope<unknown>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as unknown;
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemSettingsGetData = z.infer<(typeof schemas)["systemSettingsGet"]["data"]>;

export async function systemSettingsGet(): Promise<SystemSettingsGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/settings`).json<OjEnvelope<SystemSettingsGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as SystemSettingsGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["systemSettingsGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] systemSettingsGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemSettingsPutBody = z.input<(typeof schemas)["systemSettingsPut"]["body"]>;

export async function systemSettingsPut(body: SystemSettingsPutBody): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.put(`system/settings`, { json: body }).json<OjEnvelope<unknown>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as unknown;
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemUsersGetData = z.infer<(typeof schemas)["systemUsersGet"]["data"]>;

export async function systemUsersGet(): Promise<SystemUsersGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`system/users`).json<OjEnvelope<SystemUsersGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as SystemUsersGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["systemUsersGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] systemUsersGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemUsersPostBody = z.input<(typeof schemas)["systemUsersPost"]["body"]>;
export type SystemUsersPostData = z.infer<(typeof schemas)["systemUsersPost"]["data"]>;

export async function systemUsersPost(body: SystemUsersPostBody): Promise<SystemUsersPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`system/users`, { json: body }).json<OjEnvelope<SystemUsersPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as SystemUsersPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["systemUsersPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] systemUsersPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemUsersForbiddenPutQuery = z.input<(typeof schemas)["systemUsersForbiddenPut"]["query"]>;
export type SystemUsersForbiddenPutBody = z.input<(typeof schemas)["systemUsersForbiddenPut"]["body"]>;

export async function systemUsersForbiddenPut(input: { query: SystemUsersForbiddenPutQuery, body: SystemUsersForbiddenPutBody }): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.put(`system/users/forbidden`, { searchParams: input.query as Record<string, string | number | boolean>, json: input.body }).json<OjEnvelope<unknown>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as unknown;
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemUsersPasswordPutQuery = z.input<(typeof schemas)["systemUsersPasswordPut"]["query"]>;
export type SystemUsersPasswordPutBody = z.input<(typeof schemas)["systemUsersPasswordPut"]["body"]>;

export async function systemUsersPasswordPut(input: { query: SystemUsersPasswordPutQuery, body: SystemUsersPasswordPutBody }): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.put(`system/users/password`, { searchParams: input.query as Record<string, string | number | boolean>, json: input.body }).json<OjEnvelope<unknown>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as unknown;
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type SystemUsersRolesPutQuery = z.input<(typeof schemas)["systemUsersRolesPut"]["query"]>;
export type SystemUsersRolesPutBody = z.input<(typeof schemas)["systemUsersRolesPut"]["body"]>;

export async function systemUsersRolesPut(input: { query: SystemUsersRolesPutQuery, body: SystemUsersRolesPutBody }): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.put(`system/users/roles`, { searchParams: input.query as Record<string, string | number | boolean>, json: input.body }).json<OjEnvelope<unknown>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as unknown;
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}
