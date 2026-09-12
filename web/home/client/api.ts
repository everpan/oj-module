import type { ModuleContext } from "@oj-module/runtime";
import type { ScopedRequestLike } from "@oj-module/runtime/contract/errors";

/**
 * home 模块自有接口客户端（由 runtime api/home.ts 模块化而来；本文件为手写
 * 同规 client，与 ojm api 生成物同形状：API_PREFIX 唯一真源 + 工厂构造即接线）。
 *
 * 请求通道：模块 entry onInit 里 `createHomeClient(ctx)` 一行完成——登记
 * API_PREFIX 前缀 + 绑定 scoped request（AC-D8 能力持有者）；接口路径必须
 * 在 API_PREFIX 边界内（D11 安全收敛，越界由 scoped 层人话拒绝）。
 * 信封为全站唯一 oj `{code,msg,data}`（AC-D16），HTTP 状态=code，
 * 非 2xx 已由 request 层统一吐司，此处只见成功信封。
 */

/** oj 信封（线格式） */
interface OjEnvelope<T> {
	code: number
	msg?: string
	data?: T
}

/** 本模块 API 前缀（唯一真源，勿手改） */
export const API_PREFIX = "/home";

let req: ScopedRequestLike | undefined;

/**
 * 模块 entry 的 onInit 里一行创建（构造即 install）：完成 apiPrefix 登记 +
 * scoped request 绑定，返回绑好前缀的端点函数集合。一模块一 client；
 * 重复构造幂等安全（前缀重复登记同值、request 重绑同值）。
 */
export function createHomeClient(ctx: ModuleContext) {
	ctx.register.apiPrefix(API_PREFIX);
	bindRequest(ctx.utils.request);
	return { fetchPie, fetchLine };
}

/**
 * @deprecated 请改用 createHomeClient(ctx)——工厂构造即完成前缀登记 +
 * request 绑定，不会出现「登记了前缀没绑 request」的半接线状态。
 */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req) {
		throw new Error(
			"[home] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 createHomeClient(ctx)（或 bindRequest(ctx.utils.request)）。",
		);
	}
	return req;
}

export interface PieDataType {
	value: number
	code: string
}

export function fetchPie(data: { by: string | number }): Promise<PieDataType[]> {
	return ensureReq()
		.get("home/pie", { searchParams: data })
		.json<OjEnvelope<PieDataType[]>>()
		.then(env => env.data ?? []);
}

export function fetchLine(data: { range: string }): Promise<number[]> {
	return ensureReq()
		.post("home/line", { json: data })
		.json<OjEnvelope<number[]>>()
		.then(env => env.data ?? []);
}
