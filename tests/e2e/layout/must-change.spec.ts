import process from "node:process";
import { expect, test } from "@playwright/test";

/**
 * 首登强制改密（must_change）阻塞性引导的回归用例。
 *
 * 仅 playground 形态（shell 链）有效——legacy 主仓未接 login 模块且 devkit 语义不同。
 *
 * 机制（见 packages/runtime/src/utils/request/must-change.tsx）：
 *  - 主动层：user store 拉 `/web/user-info` 读到 `must_change` 后**立即**弹引导框；
 *  - 兜底层：管理接口并发 403 `{code:"must_change"}` 被请求层拦截，抑制逐条 toast。
 * 验收点：
 *  - 登录后「需要修改密码」引导框**立即**出现（不等用户去踩管理页踩 403）；
 *  - 不出现 4 条重复的 "password change required" 吐司。
 *
 * 用 Playwright 网络层拦截把场景做成确定性的：不依赖 devkit 种子账号是否带
 * must_change，也不依赖后端 403 文案是否完全一致——主动层靠 web/user-info 强制
 * 下发 must_change，兜底层靠 system/* 强制 403 must_change。
 */

const isPlayground = (process.env.E2E_TARGET ?? "playground") === "playground";

const MODAL_TITLE = "需要修改密码";
const TOAST_MSG = "password change required";

test.describe("must-change", () => {
	test("M1: 登录后立刻弹出阻塞性改密引导框，且管理接口 403 不刷重复吐司", async ({ page }) => {
		test.skip(!isPlayground, "仅 playground 形态可测（shell 链 + login 模块）");

		// 网络层拦截：把 must_change 场景做成确定性
		await page.route("**/auth/login", (route) => {
			void route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ code: 0, msg: "ok", data: { access_token: "mock-token", refresh_token: "mock-refresh" } }),
			});
		});
		// 主动层数据源：user-info 强制下发 must_change。
		// playground 用 login 模块（其 authProvider 读 /login/user-info），
		// 脚手架用框架内置（读 /web/user-info）——两种都拦，覆盖两种形态。
		const mustChangeUser = {
			code: 0,
			msg: "ok",
			data: { id: "1", avatar: "", username: "Admin", email: "", phoneNumber: "", description: "manager", roles: ["admin"], must_change: true },
		};
		await page.route("**/login/user-info", (route) => {
			void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mustChangeUser) });
		});
		await page.route("**/web/user-info", (route) => {
			void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mustChangeUser) });
		});
		// 路由菜单：返回空，避免 devkit 路由语义干扰
		await page.route("**/web/get-async-routes", (route) => {
			void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, msg: "ok", data: [] }) });
		});
		// 兜底层数据源：管理接口并发 403（旧行为会刷 4 条吐司）
		await page.route("**/system/**", (route) => {
			void route.fulfill({
				status: 403,
				contentType: "application/json",
				body: JSON.stringify({ code: "must_change", msg: TOAST_MSG }),
			});
		});

		await page.goto("/login");

		// 登录表单（antd Form.Item + label，兼容中英文 locale）
		await page.getByLabel(/用户名|Username/).fill("admin");
		await page.getByLabel(/密码|Password/).fill("123456");
		// antd Button htmlType="submit" → 渲染成 <button type="submit">；
		// 文案含空格（「登 录」）且随 locale 变化，按类型选最稳
		await page.locator("button[type=\"submit\"]").click();

		// 验收点 1：阻塞性引导框「立即」出现（主动层在 getUserInfo 后即弹，
		// 不等用户去点管理页踩 403）
		await expect(page.locator(".ant-modal-confirm-title", { hasText: MODAL_TITLE })).toBeVisible({ timeout: 10_000 });

		// 引导框为阻塞性：无取消按钮（只有「去修改密码」）
		await expect(page.getByRole("button", { name: "去修改密码" })).toBeVisible();
		await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);

		// 验收点 2：进入管理页触发并发 403，兜底层应抑制逐条吐司
		await page.goto("/system/users");
		// 等并发管理接口 403 落定
		await page.waitForTimeout(2_000);
		const toast = page.locator(".ant-message-notice", { hasText: TOAST_MSG });
		await expect(toast).toHaveCount(0);
	});
});
