import { pathToFileURL } from "node:url";
import i18next from "i18next";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupI18n } from "#src/locales";
import { loadAll, unloadModule } from "#src/module-loader";

import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 多命名空间 i18n（多根聚合模块）：
 * - 模块自身命名空间仍为 `definition.name`（`i18n` 字段，历史行为）；
 * - `i18nNamespaces` 里的每个命名空间独立注册，key 不必改名。
 *
 * 菜单标题走 `"<ns>:menu.<key>"`，页面走 `useTranslation("<ns>")`——两者都依赖
 * 命名空间存在，故合并模块时这是「菜单文案不变」的前提。
 */
describe("模块 i18n 多命名空间（i18nNamespaces）", () => {
	beforeAll(async () => {
		// i18next 的 store API（addResourceBundle/getResourceBundle）在 init 时才挂到实例上；
		// 生产由宿主 setupI18n 先行初始化，测试同样先落地这一前置。
		setupI18n();
		await unloadModule("i18n-ns-fixture");
		await loadAll({
			modules: [{
				name: "i18n-ns-fixture",
				entry: pathToFileURL(`${PROJECT_ROOT}/tests/fixtures/i18n-namespaces-entry.ts`).href,
			}],
		});
	});

	afterAll(async () => {
		await unloadModule("i18n-ns-fixture");
	});

	it("附加命名空间按声明注册（system / personal-center 各自可读）", () => {
		expect(i18next.getResourceBundle("zh-CN", "system").menu.system).toBe("系统管理");
		expect(i18next.getResourceBundle("zh-CN", "personal-center").menu.profile).toBe("我的资料");
	});

	it("模块自身命名空间仍是 definition.name", () => {
		expect(i18next.getResourceBundle("zh-CN", "i18n-ns-fixture").menu.main).toBe("聚合模块");
	});
});
