// BDD：企微登录落地的纯逻辑（Phase 2 前端）。
//
// 这三处错了都不报错、只表现为「点了没反应 / 登录过期」，故单独锁：
//   · 落地参数解析必须区分「企微回跳」与「普通打开登录页」（后者不能触发换票）；
//   · 参数要裁剪、要能容忍少了 tenant（此时沿用本地租户，不是登录失败）；
//   · 授权入口即使没填企业代码也要跳（后端会回 400 说明缺什么，比前端静默不动好排查）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWecomBootError, onInit } from "../src/app/web/login/routes";
import { parseWecomLanding, wecomAuthorizePath } from "../src/app/web/login/wecom";

// p2-C：企微回跳的换票必须发生在首帧 render 之前，且成功后把 URL 改到首页——
// 否则宿主 shell（无 AuthGuard）会先把登录页画出来再跳，工作台进入时「闪一下」。
// 这里把 runtime 全部桩掉，只锁 onInit 的编排：谁被调用、顺序、URL 改没改。
const mocks = vi.hoisted(() => ({
	login: vi.fn(),
	setTenant: vi.fn(),
	registerAuthProvider: vi.fn(),
	replaceState: vi.fn(),
}));

vi.mock("@oj-module/runtime", () => ({
	useAuthStore: { getState: () => ({ login: mocks.login }), subscribe: vi.fn() },
	useTenantStore: { getState: () => ({ setTenant: mocks.setTenant, clear: vi.fn() }) },
	getRedirectPath: () => "/home",
	resolveSiteBase: () => "/",
}));

describe("p2-A：回跳落地参数解析", () => {
	it("带齐 ticket 与 tenant → 解析出两者", () => {
		expect(parseWecomLanding("?wecom_ticket=tk_1&tenant=ww_corp_a")).toEqual({ ticket: "tk_1", tenant: "ww_corp_a" });
	});

	it("只有 ticket（后端没带租户）→ tenant 为空串，仍算企微落地", () => {
		expect(parseWecomLanding("?wecom_ticket=tk_1")).toEqual({ ticket: "tk_1", tenant: "" });
	});

	it("普通打开登录页（无 ticket）→ null，绝不触发换票", () => {
		expect(parseWecomLanding("")).toBeNull();
		expect(parseWecomLanding("?tenant=ww_corp_a")).toBeNull();
		expect(parseWecomLanding("?wecom_ticket=")).toBeNull();
		expect(parseWecomLanding("?wecom_ticket=%20%20")).toBeNull();
	});

	it("参数前后空白被裁掉（复制粘贴链接常带空格）", () => {
		expect(parseWecomLanding("?wecom_ticket=%20tk_1%20&tenant=%20ww_corp_a%20")).toEqual({ ticket: "tk_1", tenant: "ww_corp_a" });
	});

	it("不吞别的参数：redirect 原样留给 getRedirectPath（登录后回原页）", () => {
		const search = "?wecom_ticket=tk_1&tenant=ww_corp_a&redirect=%2Fsystem%2Fusers";
		expect(parseWecomLanding(search)).toEqual({ ticket: "tk_1", tenant: "ww_corp_a" });
		expect(new URLSearchParams(search).get("redirect")).toBe("/system/users");
	});
});

describe("p2-C：回跳换票提前到 onInit（登录页不闪）", () => {
	const ctx = { register: { authProvider: mocks.registerAuthProvider } } as never;
	const g = globalThis as any;

	beforeEach(() => {
		vi.clearAllMocks();
		g.window = { location: { search: "" }, history: { replaceState: mocks.replaceState } };
	});

	it("无 ticket：不换票、不改 URL", async () => {
		await onInit(ctx);
		expect(mocks.login).not.toHaveBeenCalled();
		expect(mocks.replaceState).not.toHaveBeenCalled();
	});

	it("带 ticket：首帧前换票成功，URL 改到首页（登录页不挂载）", async () => {
		g.window.location.search = "?wecom_ticket=tk_1&tenant=ww_corp_a";
		mocks.login.mockResolvedValue(undefined);
		await onInit(ctx);
		expect(mocks.setTenant).toHaveBeenCalledWith("ww_corp_a");
		expect(mocks.login).toHaveBeenCalledTimes(1);
		expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ method: "wecom", ticket: "tk_1" }));
		expect(mocks.replaceState).toHaveBeenCalledWith(null, "", "/home");
		expect(getWecomBootError()).toBe("");
	});

	it("换票失败：错误留给登录页首帧显示表单，不改写 URL", async () => {
		g.window.location.search = "?wecom_ticket=bad&tenant=ww_corp_a";
		mocks.login.mockRejectedValue(new Error("登录票据无效或已使用"));
		await onInit(ctx);
		expect(mocks.replaceState).not.toHaveBeenCalled();
		expect(getWecomBootError()).toContain("登录票据无效或已使用");
	});
});

describe("p2-D：一键扫码登录路径（不要求用户填企业代码）", () => {
	it("不带 corp/agent 时是纯入口路径，由后端 corpSelf() 自动解析本企业", () => {
		// 登录页「企业微信一键登录」按钮走这条：点一次即跳，用户不必输企业代码。
		// 带上 corp 就退回「先填企业代码再点」的两步式，锁住这个契约。
		expect(wecomAuthorizePath("", "")).toBe("/auth/wecom/login");
		expect(wecomAuthorizePath("", "")).not.toContain("corp=");
	});
});

describe("p2-B：授权入口拼装", () => {
	it("企业代码 → 站内路径（部署前缀由调用方 withSiteBase 拼）", () => {
		expect(wecomAuthorizePath("ww_corp_a")).toBe("/auth/wecom/login?corp=ww_corp_a");
	});

	it("同企业两个应用（测试/正式）→ 带 agent 区分", () => {
		expect(wecomAuthorizePath("ww_corp_a", "100002")).toBe("/auth/wecom/login?corp=ww_corp_a&agent=100002");
	});

	it("企业代码为空/空白 → 仍拼出入口（后端回 400 点明缺 corp，比按钮无反应好排查）", () => {
		expect(wecomAuthorizePath("")).toBe("/auth/wecom/login");
		expect(wecomAuthorizePath("  ")).toBe("/auth/wecom/login");
	});

	it("值做 URL 编码（企业代码/agent 可能含特殊字符）", () => {
		expect(wecomAuthorizePath("ww a&b", "1 0")).toBe("/auth/wecom/login?corp=ww+a%26b&agent=1+0");
	});
});
