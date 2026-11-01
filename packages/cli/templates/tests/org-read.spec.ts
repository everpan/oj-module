// BDD：组织架构共享读面（A3 / 方案 §5.2 + D5）——给别的模块消费的只读面。
//
// 这一层比 CRUD 更容易「静默越权」，所以用例按**门禁**和**可见性**两条线钉：
//   1. self 档的可见范围是「我所在部门 + 祖先链」，不是「登录即可看全公司」。
//      祖先可见 ≠ 祖先可展开：对祖先 includeSub 会把整棵子树吐出来，等于绕过自身路径，
//      必须 400（宁可报错也不静默截断——截断给出的是「看似正确其实少人」的结果）。
//   2. 读面字段是**白名单**：origin / syncVisible / isLeader / externalStatus 一个都不能漏出来。
//      反过来也钉住：返回字段与 scope 无关，消费模块不该按档位分支解析。
//
// 另外钉住 §9.1 阻断项：通讯录只出 activated=1，同步灌进来的「从未登录」账号不得被检索到。
import type { OrgDeps } from "../src/_platform/api/_shared/service/domain/org";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contactDetail, searchContacts } from "../src/_platform/api/_shared/service/domain/contacts";
import {
	addMember,
	createDepartment,
	deleteDepartment,
} from "../src/_platform/api/_shared/service/domain/org";
import {
	isMemberOf,
	pageDepartments,
	pageMembers,
	parseScope,
	readPicker,
	readTree,
	readUserDepartments,
	resolveReader,
	resolveReadFace,
	resolveUserIds,
} from "../src/_platform/api/_shared/service/domain/org-read";
import { createUser } from "../src/_platform/api/_shared/service/domain/users";
import { invalidateUser } from "../src/_platform/api/_shared/service/infra/access";
import { ensureWecomUser } from "../src/auth/api/_shared/wecom/login";
import { ADMIN, installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;
const deps: OrgDeps = { now: () => 1_700_000_000 };

let seq = 0;
/** 建部门（走基线 CRUD，origin=local） */
async function mkDept(name: string, parentId: number | null = null): Promise<number> {
	return createDepartment({ name, parentId }, deps);
}

/** 建本地账号（返回 uid）；activated 由 createUser 决定 */
async function mkUser(username: string): Promise<number> {
	seq += 1;
	return createUser({ username: `${username}${seq}`, password: "aA123456" }, { bcryptHash: async () => "x" });
}

/** 极简骨架：公司 → (研发 → (前端组), 销售) */
async function mkOrg(): Promise<{ root: number, rd: number, fe: number, sales: number }> {
	const root = await mkDept("公司");
	const rd = await mkDept("研发部", root);
	const fe = await mkDept("前端组", rd);
	const sales = await mkDept("销售部", root);
	return { root, rd, fe, sales };
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
	dbo.exec("DELETE FROM sys_role_permission");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM sys_refresh_token");
	dbo.exec("DELETE FROM sys_rate_window");
	dbo.exec("DELETE FROM sys_oplog");
	dbo.exec("DELETE FROM users WHERE id <> 1");
	invalidateUser(ADMIN);
});

describe("scope 解析", () => {
	it("缺省与 'self' 都归一为 self；'all' 原样；其余 400", () => {
		expect(parseScope(undefined)).toBe("self");
		expect(parseScope("")).toBe("self");
		expect(parseScope("  ")).toBe("self");
		expect(parseScope("self")).toBe("self");
		expect(parseScope("all")).toBe("all");
		expect(() => parseScope("full")).toThrowError(/scope must be/);
	});

	it("self 档可见集 = 我所在部门 + 全部祖先；可展开集只含我所在部门", async () => {
		const { root, rd, fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, {}, deps);

		const reader = await resolveReader(uid, "self");
		expect([...reader.visible!].sort((a, b) => a - b)).toEqual([root, rd, fe].sort((a, b) => a - b));
		// 祖先只是「可见」，不可展开——见头注红线
		expect([...reader.expandable!]).toEqual([fe]);
	});

	it("self 档无部门 → 可见集是**空集**而不是 null（空集不等于不限制）", async () => {
		const uid = await mkUser("u");
		const reader = await resolveReader(uid, "self");
		expect(reader.visible).toBeInstanceOf(Set);
		expect(reader.visible!.size).toBe(0);
		expect(reader.expandable!.size).toBe(0);
	});

	it("all 档不设可见集（null = 不限制）", async () => {
		const uid = await mkUser("u");
		const reader = await resolveReader(uid, "all");
		expect(reader.visible).toBeNull();
		expect(reader.expandable).toBeNull();
	});
});

