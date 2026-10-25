// BDD：`ojm list`（站点已装方案的可查面）。
//
// 到 0.3.2 为止 CLI 没有任何命令能回答「这个站点上装了什么」——装完只有一条终态文案。
// 用例盯四件事：
//   ① 缺省只列**已装**（installed != null），`--all` 才连未装行一起列；
//   ② 三个派生结论不许算错：upgradable / enabled / trust_state 都原样取自站点索引行；
//   ③ 空清算是成功（exit 0），并在人话里给出下一步（`ojm list --all`）；
//   ④ `--json` 下 stdout 只有一行信封，命令名 `list`，数据在 data.solutions。
import type { SolutionRow } from "../list";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCli, localizeCacError, reportCliError } from "../cli";
import { listCommand } from "../list";

/** fetch stub：按 URL 前缀分发，记录全部调用（uninstall.test.ts 同范式） */
function fetchStub(handlers: Record<string, (url: string) => unknown>): { fetchFn: typeof fetch, calls: string[] } {
	const calls: string[] = [];
	const fetchFn = (async (url: string | URL) => {
		const u = String(url);
		calls.push(u);
		for (const [prefix, handler] of Object.entries(handlers)) {
			if (u.includes(prefix))
				return handler(u);
		}
		throw new Error(`fetchStub 未覆盖：${u}`);
	}) as typeof fetch;
	return { fetchFn, calls };
}

const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data }) });
const LOGIN = () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 });

const ROWS = [
	{ name: "demo-solution", latest: "0.1.2", installed: "0.1.0", enabled: true, upgradable: true, available: ["0.1.0", "0.1.2"], trust_state: "trusted" },
	{ name: "acme-demo", latest: "2.0.0", installed: "2.0.0", enabled: false, upgradable: false, available: ["2.0.0"], trust_state: "untrusted" },
	{ name: "not-installed-one", latest: "1.0.0", installed: null, enabled: null, upgradable: false, available: ["1.0.0"], trust_state: null },
];

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

describe("listCommand：已装清单", () => {
	it("scenario: 缺省只列已装，按名字排序，upgradable / trust_state 原样透出", async () => {
		const { fetchFn, calls } = fetchStub({
			"/api/auth/login": LOGIN,
			"/api/_platform/market/index": () => ok(ROWS),
		});
		const rows = await listCommand({ siteUrl: "http://x", user: "u", pass: "p", fetchFn });

		expect(rows.map(r => r.name)).toEqual(["acme-demo", "demo-solution"]); // 未装的不出现
		expect(rows.find(r => r.name === "demo-solution")).toEqual({
			name: "demo-solution",
			installed: "0.1.0",
			enabled: true,
			latest: "0.1.2",
			upgradable: true,
			trustState: "trusted",
		});
		// 登录用的是站点寻址（Bearer 由 callApi 注入，这里只断言两次调用与顺序）
		expect(calls).toEqual(["http://x/api/auth/login", "http://x/api/_platform/market/index"]);

		const text = logs.join("\n");
		expect(text).toContain("已装 2 个方案");
		expect(text).toContain("NAME");
		expect(text).toContain("可升级：demo-solution");
		expect(text).toContain("签名不受信：acme-demo");
		expect(text).toContain("no"); // 禁用态
	});

	it("scenario: --all 连未装行一起列（installed 显示 -），人话里给两个计数", async () => {
		const { fetchFn } = fetchStub({
			"/api/auth/login": LOGIN,
			"/api/_platform/market/index": () => ok(ROWS),
		});
		const rows = await listCommand({ siteUrl: "http://x", user: "u", pass: "p", fetchFn, all: true });

		expect(rows.map(r => r.name)).toEqual(["acme-demo", "demo-solution", "not-installed-one"]);
		expect(rows.find(r => r.name === "not-installed-one")).toMatchObject({ installed: null, upgradable: false, enabled: null });
		const text = logs.join("\n");
		expect(text).toContain("3 个方案（已装 2 个）");
		expect(text).toMatch(/not-installed-one\s+-/); // 未装的行 installed 列是 `-`
	});

	it("scenario: 站点上一个方案都没装 → 成功（exit 0 语义），人话指路 --all", async () => {
		const { fetchFn } = fetchStub({
			"/api/auth/login": LOGIN,
			"/api/_platform/market/index": () => ok([ROWS[2]]),
		});
		const rows = await listCommand({ siteUrl: "http://x", user: "u", pass: "p", fetchFn });
		expect(rows).toEqual([]);
		expect(logs.join("\n")).toContain("还没有已装方案");
		expect(logs.join("\n")).toContain("ojm list --all");
	});

	it("scenario: 缺凭据 → 用法错误（2），不去联网", async () => {
		const { fetchFn, calls } = fetchStub({});
		await expect(listCommand({ siteUrl: "http://x", fetchFn })).rejects.toThrowError(/缺少站点凭据/);
		expect(calls).toEqual([]);
	});
});

