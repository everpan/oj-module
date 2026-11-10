// factory-converge spec：出厂即装触发（支柱三）。
//
// 服务端 isolate 无 setTimeout（wecom/client.ts 同结论）、boot 有 2s 看门狗，随站 bundle
// 收敛只能 riding 首个编排请求（对账即服务）。「默认安装好」要求零首装仪式——
// ojm dev / ojm preview 后端就绪后由 CLI fire-and-forget 触发一次：
//   POST <apiBase>/oj-market/converge（头 x-ojm-converge-token；2026-11-10 起替代
//   账密登录 superadmin/aA123456——密码被改则登录 401 被吞咽，零首装仪式静默失效）。
//   token = 启动时随机生成、经派生 config vars.ojm_converge_token 注入服务端（生产站点
//   无此 var → 端点 404 即死）。安装在服务端完成（含 DB 注册面），CLI 无法替代。
//   失败一律吞咽——不阻断 dev/preview 启动，下次 index 对账再试（首个真实请求或下次启动）。
//
// 行为钉：单次 POST（无 login 前奏）、token 头透传、非 2xx 吞咽不抛、火忘模式。

import { describe, expect, it } from "vitest";

import { triggerFactoryConverge } from "../market/factory-converge";

interface Call {
	url: string
	method: string
	headers: Record<string, string>
	body?: string
}

function fakeFetch(calls: Call[], behavior: { convergeStatus?: number, throwOnConverge?: boolean } = {}) {
	return async (url: string, init?: RequestInit) => {
		calls.push({
			url,
			method: init?.method ?? "GET",
			headers: Object.fromEntries(new Headers(init?.headers).entries()),
			body: typeof init?.body === "string" ? init.body : undefined,
		});
		if (behavior.throwOnConverge)
			throw new Error("ECONNREFUSED");
		return new Response(JSON.stringify({ code: 0, data: { ok: true } }), { status: behavior.convergeStatus ?? 200 });
	};
}

describe("triggerFactoryConverge（出厂即装：后端就绪后触发一次随站 bundle 收敛）", () => {
	it("单次 POST /oj-market/converge + x-ojm-converge-token 头透传（apiBase 随 config 挂载前缀；无 login 前奏）", async () => {
		const calls: Call[] = [];
		await triggerFactoryConverge({
			port: 9778,
			apiBase: "/api",
			token: "dev-run-token",
			fetchImpl: fakeFetch(calls) as unknown as typeof fetch,
			log: () => {},
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe("http://127.0.0.1:9778/api/oj-market/converge");
		expect(calls[0]!.method).toBe("POST");
		expect(calls[0]!.headers["x-ojm-converge-token"]).toBe("dev-run-token");
		expect(calls[0]!.url).not.toContain("/auth/login");
	});

	it("端点非 2xx（404 端点即死/后端半就绪）→ 吞咽不抛", async () => {
		const calls: Call[] = [];
		await triggerFactoryConverge({
			port: 9778,
			token: "tok",
			fetchImpl: fakeFetch(calls, { convergeStatus: 404 }) as unknown as typeof fetch,
			log: () => {},
		});
		expect(calls).toHaveLength(1);
	});

	it("网络错吞咽不抛——不阻断 dev/preview 启动", async () => {
		const calls: Call[] = [];
		await triggerFactoryConverge({
			port: 9778,
			token: "tok",
			fetchImpl: fakeFetch(calls, { throwOnConverge: true }) as unknown as typeof fetch,
			log: () => {},
		});
		expect(calls).toHaveLength(1);
	});
});
