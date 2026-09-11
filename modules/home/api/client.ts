import type { ScopedRequestLike } from "@react-antd-module/runtime/contract/errors";

/**
 * home 模块自有接口客户端（由 runtime api/home.ts 模块化而来）。
 *
 * 请求通道：模块入口 onInit 里 `bindRequest(ctx.utils.request)` 绑定
 * scoped request（AC-D8 能力持有者）；接口路径必须在 entry 登记的
 * apiPrefix `/home` 边界内（D11 安全收敛，越界由 scoped 层人话拒绝）。
 * 信封为全站唯一 oj `{code,msg,data}`（AC-D16），HTTP 状态=code，
 * 非 2xx 已由 request 层统一吐司，此处只见成功信封。
 */

/** oj 信封（线格式） */
interface OjEnvelope<T> {
	code: number
	msg?: string
	data?: T
}

let req: ScopedRequestLike | undefined;

/** 模块入口 onInit 里调用：bindRequest(ctx.utils.request) */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req) {
		throw new Error(
			"[home] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 bindRequest(ctx.utils.request)。",
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