describe("部门树读面", () => {
	it("self 档只出自己部门与祖先，兄弟部门与无关子树不出", async () => {
		const { root, rd, fe, sales } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, {}, deps);

		const ids = (await readTree(await resolveReader(uid, "self"))).map(d => d.id);
		expect(ids.sort((a, b) => a - b)).toEqual([root, rd, fe].sort((a, b) => a - b));
		expect(ids).not.toContain(sales);
	});

	it("all 档出全量", async () => {
		const { root, rd, fe, sales } = await mkOrg();
		const ids = (await readTree(await resolveReader(ADMIN, "all"))).map(d => d.id);
		expect(ids.sort((a, b) => a - b)).toEqual([root, rd, fe, sales].sort((a, b) => a - b));
	});

	it("字段白名单：读面不出 origin / syncVisible / deleted / 负责人 / 在职状态", async () => {
		const { fe } = await mkOrg();
		const tree = await readTree(await resolveReader(ADMIN, "all"));
		const item = tree.find(d => d.id === fe)!;
		expect(Object.keys(item).sort()).toEqual(["id", "memberCount", "name", "nameEn", "orderNo", "parentId"]);
	});

	it("软删 / 同步不可见的部门不进读面（那是管理端的事）", async () => {
		const { root, rd, fe, sales } = await mkOrg();
		await deleteDepartment(fe);
		dbo.prepare("UPDATE sys_department SET sync_visible = 0 WHERE id = ?").run(rd);

		const ids = (await readTree(await resolveReader(ADMIN, "all"))).map(d => d.id);
		expect(ids.sort((a, b) => a - b)).toEqual([root, sales].sort((a, b) => a - b));
	});

	it("memberCount 是真人数（不是子树累加）", async () => {
		const { rd, fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, {}, deps);
		const tree = await readTree(await resolveReader(ADMIN, "all"));
		expect(tree.find(d => d.id === fe)!.memberCount).toBe(1);
		expect(tree.find(d => d.id === rd)!.memberCount).toBe(0);
	});
});

describe("部门分页读面", () => {
	it("parent=0 只出根层，parent=<id> 只出直属下级", async () => {
		const { root, rd, fe, sales } = await mkOrg();
		const reader = await resolveReader(ADMIN, "all");
		expect((await pageDepartments(reader, { parent: 0 })).list.map(d => d.id)).toEqual([root]);
		expect((await pageDepartments(reader, { parent: root })).list.map(d => d.id).sort((a, b) => a - b))
			.toEqual([rd, sales].sort((a, b) => a - b));
		expect((await pageDepartments(reader, { parent: rd })).list.map(d => d.id)).toEqual([fe]);
	});

	it("keyword 单字 400（与通讯录同一条防遍历红线）", async () => {
		const reader = await resolveReader(ADMIN, "all");
		await expect(pageDepartments(reader, { keyword: "研" })).rejects.toMatchObject({ status: 400 });
	});

	it("keyword 命中中英文名；分页给出 total / truncated", async () => {
		const { root } = await mkOrg();
		for (let i = 0; i < 3; i++)
			await createDepartment({ name: `市场${i}`, nameEn: `mkt-${i}`, parentId: root }, deps);
		const reader = await resolveReader(ADMIN, "all");

		expect((await pageDepartments(reader, { keyword: "mkt" })).total).toBe(3);
		const p1 = await pageDepartments(reader, { keyword: "市场", page: 1, size: 2 });
		expect(p1.list).toHaveLength(2);
		expect(p1.total).toBe(3);
		expect(p1.truncated).toBe(true);
		const p2 = await pageDepartments(reader, { keyword: "市场", page: 2, size: 2 });
		expect(p2.list).toHaveLength(1);
		expect(p2.truncated).toBe(false);
	});
});

