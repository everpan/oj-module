// 通用轮询工具（§10.2：市场任务 800ms 轮询、退避上限 5s、超时 30min 由调用方配置）。
// 纯函数、无副作用、可独立单测。

export interface PollOptions {
	/** 轮询间隔（默认 800ms） */
	intervalMs?: number
	/** 整体超时（默认 30min） */
	timeoutMs?: number
	/** 中断信号 */
	signal?: AbortSignal
}

/**
 * 反复执行 fn，直到 isDone(value) 为真或超时。
 * 超时返回最近一次取值（由调用方标记超时态），不抛错——避免轮询中断业务。
 */
export async function poll<T>(
	fn: () => Promise<T>,
	isDone: (value: T) => boolean,
	opts: PollOptions = {},
): Promise<T> {
	const interval = opts.intervalMs ?? 800;
	const timeout = opts.timeoutMs ?? 30 * 60 * 1000;
	const start = Date.now();
	// 轮询循环：每轮先取最新值，终态即返回，超时则返回当前值
	for (;;) {
		if (opts.signal?.aborted)
			throw new DOMException("aborted", "AbortError");
		const value = await fn();
		if (isDone(value))
			return value;
		if (Date.now() - start > timeout)
			return value;
		await new Promise<void>(resolve => setTimeout(resolve, interval));
	}
}
