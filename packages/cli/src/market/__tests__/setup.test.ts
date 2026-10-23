// ojm market setup spec（T5）：首跑打开市场地址。
//
// 两条必守：① 写出的地址必须是 config 推导的**绝对 URL**（dev 形态下相对路径会拿到 index.html，
// 见设计 §3.1.1）；② seed admin 处于 must_change 悬挂期时，登录拿的是限权 token，
// 必须先改密拿全权 token 才写得了 system 设置——这条不闭环，首跑就直接卡死。
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loginPasswordAfterSetup, setupMarketUrl } from "../setup";

const MOUNTS = "  - prefix: /api\n    api: src\n  - prefix: /cdn\n    web: ../cdn\n";
const CONFIG = `mounts:\n${MOUNTS}server:\n  host: 127.0.0.1\n  port: 9778\n`;
const MARKET_KEY = "framework.market_cdn_url";

interface Call {
	url: string
	method: string
	body?: Record<string, unknown>
	auth?: string
}

/** 假站点：可编排 login 是否受限、settings 是否拒绝 */
function fakeSite(opts: { restricted?: boolean, rejectSettings?: boolean, rejectLogin?: boolean } = {}) {
	const calls: Call[] = [];
	const fetchFn = (async (url: string, init?: { method?: string, body?: string, headers?: Record<string, string> }): Promise<Response> => {
		const method = init?.method ?? "GET";
		const body = init?.body === undefined ? undefined : JSON.parse(init.body) as Record<string, unknown>;
		calls.push({ url, method, body, auth: init?.headers?.authorization });
		if (url.endsWith("/api/auth/login")) {
			if (opts.rejectLogin === true)
				return json({ code: 401, msg: "用户名或密码错误", data: null });
			return json({ code: 0, msg: "ok", data: { access_token: "token-limited", restricted: opts.restricted === true } });
		}
		if (url.endsWith("/api/auth/password"))
			return json({ code: 0, msg: "ok", data: { access_token: "token-full", refresh_token: "r", expires_in: 3600 } });
		if (url.endsWith("/api/system/settings")) {
			if (opts.rejectSettings === true)
				return json({ code: 403, msg: "must_change", data: null });
			return json({ code: 0, msg: "ok", data: true });
		}
		throw new Error(`未预期的请求：${method} ${url}`);
	}) as unknown as typeof fetch;
	return { calls, fetchFn };
}

function json(payload: unknown): Response {
	return { ok: true, status: 200, text: async () => JSON.stringify(payload) } as unknown as Response;
}

function newProject(): string {
	const root = mkdtempSync(join(tmpdir(), "ojm-market-setup-"));
	mkdirSync(join(root, "api"), { recursive: true });
	writeFileSync(join(root, "api", "config.yaml"), CONFIG, "utf-8");
	mkdirSync(join(root, "cdn"), { recursive: true });
	return root;
}

describe("given 站点可直连且凭据未悬挂 When setup", () => {
	it("then 直接写入 config 推导的绝对市场地址", async () => {
		const root = newProject();
		const site = fakeSite();

		const result = await setupMarketUrl({ projectRoot: root, user: "admin", pass: "123456", url: "http://127.0.0.1:9778", fetchFn: site.fetchFn });

		expect(result.cdnBaseUrl).toBe("http://127.0.0.1:9778/cdn");
		const put = site.calls.find(c => c.url.endsWith("/api/system/settings"))!;
		expect(put.method).toBe("PUT");
		expect(put.body).toEqual({ key: MARKET_KEY, value: "http://127.0.0.1:9778/cdn" });
		expect(result.changedPassword).toBe(false);
	});
});

describe("given seed admin 处于 must_change 悬挂期 When setup", () => {
	it("then 先改密换全权 token，再写设置（且后续请求用新 token）", async () => {
		const root = newProject();
		const site = fakeSite({ restricted: true });

		const result = await setupMarketUrl({ projectRoot: root, user: "admin", pass: "123456", newPass: "newpass-123", url: "http://127.0.0.1:9778", fetchFn: site.fetchFn });

		expect(result.changedPassword).toBe(true);
		const pwd = site.calls.find(c => c.url.endsWith("/api/auth/password"))!;
		expect(pwd.method).toBe("PUT");
		expect(pwd.body).toEqual({ old_password: "123456", new_password: "newpass-123" });
		const put = site.calls.find(c => c.url.endsWith("/api/system/settings"))!;
		expect(put.auth).toBe("Bearer token-full");
	});
});

describe("given 站点不可达 When setup", () => {
	it("then 抛人话错误提示先起站点，不写任何东西", async () => {
		const root = newProject();
		const failing = async (): Promise<Response> => {
			throw new Error("ECONNREFUSED");
		};
		const fetchFn = failing as unknown as typeof fetch;

		await expect(setupMarketUrl({ projectRoot: root, user: "admin", pass: "123456", url: "http://127.0.0.1:9778", fetchFn }))
			.rejects
			.toThrow(/ojm dev/);
	});
});

describe("given 改密后写设置仍被拒 When setup", () => {
	it("then 抛人话错误而不是静默成功", async () => {
		const root = newProject();
		const site = fakeSite({ restricted: true, rejectSettings: true });

		await expect(setupMarketUrl({ projectRoot: root, user: "admin", pass: "123456", newPass: "newpass-123", url: "http://127.0.0.1:9778", fetchFn: site.fetchFn }))
			.rejects
			.toThrow(/must_change|权限|设置/);
	});
});

describe("given setup 返回 changedPassword When 选 setup 后的登录口令", () => {
	it("then 改密已发生用 newPass，未改密用原种子口令（must_change=0 是当前 seed 常态）", () => {
		expect(loginPasswordAfterSetup({ siteUrl: "", cdnBaseUrl: "", changedPassword: true }, "new-pass", "123456")).toBe("new-pass");
		expect(loginPasswordAfterSetup({ siteUrl: "", cdnBaseUrl: "", changedPassword: false }, "new-pass", "123456")).toBe("123456");
	});
});
