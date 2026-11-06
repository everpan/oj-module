// BDD：solution 角色 title 落库时同步翻译（R1–R6，计划 docs/plans/20261103-0948-role-title-translate）。
// title = 解析文本（站点默认语言）、title_key = 原文（UI 实时翻译锚）；解析失败回退裸 key，
// 绝不失败安装（R1）；升级元数据覆盖 = 重解析（R3）；title_key 列由 0001 基线建表即带（R2/AC4）；sys_permission 不变（R5）；name/code/绑定不变（R6）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写（register.spec 同约定） */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { registerSolution, resolveDeclTitles, siteLanguage } from "../../src/app/api/_platform/_lifecycle/steps/register";
import { installDb } from "../fixture";

const enc = new TextEncoder();

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

beforeAll(() => {
	dbo = installDb();
	g.http = {};
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM sys_role_permission");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM sys_permission");
	dbo.exec("DELETE FROM sys_role");
	dbo.exec("DELETE FROM sys_solution_route");
	dbo.exec("DELETE FROM sys_setting");
	dbo.exec("DELETE FROM sys_oplog");
});

function roleRows() {
	return dbo.prepare("SELECT name, title, title_key FROM sys_role ORDER BY name").all() as Array<{ name: string, title: string | null, title_key: string | null }>;
}

/** readFile 假面：包内 locales 按路径精确映射，未命中即「文件不存在」 */
function fakeReadFile(staging: string, files: Record<string, string>) {
	return async (p: string) => {
		const hit = files[p];
		if (hit === undefined)
			throw new Error(`ENOENT: ${p}`);
		return enc.encode(hit);
	};
}

const STAGING = "/staging";
const PM_LOCALES = {
	[`${STAGING}/web/modules/pm/locales/zh-CN.json`]: JSON.stringify({ role: { sales: "销售", admin: "方案管理员" } }),
	[`${STAGING}/web/modules/pm/locales/en-US.json`]: JSON.stringify({ role: { sales: "Sales", admin: "Solution Admin" } }),
};

function pmDecl(title: string) {
	return {
		module: "pm",
		version: "1.0.0",
		roles: [{ name: "pm.sales", title, title_key: title, permissions: ["pm.doc.create"] }],
		permissions: [{ code: "pm.doc.create" }],
	};
}

describe("R4 语言取值", () => {
	it("缺省 zh-CN（sys_setting 无 site.language 行）", async () => {
		expect(await siteLanguage()).toBe("zh-CN");
	});

	it("站点设置 site.language 生效（R4：站点默认语言）", async () => {
		await g.db.table("sys_setting").insert({ key: "site.language", module: "framework", group: "site", type: "string", value: "en-US", update_time: Date.now(), deprecated: 0 }).run();
		expect(await siteLanguage()).toBe("en-US");
	});
});

