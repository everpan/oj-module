import type { AppRouteRecordRaw } from "#src/router/types";
import type { RoutesApiProvider } from "#src/store/api-provider";

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAsyncRoutes } from "#src/api/user";

import {
	getRoutesApiProvider,
	registerRoutesApiProvider,
	unregisterApiProviders,
} from "#src/store/api-provider";
import { request } from "#src/utils/request";

// routesApi 委托（G2，BDD 5.2）：provider 优先，回落内置 web/get-async-routes。
// request 模块打桩，避免未注册用例真的发请求。
vi.mock("#src/utils/request", () => ({
	request: {
		get: vi.fn(() => ({
			json: () => Promise.resolve({ code: 0, data: [{ path: "/builtin" }] }),
		})),
	},
}));

const getMock = vi.mocked(request.get);

function routesProvider(tag: string): RoutesApiProvider {
	return {
		fetchAsyncRoutes: vi.fn().mockResolvedValue([{ path: `/p:${tag}` } as AppRouteRecordRaw]),
	};
}

afterEach(() => {
	unregisterApiProviders("routes");
	getMock.mockClear();
});

describe("routesApi 委托（G2，BDD 5.2）", () => {
	it("5.2#1 未注册 provider：走内置 web/get-async-routes", async () => {
		const r = await fetchAsyncRoutes();
		expect(getMock).toHaveBeenCalledWith("web/get-async-routes");
		expect(r).toEqual([{ path: "/builtin" }]);
	});

	it("5.2#2 注册 provider：走 provider，内置不执行", async () => {
		const p = routesProvider("del");
		registerRoutesApiProvider("routes", p);
		const r = await fetchAsyncRoutes();
		expect(p.fetchAsyncRoutes).toHaveBeenCalled();
		expect(getMock).not.toHaveBeenCalled();
		expect(r).toEqual([{ path: "/p:del" }]);
	});

	it("5.2#3 提供模块卸载后：回落内置", async () => {
		registerRoutesApiProvider("routes", routesProvider("x"));
		unregisterApiProviders("routes");
		expect(getRoutesApiProvider()).toBeUndefined();
		const r = await fetchAsyncRoutes();
		expect(getMock).toHaveBeenCalledWith("web/get-async-routes");
		expect(r).toEqual([{ path: "/builtin" }]);
	});

	it("先到先得：第二个注册者被忽略并告警", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = routesProvider("first");
		registerRoutesApiProvider("routes", first);
		registerRoutesApiProvider("routes", routesProvider("second"));
		expect(getRoutesApiProvider()).toBe(first);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
