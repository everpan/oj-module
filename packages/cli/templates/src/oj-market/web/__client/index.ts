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
export const API_PREFIX = "/oj-market";

/** 认领身份前缀（契约 apiPrefix，字面等于模块目录名）：跨模块认领护栏对比基准 */
export const MODULE_PREFIX = "/oj-market";

/**
 * 模块 entry 的 onInit 里一行创建（构造即 install）：完成 apiPrefix 登记 +
 * scoped request 绑定，返回绑好前缀的端点函数集合。一模块一 client；
 * 重复构造幂等安全（前缀重复登记同值、request 重绑同值）。
 */
export function createOjMarketClient(ctx: ModuleContext) {
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
	return { ojMarketInstallPost, ojMarketInstallCancelPost, ojMarketTaskGet, ojMarketEnablePost, ojMarketMetaGet, ojMarketTrustGet, ojMarketTrustPost, ojMarketTrustKeyPost, ojMarketTrustKeyDelete, ojMarketIndexGet, ojMarketCatalogGet, ojMarketCatalogDetailGet, ojMarketYankPost, ojMarketUninstallImpactGet, ojMarketUninstallPost, ojMarketHistoryGet, ojMarketReleasesGet, ojMarketCdnUploadPost };
}

/**
 * @deprecated 请改用 createOjMarketClient(ctx)——工厂构造即完成
 * 前缀登记 + request 绑定，不会出现「登记了前缀没绑 request」的半接线状态。
 */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req)
		throw new ContractApiError(-1, "[ojm-api] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 createOjMarketClient(ctx)（或 bindRequest(ctx.utils.request)）。");
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

export type OjMarketInstallPostBody = z.input<(typeof schemas)["ojMarketInstallPost"]["body"]>;
export type OjMarketInstallPostData = z.infer<(typeof schemas)["ojMarketInstallPost"]["data"]>;

export async function ojMarketInstallPost(body: OjMarketInstallPostBody): Promise<OjMarketInstallPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`oj-market/install`, { json: body }).json<OjEnvelope<OjMarketInstallPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketInstallPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketInstallPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketInstallPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketInstallCancelPostBody = z.input<(typeof schemas)["ojMarketInstallCancelPost"]["body"]>;
export type OjMarketInstallCancelPostData = z.infer<(typeof schemas)["ojMarketInstallCancelPost"]["data"]>;

export async function ojMarketInstallCancelPost(body: OjMarketInstallCancelPostBody): Promise<OjMarketInstallCancelPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`oj-market/install/cancel`, { json: body }).json<OjEnvelope<OjMarketInstallCancelPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketInstallCancelPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketInstallCancelPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketInstallCancelPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketTaskGetQuery = z.input<(typeof schemas)["ojMarketTaskGet"]["query"]>;
export type OjMarketTaskGetData = z.infer<(typeof schemas)["ojMarketTaskGet"]["data"]>;

export async function ojMarketTaskGet(query: OjMarketTaskGetQuery): Promise<OjMarketTaskGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/task`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<OjMarketTaskGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketTaskGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketTaskGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketTaskGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketEnablePostBody = z.input<(typeof schemas)["ojMarketEnablePost"]["body"]>;
export type OjMarketEnablePostData = z.infer<(typeof schemas)["ojMarketEnablePost"]["data"]>;

export async function ojMarketEnablePost(body: OjMarketEnablePostBody): Promise<OjMarketEnablePostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`oj-market/enable`, { json: body }).json<OjEnvelope<OjMarketEnablePostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketEnablePostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketEnablePost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketEnablePost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketMetaGetData = z.infer<(typeof schemas)["ojMarketMetaGet"]["data"]>;

export async function ojMarketMetaGet(): Promise<OjMarketMetaGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/meta`).json<OjEnvelope<OjMarketMetaGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketMetaGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketMetaGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketMetaGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketTrustGetData = z.infer<(typeof schemas)["ojMarketTrustGet"]["data"]>;

