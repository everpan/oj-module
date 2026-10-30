// BDD：CLI 作为站点客户端必须自带租户头（企微代开发多租户，v3 Phase 0）。
//
// 宿主 `tenant.enable: true` 后 oj 对每个请求强制要 `X-TENANT-ID`——**登录这类
// 匿名端点也不放过**，缺即 `400 missing tenant header`。浏览器侧由 runtime 请求层
// 注入，CLI 是独立进程：2026-10-31 按 playbook 跑 `ojm market walkthrough` 时，
// 隔离站点刚起服就卡在登录（400 missing tenant header），install/enable/list/
// market setup/trial 同命运。本用例盯两件事：
//   ① login（匿名）与 callApi（Bearer）都带 `X-TENANT-ID: default`；
//   ② GET 无 body 时也不许因为拼头而漏掉 authorization / 误加 content-type。
import { describe, expect, it } from "vitest";
import { callApi, DEFAULT_TENANT, login, TENANT_HEADER } from "../site";

interface RecordedRequest {
	url: string
	init: RequestInit
}

/** 记录请求的 fetch stub：返回 oj 信封形态（Response 的最小可用面，见 unwrapEnvelope 形参） */
function recordingFetch(data: unknown): { fetchFn: typeof fetch, requests: RecordedRequest[] } {
	const requests: RecordedRequest[] = [];
	const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
		requests.push({ url: String(url), init });
		return {
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ code: 0, msg: "ok", data }),
		};
	}) as typeof fetch;
	return { fetchFn, requests };
}

const headers = (r: RecordedRequest): Record<string, string> => r.init.headers as Record<string, string>;

describe("站点客户端租户头（v3 Phase 0）", () => {
	it("scenario: 登录（无 Bearer）也带租户头——否则服务端 400 missing tenant header", async () => {
		const { fetchFn, requests } = recordingFetch({ access_token: "tok" });

		const token = await login(fetchFn, "http://x", "u", "p");

		expect(token).toBe("tok");
		expect(headers(requests[0]!)[TENANT_HEADER]).toBe(DEFAULT_TENANT);
	});

	it("scenario: 带 Bearer 的 GET / POST 都带租户头，且不干扰原有头", async () => {
		const { fetchFn, requests } = recordingFetch({ ok: true });

		await callApi<{ ok: boolean }>(fetchFn, "http://x", "tok", "GET", "/api/_platform/market/trust");
		await callApi<{ ok: boolean }>(fetchFn, "http://x", "tok", "POST", "/api/_platform/market/install", { name: "demo" });

		expect(headers(requests[0]!)).toEqual({ authorization: "Bearer tok", [TENANT_HEADER]: DEFAULT_TENANT });
		expect(headers(requests[1]!)[TENANT_HEADER]).toBe(DEFAULT_TENANT);
		expect(headers(requests[1]!)["content-type"]).toBe("application/json");
	});
});
