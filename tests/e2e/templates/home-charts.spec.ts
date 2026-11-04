import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 首页图表回归（2026-11-04）。
 *
 * 首页三张图改用 `echarts/core` **按需注册**（`home/pages/components/echarts-setup.ts`），
 * 把整包 echarts 从模块产物里摘掉约 780 KB。按需注册的典型失败模式是
 * **静默空白**：少 `use()` 一个图表类型或组件时，echarts 不抛错、只是画不出来——
 * 体积指标全绿而页面已经坏了。这里从真实页面钉住「三张图画得出来」：
 * - 三个 canvas 存在且有实际尺寸（echarts init 成功才会建 canvas）；
 * - 控制台没有 "is used but not imported" / "not exists" 这类注册缺失告警。
 */
test.describe("首页图表（templates）", () => {
	test("三张 echarts 图按需注册后仍能渲染", async ({ page }) => {
		const consoleErrors: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "error")
				consoleErrors.push(msg.text());
		});
		page.on("pageerror", err => consoleErrors.push(String(err)));

		await enterTemplateApp(page);

		const canvases = page.locator("canvas");
		await expect(canvases).toHaveCount(3, { timeout: 15_000 });

		// canvas 是 echarts init 时才创建的，创建瞬间尺寸可能还是 0（父容器尚未定宽），
		// 故轮询「三张图都有实际尺寸」而不是一次性量 boundingBox。
		await expect.poll(async () => {
			const sizes = await canvases.evaluateAll(cs => cs.map(c => ({ w: c.clientWidth, h: c.clientHeight })));
			return sizes.filter(s => s.w > 100 && s.h > 100).length;
		}, { timeout: 15_000 }).toBe(3);

		const registrationErrors = consoleErrors.filter(e => /is used but not imported|not exists|Unregistered/i.test(e));
		expect(registrationErrors, `按需注册缺项：${registrationErrors.join(" | ")}`).toEqual([]);
	});
});
