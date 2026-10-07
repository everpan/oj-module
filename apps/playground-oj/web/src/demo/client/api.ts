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
export const API_PREFIX = "/demo";

/** 认领身份前缀（契约 apiPrefix，字面等于模块目录名）：跨模块认领护栏对比基准 */
export const MODULE_PREFIX = "/demo";

/**
 * 模块 entry 的 onInit 里一行创建（构造即 install）：完成 apiPrefix 登记 +
 * scoped request 绑定，返回绑好前缀的端点函数集合。一模块一 client；
 * 重复构造幂等安全（前缀重复登记同值、request 重绑同值）。
 */
export function createDemoClient(ctx: ModuleContext) {
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
	return { getTodoList };
}

/**
 * @deprecated 请改用 createDemoClient(ctx)——工厂构造即完成
 * 前缀登记 + request 绑定，不会出现「登记了前缀没绑 request」的半接线状态。
 */
export function bindRequest(r: ScopedRequestLike): void {
	req = r;
}

function ensureReq(): ScopedRequestLike {
	if (!req)
		throw new ContractApiError(-1, "[ojm-api] 请求未绑定——请在模块 entry.ts 的 onInit 里调用 createDemoClient(ctx)（或 bindRequest(ctx.utils.request)）。");
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

export type GetTodoListQuery = z.input<(typeof schemas)["getTodoList"]["query"]>;
export type GetTodoListData = z.infer<(typeof schemas)["getTodoList"]["data"]>;

export async function getTodoList(query: GetTodoListQuery): Promise<GetTodoListData> {
	const client = ensureReq();
	try {
		const env = await client.get(`demo/todos`, { searchParams: query as Record<string, string | number | boolean> }).json<OjEnvelope<GetTodoListData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as GetTodoListData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas.getTodoList.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] getTodoList 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}
