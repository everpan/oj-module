import { describe, expect, it } from "vitest";

import { mergeModuleI18nResources, organizeLanguageFiles } from "../src/locales";

describe("locales（v1 直蒸 + 实例收敛）", () => {
	it("organizeLanguageFiles：按文件名聚合，跳过无名文件", () => {
		const out = organizeLanguageFiles({
			"./zh-CN/common.json": { ok: "确定" },
			"./zh-CN/menu.json": { home: "首页" },
			"": {},
		});
		expect(out).toEqual({ common: { ok: "确定" }, menu: { home: "首页" } });
	});

	it("mergeModuleI18nResources：显式实例（禁默认单例）+ namespace=模块名 + default 解包", async () => {
		const calls: Array<[string, string, unknown]> = [];
		const i18n = { addResourceBundle: (lng: string, ns: string, r: unknown) => calls.push([lng, ns, r]) };
		await mergeModuleI18nResources(i18n, {
			name: "proj",
			description: "",
			version: "1",
			routes: [],
			i18n: {
				"zh-CN": async () => ({ default: { t: "项目" } }),
				"en-US": async () => ({ t: "project" }),
			},
		});
		expect(calls).toEqual([
			["zh-CN", "proj", { t: "项目" }],
			["en-US", "proj", { t: "project" }],
		]);
	});

	it("无 i18n 声明即空操作", async () => {
		let hit = false;
		await mergeModuleI18nResources({ addResourceBundle: () => (hit = true) }, {
			name: "x",
			description: "",
			version: "1",
			routes: [],
		});
		expect(hit).toBe(false);
	});
});