describe("成员读面", () => {
	it("给 dept 出该部门直属成员 + 部门名路径（根在前）", async () => {
		const { fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, { isMain: true }, deps);

		const page = await pageMembers(await resolveReader(ADMIN, "all"), { dept: fe });
		expect(page.total).toBe(1);
		expect(page.list[0].userId).toBe(uid);
		expect(page.list[0].deptPath).toEqual(["公司", "研发部", "前端组"]);
		expect(page.list[0].isMain).toBe(true);
	});

	it("includeSub 展开子树；不传只出直属", async () => {
		const { root, rd, fe } = await mkOrg();
		const a = await mkUser("a");
		const b = await mkUser("b");
		await addMember(rd, a, {}, deps);
		await addMember(fe, b, {}, deps);

		const reader = await resolveReader(ADMIN, "all");
		expect((await pageMembers(reader, { dept: root })).list.map(m => m.userId)).toEqual([]);
		expect((await pageMembers(reader, { dept: root, includeSub: true })).list.map(m => m.userId).sort((x, y) => x - y))
			.toEqual([a, b].sort((x, y) => x - y));
	});

	it("⚡ self 档对**祖先**部门 includeSub → 400（展开祖先等于绕过自身路径）", async () => {
		const { rd, fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, {}, deps);
		const reader = await resolveReader(uid, "self");

		await expect(pageMembers(reader, { dept: rd, includeSub: true })).rejects.toMatchObject({ status: 400 });
		// 祖先仍可看直属成员（可见 ≠ 可展开）
		await expect(pageMembers(reader, { dept: rd })).resolves.toMatchObject({ total: 0 });
	});

	it("self 档查不可见部门 → 403", async () => {
		const { fe, sales } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, {}, deps);
		const reader = await resolveReader(uid, "self");
		await expect(pageMembers(reader, { dept: sales })).rejects.toMatchObject({ status: 403 });
	});

	it("一人多部门只出一条（主部门优先），避免 includeSub 重复吐人", async () => {
		const { rd, fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(rd, uid, {}, deps);
		await addMember(fe, uid, { isMain: true }, deps);

		const list = (await pageMembers(await resolveReader(ADMIN, "all"), { dept: rd, includeSub: true })).list;
		expect(list.filter(m => m.userId === uid)).toHaveLength(1);
		expect(list.find(m => m.userId === uid)!.deptId).toBe(fe);
	});

	it("停用账号不出（与通讯录同口径：不该被当成收件人）", async () => {
		const { fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, {}, deps);
		dbo.prepare("UPDATE users SET is_forbidden = 1 WHERE id = ?").run(uid);

		expect((await pageMembers(await resolveReader(ADMIN, "all"), { dept: fe })).total).toBe(0);
	});

	it("keyword 命中 username / displayName", async () => {
		const { fe } = await mkOrg();
		const a = await mkUser("alice");
		const b = await mkUser("bob");
		await addMember(fe, a, {}, deps);
		await addMember(fe, b, {}, deps);
		const page = await pageMembers(await resolveReader(ADMIN, "all"), { dept: fe, keyword: "ali" });
		expect(page.list.map(m => m.userId)).toEqual([a]);
	});
});

