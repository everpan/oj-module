// factory-converge spec：出厂即装触发（支柱三）。
//
// 服务端 isolate 无 setTimeout（wecom/client.ts 同结论）、boot 有 2s 看门狗，随站 bundle
// 收敛只能 riding 首个编排请求（对账即服务）。「默认安装好」要求零首装仪式——
// ojm dev / ojm preview 后端就绪后由 CLI fire-and-forget 触发一次：
//   login（superadmin/aA123456，脚手架种子）→ GET <apiBase>/oj-market/index（
//   indexBody 里 riding 收敛，幂等：已对齐即全 skip）。安装在服务端完成（含 DB 注册面），
//   CLI 无法替代。失败一律吞咽——不阻断 dev/preview 启动，下次 index 对账再试
//   （首个真实请求或下次启动）。
//
// 行为钉：调用序（先 login 后 index）、Bearer 透传、信封 code≠0 视为失败、
// 网络错/登录错吞咽不抛、火忘模式（调用方不得 await 收敛完成）。

import { describe, expect, it } from "vitest";

import { triggerFactoryConverge } from "../market/factory-converge";

interface Call {
	url: string
	method: string
	headers: Record<string, string>
}

function fakeFetch(calls: Call[], behavior: { loginCode?: number, indexStatus?: number, throwOn?: "login" | "index" } = {}) {
	return async (url: string, init?: RequestInit) => {
		calls.push({
			url,
			method: init?.method ?? "GET",
			headers: Object.fromEntries(new Headers(init?.headers).entries()),
		});
		if (behavior.throwOn === "login" && url.endsWith("/auth/login"))
			throw new Error("ECONNREFUSED");
		if (behavior.throwOn === "index" && url.endsWith("/oj-market/index"))
			throw new Error("socket hang up");
		if (url.endsWith("/auth/login")) {
			return new Response(JSON.stringify({ code: behavior.loginCode ?? 0, data: { access_token: "TOK" } }), { status: 200 });
		}
		return new Response(JSON.stringify({ code: 0, data: { list: [], total: 0 } }), { status: behavior.indexStatus ?? 200 });
	};
}

describe("triggerFactoryConverge（出厂即装：后端就绪后触发一次随站 bundle 收敛）", () => {
	it("login → GET index 调用序 + Bearer 透传（apiBase 随 config 挂载前缀）", async () => {
		const calls: Call[] = [];
		await triggerFactoryConverge({
			port: 9778,
			apiBase: "/api",
			fetchImpl: fakeFetch(calls) as unknown as typeof fetch,
			log: () => {},
		});

		expect(calls).toHaveLength(2);
		expect(calls[0]!.url).toBe("http://127.0.0.1:9778/api/auth/login");
		expect(calls[0]!.method).toBe("POST");
		expect(calls[1]!.url).toBe("http://127.0.0.1:9778/api/oj-market/index");
		expect(calls[1]!.headers.authorization).toBe("Bearer TOK");
	});

	it("登录信封 code≠0 → 不请求 index，吞咽不抛", async () => {
		const calls: Call[] = [];
		await triggerFactoryConverge({
			port: 9778,
			fetchImpl: fakeFetch(calls, { loginCode: 401 }) as unknown as typeof fetch,
			log: () => {},
		});
		expect(calls).toHaveLength(1);
	});

	it("网络错（login/index 任一段）吞咽不抛——不阻断 dev/preview 启动", async () => {
		const calls: Call[] = [];
		await triggerFactoryConverge({
			port: 9778,
			fetchImpl: fakeFetch(calls, { throwOn: "index" }) as unknown as typeof fetch,
			log: () => {},
		});
		expect(calls).toHaveLength(2);
	});
});
