// BDD：RBAC UI 纯函数——roleLabel/canEditRoleBindings/canDeleteRole/canAssignRole/bindingDiff/groupByModule。
// 语义锚：AC1-8（成员资格）、AC1-19（builtin 无编辑/删除入口）、AC1-20（占用禁删）。
import { describe, expect, it } from "vitest";
import {
	bindingDiff,
	canAssignRole,
	canDeleteRole,
	canEditRoleBindings,
	groupByModule,
	roleLabel,
} from "#src/api/rbac/helpers";

describe("roleLabel", () => {
	it("title 优先，缺省回落机器名", () => {
		expect(roleLabel({ name: "custom.ops", title: "运维" })).toBe("运维");
		expect(roleLabel({ name: "custom.ops", title: null })).toBe("custom.ops");
		expect(roleLabel({ name: "custom.ops" })).toBe("custom.ops");
	});
});

describe("aC1-19：builtin 角色无绑定编辑/删除入口", () => {
	it("superadmin/admin/editor/viewer（builtin=1）一律 false", () => {
		for (const name of ["superadmin", "admin", "editor", "viewer"]) {
			expect(canEditRoleBindings({ builtin: true })).toBe(false);
			expect(canDeleteRole({ builtin: true, holders: 0 })).toBe(false);
			void name;
		}
	});

	it("声明/自定义角色可编辑；删除还需无持有者（AC1-20）", () => {
		expect(canEditRoleBindings({ builtin: false })).toBe(true);
		expect(canDeleteRole({ builtin: false, holders: 3 })).toBe(false);
		expect(canDeleteRole({ builtin: false, holders: 0 })).toBe(true);
	});
});

describe("aC1-8：canAssignRole 成员资格边界", () => {
	it("superadmin 可分配一切；admin 不可碰 superadmin/admin；其余不可分配", () => {
		expect(canAssignRole(["superadmin"], "superadmin")).toBe(true);
		expect(canAssignRole(["superadmin"], "wiki.editor")).toBe(true);
		expect(canAssignRole(["admin"], "superadmin")).toBe(false);
		expect(canAssignRole(["admin"], "admin")).toBe(false);
		expect(canAssignRole(["admin"], "wiki.editor")).toBe(true);
		expect(canAssignRole(["editor"], "viewer")).toBe(false);
	});
});

describe("bindingDiff", () => {
	it("增删各自归位，无序输入不影响集合语义", () => {
		expect(bindingDiff(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
		expect(bindingDiff([], [])).toEqual({ added: [], removed: [] });
	});
});

describe("groupByModule", () => {
	it("按 module 分组且保持组内原序", () => {
		const r = groupByModule([
			{ module: "wiki", code: "wiki.a" },
			{ module: "crm", code: "crm.a" },
			{ module: "wiki", code: "wiki.b" },
		]);
		expect(r).toEqual([
			{ module: "wiki", items: [{ module: "wiki", code: "wiki.a" }, { module: "wiki", code: "wiki.b" }] },
			{ module: "crm", items: [{ module: "crm", code: "crm.a" }] },
		]);
	});
});
