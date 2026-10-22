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
	// 重试不复跑「先同步 set loading 再拉取」的加载函数（effect 内同步 set 触发
	// react/set-state-in-effect），改为事件里置 loading + 递增 nonce 驱动 effect 重跑。
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let active = true;
		client
			.index()
			.then(data => active && setState({ status: "ok", data }))
			.catch(e => active && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
		return () => {
			active = false;
		};
	}, [client, nonce]);

	const retry = useCallback(() => {
		setState({ status: "loading" });
		setNonce(n => n + 1);
	}, []);

	return { ...state, retry };
}

/** 任务轮询：给定 task_id，800ms 轮询至终态（done/failed/partial）；超时不抛，返回当前值 */
export function useInstallTask(taskId: string | null): {
	record: TaskRecord | null
	done: boolean
} {
	const client = useMarketClient();
	const [record, setRecord] = useState<TaskRecord | null>(null);
	const [done, setDone] = useState(false);

	// 无任务 id / 切换任务 = 尚无任务：清空上一次任务的记录，避免「重新安装/信任后重试」时
	// 旧终态（可能是 needs_trust）残留在弹窗里被误读成本次结果。
	// （渲染期同步派生重置，替代 effect 内同步 set，规避 react/set-state-in-effect）
	const [prevTaskId, setPrevTaskId] = useState(taskId);
	if (prevTaskId !== taskId) {
		setPrevTaskId(taskId);
		setRecord(null);
		setDone(false);
	}

	useEffect(() => {
		if (!taskId)
			return;
		let active = true;
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
	// 同 useMarketIndex：重试走 nonce 驱动，不在 effect 链路里同步 set
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let active = true;
		client
			.history()
			.then(data => active && setState({ status: "ok", data }))
			.catch(e => active && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
		return () => {
			active = false;
		};
	}, [client, nonce]);

	const retry = useCallback(() => {
		setState({ status: "loading" });
		setNonce(n => n + 1);
	}, []);

	return { ...state, retry };
}
