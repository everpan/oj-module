// BDD：/system/users 行级门禁——只有 superadmin 能改 superadmin 账号。
//
// 与 tests/rbac-users.spec.ts 的 assertCanManageTarget 用例互为两面：那边钉服务端 403，
// 这边钉「前端不给会 403 的按钮」（置灰）。两处都测同一个判定口径，改名必须一起改。
import { describe, expect, it } from "vitest";

import { canManageUser, PLATFORM_ROLE } from "../src/app/web/system/pages/users/can-manage";

describe("用户管理页：superadmin 行对非超管置灰", () => {
	it("admin 看普通用户 → 可操作", () => {
		expect(canManageUser(["admin"], ["editor"])).toBe(true);
		expect(canManageUser(["admin"], [])).toBe(true);
	});

	it("admin 看 superadmin → 灰（口令/状态/成员资格一律禁用）", () => {
		expect(canManageUser(["admin"], ["superadmin"])).toBe(false);
		// 兼有 admin + editor 也不够：这条红线只认 superadmin
		expect(canManageUser(["admin", "editor", "viewer"], ["superadmin", "editor"])).toBe(false);
	});

	it("superadmin 看 superadmin → 可操作（红线是限定谁能改，不是禁止改）", () => {
		expect(canManageUser(["superadmin"], ["superadmin"])).toBe(true);
		expect(canManageUser(["superadmin"], ["admin"])).toBe(true);
	});

	it("不看自己：本人行的禁用由页面另外用 uid 判，别混进来", () => {
		// 空角色 + 空目标 = 可操作，说明本函数不承担 assertNotSelf 的职责
		expect(canManageUser([], [])).toBe(true);
	});

	it("角色名精确匹配：superadmin.readonly 不是平台超管", () => {
		expect(canManageUser(["admin"], ["superadmin.readonly"])).toBe(true);
		expect(canManageUser(["SuperAdmin"], ["superadmin"])).toBe(false);
	});

	it("门禁常量与后端保留角色名同值（改名必须两处一起改）", () => {
		expect(PLATFORM_ROLE).toBe("superadmin");
	});
});
