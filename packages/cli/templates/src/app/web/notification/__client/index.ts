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
export const API_PREFIX = "/notification";

/** 认领身份前缀（契约 apiPrefix，字面等于模块目录名）：跨模块认领护栏对比基准 */
export const MODULE_PREFIX = "/notification";

/** 认领方模块（web.config clientOwners 指定）：跨模块认领护栏对比基准 */
export const MODULE_OWNER = "/app";

/**
 * 模块 entry 的 onInit 里一行创建（构造即 install）：完成 apiPrefix 登记 +
 * scoped request 绑定，返回绑好前缀的端点函数集合。一模块一 client；
 * 重复构造幂等安全（前缀重复登记同值、request 重绑同值）。
 */
export function createNotificationClient(ctx: ModuleContext) {
	// 跨模块认领护栏（DEV）：工厂知道自己该属于谁（MODULE_PREFIX = 契约 apiPrefix），
	// ctx 又带 module.name——名实不符说明别的模块在替本模块创建 client，会共享 request
	// 单槽、卸载互相耦合；跨模块需求应由本模块创建后经 provider 暴露。
	// 注意对比基准是 MODULE_PREFIX（目录名）而非 API_PREFIX——D-M8 映射时线上前缀
	// 属于别的命名空间，认领身份仍按目录名。
	if (import.meta.env.DEV && ctx.module.name !== MODULE_OWNER.slice(1)) {
		console.warn(`[ojm-api] 模块 "${ctx.module.name}" 正在认领 ${MODULE_PREFIX} 的 client——跨模块认领会共享 request 单槽、卸载互相耦合；应由 "${MODULE_OWNER.slice(1)}" 模块在自身 onInit 创建，跨模块需求经 provider 暴露。`);
	}
	ctx.register.apiPrefix(API_PREFIX);
	bindRequest(ctx.utils.request);
	return { notificationDelPost, notificationNotificationsGet, notificationNotificationsClearPost, notificationNotificationsReadPost, notificationNotificationsReadAllPost, notificationPushPost, notificationPushBroadcastPost };
}

/**
 * @deprecated 请改用 createNotificationClient(ctx)——工厂构造即完成
 * 前缀登记 + request 绑定，不会出现「登记了前缀没绑 request」的半接线状态。
 */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req)
		throw new ContractApiError(-1, "[ojm-api] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 createNotificationClient(ctx)（或 bindRequest(ctx.utils.request)）。");
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

export type NotificationDelPostBody = z.input<(typeof schemas)["notificationDelPost"]["body"]>;
export type NotificationDelPostData = z.infer<(typeof schemas)["notificationDelPost"]["data"]>;

export async function notificationDelPost(body: NotificationDelPostBody): Promise<NotificationDelPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`notification/del`, { json: body }).json<OjEnvelope<NotificationDelPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as NotificationDelPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["notificationDelPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] notificationDelPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type NotificationNotificationsGetData = z.infer<(typeof schemas)["notificationNotificationsGet"]["data"]>;

export async function notificationNotificationsGet(): Promise<NotificationNotificationsGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`notification/notifications`).json<OjEnvelope<NotificationNotificationsGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as NotificationNotificationsGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["notificationNotificationsGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] notificationNotificationsGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type NotificationNotificationsClearPostBody = z.input<(typeof schemas)["notificationNotificationsClearPost"]["body"]>;
export type NotificationNotificationsClearPostData = z.infer<(typeof schemas)["notificationNotificationsClearPost"]["data"]>;

export async function notificationNotificationsClearPost(body: NotificationNotificationsClearPostBody): Promise<NotificationNotificationsClearPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`notification/notifications/clear`, { json: body }).json<OjEnvelope<NotificationNotificationsClearPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as NotificationNotificationsClearPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["notificationNotificationsClearPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] notificationNotificationsClearPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type NotificationNotificationsReadPostBody = z.input<(typeof schemas)["notificationNotificationsReadPost"]["body"]>;
export type NotificationNotificationsReadPostData = z.infer<(typeof schemas)["notificationNotificationsReadPost"]["data"]>;

export async function notificationNotificationsReadPost(body: NotificationNotificationsReadPostBody): Promise<NotificationNotificationsReadPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`notification/notifications/read`, { json: body }).json<OjEnvelope<NotificationNotificationsReadPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as NotificationNotificationsReadPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["notificationNotificationsReadPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] notificationNotificationsReadPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type NotificationNotificationsReadAllPostBody = z.input<(typeof schemas)["notificationNotificationsReadAllPost"]["body"]>;
export type NotificationNotificationsReadAllPostData = z.infer<(typeof schemas)["notificationNotificationsReadAllPost"]["data"]>;

export async function notificationNotificationsReadAllPost(body: NotificationNotificationsReadAllPostBody): Promise<NotificationNotificationsReadAllPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`notification/notifications/read-all`, { json: body }).json<OjEnvelope<NotificationNotificationsReadAllPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as NotificationNotificationsReadAllPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["notificationNotificationsReadAllPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] notificationNotificationsReadAllPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type NotificationPushPostBody = z.input<(typeof schemas)["notificationPushPost"]["body"]>;
export type NotificationPushPostData = z.infer<(typeof schemas)["notificationPushPost"]["data"]>;

export async function notificationPushPost(body: NotificationPushPostBody): Promise<NotificationPushPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`notification/push`, { json: body }).json<OjEnvelope<NotificationPushPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as NotificationPushPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["notificationPushPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] notificationPushPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type NotificationPushBroadcastPostBody = z.input<(typeof schemas)["notificationPushBroadcastPost"]["body"]>;
export type NotificationPushBroadcastPostData = z.infer<(typeof schemas)["notificationPushBroadcastPost"]["data"]>;

export async function notificationPushBroadcastPost(body: NotificationPushBroadcastPostBody): Promise<NotificationPushBroadcastPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`notification/push-broadcast`, { json: body }).json<OjEnvelope<NotificationPushBroadcastPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as NotificationPushBroadcastPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["notificationPushBroadcastPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] notificationPushBroadcastPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}
