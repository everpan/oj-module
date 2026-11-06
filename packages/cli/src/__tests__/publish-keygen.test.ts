// BDD：`ojm keygen --credential`（凭证通道，P5）。
//
// 三条不可退让的行为：
//   · 身份只来自凭证——服务端下发什么 key_id 就落什么目录，CLI 不推导；
//   · 兑换失败不落任何密钥文件（先兑换、后生成，顺序即保证）；
//   · 不给凭证时逐字节走原离线路径（环境变量残留不得把离线用例带进网络分支）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCli } from "../cli";
import { exchangePublishCredential } from "../keygen";

const TOKEN = "a".repeat(64);
const KEY_ID = "demo-solution.wecom-everpan";

let tmp: string;
let logs: string[];
let exitSpy: ReturnType<typeof vi.fn>;
let savedCredential: string | undefined;
let savedSite: string | undefined;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-publish-keygen-"));
	logs = [];
	exitSpy = vi.fn();
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => logs.push(args.join(" ")));
	vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => logs.push(args.join(" ")));
	// E-4：环境变量残留会把离线用例带进网络分支（先例 registry-cli.test.ts）
	savedCredential = process.env.OJM_PUBLISH_CREDENTIAL;
	savedSite = process.env.OJM_SITE_URL;
	delete process.env.OJM_PUBLISH_CREDENTIAL;
	delete process.env.OJM_SITE_URL;
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	if (savedCredential === undefined)
		delete process.env.OJM_PUBLISH_CREDENTIAL;
	else
		process.env.OJM_PUBLISH_CREDENTIAL = savedCredential;
	if (savedSite === undefined)
		delete process.env.OJM_SITE_URL;
	else
		process.env.OJM_SITE_URL = savedSite;
	fs.rmSync(tmp, { recursive: true, force: true });
});

/** 站点信封应答（oj 统一 {code,msg,data}） */
function stubExchange(env: { code: number, msg?: string, data?: unknown }): ReturnType<typeof vi.fn> {
	const fn = vi.fn(async () => new Response(JSON.stringify(env), { status: 200, headers: { "content-type": "application/json" } }));
	vi.stubGlobal("fetch", fn);
	return fn;
}

/** 跑一次 CLI 并等动作链结束（动态 import 需数百毫秒，同 cli.test.ts 的轮询口径） */
async function run(argv: string[]): Promise<{ out: string, exitCode: number | undefined }> {
	const cli = buildCli(tmp, "zh-CN", { exit: exitSpy as unknown as (code: number) => never });
	cli.parse(["node", "ojm", ...argv], { run: true });
	try {
		await vi.waitUntil(() => logs.length > 0 || exitSpy.mock.calls.length > 0, { timeout: 2500, interval: 10 });
	}
	catch {
		// 无输出型动作：兜底继续
	}
	await new Promise(r => setTimeout(r, 50));
	return { out: logs.join("\n"), exitCode: exitSpy.mock.calls[0]?.[0] as number | undefined };
}

describe("ojm keygen --credential", () => {
	it("given 有效凭证 When keygen --credential Then 落盘目录名等于服务端下发 key_id", async () => {
		const fetchFn = stubExchange({ code: 0, data: { key_id: KEY_ID, product: "demo-solution", username: "wecom:everpan", display_name: "张三" } });

		const r = await run(["keygen", "--credential", TOKEN, "--out", path.join(tmp, "keys"), "--yes"]);

		expect(r.exitCode).toBeUndefined();
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
		expect(fs.existsSync(path.join(tmp, "keys", "private.pem"))).toBe(true);
		expect(r.out).toContain(KEY_ID);
		// 申请人展示带回人话（产品 + 人名），而不是只有一串 key_id
		expect(r.out).toContain("demo-solution");
		expect(r.out).toContain("张三");
	});

	it("given 已用/过期凭证 When keygen --credential Then 非零退出且不落任何密钥", async () => {
		stubExchange({ code: 400, msg: "发布凭证无效或已失效（可能已兑换、已过期或已撤销）。请到「发布管理」页重新申请" });

		const r = await run(["keygen", "--credential", TOKEN, "--out", path.join(tmp, "keys"), "--yes"]);

		expect(r.exitCode).toBe(1);
		expect(r.out).toContain("发布管理");
		expect(fs.existsSync(path.join(tmp, "keys"))).toBe(false);
	});

	it("given 站点连不上 When keygen --credential Then 报站点地址且不落盘", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		}));

		const r = await run(["keygen", "--credential", TOKEN, "--site-url", "http://10.0.0.1:9778", "--out", path.join(tmp, "keys"), "--yes"]);

		expect(r.exitCode).toBe(1);
		expect(r.out).toContain("http://10.0.0.1:9778");
		expect(fs.existsSync(path.join(tmp, "keys"))).toBe(false);
	});

	it("given 同时给 --credential 与 --id Then exit 2 且文案说明二选一", async () => {
		const fetchFn = stubExchange({ code: 0, data: { key_id: KEY_ID } });

		const r = await run(["keygen", "--credential", TOKEN, "--id", "acme.market"]);

		expect(r.exitCode).toBe(2);
		expect(r.out).toContain("不能同时使用");
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("given 未设任何凭证 When keygen Then 走离线路径（既有行为零回归）", async () => {
		const fetchFn = stubExchange({ code: 0, data: { key_id: KEY_ID } });

		const r = await run(["keygen", "--out", path.join(tmp, "keys"), "--yes"]);

		expect(r.exitCode).toBeUndefined();
		expect(fetchFn).not.toHaveBeenCalled();
		expect(r.out).toContain("local.dev");
		expect(fs.existsSync(path.join(tmp, "keys", "private.pem"))).toBe(true);
	});

	it("given 环境变量 OJM_PUBLISH_CREDENTIAL When keygen 不带 --credential Then 仍走兑换通道", async () => {
		process.env.OJM_PUBLISH_CREDENTIAL = TOKEN;
		const fetchFn = stubExchange({ code: 0, data: { key_id: KEY_ID, product: "demo-solution", username: "u1" } });

		const r = await run(["keygen", "--out", path.join(tmp, "keys"), "--yes"]);

		expect(r.exitCode).toBeUndefined();
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(r.out).toContain(KEY_ID);
	});

	it("given 服务端返回越界 key_id When 兑换 Then 拒绝且不落盘（key_id 会拼进密钥目录）", async () => {
		stubExchange({ code: 0, data: { key_id: "../../etc", product: "x", username: "u" } });

		const r = await run(["keygen", "--credential", TOKEN, "--out", path.join(tmp, "keys"), "--yes"]);

		expect(r.exitCode).toBe(1);
		expect(r.out).toContain("key_id 非法");
		expect(fs.existsSync(path.join(tmp, "keys"))).toBe(false);
	});

	it("given 凭证不是 64 位 hex When 兑换 Then 本地即拒，不发请求", () => {
		const fetchFn = stubExchange({ code: 0, data: { key_id: KEY_ID } });

		return expect(exchangePublishCredential("short", { fetchFn: fetchFn as unknown as typeof fetch })).rejects.toThrow(/64 位十六进制/).then(() => expect(fetchFn).not.toHaveBeenCalled());
	});
});
