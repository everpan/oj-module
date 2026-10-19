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
export const API_PREFIX = "/_platform";

/** 认领身份前缀（契约 apiPrefix，字面等于模块目录名）：跨模块认领护栏对比基准 */
export const MODULE_PREFIX = "/_platform";

/**
 * 模块 entry 的 onInit 里一行创建（构造即 install）：完成 apiPrefix 登记 +
 * scoped request 绑定，返回绑好前缀的端点函数集合。一模块一 client；
 * 重复构造幂等安全（前缀重复登记同值、request 重绑同值）。
 */
export function create_platformClient(ctx: ModuleContext) {
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
	return { platformContactsGet, platformContactsDetailGet, platformMarketInstallPost, platformMarketInstallCancelPost, platformMarketTaskGet, platformMarketEnablePost, platformMarketMetaGet, platformMarketTrustGet, platformMarketTrustPost, platformMarketTrustKeyPost, platformMarketTrustKeyDelete, platformMarketIndexGet, platformMarketUninstallImpactGet, platformMarketUninstallPost, platformMarketHistoryGet, platformSolutionsRoutesGet, platformSolutionsVerifyPost, platformSolutionsVerifyLastGet };
}

/**
 * @deprecated 请改用 create_platformClient(ctx)——工厂构造即完成
 * 前缀登记 + request 绑定，不会出现「登记了前缀没绑 request」的半接线状态。
 */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req)
		throw new ContractApiError(-1, "[ojm-api] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 create_platformClient(ctx)（或 bindRequest(ctx.utils.request)）。");
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

export async function platformContactsGet(): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/contacts`).json<OjEnvelope<unknown>>();
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

export async function platformContactsDetailGet(): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/contacts/detail`).json<OjEnvelope<unknown>>();
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

export type PlatformMarketInstallPostBody = z.input<(typeof schemas)["platformMarketInstallPost"]["body"]>;
export type PlatformMarketInstallPostData = z.infer<(typeof schemas)["platformMarketInstallPost"]["data"]>;

export async function platformMarketInstallPost(body: PlatformMarketInstallPostBody): Promise<PlatformMarketInstallPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`_platform/market/install`, { json: body }).json<OjEnvelope<PlatformMarketInstallPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketInstallPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketInstallPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketInstallPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketInstallCancelPostBody = z.input<(typeof schemas)["platformMarketInstallCancelPost"]["body"]>;
export type PlatformMarketInstallCancelPostData = z.infer<(typeof schemas)["platformMarketInstallCancelPost"]["data"]>;

export async function platformMarketInstallCancelPost(body: PlatformMarketInstallCancelPostBody): Promise<PlatformMarketInstallCancelPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`_platform/market/install/cancel`, { json: body }).json<OjEnvelope<PlatformMarketInstallCancelPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketInstallCancelPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketInstallCancelPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketInstallCancelPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketTaskGetQuery = z.input<(typeof schemas)["platformMarketTaskGet"]["query"]>;
export type PlatformMarketTaskGetData = z.infer<(typeof schemas)["platformMarketTaskGet"]["data"]>;

export async function platformMarketTaskGet(query: PlatformMarketTaskGetQuery): Promise<PlatformMarketTaskGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/market/task`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<PlatformMarketTaskGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketTaskGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketTaskGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketTaskGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketEnablePostBody = z.input<(typeof schemas)["platformMarketEnablePost"]["body"]>;
export type PlatformMarketEnablePostData = z.infer<(typeof schemas)["platformMarketEnablePost"]["data"]>;

export async function platformMarketEnablePost(body: PlatformMarketEnablePostBody): Promise<PlatformMarketEnablePostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`_platform/market/enable`, { json: body }).json<OjEnvelope<PlatformMarketEnablePostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketEnablePostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketEnablePost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketEnablePost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketMetaGetData = z.infer<(typeof schemas)["platformMarketMetaGet"]["data"]>;

export async function platformMarketMetaGet(): Promise<PlatformMarketMetaGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/market/meta`).json<OjEnvelope<PlatformMarketMetaGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketMetaGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketMetaGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketMetaGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketTrustGetData = z.infer<(typeof schemas)["platformMarketTrustGet"]["data"]>;

