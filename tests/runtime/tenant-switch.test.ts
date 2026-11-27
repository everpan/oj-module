import type { LoginInfo } from "#src/api/user/types";
import { Buffer } from "node:buffer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "#src/store/auth";
import { DEFAULT_TENANT, syncTenantWithToken, useTenantStore } from "#src/store/tenant";

/**
 * 多账号切换的租户上下文：oj-tenant 是持久化 store，而令牌 tenant claim 才是服务端
 * 认可的租户。旧值残留会让 superadmin 带企微租户头访问写面 → currentAccess() 403。
 * 这里守住两处修复：① 登录后按令牌对齐（先对齐再写 token）；② 仅显式登出时清空，
 * 401 跳登录的 reset 保留租户以保证租户本地账号可重新登录。
 */
vi.hoisted(() => {
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

/** 构造带 tenant claim 的假 JWT（payload 走 base64url，无 padding，与真实令牌同形） */
function tokenWithTenant(tenant: string): string {
	const payload = Buffer.from(JSON.stringify({ sub: "1", tenant, iat: 1, exp: 9999999999 })).toString("base64url");
	return `header.${payload}.sig`;
}

function ojOk(data: unknown) {
	return new Response(JSON.stringify({ code: 0, msg: "ok", data }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	useTenantStore.getState().clear();
	useAuthStore.setState({ token: "", refreshToken: "" });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("syncTenantWithToken", () => {
	it("按令牌 tenant claim 对齐租户 store（base64url 无 padding）", () => {
		useTenantStore.getState().setTenant("wwd2d00dedd5c84818");
		syncTenantWithToken(tokenWithTenant(DEFAULT_TENANT));
		expect(useTenantStore.getState().tenant).toBe(DEFAULT_TENANT);
	});

	it("畸形令牌不抛错、不改动租户", () => {
		useTenantStore.getState().setTenant("wwd2d00dedd5c84818");
		expect(() => syncTenantWithToken("not-a-jwt")).not.toThrow();
		expect(() => syncTenantWithToken("")).not.toThrow();
		expect(useTenantStore.getState().tenant).toBe("wwd2d00dedd5c84818");
	});
});

describe("auth store 登录/登出的租户联动", () => {
	it("login 成功后按令牌 tenant 对齐（内置 fetchLogin 链路）", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => ojOk({
			access_token: tokenWithTenant("wwd2d00dedd5c84818"),
			refresh_token: "rt-1",
		})));
		useTenantStore.getState().setTenant(DEFAULT_TENANT);

		const payload: LoginInfo = { username: "wecom:dongzhao", password: "x", method: "local" };
		await useAuthStore.getState().login(payload);

		expect(useAuthStore.getState().token).toBe(tokenWithTenant("wwd2d00dedd5c84818"));
		expect(useTenantStore.getState().tenant).toBe("wwd2d00dedd5c84818");
	});

	it("logout 清掉持久化的旧租户，回落到部署默认", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => ojOk({})));
		useTenantStore.getState().setTenant("wwd2d00dedd5c84818");
		await useAuthStore.getState().logout();
		expect(useTenantStore.getState().tenant).toBe(DEFAULT_TENANT);
	});

	it("401 跳登录走 reset 时保留租户（租户本地账号可重新登录）", () => {
		useTenantStore.getState().setTenant("wwd2d00dedd5c84818");
		useAuthStore.getState().reset();
		expect(useTenantStore.getState().tenant).toBe("wwd2d00dedd5c84818");
	});
});
