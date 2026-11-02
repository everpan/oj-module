import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TEMPLATE_DIR } from "../helpers/paths";

/**
 * 模板工程 = 唯一的「外部模块工程」样本。
 *
 * apps/playground 与 apps/playground-oj 已于 2026-11-02 下线（它们只是 templates
 * 出现之前的手工靶场，且各存一份模块源码副本）；本文件接手那两个工程里
 * 仍然有价值的边界断言：只含模块、不引框架内部路径、共享依赖只进 devDependencies。
 */

function collectFiles(dir: string): string[] {
	if (!fs.existsSync(dir))
		return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? collectFiles(full) : [full];
	});
}

describe("模板工程边界（模块工程只含模块）", () => {
	it("具备模块工程最小结构", () => {
		for (const file of [
			"package.json",
			"web.config.ts",
			"src/app/web/entry.ts",
			"src/oj-market/web/entry.ts",
		]) {
			expect(fs.existsSync(path.join(TEMPLATE_DIR, file)), `应存在 ${file}`).toBe(true);
		}
	});

	it("源码不出现框架内部路径导入（#src/ / #modules/）", () => {
		const offenders = collectFiles(path.join(TEMPLATE_DIR, "src"))
			.filter(file => /\.tsx?$/.test(file))
			.filter(file => /from\s*["']#(?:src|modules)\//.test(fs.readFileSync(file, "utf-8")))
			.map(file => path.relative(TEMPLATE_DIR, file));

		expect(offenders, `以下文件引入了框架内部路径（应改为 @oj-module/runtime）：${offenders.join(", ")}`).toEqual([]);
	});

	it("共享依赖只在 devDependencies，且依赖 @oj-module/runtime", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf-8"));
		const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

		expect(Object.keys(pkg.dependencies ?? {}), "共享依赖不得出现在 dependencies，只能是 devDependencies").toEqual([]);
		expect(allDeps, "模块工程应依赖 @oj-module/runtime").toContain("@oj-module/runtime");
		expect(allDeps.filter((d: string) => d.startsWith("#")), "不应依赖框架内部路径").toEqual([]);
	});
});

/**
 * 菜单序轴回归（合并前后必须逐项一致）：
 * 可见根只由 `handle.order` 决定位置（≥0 主区升序、<0 底部固定区），
 * `hideInMenu` 的根（登录/强制改密/通知中心）不进菜单。
 * 任何一项漂移都会让合并改版后的侧边栏顺序变化，故在源码层钉住。
 */
describe("合并后菜单布局不变（序轴 + 隐藏）", () => {
	const read = (rel: string) => fs.readFileSync(path.join(TEMPLATE_DIR, rel), "utf-8");

	it("主区序轴：/home 1、/personal-center 110、/oj-market 200", () => {
		expect(read("src/app/web/home/routes.ts")).toMatch(/order: 1,/);
		expect(read("src/app/web/personal-center/routes.ts")).toMatch(/order: 110,/);
		expect(read("src/oj-market/web/entry.ts")).toMatch(/order: 200,/);
	});

	it("底部固定区：/system 负 order + 管理员根门禁", () => {
		const system = read("src/app/web/system/routes.ts");
		expect(system).toMatch(/order: -100,/);
		expect(system).toMatch(/roles: SYSTEM_ROLES,/);
	});

	it("不进菜单的根：/login、/change-password、/notification-center", () => {
		const login = read("src/app/web/login/routes.ts");
		expect(login.match(/hideInMenu: true/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
		expect(read("src/app/web/notification/routes.ts")).toMatch(/hideInMenu: true/);
	});
});
