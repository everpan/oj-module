// 统一异常出口（handler 层编排约定）：
// service / 守卫层抛 Error & { status?, ...extra }（见 service/roles.ts fail()），
// 但 oj 运行时对未捕获异常一律落 500 信封（不读 err.status）——
// 所有 handler 的业务体必须经 respond 收口成 json.fail(status, msg, extra)，
// 否则 D14 统一 401 / B5 429 retryAfterMs / 403 must_change / 409 holders 全被抹成 500。
/** 异常 → fail 信封。redirect / 流式等「不能先 ok 再 fail」的出口也直接复用它。 */
export function failWith(e: unknown): void {
	const err = e as Error & { status?: number } & Record<string, unknown>;
	const data = Object.fromEntries(Object.entries(err).filter(([k]) => k !== "status" && k !== "message"));
	if (Object.keys(data).length > 0)
		json.fail(err.status ?? 500, err.message, data);
	else
		json.fail(err.status ?? 500, err.message);
}

export async function respond<T>(fn: () => Promise<T>): Promise<void> {
	try {
		json.ok(await fn());
	}
	catch (e) {
		failWith(e);
	}
}
