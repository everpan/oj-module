import type { OrgDeps } from "../src/_platform/api/_shared/service/domain/org";

// BDD：组织架构领域（0016，方案 A1+A2）——CRUD 基线 + 归属权（D13）+ 保底出口（D14）。
//
// 两条最容易回归的红线，用例必须钉死：
//   1. **判环方向**：把部门挂到自己的子孙下必须 400。实现曾从「目标往下找自己」，
//      漏判「父挂到孙下」（环是 `id → target → … → id`，即 id 是 target 的**祖先**，
//      必须沿 target 的父链**往上**找）。漏判后部门树直接成环，前端建树死循环。
//   2. **归属权（D13）**：origin ≠ local 的行，改名/删除/移动一律 400，且错误文案要能
//      直接给人看（带来源人话 + 指向「转为本地维护」）。同步与回收只作用于自己 origin。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	addMember,
	createDepartment,
	deleteDepartment,
	detachToLocal,
	listDepartments,
	listMembers,
	memberCounts,
	moveDepartment,

	removeMember,
	updateDepartment,
	updateMember,
	upsertDepartment,
} from "../src/_platform/api/_shared/service/domain/org";
import { deleteUser, listUsers, updateUserProfile } from "../src/_platform/api/_shared/service/domain/users";
import { ADMIN, installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;
const deps: OrgDeps = { now: () => 1_700_000_000 };

/** 建一条外部来源（企微）的部门——走适配器写路径，不手写 SQL，顺带钉 upsert 幂等 */
async function mkDept(name: string, parentId: number | null = null): Promise<number> {
	return createDepartment({ name, parentId }, deps);
}

function deptRow(id: number): { origin: string, name: string | null, parent_id: number | null, deleted: number } {
	const row = dbo.prepare("SELECT origin, name, parent_id, deleted FROM sys_department WHERE id = ?").get(id) as any;
	return { origin: String(row.origin), name: row.name == null ? null : String(row.name), parent_id: row.parent_id == null ? null : Number(row.parent_id), deleted: Number(row.deleted) };
}

function mkUser(username: string): number {
	dbo.prepare("INSERT INTO users (username, password_hash) VALUES (?, 'x')").run(username);
	return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

beforeAll(() => {
	dbo = installDb();
});

beforeEach(() => {
	g.http = { user: { id: ADMIN } };
});

afterEach(() => {
	dbo.exec("DELETE FROM sys_dept_member");
	dbo.exec("DELETE FROM sys_department");
	dbo.exec("DELETE FROM sys_oplog");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM sys_refresh_token");
	dbo.exec("DELETE FROM users WHERE username LIKE 'u%'");
});

describe("部门 CRUD 基线", () => {
	it("建部门：origin 恒 local + origin_id 自生成 + 落审计", async () => {
		const id = await mkDept("总公司");
		const row = deptRow(id);
		expect(row.origin).toBe("local");
		expect(row.name).toBe("总公司");
		expect(row.parent_id).toBeNull();
		const audit = dbo.prepare("SELECT target FROM sys_oplog WHERE action = 'org.department.create'").all() as Array<{ target: string }>;
		expect(audit.map(a => a.target)).toEqual(["总公司"]);
	});

	it("父部门不存在 → 404（不建出孤儿）", async () => {
		await expect(mkDept("孤儿", 999)).rejects.toMatchObject({ status: 404 });
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_department").get()).toMatchObject({ c: 0 });
	});

	it("改名 / 改英文名；空名 → 400", async () => {
		const id = await mkDept("旧名");
		await updateDepartment(id, { name: "新名", nameEn: "New" }, deps);
		expect(deptRow(id).name).toBe("新名");
		await expect(updateDepartment(id, { name: "  " }, deps)).rejects.toMatchObject({ status: 400 });
	});

	it("删部门：有子部门 → 400（不级联删）", async () => {
		const parent = await mkDept("父");
		await mkDept("子", parent);
		await expect(deleteDepartment(parent)).rejects.toMatchObject({ status: 400 });
	});

	it("删部门：无子部门 → 真删 + 成员关联一并清（逻辑外键无 FK）", async () => {
		const id = await mkDept("待删");
		const uid = mkUser("u_a");
		await addMember(id, uid, {}, deps);
		await deleteDepartment(id);
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_department WHERE id = ?").get(id)).toMatchObject({ c: 0 });
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_dept_member WHERE dept_id = ?").get(id)).toMatchObject({ c: 0 });
	});
});

describe("移动：判环（回归）", () => {
	/** 建 1 → 2 → 3 三级链，返回各自 id */
	async function chain(): Promise<[number, number, number]> {
		const a = await mkDept("A");
		const b = await mkDept("B", a);
		const c = await mkDept("C", b);
		return [a, b, c];
	}

	it("合法移动：提到根 / 换父", async () => {
		const [a, b, c] = await chain();
		await moveDepartment(c, a, deps); // C 挂到 A 下（A 不是 C 的子孙）
		expect(deptRow(c).parent_id).toBe(a);
		await moveDepartment(a, null, deps); // 提到根
		expect(deptRow(a).parent_id).toBeNull();
		expect(deptRow(b).parent_id).toBe(a);
	});

	it("自挂 → 400", async () => {
		const [a] = await chain();
		await expect(moveDepartment(a, a, deps)).rejects.toMatchObject({ status: 400 });
	});

	it("挂到自己的子部门 → 400", async () => {
		const [a, b] = await chain();
		await expect(moveDepartment(a, b, deps)).rejects.toMatchObject({ status: 400 });
		expect(deptRow(a).parent_id).toBeNull(); // 未落库
	});

	it("挂到自己的孙部门 → 400（判环方向回归：曾漏判，树直接成环）", async () => {
		const [a, , c] = await chain();
		await expect(moveDepartment(a, c, deps)).rejects.toMatchObject({ status: 400 });
		expect(deptRow(a).parent_id).toBeNull();
	});

	it("判环不受 sync_visible/deleted 过滤影响（隐藏与软删的行也在父链里）", async () => {
		const a = await mkDept("A");
		const b = await mkDept("B", a);
		dbo.prepare("UPDATE sys_department SET sync_visible = 0, deleted = 1 WHERE id = ?").run(b);
		await expect(moveDepartment(a, b, deps)).rejects.toMatchObject({ status: 400 });
	});
});

describe("归属权（D13）与保底出口（D14）", () => {
	it("非 local 部门：改名 / 删除 / 移动 一律 400，文案带来源与出路", async () => {
		const id = await upsertDepartment({ origin: "wecom", originId: "wx-1", parentId: null, name: "企微部门" }, deps);
		await expect(updateDepartment(id, { name: "改名" }, deps)).rejects.toMatchObject({ status: 400 });
		await expect(deleteDepartment(id)).rejects.toMatchObject({ status: 400 });
		await expect(moveDepartment(id, null, deps)).rejects.toMatchObject({ status: 400 });
		// 人话提示：点名来源 + 指路「转为本地维护」
		await expect(updateDepartment(id, { name: "改名" }, deps)).rejects.toThrow(/企业微信/);
		await expect(updateDepartment(id, { name: "改名" }, deps)).rejects.toThrow(/转为本地维护/);
	});

	it("转为本地维护后 CRUD 全开；重复 detach 幂等", async () => {
		const id = await upsertDepartment({ origin: "wecom", originId: "wx-2", parentId: null, name: "企微部门" }, deps);
		await detachToLocal(id, deps);
		expect(deptRow(id).origin).toBe("local");
		await updateDepartment(id, { name: "已转本地" }, deps);
		expect(deptRow(id).name).toBe("已转本地");
		await detachToLocal(id, deps); // 已是 local，直接返回
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_oplog WHERE action = 'org.department.detach'").get()).toMatchObject({ c: 1 });
	});

	it("加人不受部门 origin 限制（「谁在部门」本站始终可调）", async () => {
		const id = await upsertDepartment({ origin: "wecom", originId: "wx-3", parentId: null, name: "企微部门" }, deps);
		const uid = mkUser("u_w");
		await addMember(id, uid, {}, deps);
		expect((await listMembers(id)).map(m => m.userId)).toEqual([uid]);
	});
});

describe("适配器写路径（读改写，构造器无 upsert）", () => {
	it("同 (origin, origin_id) 重复 upsert 复用同一行，只改结构字段", async () => {
		const a = await upsertDepartment({ origin: "wecom", originId: "wx-9", parentId: null, name: "旧" }, deps);
		const b = await upsertDepartment({ origin: "wecom", originId: "wx-9", parentId: null, name: "新" }, deps);
		expect(b).toBe(a);
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_department").get()).toMatchObject({ c: 1 });
		expect(deptRow(a).name).toBe("新");
	});

	it("upsert 不覆写 sync_visible / deleted / origin", async () => {
		const id = await upsertDepartment({ origin: "wecom", originId: "wx-10", parentId: null, name: "x" }, deps);
		dbo.prepare("UPDATE sys_department SET sync_visible = 0, deleted = 1 WHERE id = ?").run(id);
		await upsertDepartment({ origin: "wecom", originId: "wx-10", parentId: null, name: "y" }, deps);
		const row = dbo.prepare("SELECT sync_visible, deleted, origin FROM sys_department WHERE id = ?").get(id) as any;
		expect(Number(row.sync_visible)).toBe(0);
		expect(Number(row.deleted)).toBe(1);
		expect(String(row.origin)).toBe("wecom");
	});
});

describe("部门成员", () => {
	it("加 / 列 / 改 / 移；重复加 → 400；改不存在的关联 → 404", async () => {
		const id = await mkDept("技术部");
		const uid = mkUser("u_m");
		await addMember(id, uid, { orderNo: 5 }, deps);
		await expect(addMember(id, uid, {}, deps)).rejects.toMatchObject({ status: 400 });
		const [m] = await listMembers(id);
		expect(m).toMatchObject({ userId: uid, deptId: id, orderNo: 5, isLeader: false, isMain: false, username: "u_m" });
		await updateMember(id, uid, { isLeader: true }, deps);
		expect((await listMembers(id))[0]!.isLeader).toBe(true);
		await removeMember(id, uid, deps);
		expect(await listMembers(id)).toEqual([]);
		await expect(updateMember(id, uid, { isLeader: true }, deps)).rejects.toMatchObject({ status: 404 });
	});

	it("主部门全租户唯一：设新的主部门会把旧的降下来", async () => {
		const d1 = await mkDept("一");
		const d2 = await mkDept("二");
		const uid = mkUser("u_main");
		await addMember(d1, uid, { isMain: true }, deps);
		await addMember(d2, uid, {}, deps);
		await updateMember(d2, uid, { isMain: true }, deps);
		const mains = dbo.prepare("SELECT dept_id FROM sys_dept_member WHERE user_id = ? AND is_main = 1").all(uid) as Array<{ dept_id: number }>;
		expect(mains.map(r => Number(r.dept_id))).toEqual([d2]);
	});

	it("memberCounts 按部门聚合成员数", async () => {
		const d1 = await mkDept("一");
		const d2 = await mkDept("二");
		for (const u of [mkUser("u_c1"), mkUser("u_c2")])
			await addMember(d1, u, {}, deps);
		await addMember(d2, mkUser("u_c3"), {}, deps);
		const counts = await memberCounts();
		expect(counts.get(d1)).toBe(2);
		expect(counts.get(d2)).toBe(1);
	});
});

describe("用户侧（改资料 / 删号）", () => {
	it("改资料：只动展示字段，用户名不在可改之列", async () => {
		const uid = mkUser("u_p");
		await updateUserProfile(ADMIN, uid, { position: "cto", displayName: "张三", email: "z@x.com" });
		const row = dbo.prepare("SELECT position, display_name, email, username FROM users WHERE id = ?").get(uid) as any;
		expect(row.position).toBe("cto");
		expect(row.display_name).toBe("张三");
		expect(row.email).toBe("z@x.com");
		expect(row.username).toBe("u_p");
	});

	it("改资料：用户不存在 → 404；空 patch 不写库", async () => {
		await expect(updateUserProfile(ADMIN, 9999, { position: "x" })).rejects.toMatchObject({ status: 404 });
		const uid = mkUser("u_noop");
		await updateUserProfile(ADMIN, uid, {});
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_oplog WHERE action = 'user.profile.update'").get()).toMatchObject({ c: 0 });
	});

	it("删号：级联清部门关联 / 角色 / 会话", async () => {
		const uid = mkUser("u_del");
		const dept = await mkDept("待清");
		await addMember(dept, uid, {}, deps);
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'editor')").run(uid);
		dbo.prepare("INSERT INTO sys_refresh_token (user_id, token_hash, expires_at, revoked, created_at) VALUES (?, 'h', 0, 0, ?)").run(uid, 1_700_000_000);
		await deleteUser(ADMIN, uid);
		expect(dbo.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get(uid)).toMatchObject({ c: 0 });
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_dept_member WHERE user_id = ?").get(uid)).toMatchObject({ c: 0 });
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_user_role WHERE user_id = ?").get(uid)).toMatchObject({ c: 0 });
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_refresh_token WHERE user_id = ?").get(uid)).toMatchObject({ c: 0 });
	});

	it("删号：禁止删自己；最后一个 superadmin 拒删", async () => {
		await expect(deleteUser(ADMIN, ADMIN)).rejects.toMatchObject({ status: 400 });
		const solo = mkUser("u_sup");
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'superadmin')").run(solo);
		await expect(deleteUser(ADMIN, solo)).rejects.toMatchObject({ status: 400 });
		// 有两个 superadmin 时允许删（兜底只保最后一个）
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'superadmin')").run(ADMIN);
		await deleteUser(ADMIN, solo);
		expect(dbo.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get(solo)).toMatchObject({ c: 0 });
	});

	it("listUsers 带 departments（主部门在前 + isMain）与 position", async () => {
		const d1 = await mkDept("主");
		const d2 = await mkDept("副");
		const uid = mkUser("u_list");
		await addMember(d2, uid, {}, deps);
		await addMember(d1, uid, { isMain: true }, deps);
		await updateUserProfile(ADMIN, uid, { position: "tech lead" });
		const row = (await listUsers()).find(u => u.username === "u_list");
		expect(row?.position).toBe("tech lead");
		// 带 id：前端按部门（含子部门）筛选靠它，部门重名也串不了
		expect(row?.departments).toEqual([
			{ id: d1, name: "主", isMain: true },
			{ id: d2, name: "副", isMain: false },
		]);
	});

	it("部门名缺失就下发 null，不在接口里造 `#id` 字符串（展示口径归前端）", async () => {
		const d = await mkDept("待改名");
		const uid = mkUser("u_noname");
		await addMember(d, uid, {}, deps);
		dbo.prepare("UPDATE sys_department SET name = NULL WHERE id = ?").run(d);
		const row = (await listUsers()).find(u => u.username === "u_noname");
		expect(row?.departments).toEqual([{ id: d, name: null, isMain: false }]);
	});

	it("口径：listDepartments 默认过滤隐藏与软删，开关显式打开才全给", async () => {
		const visible = await mkDept("可见");
		const hidden = await mkDept("隐藏");
		dbo.prepare("UPDATE sys_department SET sync_visible = 0 WHERE id = ?").run(hidden);
		const gone = await mkDept("源侧已删");
		dbo.prepare("UPDATE sys_department SET deleted = 1 WHERE id = ?").run(gone);
		expect((await listDepartments()).map(d => d.id)).toEqual([visible]);
		expect((await listDepartments({ includeHidden: true, includeDeleted: true })).map(d => d.id).sort()).toEqual([visible, hidden, gone].sort());
	});
});