/* ────────────────────────────── CLI 接线与信封 ────────────────────────────── */

interface RunResult { out: string[], err: string[], exitCode: number | undefined }

async function run(argv: string[], fetchFn: typeof fetch): Promise<RunResult> {
	vi.stubGlobal("fetch", fetchFn);
	const out: string[] = [];
	const err: string[] = [];
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		out.push(args.map(String).join(" "));
	});
	vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		err.push(args.map(String).join(" "));
	});
	const exitSpy = vi.fn();
	const exit = exitSpy as unknown as (code: number) => never;
	const cli = buildCli(process.cwd(), "zh-CN", { exit, argv });
	try {
		cli.parse(["node", "ojm", ...argv], { run: true });
	}
	catch (error) {
		reportCliError(localizeCacError(error, "zh-CN"), exit, argv);
	}
	await vi.waitUntil(() => out.length > 0 || err.length > 0 || exitSpy.mock.calls.length > 0, { timeout: 3000, interval: 10 });
	return { out, err, exitCode: exitSpy.mock.calls[0]?.[0] as number | undefined };
}

describe("list：CLI 接线与信封", () => {
	it("scenario: --json → stdout 只有一行信封，data.solutions 是过滤后的已装行", async () => {
		const { fetchFn } = fetchStub({
			"/api/auth/login": LOGIN,
			"/api/_platform/market/index": () => ok(ROWS),
		});
		const r = await run(["list", "--site-url", "http://x", "--user", "u", "--pass", "p", "--json"], fetchFn);

		expect(r.exitCode).toBeUndefined();
		expect(r.out).toHaveLength(1);
		const envelope = JSON.parse(r.out[0]!) as { ok: boolean, command: string, code: string, data: { site: string, all: boolean, solutions: SolutionRow[] } };
		expect(envelope).toMatchObject({ ok: true, command: "list", code: "ok" });
		expect(envelope.data.site).toBe("http://x");
		expect(envelope.data.all).toBe(false);
		expect(envelope.data.solutions.map(s => s.name)).toEqual(["acme-demo", "demo-solution"]);
	});

	it("scenario: --all 也进信封（all = true 且包含未装行）", async () => {
		const { fetchFn } = fetchStub({
			"/api/auth/login": LOGIN,
			"/api/_platform/market/index": () => ok(ROWS),
		});
		const r = await run(["list", "--site-url", "http://x", "--user", "u", "--pass", "p", "--all", "--json"], fetchFn);
		const envelope = JSON.parse(r.out[0]!) as { data: { all: boolean, solutions: SolutionRow[] } };
		expect(envelope.data.all).toBe(true);
		expect(envelope.data.solutions).toHaveLength(3);
	});

	it("scenario: 站点报错（索引 503）→ 业务失败（1），错误话说清楚", async () => {
		const { fetchFn } = fetchStub({
			"/api/auth/login": LOGIN,
			"/api/_platform/market/index": () => ({ ok: false, status: 503, text: async () => JSON.stringify({ code: 503, msg: "未配置市场地址" }) }),
		});
		const r = await run(["list", "--site-url", "http://x", "--user", "u", "--pass", "p"], fetchFn);
		expect(r.exitCode).toBe(1);
		expect(r.err.join("\n")).toContain("未配置市场地址");
	});
});
