import process from "node:process";
// BDD：ojm uninstall 瘦客户端（P1-15a 缺口 B，D6/D8 同款）——纯转发：
// 登录 → POST /api/_platform/market/uninstall {name} → 打印服务端人话 message；
// ok:false（未装/空锁拒启）置 exitCode 1。fetch 全 stub 不真发网络（install.test.ts 同范式）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uninstallCommand } from "../../uninstall";

/** fetch stub：按 URL 前缀分发，记录全部调用（url + init） */
function fetchStub(handlers: Record<string, (url: string, init?: RequestInit) => unknown>): {
	fetchFn: typeof fetch
	calls: { url: string, init?: RequestInit }[]
} {
	const calls: { url: string, init?: RequestInit }[] = [];
	const fetchFn = (async (url: string | URL, init?: RequestInit) => {
		const u = String(url);
		calls.push({ url: u, init });
		for (const [prefix, handler] of Object.entries(handlers)) {
			if (u.includes(prefix))
				return handler(u, init);
		}
		throw new Error(`fetchStub 未覆盖：${u}`);
	}) as typeof fetch;
	return { fetchFn, calls };
}

const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data }) });

let logs: string[];

beforeEach(() => {
	logs = [];
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("uninstallCommand · 卸载瘦客户端（P1-15a 缺口 B）", () => {
	it("登录后 POST uninstall {name}（Bearer 注入）→ 打印服务端 message", async () => {
		const { fetchFn, calls } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/uninstall": () => ok({ ok: true, message: "卸载完成：四处同删（demo-solution@0.1.0）" }),
		});
		await uninstallCommand("demo-solution", { siteUrl: "http://x", user: "u", pass: "p", fetchFn });
		// 登录体 + uninstall JSON 体 + Bearer
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ username: "u", password: "p" });
		const call = calls[1]!;
		expect(call.url).toContain("/api/_platform/market/uninstall");
		expect(call.init?.method).toBe("POST");
		expect((call.init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
		expect(JSON.parse(String(call.init?.body))).toEqual({ name: "demo-solution" });
		expect(logs.join("\n")).toContain("卸载完成：四处同删（demo-solution@0.1.0）");
	});

	it("ok:false（域逻辑拒绝）→ message 照打 + exitCode 1", async () => {
		const { fetchFn } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/uninstall": () => ok({ ok: false, message: "卸载失败：「x」未安装（锁与 sidecar 均无记录）" }),
		});
		const exitBackup = process.exitCode;
		process.exitCode = 0;
		try {
			await uninstallCommand("x", { siteUrl: "http://x", user: "u", pass: "p", fetchFn });
			expect(process.exitCode).toBe(1);
		}
		finally {
			process.exitCode = exitBackup;
		}
		expect(logs.join("\n")).toContain("未安装");
	});

	it("空名 → 人话用法报错（不发网络）", async () => {
		const { fetchFn, calls } = fetchStub({});
		await expect(uninstallCommand("", { siteUrl: "http://x", user: "u", pass: "p", fetchFn })).rejects.toThrow(/用法/);
		expect(calls).toHaveLength(0);
	});

	it("信封非 0：可读报错（code + msg）", async () => {
		const { fetchFn } = fetchStub({
			"/api/auth/login": () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 403, msg: "forbidden" }) }),
		});
		await expect(uninstallCommand("x", { siteUrl: "http://x", user: "u", pass: "p", fetchFn })).rejects.toThrow(/forbidden/);
	});
});
