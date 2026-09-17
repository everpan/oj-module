import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "#src/store/auth";
import { registerHeaderProvider, unregisterHeaderProvider } from "#src/store/header-provider";
import { getAppNamespace } from "#src/utils/get-app-namespace";
import { request } from "#src/utils/request";

vi.hoisted(() => {
	// happy-dom 的 localStorage 缺 setItem（同 header-provider.test.ts）
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
 * D-M10 spike：per-layout 凭据域。
 *
 * 假设：admin 面与主站是独立凭据面，同站并存时单 token 槽互踩不可接受（架构 B3）。
 * 验证：admin token 存独立命名空间键（模块自管，不进 useAuthStore），
 * headerProvider 按当前 layout 上下文解析 Authorization——admin 布局返回
 * 独立 token 覆盖默认头（ky 同名后写覆盖），app 布局返回 {} 沿用默认注入。
 *
 * 结论：可行（见各断言）。已知边界：useAuthStore persist 键固定为
 * getAppNamespace("access-token") 单例，双 token 不能同驻 auth store——
 * admin 凭据须模块自管（本测试即此形态）。若后续 admin 面要复用 runtime 的
 * login/logout/refresh 动作，最小框架诉求 = auth store 键参数化（不在本次实现）。
 */

const seen: Request[] = [];
const APP_KEY = getAppNamespace("access-token");
const ADMIN_KEY = getAppNamespace("admin-access-token");

// 模拟 layout 上下文（生产中由路由/layout 解析，spike 用变量替身）
let layout: "app" | "admin" = "app";

beforeEach(() => {
	layout = "app";
	seen.length = 0;
	vi.stubGlobal("fetch", vi.fn(async (input: Request) => {
		seen.push(input);
		return new Response("{}", {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}));
	registerHeaderProvider("m-layout", () => layout === "admin"
		? { Authorization: `Bearer ${localStorage.getItem(ADMIN_KEY) ?? ""}` }
		// 显式断言：三元两分支归一后 `{}` 被推成 `{ Authorization?: undefined }`，
		// 不满足 HeaderProvider 的 Record<string, string>（tsc --noEmit 长红）
		: {} as Record<string, string>);
});

afterEach(() => {
	unregisterHeaderProvider("m-layout");
	useAuthStore.setState({ token: "", refreshToken: "" });
	localStorage.removeItem(ADMIN_KEY);
	vi.unstubAllGlobals();
});

async function lastHeaders(): Promise<Headers> {
	await request.get("http://localhost/api/user/info");
	return seen.at(-1)!.headers;
}

describe("per-layout 凭据域（D-M10 spike）", () => {
	it("app 布局：provider 返回 {}，默认 Authorization 照注", async () => {
		useAuthStore.setState({ token: "app-tok", refreshToken: "app-rt" });
		expect((await lastHeaders()).get("Authorization")).toBe("Bearer app-tok");
	});

	it("admin 布局：provider 同名覆盖，请求携带 admin 独立 token", async () => {
		useAuthStore.setState({ token: "app-tok", refreshToken: "app-rt" });
		localStorage.setItem(ADMIN_KEY, "admin-tok");
		layout = "admin";

		expect((await lastHeaders()).get("Authorization")).toBe("Bearer admin-tok");
	});

	it("layout 切换惰性解析：同一 provider 逐请求按当前 layout 求值", async () => {
		useAuthStore.setState({ token: "app-tok", refreshToken: "app-rt" });
		localStorage.setItem(ADMIN_KEY, "admin-tok");

		expect((await lastHeaders()).get("Authorization")).toBe("Bearer app-tok");
		layout = "admin";
		expect((await lastHeaders()).get("Authorization")).toBe("Bearer admin-tok");
		layout = "app";
		expect((await lastHeaders()).get("Authorization")).toBe("Bearer app-tok");
	});

	it("双 token 并存：auth store 持久键与 admin 独立键互不覆写", async () => {
		useAuthStore.setState({ token: "app-tok", refreshToken: "app-rt" });
		localStorage.setItem(ADMIN_KEY, "admin-tok");
		layout = "admin";
		await lastHeaders();

		expect(APP_KEY).not.toBe(ADMIN_KEY);
		// auth store persist 落库仍是主站 token，admin 面读写不触碰
		expect(localStorage.getItem(APP_KEY)).toContain("app-tok");
		expect(localStorage.getItem(ADMIN_KEY)).toBe("admin-tok");
	});
});
