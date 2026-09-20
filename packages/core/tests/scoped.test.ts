import type { ModuleRequest } from "../src/types";

import { describe, expect, it } from "vitest";
import { createScopedRequest } from "../src/request/scoped";

function stub(): ModuleRequest {
	const fn = (() => Promise.resolve("called")) as unknown as ModuleRequest;
	for (const m of ["get", "post", "put", "patch", "delete", "head"] as const) {
		fn[m] = (() => Promise.resolve(m)) as never;
	}
	return fn;
}

describe("createScopedRequest（v1 P6.3/D11/P7.2 直蒸回归）", () => {
	it("未登记前缀即拒（人话报错）", async () => {
		const scoped = createScopedRequest("m", () => undefined, stub());
		expect(() => scoped.get("/auth/x")).toThrow(/尚未登记 API 前缀/);
	});

	it("越界拒绝：前缀边界 + 兄弟前缀 + 路径穿越", () => {
		const scoped = createScopedRequest("m", () => "/sys", stub());
		expect(() => scoped.get("/sysadmin/x")).toThrow(/越界/);
		expect(() => scoped.get("/sys/../admin")).toThrow(/越界/);
		expect(() => scoped("/other")).toThrow(/越界/);
	});

	it("边界内放行（精确边界与子路径）；多前缀命中任一", () => {
		const scoped = createScopedRequest("m", () => ["/auth", "/users"], stub());
		expect(() => scoped.get("/auth/login")).not.toThrow();
		expect(() => scoped.get("/users/me")).not.toThrow();
		expect(() => scoped.get("/authx")).toThrow(/越界/);
	});

	it("剥离逐请求 prefix/prefixUrl（防凭据外泄到任意外域）", async () => {
		const seen: unknown[] = [];
		const spy = stub();
		spy.get = ((url: string, options?: unknown) => {
			seen.push(options);
			return Promise.resolve();
		}) as never;
		const scoped = createScopedRequest("m", () => "/sys", spy);
		await scoped.get("/sys/x", { prefix: "https://evil.com", prefixUrl: "y", searchParams: { a: 1 } } as any);
		expect((seen[0] as Record<string, unknown>)).not.toHaveProperty("prefix");
		expect((seen[0] as Record<string, unknown>)).not.toHaveProperty("prefixUrl");
		expect((seen[0] as Record<string, unknown>)).toHaveProperty("searchParams");
	});

	it("前缀惰性求值：先请求拒绝、登记后放行（同一 client）", () => {
		let prefixes: string[] = [];
		const scoped = createScopedRequest("m", () => prefixes[0], stub());
		expect(() => scoped.get("/api/x")).toThrow(/尚未登记/);
		prefixes = ["/api"];
		expect(() => scoped.get("/api/x")).not.toThrow();
	});
});
