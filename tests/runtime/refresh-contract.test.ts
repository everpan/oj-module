import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "#src/store/auth";
import { request } from "#src/utils/request";
import { refreshTokenAndRetry } from "#src/utils/request/refresh";

/**
 * M1 T8：runtime 自动刷新链对 oj 后端 `POST /auth/refresh` 的端到端契约。
 *
 * 后端事实（oj-app/api/src/auth/refresh/api.ts + tests/auth-domain.test.ts）：
 *  - 请求体：snake_case `{ refresh_token }`；响应 oj 信封 data =
 *    `{ access_token, refresh_token, expires_in, grace }`（轮换制；
 *    grace=true 为旧 token 30s 宽限命中，属正常成功响应）。
 *
 * 全链真跑（只 mock fetch，不 mock 模块）：
 *  1. refresh 请求体恰为 `{ refresh_token }`；
 *  2. 新对经 mapAuthPayload（access_token/refresh_token → token/refreshToken）写回 auth store；
 *  3. 原请求重放，Authorization 携带新 Bearer；
 *  4. grace:true 宽限响应不破坏重放。
 *
 * 注意：不得对 `#src/api/user` 用 vi.mock——api/user ↔ utils/request 循环依赖
 * 使 mock 拦截随 import 顺序失效（实测）；也不需 mock，真实 fetchRefreshToken
 * 走 mock fetch 即全链覆盖。fetchRefreshToken 单点映射另由
 * api-oj-contract.test.ts 守护。
 */

vi.hoisted(() => {
	// happy-dom 的 localStorage 缺 setItem（同 auth-provider / header-provider 测试），
	// auth store 的 persist 在 setState 时写库——垫一个内存实现
	const mem = new Map<string, string>();
	(globalThis as Record<string, unknown>).localStorage = {
		getItem: (k: string) => mem.get(k) ?? null,
		setItem: (k: string, v: string) => void mem.set(k, String(v)),
		removeItem: (k: string) => void mem.delete(k),
		clear: () => mem.clear(),
		key: () => null,
		get length() { return mem.size; },
	};
});

interface Call {
	url: string
	method: string
	auth: string | null
	body: string
}

let calls: Call[];

/** oj 原生成功信封（refresh 载荷含 grace 宽限标记） */
function ojOk(data: unknown) {
	return new Response(JSON.stringify({ code: 0, msg: "ok", data }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/** 记录调用；refresh 端点返轮换新对（grace:true），其余端点 200 空 data */
function stubFetch(onOriginal?: (url: string, attempt: number) => Response | undefined) {
	vi.stubGlobal("fetch", vi.fn(async (input: Request | string, init?: RequestInit) => {
		const req = input instanceof Request ? input : new Request(input, init);
		calls.push({
			url: req.url,
			method: req.method,
			auth: req.headers.get("Authorization"),
			body: await req.clone().text().catch(() => ""),
		});
		if (req.url.endsWith("/auth/refresh")) {
			return ojOk({ access_token: "at-new", refresh_token: "rt-new", expires_in: 720, grace: true });
		}
		return onOriginal?.(req.url, calls.length) ?? ojOk({});
	}));
}

beforeEach(() => {
	calls = [];
	useAuthStore.setState({ token: "at-old", refreshToken: "rt-old" });
	stubFetch();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("refresh 编排（refreshTokenAndRetry）", () => {
	it("refresh 请求体 {refresh_token}；新对写回 store；原请求带新 Bearer 重放", async () => {
		const original = new Request("http://localhost/api/workspaces", {
			method: "GET",
			headers: { Authorization: "Bearer at-old" },
		});

		const resp = await refreshTokenAndRetry(original, {}, "rt-old");

		// ① refresh 端点契约：POST，请求体恰为 oj snake_case
		const refreshCall = calls.find(c => c.url.endsWith("/auth/refresh"));
		expect(refreshCall, "应发出 auth/refresh 请求").toBeDefined();
		expect(refreshCall!.method).toBe("POST");
		expect(JSON.parse(refreshCall!.body)).toEqual({ refresh_token: "rt-old" });

		// ② 新对（access_token/refresh_token → token/refreshToken）写回 store
		expect(useAuthStore.getState().token).toBe("at-new");
		expect(useAuthStore.getState().refreshToken).toBe("rt-new");

		// ③ 原请求重放，Authorization 携带新 Bearer
		const replay = calls.find(c => c.url === "http://localhost/api/workspaces");
		expect(replay, "应重放原请求").toBeDefined();
		expect(replay!.auth).toBe("Bearer at-new");

		// ④ 重放成功返回
		expect(resp.ok).toBe(true);
	});

	it("grace:true 宽限响应不破坏重放（store 仅落 token/refreshToken）", async () => {
		const original = new Request("http://localhost/api/projects", { method: "GET" });
		const resp = await refreshTokenAndRetry(original, {}, "rt-old");

		expect(resp.ok).toBe(true);
		expect(useAuthStore.getState().token).toBe("at-new");
		expect(useAuthStore.getState().refreshToken).toBe("rt-new");
	});
});

describe("afterResponse 401 触发刷新（端到端）", () => {
	it("业务请求 401 → 自动 refresh → 重放 200，全程对 oj 后端契约成立", async () => {
		let attempts = 0;
		stubFetch((url) => {
			if (url.endsWith("/web/user-info")) {
				attempts += 1;
				if (attempts === 1) {
					return new Response(JSON.stringify({ code: 401, msg: "unauthorized" }), {
						status: 401,
						headers: { "Content-Type": "application/json" },
					});
				}
			}
			return undefined;
		});

		const resp = await request.get("web/user-info");
		expect(resp.ok).toBe(true);

		// refresh 端点契约：请求体恰为 { refresh_token }
		const refreshCall = calls.find(c => c.url.endsWith("/auth/refresh"));
		expect(refreshCall).toBeDefined();
		expect(refreshCall!.method).toBe("POST");
		expect(JSON.parse(refreshCall!.body)).toEqual({ refresh_token: "rt-old" });

		// 原请求两次到达：首次 401（旧 Bearer），重放带新 Bearer
		const tries = calls.filter(c => c.url.endsWith("/web/user-info"));
		expect(tries.length).toBeGreaterThanOrEqual(2);
		expect(tries[0]!.auth).toBe("Bearer at-old");
		expect(tries.at(-1)!.auth).toBe("Bearer at-new");

		// store 已落新对
		expect(useAuthStore.getState().token).toBe("at-new");
		expect(useAuthStore.getState().refreshToken).toBe("rt-new");
	});
});
