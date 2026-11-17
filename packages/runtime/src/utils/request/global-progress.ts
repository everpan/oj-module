import { useGlobalStore } from "#src/store/global";

// 定义一个全局变量用于追踪当前有多少请求正在进行中
let requestCount = 0;

/**
 * 已归还计数的请求（以 ky 的 normalized options 对象为键）。
 *
 * 为什么需要：ky 对「有响应」的失败（4xx/5xx）会先跑 afterResponse、再因
 * throwHttpErrors 跑 beforeError；对「无响应」的失败（网络错/超时/abort）只跑
 * beforeError。计数在 beforeRequest 里 +1，必须在两个出口之一 -1 且只 -1 一次，
 * 否则要么泄漏（蒙版永久转圈），要么多减（并发下提前关蒙版）。options 是 ky 对
 * 单个请求缓存且冻结的对象，跨钩子身份稳定，是天然的幂等键。
 */
const settledOptions = new WeakSet<object>();

export const globalProgress = {
	/**
	 * 启动请求
	 *
	 * 如果请求计数为 0，则显示全局加载动画，并将请求计数加 1。
	 */
	start() {
		if (requestCount === 0) {
			// 显示全局加载动画
			useGlobalStore.getState().openGlobalSpin();
		}
		// 请求计数加 1
		requestCount++;
	},

	/**
	 * 请求完成后的回调函数
	 *
	 * @description 将请求计数减 1，并保证请求计数不会小于 0；
	 *              如果请求计数为 0，则隐藏全局加载动画。
	 *              传入 ky normalized options 作幂等键：同一请求只归还一次计数
	 *              （HTTP 错误会先 afterResponse 再 beforeError，二者都会调 done）。
	 */
	done(options?: object) {
		if (options) {
			if (settledOptions.has(options))
				return;
			settledOptions.add(options);
		}
		// 请求计数减 1，但保证请求计数不会小于 0
		requestCount = Math.max(requestCount - 1, 0);
		if (requestCount === 0) {
			// 隐藏全局加载动画
			useGlobalStore.getState().closeGlobalSpin();
		}
	},

	/**
	 * 强制完成请求
	 *
	 * 将请求计数直接设置为0，并隐藏全局加载动画
	 */
	forceFinish() {
		// 直接将请求计数设置为 0
		requestCount = 0;
		// 隐藏全局加载动画
		useGlobalStore.getState().closeGlobalSpin();
	},
};
