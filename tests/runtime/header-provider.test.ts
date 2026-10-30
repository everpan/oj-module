import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "#src/store/auth";
import {
	currentHeaderProvider,
	registerHeaderProvider,
	unregisterHeaderProvider,
} from "#src/store/header-provider";
import { request } from "#src/utils/request";

import { PROJECT_ROOT } from "../helpers/paths";

vi.hoisted(() => {
	// happy-dom 的 localStorage 缺 setItem（同 auth-provider.test.ts），
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

/**
 * D-M9：模块经 ctx.register.headerProvider 注入惰性求值的自定义请求头，
 * beforeRequest 在 token / X-Lang / 内置租户头之后合并进每个请求。
 *
 * 注意：`X-TENANT-ID` 自 L2 起由运行时无条件注入（默认 default），不再依赖模块
 * provider —— 宿主 shell 的 hydrateUser / solution-routes 早于任何模块 onInit 发请求。
 * provider 仍可覆盖它（如按登录态切换租户），未注册时保持运行时默认值。
 */

// ky 走全局 fetch：以桩捕获 Request，断言最终头部
const seen: Request[] = [];

beforeEach(() => {
	seen.length = 0;
	vi.stubGlobal("fetch", vi.fn(async (input: Request) => {
		seen.push(input);
		return new Response("{}", {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}));
});

afterEach(() => {
	unregisterHeaderProvider("m-hp");
	unregisterHeaderProvider("m-hp-2");
	vi.unstubAllGlobals();
});

// 非白名单路径（不命中 auth/login|auth/refresh），token 照常注入
async function lastHeaders(): Promise<Headers> {
	await request.get("http://localhost/api/user/info");
	return seen.at(-1)!.headers;
}

describe("header provider 注册表（D-M9）", () => {
	it("先到先得：第二个注册者被忽略并告警", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const first = () => ({ "X-TENANT-ID": "first" });
		registerHeaderProvider("m-hp", first);
		registerHeaderProvider("m-hp-2", () => ({ "X-TENANT-ID": "second" }));
		expect(currentHeaderProvider()).toBe(first);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("注册后请求携带 provider 头，且按请求惰性求值", async () => {
		let tenant = "t-1";
		registerHeaderProvider("m-hp", () => ({ "X-TENANT-ID": tenant }));

		expect((await lastHeaders()).get("X-TENANT-ID")).toBe("t-1");

		tenant = "t-2";
		expect((await lastHeaders()).get("X-TENANT-ID")).toBe("t-2");
	});

	it("未注册时只剩运行时内置头：Authorization / X-Lang / 租户默认值", async () => {
		useAuthStore.setState({ token: "tok-0", refreshToken: "r-0" });
		expect(currentHeaderProvider()).toBeUndefined();

		const headers = await lastHeaders();
		expect(headers.get("Authorization")).toBe("Bearer tok-0");
		expect(headers.get("X-Lang")).toBeTruthy();
		expect(headers.get("X-TENANT-ID")).toBe("default");
	});

	it("合并语义 = 追加非替换：provider 头不覆盖已注入的 Authorization", async () => {
		useAuthStore.setState({ token: "tok-4", refreshToken: "r-4" });
		registerHeaderProvider("m-hp", () => ({ "X-TENANT-ID": "t-4" }));

		const headers = await lastHeaders();
		expect(headers.get("Authorization")).toBe("Bearer tok-4");
		expect(headers.get("X-TENANT-ID")).toBe("t-4");
	});
});

describe("header provider 生命周期注入（D-M9）", () => {
	it("unloadModule 注销后回落到运行时租户默认值", async () => {
		const { loadAll, unloadModule } = await import("#src/module-loader");
		await loadAll({
			modules: [{
				name: "header-provider-fixture",
				entry: pathToFileURL(`${PROJECT_ROOT}/tests/fixtures/header-provider-entry.tsx`).href,
			}],
		});
		expect((await lastHeaders()).get("X-TENANT-ID")).toBe("fixture-tenant");

		await unloadModule("header-provider-fixture");
		expect(currentHeaderProvider()).toBeUndefined();
		expect((await lastHeaders()).get("X-TENANT-ID")).toBe("default");
	});
});