describe("某人的部门", () => {
	it("出主部门路径、全部部门与职务", async () => {
		const { rd, fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(rd, uid, {}, deps);
		await addMember(fe, uid, { isMain: true }, deps);
		dbo.prepare("UPDATE users SET position = '前端工程师' WHERE id = ?").run(uid);

		const info = await readUserDepartments(await resolveReader(ADMIN, "all"), uid);
		expect(info.mainDeptId).toBe(fe);
		expect(info.mainDeptPath).toEqual(["公司", "研发部", "前端组"]);
		expect(info.position).toBe("前端工程师");
		expect(info.departments.map(d => d.deptId)).toEqual([fe, rd]);
	});

	it("self 档查别人 → 403（不是 404：不泄露账号存在性）", async () => {
		const uid = await mkUser("u");
		const other = await mkUser("o");
		await expect(readUserDepartments(await resolveReader(uid, "self"), other)).rejects.toMatchObject({ status: 403 });
	});

	it("self 档查自己可以；用户不存在 → 404", async () => {
		const uid = await mkUser("u");
		await expect(readUserDepartments(await resolveReader(uid, "self"), uid)).resolves.toMatchObject({ userId: uid });
		await expect(readUserDepartments(await resolveReader(ADMIN, "all"), 999_999)).rejects.toMatchObject({ status: 404 });
	});

	it("已删部门从 departments 里裁掉，主部门路径随之清空", async () => {
		const { fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, { isMain: true }, deps);
		await deleteDepartment(fe);

		const info = await readUserDepartments(await resolveReader(ADMIN, "all"), uid);
		expect(info.departments).toEqual([]);
		expect(info.mainDeptId).toBeNull();
		expect(info.mainDeptPath).toEqual([]);
	});
});

describe("选人组件", () => {
	it("keyword 必填，且 <2 字 400", async () => {
		const reader = await resolveReader(ADMIN, "all");
		await expect(readPicker(reader, {})).rejects.toMatchObject({ status: 400 });
		await expect(readPicker(reader, { keyword: "研" })).rejects.toMatchObject({ status: 400 });
	});

	it("人与部门一起返回，limit 生效", async () => {
		const { root } = await mkOrg();
		for (let i = 0; i < 3; i++)
			await createDepartment({ name: `市场${i}`, parentId: root }, deps);
		const uid = await mkUser("mkt");
		const res = await readPicker(await resolveReader(ADMIN, "all"), { keyword: "市场", limit: 2 });
		expect(res.departments).toHaveLength(2);
		expect(res.departments.every(d => d.parentId === root)).toBe(true);
		// 名字里没有「市场」的人不该被带出来
		expect(res.users.map(u => u.userId)).not.toContain(uid);
	});

	it("limit 超上限静默钳 50", async () => {
		const { root } = await mkOrg();
		for (let i = 0; i < 60; i++)
			await createDepartment({ name: `部门${i}`, parentId: root }, deps);
		const res = await readPicker(await resolveReader(ADMIN, "all"), { keyword: "部门", limit: 999 });
		expect(res.departments).toHaveLength(50);
	});
});

describe("resolve（把部门展开成 user_id）", () => {
	it("deptIds + includeSub 展开子树，结果去重升序", async () => {
		const { rd, fe } = await mkOrg();
		const a = await mkUser("a");
		const b = await mkUser("b");
		const c = await mkUser("c");
		await addMember(rd, a, {}, deps);
		await addMember(fe, b, {}, deps);
		await addMember(fe, c, {}, deps);

		const reader = await resolveReader(ADMIN, "all");
		expect(await resolveUserIds(reader, { deptIds: [rd] })).toEqual([a]);
		expect(await resolveUserIds(reader, { deptIds: [rd], includeSub: true })).toEqual([a, b, c].sort((x, y) => x - y));
		// 父子同时给也不重复
		expect(await resolveUserIds(reader, { deptIds: [rd, fe], includeSub: true })).toEqual([a, b, c].sort((x, y) => x - y));
	});

	it("显式 userIds 原样并入并去重（不校验部门归属）", async () => {
		const { fe } = await mkOrg();
		const a = await mkUser("a");
		const reader = await resolveReader(ADMIN, "all");
		expect(await resolveUserIds(reader, { userIds: [a, a, 424242] })).toEqual([a, 424242].sort((x, y) => x - y));
		expect(await resolveUserIds(reader, { userIds: [a], deptIds: [fe] })).toEqual([a]);
	});

	it("⚡ self 档 includeSub 祖先部门 → 400", async () => {
		const { rd, fe } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, {}, deps);
		const reader = await resolveReader(uid, "self");
		await expect(resolveUserIds(reader, { deptIds: [rd], includeSub: true })).rejects.toMatchObject({ status: 400 });
	});

	it("非法 id 忽略，不抛", async () => {
		await mkOrg();
		const reader = await resolveReader(ADMIN, "all");
		expect(await resolveUserIds(reader, { deptIds: ["x", -1, 0], userIds: [null, "y"] })).toEqual([]);
	});
});

