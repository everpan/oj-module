// ScopedRequestLike 真源在 runtime contract（生成物 __client/api.ts 也从这里 import，
// 自身不再 re-export——旧写法 type import 自 __client 会在再生后 TS2305）。
import type { ScopedRequestLike } from "@oj-module/runtime/contract/errors";

// 集成回归：真实 httpMarketClient（统一后委托 ojm 生成 client）的委托行为。
// 经 bindRequest 注入 mock request，验证每条 MarketClient 方法 → 正确 URL/body/query + 返回形状；
// 并验证 index 的 503「未配置市场地址」→ [] 空态（PRD §5.3）。
//
// 不加载 @oj-module/runtime 重依赖（antd / pro-components 在 node 环境无法 import），仅桩 request、
// 透传真实 zod（供生成 client 的 DEV 响应校验走真实路径）。ContractApiError 由轻量子路径提供。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindRequest } from "../../../templates/src/_platform/web/__client/api";
import { httpMarketClient } from "../../../templates/src/oj-market/web/api/defaultClient";

// index() 直连 request（不走生成 client），故把桩 request 做成可变实现，测试内统一指向同一 mock。
const { requestImpl } = vi.hoisted(() => ({
	requestImpl: {
		get: () => { throw new Error("placeholder"); },
		post: () => { throw new Error("placeholder"); },
		put: () => { throw new Error("placeholder"); },
		delete: () => { throw new Error("placeholder"); },
		patch: () => { throw new Error("placeholder"); },
		head: () => { throw new Error("placeholder"); },
	},
}));

vi.mock("@oj-module/runtime", async () => {
	const { z } = await import("zod");
	return {
		z,
		// defaultClient 顶层 bindRequest(request) 用到；测试内立即被 mock 覆盖，不会真发请求。
		request: requestImpl,
	};
});

interface Call {
	method: string
	url: string
	opts?: { searchParams?: Record<string, string | number | boolean>, json?: unknown }
}

function mockRequest(responder: (c: Call) => { status?: number, data?: unknown }) {
	const calls: Call[] = [];
	const make = (method: string) => (url: string, opts?: Call["opts"]) => {
		calls.push({ method, url, opts });
		const r = responder({ method, url, opts });
		if (r.status && r.status >= 400) {
			// ky 形态：HTTPError 携带 response.status（httpMarketClient.isUnconfigured 依赖它）
			throw Object.assign(new Error(`HTTP ${r.status}`), { response: { status: r.status } });
		}
		return { json: () => Promise.resolve({ code: 0, data: r.data ?? null }) };
	};
	const req = {
		get: make("get"),
		post: make("post"),
		put: make("put"),
		delete: make("delete"),
		patch: make("patch"),
		head: make("head"),
	} as unknown as ScopedRequestLike;
	return { calls, req };
}

// 让 index() 直连的 request 与生成 client 的 bindRequest 指向同一 mock，行为一致。
// 桥接：占位方法零参签名 ↔ ScopedRequestLike 真实签名，经 any 双向打通（测试桩，无运行时差异）。
function bindMock(m: ReturnType<typeof mockRequest>) {
	bindRequest(m.req);
	const req = m.req as unknown as Record<keyof typeof requestImpl, () => never>;
	for (const k of Object.keys(requestImpl) as Array<keyof typeof requestImpl>)
		requestImpl[k] = req[k];
}

