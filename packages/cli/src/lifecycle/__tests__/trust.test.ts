import process from "node:process";
// BDD：ojm trust 瘦客户端（P2-2，C2-38/39）——纯转发（uninstall.test.ts 同范式）：
// 登录 → GET/POST/DELETE /api/_platform/market/trust* → 打印人话；fetch 全 stub 不真发网络。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatFingerprint, trustCommand } from "../../trust";

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

const KEY_A = { key_id: "ojm.test", public_key: "a".repeat(64), added_at: 1730000000000 };

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

const SITE = { url: "http://x", user: "u", pass: "p" };

describe("trustCommand · ls（P2-2）", () => {
	it("登录后 GET /market/trust → 逐行打印 key_id + 分组指纹", async () => {
		const { fetchFn, calls } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/trust": () => ok({ keys: [KEY_A], note: null }),
		});
		await trustCommand("ls", [], { ...SITE, fetchFn });
		expect(calls[1]?.url).toContain("/api/_platform/market/trust");
		expect(calls[1]?.init?.method).toBe("GET");
		expect((calls[1]?.init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
		const out = logs.join("\n");
		expect(out).toContain("ojm.test");
		expect(out).toMatch(/fp=([0-9a-f]{8} ){7}[0-9a-f]{8}/); // 64hex 分 8 组
	});

	it("空库 → 可读空态；note 在场（.bak 回落）→ 先打注意行", async () => {
		const { fetchFn } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/trust": () => ok({ keys: [], note: "x 损坏，已自动回落 x.bak" }),
		});
		await trustCommand("ls", [], { ...SITE, fetchFn });
		expect(logs.join("\n")).toContain("已自动回落");
	});
});

describe("trustCommand · add / revoke（P2-2）", () => {
	it("add：POST {key_id, public_key}；added / exists_same 两种回显", async () => {
		const added = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/trust/key": () => ok({ result: "added" }),
		});
		await trustCommand("add", ["ojm.test", "a".repeat(64)], { ...SITE, fetchFn: added.fetchFn });
		const call = added.calls[1]!;
		expect(call.init?.method).toBe("POST");
		expect(JSON.parse(String(call.init?.body))).toEqual({ key_id: "ojm.test", public_key: "a".repeat(64) });
		expect(logs.join("\n")).toContain("已信任发布方：ojm.test");

		const idem = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/trust/key": () => ok({ result: "exists_same" }),
		});
		await trustCommand("add", ["ojm.test", "a".repeat(64)], { ...SITE, fetchFn: idem.fetchFn });
		expect(logs.join("\n")).toContain("无需重复添加");
	});

	it("add 缺参 → 人话用法报错（不发网络）", async () => {
		const { fetchFn, calls } = fetchStub({});
		await expect(trustCommand("add", ["ojm.test"], { ...SITE, fetchFn })).rejects.toThrow(/用法/);
		expect(calls).toHaveLength(0);
	});

	it("revoke：DELETE ?key_id=（URI 编码）；revoked=false 置 exitCode 1", async () => {
		const exitBackup = process.exitCode;
		process.exitCode = 0;
		try {
			const yes = fetchStub({
				"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
				"/api/_platform/market/trust/key": () => ok({ revoked: true }),
			});
			await trustCommand("revoke", ["ojm.test"], { ...SITE, fetchFn: yes.fetchFn });
			const call = yes.calls[1]!;
			expect(call.init?.method).toBe("DELETE");
			expect(call.url).toContain("/api/_platform/market/trust/key?key_id=ojm.test");
			expect(process.exitCode).toBe(0);

			process.exitCode = 0;
			const no = fetchStub({
				"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
				"/api/_platform/market/trust/key": () => ok({ revoked: false }),
			});
			await trustCommand("revoke", ["nope.key"], { ...SITE, fetchFn: no.fetchFn });
			expect(process.exitCode).toBe(1);
			expect(logs.join("\n")).toContain("无此 key_id");
		}
		finally {
			process.exitCode = exitBackup;
		}
	});

	it("未知子命令 → 人话报错（列可用子命令）", async () => {
		const { fetchFn } = fetchStub({});
		await expect(trustCommand("frobnicate", [], { ...SITE, fetchFn })).rejects.toThrow(/可用：ls/);
	});
});

describe("formatFingerprint（契约 §2.11 展示口径）", () => {
	it("64hex → 8 组 × 8 字符空格分隔", () => {
		expect(formatFingerprint("0".repeat(64))).toBe("00000000 ".repeat(8).trim());
	});
});
