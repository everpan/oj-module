/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
import { ContractApiError } from "@oj-module/runtime/contract/errors";
import type { ScopedRequestLike } from "@oj-module/runtime/contract/errors";
import type { z } from "@oj-module/runtime";
import type { schemas } from "./api.schemas";

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

export type FetchNotificationsData = z.infer<(typeof schemas)["fetchNotifications"]["data"]>;

export async function fetchNotifications(): Promise<FetchNotificationsData> {
	const client = ensureReq();
	try {
		const env = await client.get(`notification/notifications`).json<OjEnvelope<FetchNotificationsData>>();
		// 2xx + code!==0 也是业务错误（§6.2 通道 a）：oj 不会这么发，但契约机制的价值恰是防漂移
		if (typeof env.code === "number" && env.code !== 0)
			throw new ContractApiError(env.code, env.msg ?? "业务错误（信封 code 非 0）");
		const data = env.data as FetchNotificationsData;
		if (import.meta.env.DEV) {
			const { schemas } = await import("./api.schemas");
			const r = schemas.fetchNotifications.data.safeParse(data);
			if (!r.success)
				throw new ContractApiError(-1, `[契约违例] fetchNotifications 响应与契约不符：${r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
		}
		return data;
	}
	catch (e) {
		throw await toApiError(e);
	}
}