describe("is-member", () => {
	it("含子部门：在孙部门也算属于根部门", async () => {
		const { root, rd, fe, sales } = await mkOrg();
		const uid = await mkUser("u");
		await addMember(fe, uid, {}, deps);
		const reader = await resolveReader(ADMIN, "all");

		expect(await isMemberOf(reader, uid, fe)).toBe(true);
		expect(await isMemberOf(reader, uid, rd)).toBe(true);
		expect(await isMemberOf(reader, uid, root)).toBe(true);
		expect(await isMemberOf(reader, uid, sales)).toBe(false);
	});

	it("self 档只能问自己 → 问别人 403；可见部门内正常作答", async () => {
		const { fe } = await mkOrg();
		const uid = await mkUser("u");
		const other = await mkUser("o");
		await addMember(fe, uid, {}, deps);
		const reader = await resolveReader(uid, "self");
		await expect(isMemberOf(reader, other, fe)).rejects.toMatchObject({ status: 403 });
		expect(await isMemberOf(reader, uid, fe)).toBe(true);
		// 不可见部门连问都不许问（403 而不是 false：false 会泄露「这个部门存在且你不属于」）
		await expect(isMemberOf(reader, uid, 999_999)).rejects.toMatchObject({ status: 403 });
	});
});

describe("门禁（resolveReadFace）", () => {
	it("未登录 → 401", async () => {
		g.http = {};
		await expect(resolveReadFace(undefined)).rejects.toMatchObject({ status: 401 });
	});

	it("伪造 X-TENANT-ID → 403（token 的 sub 在本租户查无此人）", async () => {
		g.http = { user: { id: ADMIN }, tenantId: "other-corp" };
		await expect(resolveReadFace(undefined)).rejects.toMatchObject({ status: 403 });
	});

	it("scope 非法 → 400", async () => {
		await expect(resolveReadFace("full")).rejects.toMatchObject({ status: 400 });
	});

	it("scope=all 无权限点 → 403", async () => {
		const uid = await mkUser("u");
		// must_change 先清零：否则 403 来自「首登改密悬挂」，测不到权限点这一层
		dbo.prepare("UPDATE users SET must_change = 0 WHERE id = ?").run(uid);
		g.http = { user: { id: uid } };
		await expect(resolveReadFace("all")).rejects.toMatchObject({ status: 403 });
		// self 档不挂权限点：登录即可
		await expect(resolveReadFace("self")).resolves.toMatchObject({ scope: "self" });
	});

	it("scope=all 绑定 platform.org.read.all 后通过", async () => {
		const uid = await mkUser("u");
		// createUser 默认 must_change=1（首登改密悬挂），判权出口会先拒；这里只测权限点绑定
		dbo.prepare("UPDATE users SET must_change = 0 WHERE id = ?").run(uid);
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'auditor')").run(uid);
		dbo.prepare("INSERT INTO sys_role_permission (role_name, permission_code) VALUES ('auditor', 'platform.org.read.all')").run();
		g.http = { user: { id: uid } };
		await expect(resolveReadFace("all")).resolves.toMatchObject({ scope: "all", visible: null });
	});

	it("超限 → 429（60 次/分）", async () => {
		const uid = await mkUser("u");
		g.http = { user: { id: uid } };
		dbo.prepare("INSERT INTO sys_rate_window (rate_key, window_start, count) VALUES (?, ?, 60)")
			.run(`org:${uid}`, Date.now() - 1_000);
		await expect(resolveReadFace("self")).rejects.toMatchObject({ status: 429 });
	});
});

describe("通讯录 activated 门禁（方案 §9.1 阻断项）", () => {
	it("管理员建号即 activated=1", async () => {
		const uid = await mkUser("u");
		expect(dbo.prepare("SELECT activated FROM users WHERE id = ?").get(uid)).toMatchObject({ activated: 1 });
	});

	it("企微登录建档 activated=1（真人刚登录过）", async () => {
		const { uid } = await ensureWecomUser("corp-x", "zhangsan");
		expect(dbo.prepare("SELECT activated FROM users WHERE id = ?").get(uid)).toMatchObject({ activated: 1 });
	});

	it("同步灌进来的 activated=0 账号检索不到、详情 404", async () => {
		dbo.prepare("INSERT INTO users (username, password_hash, display_name, activated) VALUES ('sync-zhang', '!sync', '张三', 0)").run();
		const id = (dbo.prepare("SELECT id FROM users WHERE username = 'sync-zhang'").get() as { id: number }).id;

		expect(await searchContacts("张三", {})).toEqual([]);
		await expect(contactDetail(id)).rejects.toMatchObject({ status: 404 });
		// 翻成 1 之后才可见——这是「真人用过」的唯一凭据
		dbo.prepare("UPDATE users SET activated = 1 WHERE id = ?").run(id);
		expect((await searchContacts("张三", {})).map(r => r.id)).toEqual([id]);
	});
});
