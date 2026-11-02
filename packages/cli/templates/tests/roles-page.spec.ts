// BDD：/system/roles 展示页隐去 superadmin（事故：角色页把平台级角色当成站点可分配角色列出）。
//
// 过滤只发生在**展示层**，所以这里测纯函数而不是整页：页面本身只做 query + 渲染，
// 真正会回归的是「哪些行算可见」。后端那半边（listRoles 必须原样返回 superadmin）在
// tests/rbac-roles.spec.ts 里钉，两处合起来才防住「顺手把后端也过滤掉」的改法。
import { describe, expect, it } from "vitest";

import { HIDDEN_ROLE, visibleRoles } from "../src/app/web/system/pages/roles/visible-roles";

const ROWS = [
	{ name: "superadmin", module: "_platform" },
	{ name: "admin", module: "_platform" },
	{ name: "custom.wiki", module: "wiki" },
];

describe("角色展示页：隐去 superadmin、其余原样", () => {
	it("不列 superadmin，其余顺序不变", () => {
		expect(visibleRoles(ROWS).map(r => r.name)).toEqual(["admin", "custom.wiki"]);
	});

	it("只按名字精确匹配：superadmin.* / 前缀相近的角色照常显示", () => {
		const rows = [...ROWS, { name: "superadmin.readonly", module: "_platform" }, { name: "Admin", module: "_platform" }];
		expect(visibleRoles(rows).map(r => r.name)).toEqual(["admin", "custom.wiki", "superadmin.readonly", "Admin"]);
	});

	it("不改入参（useQuery 缓存对象不能被就地改写）", () => {
		const input = ROWS.map(r => ({ ...r }));
		const before = input.map(r => r.name);
		visibleRoles(input);
		expect(input.map(r => r.name)).toEqual(before);
	});

	it("空列表不炸（查询未返回时的形态）", () => {
		expect(visibleRoles([])).toEqual([]);
	});

	it("隐藏项与后端保留角色名同值（改名必须两处一起改）", () => {
		expect(HIDDEN_ROLE).toBe("superadmin");
	});
});
