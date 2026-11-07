// BDD：superadmin 安装页退役钉（2026-11-07 策略变更：市场方案默认安装好——
// 「出厂未装 + 首装仪式」随 /system/solutions 页面整建制退役）。
//
// 退役边界：
//   - 页面 / 路由 / 菜单 i18n / market-entry 纯推导层移除（本钉锁住不复活）；
//   - 安装/升级端点（install/task/index，R9 超管门禁）与市场页自身不动——
//     市场方案的消费面从「首装入口」迁移为「出厂即装 + 市场页升级」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SYSTEM_WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/app/web/system");

describe("superadmin 安装页退役钉", () => {
	it("/system/solutions 路由与 pages/solutions 目录整建制移除", () => {
		expect(fs.existsSync(path.join(SYSTEM_WEB, "pages", "solutions"))).toBe(false);
		const routes = fs.readFileSync(path.join(SYSTEM_WEB, "routes.ts"), "utf8");
		expect(routes).not.toContain("/system/solutions");
		expect(routes).not.toContain("pages/solutions");
	});

	it("菜单 i18n 键（menu.solutions / solutionsPage）双语言移除", () => {
		for (const lang of ["zh-CN", "en-US"]) {
			const loc = JSON.parse(fs.readFileSync(path.join(SYSTEM_WEB, "locales", `${lang}.json`), "utf8")) as Record<string, any>;
			expect(loc.menu?.solutions).toBeUndefined();
			expect(loc.solutionsPage).toBeUndefined();
		}
	});
});
