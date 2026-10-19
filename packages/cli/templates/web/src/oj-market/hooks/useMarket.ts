import type { IndexRow, MarketHistory, TaskRecord } from "../types";
import { useCallback, useEffect, useState } from "react";
import { useMarketClient } from "../api/context";
import { poll } from "../utils/poll";

/** 加载态三态（空态/加载/错误）统一建模，便于组件 DRY 渲染 */
// 注：TS 6 收紧联合类型属性访问——属性须出现在所有成员上方可通过 .data 访问，
// 故非 ok 变体也声明 data?: undefined（ok 变体 data: T，访问结果为 T | undefined）。
export type LoadState<T> = { status: "loading", data?: undefined } | { status: "ok", data: T } | { status: "error", error: string, data?: undefined };

/** 卡片索引加载（含重试）；消费 GET /_platform/market/index */
export function useMarketIndex(): LoadState<IndexRow[]> & { retry: () => void } {
	const client = useMarketClient();
	const [state, setState] = useState<LoadState<IndexRow[]>>({ status: "loading" });

	const load = useCallback(() => {
		let active = true;
		setState({ status: "loading" });
		client
			.index()
			.then(data => active && setState({ status: "ok", data }))
			.catch(e => active && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
		return () => {
			active = false;
		};
	}, [client]);

	useEffect(() => load(), [load]);

	return { ...state, retry: load };
}

/** 任务轮询：给定 task_id，800ms 轮询至终态（done/failed/partial）；超时不抛，返回当前值 */
export function useInstallTask(taskId: string | null): {
	record: TaskRecord | null
	done: boolean
} {
	const client = useMarketClient();
	const [record, setRecord] = useState<TaskRecord | null>(null);
	const [done, setDone] = useState(false);

	useEffect(() => {
		if (!taskId)
			return;
		let active = true;
		setRecord(null);
		setDone(false);
		poll(
			() => client.task(taskId),
			r => r.status !== "running",
			{ intervalMs: 800, timeoutMs: 30 * 60 * 1000 },
		)
			.then(rec => active && setRecord(rec))
			.catch(e => active && setRecord({
				id: taskId,
				name: "",
				version: "",
				status: "failed",
				stage: null,
				progress: 0,
				message: e instanceof Error ? e.message : String(e),
				stages: [],
				startedAt: 0,
			}))
			.finally(() => active && setDone(true));
		return () => {
			active = false;
		};
	}, [client, taskId]);

	return { record, done };
}

/** 市场操作历史加载（只读消费本仓端点） */
export function useMarketHistory(): LoadState<MarketHistory[]> & { retry: () => void } {
	const client = useMarketClient();
	const [state, setState] = useState<LoadState<MarketHistory[]>>({ status: "loading" });

	const load = useCallback(() => {
		let active = true;
		setState({ status: "loading" });
		client
			.history()
			.then(data => active && setState({ status: "ok", data }))
			.catch(e => active && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
		return () => {
			active = false;
		};
	}, [client]);

	useEffect(() => load(), [load]);

	return { ...state, retry: load };
}
