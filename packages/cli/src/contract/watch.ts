import type { RunResult } from "./run";
import { runApi } from "./run";

/**
 * AC-D7 watch 集成：契约变更 → 去抖合并 → runApi 重生成。
 *
 * 产物落 web 树后由既有模块 watch 捕获 → 重建 + SSE 刷新（复用不新造）。
 * 失败不崩 dev server：错误收敛到 onError（[ojm-api] 前缀人话）。
 * runApi 进行中再来变更记 pending，收尾后补跑一次——不丢变更。
 */

export interface ContractRegenOptions {
	debounceMs?: number
	/** 注入 run 实现（测试用）；缺省真实 runApi */
	run?: (opts: { cwd: string }) => Promise<RunResult>
	onRegenerated?: (result: RunResult) => void
	onError?: (error: unknown) => void
}

export function createContractRegen(cwd: string, opts: ContractRegenOptions = {}): () => void {
	const debounceMs = opts.debounceMs ?? 100;
	const run = opts.run ?? runApi;
	const onError = opts.onError ?? ((e: unknown) => {
		console.error(`[ojm-api] 契约重生成失败：${e instanceof Error ? e.message : String(e)}`);
	});
	const onRegenerated = opts.onRegenerated ?? ((result: RunResult) => {
		if (result.written.length > 0)
			console.log(`[ojm-api] 契约产物已更新 ${result.written.length} 个文件——模块重建将自动触发。`);
	});

	let timer: NodeJS.Timeout | null = null;
	let running = false;
	let pending = false;

	const fire = async () => {
		running = true;
		try {
			onRegenerated(await run({ cwd }));
		}
		catch (e) {
			onError(e);
		}
		finally {
			running = false;
			if (pending) {
				pending = false;
				schedule();
			}
		}
	};

	// 函数声明提升：fire 的 finally 里可前向引用
	function schedule() {
		if (timer)
			clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			if (running) {
				pending = true;
				return;
			}
			void fire();
		}, debounceMs);
	}

	return schedule;
}
