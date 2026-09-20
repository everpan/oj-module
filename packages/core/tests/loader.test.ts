import type { Manifest } from "../src/types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDevFlag } from "../src/host";
import {
	getAllRoutePathKeys,
	getKeepAliveExcludeKeys,
	getModule,
	getRegisteredMenus,
	getRegisteredStore,
	getRoutes,
	getSlotNodes,
	loadAll,
	onRoutesReady,
	setI18nBridge,
	setRouteAuthzProvider,
	setUnderlyingRequest,
	unloadModule,
} from "../src/index";

/**
 * entry.ts 经 data: URL 动态导入（node 原生支持 data: import）。
 * 生命周期函数无法走 JSON.stringify——经 globalThis.__order 通道回传调用序。
 */
const G = globalThis as { __order?: string[] };

interface DefSpec {
	name: string
	routes?: unknown[]
	peerRuntime?: string
	config?: Record<string, unknown>
	lifecycleSource?: string
}

function entryUrl(spec: DefSpec): string {
	const base = JSON.stringify({
		name: spec.name,
		description: "",
		version: "1.0.0",
		routes: spec.routes ?? [{ path: `/${spec.name}`, handle: { title: spec.name } }],
		peerRuntime: spec.peerRuntime,
		config: spec.config,
	});
	const lifecycle = spec.lifecycleSource ? `, { lifecycle: { ${spec.lifecycleSource} } }` : "";
	return `data:text/javascript;charset=utf-8,${encodeURIComponent(`export default Object.assign(${base}${lifecycle})`)}`;
}

function manifest(specs: DefSpec[], runtimeVersion?: string): Manifest {
	return {
		modules: specs.map(s => ({ name: s.name, entry: entryUrl(s) })),
		runtimeVersion,
	};
}

const requestStub = Object.assign(() => Promise.resolve(), {
	get: () => Promise.resolve(),
	post: () => Promise.resolve(),
	put: () => Promise.resolve(),
	patch: () => Promise.resolve(),
	delete: () => Promise.resolve(),
	head: () => Promise.resolve(),
});

beforeEach(() => {
	setUnderlyingRequest(requestStub);
	setI18nBridge({ addResourceBundle: () => {} });
	setDevFlag(false);
	setRouteAuthzProvider(() => ({ roles: [], permissions: [] }));
	G.__order = [];
});

afterEach(async () => {
	for (const m of ["a", "b", "peer", "dep", "dep2"]) {
		await unloadModule(m);
	}
	vi.restoreAllMocks();
});

describe("loadAll 引擎（全生命周期 + 三处事件化）", () => {
	it("正常加载：生命周期按序执行、路由就绪事件发布（事件化①）、ctx.menu/store 可用", async () => {
		const ready: string[][] = [];
		const off = onRoutesReady(routes => ready.push(routes.map(r => String((r as { id?: string }).id))));
		const result = await loadAll(manifest([{
			name: "a",
			lifecycleSource: [
				"beforeInit: (ctx) => { globalThis.__order.push('beforeInit'); ctx.register.apiPrefix('/auth'); ctx.register.store('aStore', { v: 1 }); }",
				"onInit: (ctx) => { globalThis.__order.push('onInit'); ctx.register.menu((p) => [{ key: 'a', name: 'A', href: '/w/' + (p.workspaceSlug || '-') + '/p/' + (p.projectId || '-'), icon: null, access: [], shouldRender: true, sortOrder: 1, i18n_key: 'sidebar.a' }]); ctx.registerSlot('header-actions', 'A'); }",
			].join(", "),
		}]));
		off();

		expect(G.__order).toEqual(["beforeInit", "onInit"]); // onActivate 不在 loadAll（R0-3）
		expect(ready).toHaveLength(1);
		expect(ready[0]).toContain("/a");
		expect(getRegisteredStore<{ v: number }>("aStore")?.v).toBe(1);
		// 菜单贡献是工厂：同一份注册在两次不同 params 下现算出两个 href（PRD §5.1 的渲染期现算）
		expect(getRegisteredMenus({ workspaceSlug: "acme", projectId: "p1" })[0]!.href).toBe("/w/acme/p/p1");
		expect(getRegisteredMenus({ workspaceSlug: "beta", projectId: "p2" })[0]!.href).toBe("/w/beta/p/p2");
		expect(getRegisteredMenus({ workspaceSlug: "acme", projectId: "p1" })[0]!.key).toBe("a");
		expect(getSlotNodes("header-actions")).toEqual(["A"]);
		expect(result[0]!.status).toBe("loaded");
	});

	it("事件化②：authz 钩子前置过滤（requiredRoles）", async () => {
		setRouteAuthzProvider(() => ({ roles: ["viewer"], permissions: [] }));
		await loadAll(manifest([
			{ name: "a", config: { requiredRoles: ["admin"] } },
			{ name: "b", config: { requiredRoles: ["viewer", "admin"] } },
		]));
		const ids = getRoutes().map(r => String((r as { id?: string }).id));
		expect(ids.some(p => p.includes("/a"))).toBe(false);
		expect(ids.some(p => p.includes("/b"))).toBe(true);
	});

	it("peerRuntime 不兼容 → error 态 + 无路由（禁止静默成功）", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		await loadAll(manifest([{ name: "peer", peerRuntime: "^9.0.0" }], "1.0.0"));
		expect(getModule("peer")?.status).toBe("error");
		expect(getRoutes()).toHaveLength(0);
		expect(err).toHaveBeenCalled();
	});

	it("依赖缺失 → missing-deps 跳过生命周期（禁止半加载）；依赖在则拓扑先行", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		await loadAll(manifest([{ name: "dep", config: { dependencies: ["missing-mod"] } }]));
		expect(getModule("dep")?.status).toBe("missing-deps");
		expect(err).toHaveBeenCalled();
		err.mockRestore();

		G.__order = [];
		await loadAll(manifest([
			{ name: "dep", lifecycleSource: "onInit: () => { globalThis.__order.push('dep'); }" },
			{ name: "dep2", config: { dependencies: ["dep"] }, lifecycleSource: "onInit: () => { globalThis.__order.push('dep2'); }" },
		]));
		expect(G.__order).toEqual(["dep", "dep2"]);
	});

	it("unloadModule 清理：路由、插槽、菜单全退场", async () => {
		await loadAll(manifest([{
			name: "a",
			lifecycleSource: "onInit: (ctx) => { ctx.register.menu(() => [{ key: 'm', name: 'M', href: '/m', icon: null, access: [], shouldRender: true, sortOrder: 1, i18n_key: 'm' }]); ctx.registerSlot('s', 'N'); }",
		}]));
		expect(getModule("a")?.status).toBe("loaded");
		await unloadModule("a");
		expect(getModule("a")).toBeUndefined();
		expect(getSlotNodes("s")).toEqual([]);
		expect(getRegisteredMenus()).toEqual([]);
		expect(getRoutes()).toHaveLength(0);
	});

	it("keep-alive 聚合与出口补 id", async () => {
		await loadAll(manifest([{
			name: "a",
			routes: [{ path: "/k", handle: { title: "k", keepAlive: false } }],
		}]));
		expect(getKeepAliveExcludeKeys()).toContain("/k");
		expect(getAllRoutePathKeys()).toContain("/k");
		const routes = getRoutes() as Array<{ id?: string }>;
		expect(routes.every(r => typeof r.id === "string")).toBe(true);
	});
});