describe("httpMarketClient · 统一委托生成 client 集成回归", () => {
	let mock: ReturnType<typeof mockRequest>;

	beforeEach(() => {
		mock = mockRequest(() => ({ data: {} }));
		bindMock(mock);
	});

	it("meta() → GET _platform/market/meta，返回 { apiVersion }", async () => {
		mock = mockRequest(() => ({ data: { apiVersion: "1.2.3" } }));
		bindMock(mock);
		const r = await httpMarketClient.meta();
		expect(mock.calls).toEqual([{ method: "get", url: "_platform/market/meta", opts: undefined }]);
		expect(r).toEqual({ apiVersion: "1.2.3" });
	});

	it("index() → GET _platform/market/index，返回 IndexRow[]", async () => {
		const rows = [{ name: "a", latest: "1.0", installed: "1.0", enabled: true, upgradable: false }];
		mock = mockRequest(() => ({ data: rows }));
		bindMock(mock);
		const r = await httpMarketClient.index();
		expect(mock.calls[0]).toMatchObject({ method: "get", url: "_platform/market/index" });
		expect(r).toEqual(rows);
	});

	it("index() 遇 503（未配置市场地址）→ [] 空态，不抛（PRD §5.3）", async () => {
		mock = mockRequest(c => (c.url === "_platform/market/index" ? { status: 503 } : { data: {} }));
		bindMock(mock);
		const r = await httpMarketClient.index();
		expect(r).toEqual([]);
		// 503 是配置态而非故障：silentError 抑制全局 toast + retry:0 不重试（原
		// market-client-unconfigured 用例的断言并入此处——工厂形态退役后唯一活口）
		expect(mock.calls).toHaveLength(1);
		expect(mock.calls[0].opts).toMatchObject({ silentError: true, retry: 0 });
	});

	it("install(input) → POST _platform/market/install，body 含 name/version/source", async () => {
		mock = mockRequest(() => ({ data: { task_id: "t-1" } }));
		bindMock(mock);
		const r = await httpMarketClient.install({ name: "alpha", version: "2.0", source: "file" });
		expect(mock.calls[0]).toMatchObject({ method: "post", url: "_platform/market/install" });
		expect(mock.calls[0].opts?.json).toEqual({ name: "alpha", version: "2.0", source: "file" });
		expect(r).toEqual({ task_id: "t-1" });
	});

	it("install(input) 缺省 version/source → null / cdn 兜底", async () => {
		mock = mockRequest(() => ({ data: { task_id: "t-2" } }));
		bindMock(mock);
		await httpMarketClient.install({ name: "beta" });
		expect(mock.calls[0].opts?.json).toEqual({ name: "beta", version: null, source: "cdn" });
	});

	it("task(id) → GET _platform/market/task? 带 id", async () => {
		const rec = { id: "t-1", name: "a", version: "1.0", status: "done", stage: "done", progress: 100, message: "ok", stages: [], startedAt: 1 };
		mock = mockRequest(() => ({ data: rec }));
		bindMock(mock);
		const r = await httpMarketClient.task("t-1");
		expect(mock.calls[0]).toMatchObject({ method: "get", url: "_platform/market/task" });
		expect(mock.calls[0].opts?.searchParams).toEqual({ id: "t-1" });
		expect(r).toEqual(rec);
	});

	it("enable(input) → POST _platform/market/enable，body {name,enabled}", async () => {
		mock = mockRequest(() => ({ data: { ok: true, message: "done" } }));
		bindMock(mock);
		const r = await httpMarketClient.enable({ name: "a", enabled: false });
		expect(mock.calls[0]).toMatchObject({ method: "post", url: "_platform/market/enable" });
		expect(mock.calls[0].opts?.json).toEqual({ name: "a", enabled: false });
		expect(r).toEqual({ ok: true, message: "done" });
	});

	it("history() → GET _platform/market/history，返回 MarketHistory[]", async () => {
		const hist = [{ id: 1, solution: "a", version: "1.0", action: "install", status: "ok", operator: null, message: null, created_at: 1 }];
		mock = mockRequest(() => ({ data: hist }));
		bindMock(mock);
		const r = await httpMarketClient.history();
		expect(mock.calls[0]).toMatchObject({ method: "get", url: "_platform/market/history" });
		expect(r).toEqual(hist);
	});

	it("uninstallImpact(name) → GET _platform/market/uninstall-impact? 带 name", async () => {
		mock = mockRequest(() => ({ data: { name: "a", affectedRoles: 2, affectedUsers: 5 } }));
		bindMock(mock);
		const r = await httpMarketClient.uninstallImpact("a");
		expect(mock.calls[0]).toMatchObject({ method: "get", url: "_platform/market/uninstall-impact" });
		expect(mock.calls[0].opts?.searchParams).toEqual({ name: "a" });
		expect(r).toEqual({ name: "a", affectedRoles: 2, affectedUsers: 5 });
	});

	it("uninstall(name) → POST _platform/market/uninstall，body {name}", async () => {
		mock = mockRequest(() => ({ data: { ok: true, message: "removed" } }));
		bindMock(mock);
		const r = await httpMarketClient.uninstall("a");
		expect(mock.calls[0]).toMatchObject({ method: "post", url: "_platform/market/uninstall" });
		expect(mock.calls[0].opts?.json).toEqual({ name: "a" });
		expect(r).toEqual({ ok: true, message: "removed" });
	});
});
