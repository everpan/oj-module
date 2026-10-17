import type { TaskRecord } from "../../site";
// BDD：CLI 瘦客户端（P1-13，D6/D8）。三块：参数解析 / 轮询退避 / 终态渲染，另加
// install 双源（file 上传 / cdn）端到端 stub fetch 用例钉住请求形状（信封 {code,msg,data}、
// Bearer 注入、multipart 字段与服务端 uploadBytes 消费面对齐）。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLifecycleArgs } from "../../args";
import { setEnabledCommand } from "../../enable";
import { installCommand, parseTarget, renderOutcome } from "../../install";
import { pollTask, resolveSite } from "../../site";

/** 终态记录工厂（§10.2 形状，测试只需关键字段） */
function rec(over: Partial<TaskRecord> = {}): TaskRecord {
	return {
		id: "install-1-abc",
		name: "demo-solution",
		version: "0.1.0",
		status: "done",
		stage: "done",
		progress: 100,
		message: "安装完成",
		stages: [],
		startedAt: 1,
		finishedAt: 2,
		...over,
	};
}

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

describe("parseLifecycleArgs · 参数解析", () => {
	it("位置参数与值式 flag 分离：--url 等的值不被误当位置参数（P6 同款坑）", () => {
		const a = parseLifecycleArgs(["demo-solution@0.1.0", "--url", "http://x:1", "--user", "u", "--pass", "p", "--locale", "en-US"]);
		expect(a.positionals).toEqual(["demo-solution@0.1.0"]);
		expect(a.url).toBe("http://x:1");
		expect(a.user).toBe("u");
		expect(a.pass).toBe("p");
		expect(a.locale).toBe("en-US");
	});

	it("install 专属 --name/--version 覆盖位", () => {
		const a = parseLifecycleArgs(["./a.tgz", "--name", "demo-solution", "--version", "0.2.0"]);
		expect(a.positionals).toEqual(["./a.tgz"]);
		expect(a.name).toBe("demo-solution");
		expect(a.version).toBe("0.2.0");
	});

	it("未知 --flag 忽略不炸", () => {
		expect(parseLifecycleArgs(["x", "--future"]).positionals).toEqual(["x"]);
	});
});

describe("resolveSite · 站点寻址（flag > 环境变量 > 缺省模板 serve 端口 9778）", () => {
	const ENV_BACKUP = { ...process.env };

	afterEach(() => {
		process.env = { ...ENV_BACKUP };
	});

	it("缺省 base = http://127.0.0.1:9778（模板 config.yaml server.port）", () => {
		expect(resolveSite({ user: "u", pass: "p" })).toEqual({ base: "http://127.0.0.1:9778", user: "u", pass: "p" });
	});

	it("环境变量 OJM_URL/OJM_USER/OJM_PASS 兜底；flag 优先；尾斜杠归一", () => {
		process.env.OJM_URL = "http://env:9/";
		process.env.OJM_USER = "eu";
		process.env.OJM_PASS = "ep";
		expect(resolveSite({})).toEqual({ base: "http://env:9", user: "eu", pass: "ep" });
		expect(resolveSite({ url: "http://flag:8/", user: "fu", pass: "fp" }).base).toBe("http://flag:8");
	});

	it("缺凭据即人话报错（凭据只走内存不落盘）", () => {
		delete process.env.OJM_USER;
		delete process.env.OJM_PASS;
		expect(() => resolveSite({})).toThrow(/OJM_USER\/OJM_PASS/);
	});
});

describe("pollTask · 轮询退避（800ms 起步指数退避、上限 5s、超时报错）", () => {
	const sleepLog: number[] = [];
	const sleep = async (ms: number) => {
		sleepLog.push(ms);
	};

	it("running 两拍后 done：间隔 800→1600 指数退避，返回终态", async () => {
		sleepLog.length = 0;
		let n = 0;
		const { fetchFn } = fetchStub({
			"/api/_platform/market/task": () => ok(n++ < 2 ? rec({ status: "running", progress: 30 * n }) : rec()),
		});
		const r = await pollTask(fetchFn, "http://x", "tok", "t1", { sleep });
		expect(r.status).toBe("done");
		expect(sleepLog).toEqual([800, 1600]);
	});

	it("间隔封顶 5s：第 4 拍起不再翻倍", async () => {
		sleepLog.length = 0;
		let n = 0;
		const { fetchFn } = fetchStub({
			"/api/_platform/market/task": () => ok(rec({ status: n++ < 5 ? "running" : "done", progress: 10 + n })),
		});
		const r = await pollTask(fetchFn, "http://x", "tok", "t1", { sleep, timeoutMs: 20_000 });
		expect(r.status).toBe("done");
		expect(sleepLog).toEqual([800, 1600, 3200, 5000, 5000]);
	});

	it("超时报错：总等待预算耗尽即人话退出", async () => {
		sleepLog.length = 0;
		const { fetchFn } = fetchStub({
			"/api/_platform/market/task": () => ok(rec({ status: "running" })),
		});
		await expect(pollTask(fetchFn, "http://x", "tok", "t1", { sleep, timeoutMs: 1000 })).rejects.toThrow(/超时/);
		expect(sleepLog).toEqual([800]);
	});

	it("查询参数形态：task?id=<id>（非路径段，P1-12 裁决）", async () => {
		const { fetchFn, calls } = fetchStub({
			"/api/_platform/market/task": () => ok(rec()),
		});
		await pollTask(fetchFn, "http://x", "tok", "t1", { sleep });
		expect(calls[0]?.url).toContain("task?id=t1");
	});
});