export async function platformMarketTrustGet(): Promise<PlatformMarketTrustGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/market/trust`).json<OjEnvelope<PlatformMarketTrustGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketTrustGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketTrustGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketTrustGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketTrustPostBody = z.input<(typeof schemas)["platformMarketTrustPost"]["body"]>;
export type PlatformMarketTrustPostData = z.infer<(typeof schemas)["platformMarketTrustPost"]["data"]>;

export async function platformMarketTrustPost(body: PlatformMarketTrustPostBody): Promise<PlatformMarketTrustPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`_platform/market/trust`, { json: body }).json<OjEnvelope<PlatformMarketTrustPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketTrustPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketTrustPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketTrustPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketTrustKeyPostBody = z.input<(typeof schemas)["platformMarketTrustKeyPost"]["body"]>;
export type PlatformMarketTrustKeyPostData = z.infer<(typeof schemas)["platformMarketTrustKeyPost"]["data"]>;

export async function platformMarketTrustKeyPost(body: PlatformMarketTrustKeyPostBody): Promise<PlatformMarketTrustKeyPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`_platform/market/trust/key`, { json: body }).json<OjEnvelope<PlatformMarketTrustKeyPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketTrustKeyPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketTrustKeyPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketTrustKeyPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketTrustKeyDeleteQuery = z.input<(typeof schemas)["platformMarketTrustKeyDelete"]["query"]>;
export type PlatformMarketTrustKeyDeleteData = z.infer<(typeof schemas)["platformMarketTrustKeyDelete"]["data"]>;

export async function platformMarketTrustKeyDelete(query: PlatformMarketTrustKeyDeleteQuery): Promise<PlatformMarketTrustKeyDeleteData> {
	const client = ensureReq();
	try {
		const env = await client.delete(`_platform/market/trust/key`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<PlatformMarketTrustKeyDeleteData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketTrustKeyDeleteData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketTrustKeyDelete"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketTrustKeyDelete 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketIndexGetData = z.infer<(typeof schemas)["platformMarketIndexGet"]["data"]>;

export async function platformMarketIndexGet(): Promise<PlatformMarketIndexGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/market/index`).json<OjEnvelope<PlatformMarketIndexGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketIndexGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketIndexGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketIndexGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketUninstallImpactGetQuery = z.input<(typeof schemas)["platformMarketUninstallImpactGet"]["query"]>;
export type PlatformMarketUninstallImpactGetData = z.infer<(typeof schemas)["platformMarketUninstallImpactGet"]["data"]>;

export async function platformMarketUninstallImpactGet(query: PlatformMarketUninstallImpactGetQuery): Promise<PlatformMarketUninstallImpactGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/market/uninstall-impact`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<PlatformMarketUninstallImpactGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketUninstallImpactGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketUninstallImpactGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketUninstallImpactGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketUninstallPostBody = z.input<(typeof schemas)["platformMarketUninstallPost"]["body"]>;
export type PlatformMarketUninstallPostData = z.infer<(typeof schemas)["platformMarketUninstallPost"]["data"]>;

export async function platformMarketUninstallPost(body: PlatformMarketUninstallPostBody): Promise<PlatformMarketUninstallPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`_platform/market/uninstall`, { json: body }).json<OjEnvelope<PlatformMarketUninstallPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketUninstallPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketUninstallPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketUninstallPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type PlatformMarketHistoryGetData = z.infer<(typeof schemas)["platformMarketHistoryGet"]["data"]>;

export async function platformMarketHistoryGet(): Promise<PlatformMarketHistoryGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/market/history`).json<OjEnvelope<PlatformMarketHistoryGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as PlatformMarketHistoryGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["platformMarketHistoryGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] platformMarketHistoryGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export async function platformSolutionsRoutesGet(): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/solutions/routes`).json<OjEnvelope<unknown>>();
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

export async function platformSolutionsVerifyPost(): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.post(`_platform/solutions/verify`).json<OjEnvelope<unknown>>();
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

export async function platformSolutionsVerifyLastGet(): Promise<unknown> {
	const client = ensureReq();
	try {
		const env = await client.get(`_platform/solutions/verify/last`).json<OjEnvelope<unknown>>();
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