describe("R1 注册时解析（resolveDeclTitles）", () => {
	it("AC1 首装：title_key 解析为站点语言 locale 文本", async () => {
		const resolved = await resolveDeclTitles(pmDecl("pm:role.sales"), STAGING, "zh-CN", fakeReadFile(STAGING, PM_LOCALES));
		expect(resolved.roles[0]!.title).toBe("销售");
		expect(resolved.roles[0]!.title_key).toBe("pm:role.sales");
	});

	it("R4：语言参数决定读取的 locale 文件", async () => {
		const resolved = await resolveDeclTitles(pmDecl("pm:role.sales"), STAGING, "en-US", fakeReadFile(STAGING, PM_LOCALES));
		expect(resolved.roles[0]!.title).toBe("Sales");
	});

	it("AC3 缺 key：保留裸 key（title 原样），绝不抛错", async () => {
		const files = { [`${STAGING}/web/modules/pm/locales/zh-CN.json`]: JSON.stringify({ role: { sales: "销售" } }) };
		const resolved = await resolveDeclTitles(pmDecl("pm:role.admin"), STAGING, "zh-CN", fakeReadFile(STAGING, files));
		expect(resolved.roles[0]!.title).toBe("pm:role.admin");
	});

	it("R1 边界：locale 文件缺失 / 坏 JSON / 非 string 值 / 空 key 形状不符 → 原文保留", async () => {
		const noFile = await resolveDeclTitles(pmDecl("pm:role.sales"), STAGING, "zh-CN", fakeReadFile(STAGING, {}));
		expect(noFile.roles[0]!.title).toBe("pm:role.sales");

		const badJson = await resolveDeclTitles(pmDecl("pm:role.sales"), STAGING, "zh-CN", fakeReadFile(STAGING, { [`${STAGING}/web/modules/pm/locales/zh-CN.json`]: "{not-json" }));
		expect(badJson.roles[0]!.title).toBe("pm:role.sales");

		const nonString = await resolveDeclTitles(pmDecl("pm:role.sales"), STAGING, "zh-CN", fakeReadFile(STAGING, { [`${STAGING}/web/modules/pm/locales/zh-CN.json`]: JSON.stringify({ role: { sales: 42 } }) }));
		expect(nonString.roles[0]!.title).toBe("pm:role.sales");

		// 非 key 形状（中文文本）不做解析尝试——已解析文本二次注册不被误改
		const plain = await resolveDeclTitles(pmDecl("销售"), STAGING, "zh-CN", fakeReadFile(STAGING, PM_LOCALES));
		expect(plain.roles[0]!.title).toBe("销售");
	});

	it("R1 边界：ns ≠ 模块名不越界解析（跨 ns 无本包 locale）", async () => {
		const decl = { ...pmDecl("wiki:role.sales"), module: "pm" };
		const resolved = await resolveDeclTitles(decl, STAGING, "zh-CN", fakeReadFile(STAGING, PM_LOCALES));
		expect(resolved.roles[0]!.title).toBe("wiki:role.sales");
	});
});

describe("R1–R3 落库（registerSolution 消费解析后的 decl）", () => {
	it("AC1 首装：sys_role 落 (title=销售, title_key=pm:role.sales)，权限点照常", async () => {
		const resolved = await resolveDeclTitles(pmDecl("pm:role.sales"), STAGING, "zh-CN", fakeReadFile(STAGING, PM_LOCALES));
		const r = await registerSolution(resolved);
		expect(r.ok).toBe(true);
		const rows = roleRows();
		expect(rows).toEqual([{ name: "pm.sales", title: "销售", title_key: "pm:role.sales" }]);
		const perms = dbo.prepare("SELECT code FROM sys_permission").all() as Array<{ code: string }>;
		expect(perms.map(p => p.code)).toEqual(["pm.doc.create"]);
	});

	it("AC2 升级：元数据覆盖写新解析文本 + title_key 刷新（R3 locale 改进随升级传播）", async () => {
		await registerSolution(await resolveDeclTitles(pmDecl("pm:role.sales"), STAGING, "zh-CN", fakeReadFile(STAGING, PM_LOCALES)));
		const improved = fakeReadFile(STAGING, { [`${STAGING}/web/modules/pm/locales/zh-CN.json`]: JSON.stringify({ role: { sales: "销售冠军" } }) });
		const r = await registerSolution(await resolveDeclTitles(pmDecl("pm:role.sales"), STAGING, "zh-CN", improved));
		expect(r.ok).toBe(true);
		expect(roleRows()).toEqual([{ name: "pm.sales", title: "销售冠军", title_key: "pm:role.sales" }]);
	});

	it("AC3 缺 key：注册不失败，title = 裸 key（现行回退形态）", async () => {
		const r = await registerSolution(await resolveDeclTitles(pmDecl("pm:role.viewer"), STAGING, "zh-CN", fakeReadFile(STAGING, PM_LOCALES)));
		expect(r.ok).toBe(true);
		expect(roleRows()).toEqual([{ name: "pm.sales", title: "pm:role.viewer", title_key: "pm:role.viewer" }]);
	});
});

describe("R2 sys_role.title_key 列（基线建表即带）", () => {
	it("AC4 夹具真实迁移后 sys_role 带 title_key 列（列进库 ↔ schema.yaml 一致守卫的库侧半边）", () => {
		const cols = (dbo.prepare("PRAGMA table_info(sys_role)").all() as Array<{ name: string }>).map(c => c.name);
		expect(cols).toContain("title_key");
	});
});
