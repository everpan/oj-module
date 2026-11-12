// BDD：CLI 作为站点客户端与租户头的正确关系（企微代开发多租户，v3 Phase 0；
// 2026-11-12 强绑定复盘后重订）。
//
// 宿主 `tenant.enable: true` 后 oj 对每个请求都要租户身份，但取法分两条：
//   · **带 Bearer 的运维请求**：带 `X-TENANT-ID: default`，与 token 里的 signed claim 复核；
//   · **登录这类无 token 请求**：**不带**头——强绑定（`tenant.require_signed_claim: true`，
//     模板默认）下裸头没有 claim 可复核，oj 直接 `403 tenant requires a signed claim`；
//     正确走法是匿名路径 + 请求体自报 `tenant`（handler 内 db.asTenant 补身份），与前端同口径。
// 本用例盯两件事：
//   ① login 不注租户头而是把 tenant 放进请求体；callApi（Bearer）仍带 `X-TENANT-ID: default`；
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
	it("scenario: 登录（无 Bearer）不带租户头，改由请求体自报 tenant——强绑定下裸头 403", async () => {
		const { fetchFn, requests } = recordingFetch({ access_token: "tok" });

		const token = await login(fetchFn, "http://x", "u", "p");

		expect(token).toBe("tok");
		expect(headers(requests[0]!)[TENANT_HEADER]).toBeUndefined();
		expect(JSON.parse(String(requests[0]!.init.body))).toEqual({ username: "u", password: "p", tenant: DEFAULT_TENANT });
	});

	it("scenario: 带 Bearer 的 GET / POST 都带租户头，且不干扰原有头", async () => {
		const { fetchFn, requests } = recordingFetch({ ok: true });

		await callApi<{ ok: boolean }>(fetchFn, "http://x", "tok", "GET", "/api/oj-market/trust");
		await callApi<{ ok: boolean }>(fetchFn, "http://x", "tok", "POST", "/api/oj-market/install", { name: "demo" });

		expect(headers(requests[0]!)).toEqual({ authorization: "Bearer tok", [TENANT_HEADER]: DEFAULT_TENANT });
		expect(headers(requests[1]!)[TENANT_HEADER]).toBe(DEFAULT_TENANT);
		expect(headers(requests[1]!)["content-type"]).toBe("application/json");
	});
});
