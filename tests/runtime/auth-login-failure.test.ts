import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchLogin } from "#src/api/user";
import { useAuthStore } from "#src/store/auth";

/**
 * AC-D16（原 F12 场景迁移）：业务失败 = 非 2xx + oj 信封，fetchLogin 经 ky
 * 抛 HTTPError（吐司由 request 层 error-response 统一负责）；auth store 的
 * login() 不再有 success 信封分支——rejection 透传，已持久化 token 不动。
 */

const { messageError } = vi.hoisted(() => {
	// 本仓 happy-dom 环境的 localStorage 不可用（probe 实测 setItem 缺失），
	// auth store 的 persist 会在 setState 时写库——垫一个内存实现
	const mem = new Map<string, string>();
	(globalThis as Record<string, unknown>).localStorage = {
		getItem: (k: string) => mem.get(k) ?? null,
		setItem: (k: string, v: string) => void mem.set(k, String(v)),
		removeItem: (k: string) => void mem.delete(k),
		clear: () => mem.clear(),
		key: () => null,
		get length() { return mem.size; },
	};
	return { messageError: vi.fn() };
});

vi.mock("#src/api/user", () => ({
	fetchLogin: vi.fn(),
	fetchLogout: vi.fn(),
}));
vi.mock("#src/utils/static-antd", () => ({
	message: { error: messageError },
}));

describe("auth store login 信封级失败（F12）", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useAuthStore.setState({ token: "persisted-token", refreshToken: "persisted-refresh" });
	});

	it("fetchLogin 拒绝（业务失败=HTTPError）→ login 拒绝、不动已持久化 token", async () => {
		vi.mocked(fetchLogin).mockRejectedValue(new Error("账号或密码错误"));

		await expect(useAuthStore.getState().login({ username: "admin", password: "wrong" }))
			.rejects
			.toThrowError(/账号或密码错误/);

		expect(useAuthStore.getState().token).toBe("persisted-token");
		expect(useAuthStore.getState().refreshToken).toBe("persisted-refresh");
	});

	it("fetchLogin 成功 → 直返 { token, refreshToken } 正常写入", async () => {
		vi.mocked(fetchLogin).mockResolvedValue({
			token: "new-token",
			refreshToken: "new-refresh",
		});

		await useAuthStore.getState().login({ username: "admin", password: "aA123456" });
		expect(useAuthStore.getState().token).toBe("new-token");
	});
});