describe("renderOutcome · 终态渲染（reason + retryable + hintKey 双语文案，契约附录 A）", () => {
	it("done：单行完成文案", () => {
		const text = renderOutcome(rec(), "zh-CN");
		expect(text).toContain("安装完成");
		expect(text).toContain("demo-solution 0.1.0");
	});

	it("failed zh-CN：原因 + 指引 + 重试标注三行齐", () => {
		const text = renderOutcome(rec({
			status: "failed",
			stage: "preflight",
			error: { reason: "预检未通过：名称被保留", retryable: false, hintKey: "lifecycle.stage.preflight.hint" },
		}), "zh-CN");
		expect(text).toContain("安装失败");
		expect(text).toContain("预检未通过：名称被保留");
		expect(text).toContain("请修正方案清单或释放占用的名称与前缀后重新安装");
		expect(text).toContain("本次失败不可自动重试");
		expect(text).toContain("lifecycle.stage.preflight.hint");
	});

	it("partial zh-CN：部分生效标注 + smoke 指引", () => {
		const text = renderOutcome(rec({
			status: "partial",
			stage: "smoke",
			error: { reason: "冒烟检查未通过", retryable: false, hintKey: "lifecycle.stage.smoke.hint" },
		}), "zh-CN");
		expect(text).toContain("部分生效");
		expect(text).toContain("可先禁用该方案恢复原状");
	});

	it("en-US：双语全表取 en 列", () => {
		const text = renderOutcome(rec({
			status: "failed",
			stage: "downloading",
			error: { reason: "download boom", retryable: true, hintKey: "lifecycle.stage.downloading.hint" },
		}), "en-US");
		expect(text).toContain("Install failed");
		expect(text).toContain("Check the network and market URL");
		expect(text).toContain("This failure is retryable");
	});

	it("未知 stage：兜底指引不炸", () => {
		const text = renderOutcome(rec({
			status: "failed",
			stage: "mystery",
			error: { reason: "boom", retryable: true, hintKey: "lifecycle.stage.mystery.hint" },
		}), "zh-CN");
		expect(text).toContain("boom");
		expect(text).toContain("本次失败可重试");
	});
});

describe("parseTarget · 安装目标解析", () => {
	it("name[@version] → cdn 源", () => {
		expect(parseTarget("demo-solution")).toEqual({ kind: "cdn", name: "demo-solution", version: null });
		expect(parseTarget("demo-solution@0.1.0")).toEqual({ kind: "cdn", name: "demo-solution", version: "0.1.0" });
	});

	it(".tgz 路径 → file 源；<name>-<version>.tgz 文件名推导身份", () => {
		expect(parseTarget("dist/demo-solution-0.1.0.tgz")).toEqual({ kind: "file", path: "dist/demo-solution-0.1.0.tgz", name: "demo-solution", version: "0.1.0" });
		expect(parseTarget("weird.tgz")).toEqual({ kind: "file", path: "weird.tgz", name: null, version: null });
	});

	it("prerelease 文件名推导：demo-solution-1.0.0-beta.tgz → version 含 -beta 段（Finding C）", () => {
		expect(parseTarget("demo-solution-1.0.0-beta.tgz")).toEqual({ kind: "file", path: "demo-solution-1.0.0-beta.tgz", name: "demo-solution", version: "1.0.0-beta" });
		expect(parseTarget("demo-1.0.0-rc.1.tgz")).toEqual({ kind: "file", path: "demo-1.0.0-rc.1.tgz", name: "demo", version: "1.0.0-rc.1" });
	});

	it("cdn 名含非法形状（空名）即报错", () => {
		expect(() => parseTarget("@0.1.0")).toThrow();
	});
});

