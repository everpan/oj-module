/**
 * 用户管理两项特性的纯函数用例（BDD）：
 * - matchUserKeyword：/system/users 关键词搜索（用户名 + 显示名）
 * - roleLabel：成员资格/角色页共用的角色语言名解析（title_key → 内置 locale → title → name）
 *
 * 被测代码在 templates 脚手架源里（pages/users、pages/roles），此处经相对路径
 * 直引纯函数文件（无 react/antd 依赖，cli vitest node 环境可直接跑）。
 */
import { describe, expect, it } from "vitest";
import { roleLabel } from "../../templates/src/app/web/system/pages/roles/role-label";
import { matchUserKeyword } from "../../templates/src/app/web/system/pages/users/match-keyword";

// 测试桩：模拟 i18next 的 t（key 命中表 → 译文；否则 defaultValue ?? key）
function makeT(dict: Record<string, string>) {
	return (key: string, opts?: { defaultValue?: string }): string => dict[key] ?? opts?.defaultValue ?? key;
}

describe("matchUserKeyword：用户关键词搜索", () => {
	const rows = [
		{ username: "zhangsan", display_name: "张三" },
		{ username: "lisi", display_name: null },
		{ username: "admin", display_name: "Admin 张" },
	];

	it.each([
		["zhang", 0], // 命中 username
		["张", 0], // 命中 display_name（中文）
		["张", 2], // display_name 含中文，username 不含
		["ADMIN", 2], // 大小写不敏感
	])("given 关键字 %j when 过滤 then 命中第 %i 行", (kw, idx) => {
		expect(matchUserKeyword(rows[idx]!, kw)).toBe(true);
	});

	it.each([
		["zhang", 1], // lisi 行不命中
		["wang", 0],
	])("given 关键字 %j when 过滤 then 第 %i 行不命中", (kw, idx) => {
		expect(matchUserKeyword(rows[idx]!, kw)).toBe(false);
	});

	it("given display_name 为 null when 过滤 then 不抛错且不匹配", () => {
		expect(matchUserKeyword(rows[1]!, "张")).toBe(false);
	});

	it.each([
		["", true], // 空串 → 全可见
		["   ", true], // 纯空白 trim 后为空 → 全可见
	])("given 空白关键字 %j when 过滤 then %j", (kw, expected) => {
		expect(matchUserKeyword(rows[0]!, kw)).toBe(expected);
	});
});

describe("roleLabel：角色语言名解析", () => {
	it("given title_key 且 t 命中 when roleLabel then 返回译文", () => {
		const t = makeT({ "wiki:role.editor": "编辑者" });
		expect(roleLabel({ name: "editor", title: "Editor", title_key: "wiki:role.editor", builtin: false }, t)).toBe("编辑者");
	});

	it("given title_key 但 t 未命中 when roleLabel then 回退 title", () => {
		const t = makeT({});
		expect(roleLabel({ name: "editor", title: "Editor", title_key: "wiki:role.editor", builtin: false }, t)).toBe("Editor");
	});

	it("given 内置角色无 title_key when roleLabel then 查 rolesPage.roleTitle locale 键", () => {
		const t = makeT({ "system:rolesPage.roleTitle.admin": "系统管理员" });
		expect(roleLabel({ name: "admin", title: "Admin", title_key: null, builtin: true }, t)).toBe("系统管理员");
	});

	it("given 内置角色 locale 键未命中 when roleLabel then 回退 title", () => {
		const t = makeT({});
		expect(roleLabel({ name: "boss", title: "Boss", title_key: null, builtin: true }, t)).toBe("Boss");
	});

	it("given 内置角色 locale 键未命中且 title 为空 when roleLabel then 回退 name", () => {
		const t = makeT({});
		expect(roleLabel({ name: "boss", title: null, title_key: null, builtin: true }, t)).toBe("boss");
	});

	it("given custom 角色（非内置、无 title_key）when roleLabel then 原样 title，title 空回退 name", () => {
		const t = makeT({});
		expect(roleLabel({ name: "custom.crm", title: "CRM 专员", title_key: null, builtin: false }, t)).toBe("CRM 专员");
		expect(roleLabel({ name: "custom.crm", title: null, title_key: null, builtin: false }, t)).toBe("custom.crm");
	});
});
