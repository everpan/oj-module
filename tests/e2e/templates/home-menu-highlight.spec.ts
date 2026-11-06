import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 首页菜单高亮回归（2026-11-05）。
 *
 * 模板 /home 是「/home 根 + index 子路由」结构，运行时 `useMatches` 匹配到的叶子路由
 * id 为 `/home/`（带尾斜杠），而侧边栏菜单项 key 是父级 `/home`——
 * `resolveSelectedKeys` 取叶子 id 导致 selectedKeys 对不上，『首页』菜单项不亮，
 * 复刻 react-antd-admin 时首页选中态丢失。home/routes.ts 用 `currentActiveMenu: "/home"`
 * 显式声明高亮目标（框架既定机制：页面指定高亮哪个菜单），对齐 playground / react-antd-admin
 * 的选中态。
 *
 * 本用例从真实页面钉住「进入 /home 后侧边栏『首页』项被选中并带浅蓝高亮」，防止 index
 * 子路由这类结构改动再次悄悄打掉首页高亮。
 */
test.describe("首页菜单高亮（templates）", () => {
	test("进入 /home 后侧边栏『首页』菜单项高亮", async ({ page }) => {
		await enterTemplateApp(page);

		const selected = page.locator(".ant-menu-item-selected");
		// 首页是默认落地页，应恰好有一项被选中
		await expect(selected).toHaveCount(1, { timeout: 15_000 });
		await expect(selected).toHaveText("首页");

		// 选中态须带 antd 默认浅蓝背景（rgb(230,244,255)），而非透明——
		// 透明即说明 selectedKeys 没对上、高亮丢了
		const bg = await selected.evaluate(el => getComputedStyle(el).backgroundColor);
		expect(bg, `首页菜单项选中背景缺失（非 antd 浅蓝），当前=${bg}`).toBe("rgb(230, 244, 255)");
	});
});