describe("installCommand · file 源端到端（stub fetch：登录 → multipart 上传 → 轮询终态）", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "ojm-install-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("登录后 Bearer 注入；FormData 字段与服务端 http.files 消费面对齐；终态 done 打印", async () => {
		const tgz = join(dir, "demo-solution-0.1.0.tgz");
		writeFileSync(tgz, "fake-tgz-bytes");
		const { fetchFn, calls } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok-1", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/install": () => ok({ task_id: "t1" }),
			"/api/_platform/market/task": () => ok(rec()),
		});
		await installCommand(tgz, { url: "http://x", user: "u", pass: "p", fetchFn, sleep: async () => {} });
		// 登录体
		const loginBody = JSON.parse(String(calls[0]?.init?.body));
		expect(loginBody).toEqual({ username: "u", password: "p" });
		// install：multipart 字段 + Bearer
		const installCall = calls[1]!;
		expect(installCall.init?.method).toBe("POST");
		expect((installCall.init?.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
		const form = installCall.init?.body as FormData;
		expect(form.get("name")).toBe("demo-solution");
		expect(form.get("version")).toBe("0.1.0");
		expect(form.get("source")).toBe("file");
		expect(form.get("file")).toBeInstanceOf(File);
		// 轮询带 Bearer；终态渲染
		expect(calls[2]?.url).toContain("task?id=t1");
		expect((calls[2]?.init?.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
		expect(logs.join("\n")).toContain("安装完成");
	});

	it("终态 failed：非零退出码（exitCode），多行人话已打印", async () => {
		const tgz = join(dir, "demo-solution-0.1.0.tgz");
		writeFileSync(tgz, "fake-tgz-bytes");
		const { fetchFn } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/install": () => ok({ task_id: "t1" }),
			"/api/_platform/market/task": () => ok(rec({
				status: "failed",
				stage: "migrating",
				error: { reason: "迁移失败", retryable: true, hintKey: "lifecycle.stage.migrating.hint" },
			})),
		});
		const exitBackup = process.exitCode;
		process.exitCode = 0;
		try {
			await installCommand(tgz, { url: "http://x", user: "u", pass: "p", fetchFn, sleep: async () => {} });
			expect(process.exitCode).toBe(1);
		}
		finally {
			process.exitCode = exitBackup;
		}
		expect(logs.join("\n")).toContain("数据已保留原状，请修复后重试");
	});

	it("信封非 0：可读报错（code + msg）", async () => {
		const tgz = join(dir, "demo-solution-0.1.0.tgz");
		writeFileSync(tgz, "x");
		const { fetchFn } = fetchStub({
			"/api/auth/login": () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 401, msg: "invalid credentials" }) }),
		});
		await expect(installCommand(tgz, { url: "http://x", user: "u", pass: "bad", fetchFn })).rejects.toThrow(/invalid credentials/);
	});
});

describe("installCommand · cdn 源（JSON 体 name@version）", () => {
	it("source=cdn 的 JSON 体 + 版本缺省 null", async () => {
		const { fetchFn, calls } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/install": () => ok({ task_id: "t1" }),
			"/api/_platform/market/task": () => ok(rec()),
		});
		await installCommand("demo-solution", { url: "http://x", user: "u", pass: "p", fetchFn, sleep: async () => {} });
		const installCall = calls[1]!;
		expect((installCall.init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
		expect(JSON.parse(String(installCall.init?.body))).toEqual({ name: "demo-solution", version: null, source: "cdn" });
	});

	it("@version 透传", async () => {
		const { fetchFn, calls } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/install": () => ok({ task_id: "t1" }),
			"/api/_platform/market/task": () => ok(rec()),
		});
		await installCommand("demo-solution@0.2.0", { url: "http://x", user: "u", pass: "p", fetchFn, sleep: async () => {} });
		expect(JSON.parse(String(calls[1]?.init?.body)).version).toBe("0.2.0");
	});
});

describe("setEnabledCommand · enable/disable 瘦客户端（D8）", () => {
	it("pOST enable {name, enabled} → 打印服务端 message；ok:false 非零退出", async () => {
		const { fetchFn, calls } = fetchStub({
			"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
			"/api/_platform/market/enable": () => ok({ ok: true, message: "启用完成：四处同写" }),
		});
		await setEnabledCommand("demo-solution", true, { url: "http://x", user: "u", pass: "p", fetchFn });
		const call = calls[1]!;
		expect(call.url).toContain("/api/_platform/market/enable");
		expect(JSON.parse(String(call.init?.body))).toEqual({ name: "demo-solution", enabled: true });
		expect(logs.join("\n")).toContain("启用完成：四处同写");

		const exitBackup = process.exitCode;
		process.exitCode = 0;
		try {
			const { fetchFn: fetchFn2 } = fetchStub({
				"/api/auth/login": () => ok({ access_token: "tok", refresh_token: "r", expires_in: 1 }),
				"/api/_platform/market/enable": () => ok({ ok: false, message: "禁用失败：「x」未安装" }),
			});
			await setEnabledCommand("x", false, { url: "http://x", user: "u", pass: "p", fetchFn: fetchFn2 });
			expect(process.exitCode).toBe(1);
		}
		finally {
			process.exitCode = exitBackup;
		}
		expect(logs.join("\n")).toContain("禁用失败：「x」未安装");
	});
});