export async function ojMarketTrustGet(): Promise<OjMarketTrustGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/trust`).json<OjEnvelope<OjMarketTrustGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketTrustGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketTrustGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketTrustGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketTrustPostBody = z.input<(typeof schemas)["ojMarketTrustPost"]["body"]>;
export type OjMarketTrustPostData = z.infer<(typeof schemas)["ojMarketTrustPost"]["data"]>;

export async function ojMarketTrustPost(body: OjMarketTrustPostBody): Promise<OjMarketTrustPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`oj-market/trust`, { json: body }).json<OjEnvelope<OjMarketTrustPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketTrustPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketTrustPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketTrustPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketTrustKeyPostBody = z.input<(typeof schemas)["ojMarketTrustKeyPost"]["body"]>;
export type OjMarketTrustKeyPostData = z.infer<(typeof schemas)["ojMarketTrustKeyPost"]["data"]>;

export async function ojMarketTrustKeyPost(body: OjMarketTrustKeyPostBody): Promise<OjMarketTrustKeyPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`oj-market/trust/key`, { json: body }).json<OjEnvelope<OjMarketTrustKeyPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketTrustKeyPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketTrustKeyPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketTrustKeyPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketTrustKeyDeleteQuery = z.input<(typeof schemas)["ojMarketTrustKeyDelete"]["query"]>;
export type OjMarketTrustKeyDeleteData = z.infer<(typeof schemas)["ojMarketTrustKeyDelete"]["data"]>;

export async function ojMarketTrustKeyDelete(query: OjMarketTrustKeyDeleteQuery): Promise<OjMarketTrustKeyDeleteData> {
	const client = ensureReq();
	try {
		const env = await client.delete(`oj-market/trust/key`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<OjMarketTrustKeyDeleteData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketTrustKeyDeleteData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketTrustKeyDelete"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketTrustKeyDelete 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketIndexGetData = z.infer<(typeof schemas)["ojMarketIndexGet"]["data"]>;

export async function ojMarketIndexGet(): Promise<OjMarketIndexGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/index`).json<OjEnvelope<OjMarketIndexGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketIndexGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketIndexGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketIndexGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketCatalogGetQuery = z.input<(typeof schemas)["ojMarketCatalogGet"]["query"]>;
export type OjMarketCatalogGetData = z.infer<(typeof schemas)["ojMarketCatalogGet"]["data"]>;

export async function ojMarketCatalogGet(query: OjMarketCatalogGetQuery): Promise<OjMarketCatalogGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/catalog`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<OjMarketCatalogGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketCatalogGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketCatalogGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketCatalogGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketCatalogDetailGetQuery = z.input<(typeof schemas)["ojMarketCatalogDetailGet"]["query"]>;
export type OjMarketCatalogDetailGetData = z.infer<(typeof schemas)["ojMarketCatalogDetailGet"]["data"]>;

export async function ojMarketCatalogDetailGet(query: OjMarketCatalogDetailGetQuery): Promise<OjMarketCatalogDetailGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/catalog/detail`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<OjMarketCatalogDetailGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketCatalogDetailGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketCatalogDetailGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketCatalogDetailGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketYankPostBody = z.input<(typeof schemas)["ojMarketYankPost"]["body"]>;
export type OjMarketYankPostData = z.infer<(typeof schemas)["ojMarketYankPost"]["data"]>;

export async function ojMarketYankPost(body: OjMarketYankPostBody): Promise<OjMarketYankPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`oj-market/yank`, { json: body }).json<OjEnvelope<OjMarketYankPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketYankPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketYankPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketYankPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketUninstallImpactGetQuery = z.input<(typeof schemas)["ojMarketUninstallImpactGet"]["query"]>;
export type OjMarketUninstallImpactGetData = z.infer<(typeof schemas)["ojMarketUninstallImpactGet"]["data"]>;

export async function ojMarketUninstallImpactGet(query: OjMarketUninstallImpactGetQuery): Promise<OjMarketUninstallImpactGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/uninstall-impact`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<OjMarketUninstallImpactGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketUninstallImpactGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketUninstallImpactGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketUninstallImpactGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketUninstallPostBody = z.input<(typeof schemas)["ojMarketUninstallPost"]["body"]>;
export type OjMarketUninstallPostData = z.infer<(typeof schemas)["ojMarketUninstallPost"]["data"]>;

export async function ojMarketUninstallPost(body: OjMarketUninstallPostBody): Promise<OjMarketUninstallPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`oj-market/uninstall`, { json: body }).json<OjEnvelope<OjMarketUninstallPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketUninstallPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketUninstallPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketUninstallPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketHistoryGetData = z.infer<(typeof schemas)["ojMarketHistoryGet"]["data"]>;

export async function ojMarketHistoryGet(): Promise<OjMarketHistoryGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/history`).json<OjEnvelope<OjMarketHistoryGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketHistoryGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketHistoryGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketHistoryGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketReleasesGetQuery = z.input<(typeof schemas)["ojMarketReleasesGet"]["query"]>;
export type OjMarketReleasesGetData = z.infer<(typeof schemas)["ojMarketReleasesGet"]["data"]>;

export async function ojMarketReleasesGet(query: OjMarketReleasesGetQuery): Promise<OjMarketReleasesGetData> {
	const client = ensureReq();
	try {
		const env = await client.get(`oj-market/releases`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<OjMarketReleasesGetData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketReleasesGetData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketReleasesGet"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketReleasesGet 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}

export type OjMarketCdnUploadPostQuery = z.input<(typeof schemas)["ojMarketCdnUploadPost"]["query"]>;
export type OjMarketCdnUploadPostData = z.infer<(typeof schemas)["ojMarketCdnUploadPost"]["data"]>;

export async function ojMarketCdnUploadPost(query: OjMarketCdnUploadPostQuery): Promise<OjMarketCdnUploadPostData> {
	const client = ensureReq();
	try {
		const env = await client.post(`oj-market/cdn/upload`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<OjMarketCdnUploadPostData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as OjMarketCdnUploadPostData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas["ojMarketCdnUploadPost"].data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] ojMarketCdnUploadPost 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}
