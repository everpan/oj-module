// 回归：企微 API 客户端在「服务端 isolate」下的超时与崩溃防护。
//
// 真实 oj 服务端 isolate 没有 `AbortSignal` 全局，也没有 `setTimeout`
// （oj-api-dev global.d.ts：「本运行时无 timer 全局，setTimeout 不可用」）。
// 旧实现 `fetch(url, { signal: AbortSignal.timeout(ms) })` 会直接 ReferenceError
// → 所有企微调用（换 token / 生成开通链接 / 登录）一律 502。
// 这里在测试里**模拟**该 isolate（删掉 AbortSignal、tasks 视情况），断言：
//   1. 无 AbortSignal 时调用照常工作（不抛 `AbortSignal is not defined`）；
//   2. 不再把 `signal` 传给 fetch（旧 bug 的根）；
//   3. tasks.sleep 存在 → 慢请求被软超时拦截并抛「超时」文案；
//   4. tasks 缺失 → 安全降级为「不超时」，快速请求正常返回；
//   5. 软超时只按短步长 sleep（企微工作台 5-6s 白屏回归）——早期实现挂一条
//      sleep(5000) 做竞态，上游秒回时那条 sleep 仍在飞，oj 运行时要等请求上下文里
//      所有异步任务结束才 flush 响应，于是每个调企微接口的请求都被白拖到 5s。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeHttp } from "../src/app/api/auth/_shared/wecom/client";

const g = globalThis as any;

let savedAbortSignal: unknown;
let savedTasks: unknown;
let savedFetch: unknown;

beforeEach(() => {
	savedAbortSignal = (globalThis as { AbortSignal?: unknown }).AbortSignal;
	savedTasks = g.tasks;
	savedFetch = g.fetch;
});

afterEach(() => {
	vi.restoreAllMocks();
	Object.defineProperty(globalThis, "AbortSignal", { value: savedAbortSignal, configurable: true, writable: true });
	g.tasks = savedTasks;
	g.fetch = savedFetch;
});

describe("wecom client：无 AbortSignal 的 isolate 不崩（回归）", () => {
	it("abortSignal 被删掉时，getJson/postJson 仍能调用企微接口", async () => {
		// 模拟服务端 isolate：把 AbortSignal 强制为 undefined（兼覆盖「整类不存在」与「.timeout 缺失」两种形态）
		Object.defineProperty(globalThis, "AbortSignal", { value: undefined, configurable: true, writable: true });
		g.tasks = undefined;

		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ errcode: 0, suite_access_token: "TOK", expires_in: 7200 }),
		}));
		g.fetch = fetchMock;

		const http = runtimeHttp();
		const data = await http.postJson("https://qyapi.weixin.qq.com/cgi-bin/service/get_suite_token", { a: 1 });
		expect(data.errcode).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("不再把 signal 传给 fetch（旧实现传 AbortSignal.timeout 的结果）", async () => {
		Object.defineProperty(globalThis, "AbortSignal", { value: undefined, configurable: true, writable: true });
		g.tasks = undefined;

		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 0 }) }));
		g.fetch = fetchMock;

		await runtimeHttp().getJson("https://qyapi.weixin.qq.com/x");
		const [, init] = fetchMock.mock.calls[0];
		expect(init.signal).toBeUndefined();
	});

	it("abortSignal.timeout 绝不被调用（防止旧 bug 回潮）", async () => {
		const spy = vi.spyOn(globalThis.AbortSignal as { timeout: (ms: number) => unknown }, "timeout");
		g.tasks = undefined;
		g.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 0 }) }));

		await runtimeHttp().getJson("https://qyapi.weixin.qq.com/x");
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe("wecom client：软超时（tasks.sleep）", () => {
	it("tasks.sleep 存在时，慢请求被软超时拦截并抛出「超时」文案", async () => {
		// 假时钟：sleep 不真的等，只推进 Date.now()。软超时按墙钟 deadline 判定、
		// 50ms 一个步长，故 100 步后到点抛超时（测试秒级完成）。
		let now = 0;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		g.tasks = {
			sleep: (ms: number) => {
				now += ms;
				return Promise.resolve();
			},
		};
		let resolveFetch: (v: unknown) => void = () => {};
		const fetchMock = vi.fn(() => new Promise<unknown>((resolve) => {
			resolveFetch = resolve;
		}));
		g.fetch = fetchMock;

		const p = runtimeHttp().getJson("https://qyapi.weixin.qq.com/x");
		await expect(p).rejects.toThrow(/超时/);
		// 收尾挂起的 fetch，避免 open handle
		resolveFetch({ ok: true, json: async () => ({ errcode: 0 }) });
	});

	it("tasks 缺失时降级为不超时：快速请求正常返回", async () => {
		g.tasks = undefined;
		const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 0 }) }));
		g.fetch = fetchMock;

		const data = await runtimeHttp().getJson("https://qyapi.weixin.qq.com/x");
		expect(data.errcode).toBe(0);
	});

	it("快速上游只按短步长 sleep，不留 5s 悬挂任务拖住响应（企微工作台白屏回归）", async () => {
		const sleeps: number[] = [];
		g.tasks = {
			sleep: (ms: number) => {
				sleeps.push(ms);
				return Promise.resolve();
			},
		};
		g.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ errcode: 0 }) }));

		const data = await runtimeHttp().getJson("https://qyapi.weixin.qq.com/x");
		expect(data.errcode).toBe(0);
		// 旧实现这里会是 [5000]：race 由 fetch 赢，但那条 sleep 仍在请求上下文里飞，
		// 响应只能等它走完才发出去。短步长后每次请求都 <=50ms，主链路结束即收尾。
		expect(sleeps.length).toBeGreaterThan(0);
		expect(Math.max(...sleeps)).toBeLessThanOrEqual(50);
	});
});
