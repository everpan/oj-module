import { afterEach, describe, expect, it, vi } from "vitest";

import { rememberRoute } from "#src/utils/remember-route";

/**
 * 回跳参数与部署 base 的分工回归（2026-10 子路径部署实测）：
 * goLogin 的硬跳转负责补 base（`/oj/login?redirect=...`），
 * rememberRoute 只产出**路由空间**路径——消费端 login 模块
 * `navigate(getRedirectPath(search))` 会被 basename 再补一次 base，
 * 这里若把 URL 空间的 pathname（含 `/oj`）原样塞进 redirect，
 * 登录后落 `/oj/oj/home`（base 双拼）。
 */
function stubLocation(pathname: string, search = ""): void {
	vi.stubGlobal("window", { location: { pathname, search } });
}

describe("rememberRoute：redirect 取路由空间路径", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		delete (globalThis as { __OJ_BASE__?: string }).__OJ_BASE__;
	});

	it("子路径部署：剥掉 /oj 前缀（URL 空间 → 路由空间）", () => {
		(globalThis as { __OJ_BASE__?: string }).__OJ_BASE__ = "/oj/";
		stubLocation("/oj/wiki/space/1/doc/14", "?tab=1");
		expect(rememberRoute()).toBe("?redirect=/wiki/space/1/doc/14?tab=1");
	});

	it("根路径部署：行为不变", () => {
		stubLocation("/wiki/space/1/doc/14");
		expect(rememberRoute()).toBe("?redirect=/wiki/space/1/doc/14");
	});

	it("子路径根 /oj 与登录页本身：不记回跳", () => {
		(globalThis as { __OJ_BASE__?: string }).__OJ_BASE__ = "/oj/";
		stubLocation("/oj");
		expect(rememberRoute()).toBe("");
		stubLocation("/oj/login");
		expect(rememberRoute()).toBe("");
	});
});
