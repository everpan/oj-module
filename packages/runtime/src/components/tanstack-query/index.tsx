import type { ReactNode } from "react";

import {
	MutationCache,
	QueryCache,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

/**
 * 请求层 {@link handleErrorResponse} 已对 HTTP 错误体弹 toast，此处只兜底
 * 「请求层未触达」的失败（网络中断 / 解析异常 / 非响应错误），避免重复弹窗。
 */
function isHttpError(error: unknown): boolean {
	const maybe = error as { response?: { status?: unknown } } | null;
	return Boolean(maybe?.response && typeof maybe.response.status === "number");
}

function surfaceQueryError(error: unknown): void {
	if (isHttpError(error))
		return; // 请求层已弹 toast，避免重复
	const message = error instanceof Error && /fetch|network|timeout/i.test(error.message)
		? "网络异常，请检查网络连接后重试"
		: error instanceof Error
			? error.message
			: "请求失败";
	window.$message?.error(message);
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false, // 窗口聚焦时是否重新获取数据
			refetchOnReconnect: false, // 网络恢复时是否重新获取数据
			retry: 0, // 重试次数
		},
		mutations: {
			retry: 0, // 重试次数
		},
	},
	queryCache: new QueryCache({ onError: surfaceQueryError }),
	mutationCache: new MutationCache({ onError: surfaceQueryError }),
});

export interface TanstackQueryProps {
	children: ReactNode
}

export function TanstackQuery({ children }: TanstackQueryProps) {
	return (
		<QueryClientProvider client={queryClient}>
			<ReactQueryDevtools initialIsOpen={false} />
			{children}
		</QueryClientProvider>
	);
}
