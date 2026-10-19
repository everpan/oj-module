// BDD：查询工具——paginate（limit 钳 200 / truncated）+ likePattern（keyword≥2、LIKE 转义）。
// AC 锚点：AC1-24（钳制与截断）、AC1-22（keyword<2 → 400）。ESCAPE '!' 三方言同语义（sqlite/mysql/pg）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { beforeAll, describe, expect, it } from "vitest";

import { likePattern, paged } from "../src/_platform/_shared/service/infra/query";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;

beforeAll(() => {
	dbo = installDb();
	for (let i = 1; i <= 300; i++)
		dbo.prepare("INSERT INTO users (username, password_hash) VALUES (?, 'x')").run(`u${String(i).padStart(3, "0")}`);
});

const LIST = "select id, username from users where 1=1";
const COUNT = "select count(*) as c from users where 1=1";

describe("AC1-24：limit 钳制与截断标记", () => {
	it("size 静默钳 200，truncated=true（库 301 人=夹具 admin+300）", async () => {
		const r = await paged<any>(LIST, COUNT, [], { page: 1, size: 500 });
		expect(r.size).toBe(200);
		expect(r.list.length).toBe(200);
		expect(r.total).toBe(301);
		expect(r.truncated).toBe(true);
	});

	it("末页 truncated=false", async () => {
		const r = await paged<any>(LIST, COUNT, [], { page: 2, size: 200 });
		expect(r.list.length).toBe(101);
		expect(r.truncated).toBe(false);
	});

	it("缺省 page=1 / size=20；页码/尺寸非法值回落（0/负数/非数）", async () => {
		const d = await paged<any>(LIST, COUNT, [], {});
		expect(d.page).toBe(1);
		expect(d.size).toBe(20);
		const bad = await paged<any>(LIST, COUNT, [], { page: 0, size: -3 });
		expect(bad.page).toBe(1);
		expect(bad.size).toBe(20);
	});
});

describe("AC1-22：LIKE 模式与 keyword 长度红线", () => {
	it("keyword <2 字符 → 400", () => {
		expect(() => likePattern("张")).toThrowError(expect.objectContaining({ status: 400 }));
	});

	it("keyword >64 字符 → 400", () => {
		expect(() => likePattern("x".repeat(65))).toThrowError(expect.objectContaining({ status: 400 }));
	});

	it("LIKE 元字符转义：% _ ! 原样匹配不泛化", async () => {
		dbo.prepare("INSERT INTO users (username, password_hash) VALUES ('a%b_c!d', 'x')").run();
		const r = await paged<any>(
			"select id, username from users where username like ? escape '!'",
			"select count(*) as c from users where username like ? escape '!'",
			[likePattern("a%b_c!d")],
			{ size: 10 },
		);
		expect(r.list.map((x: any) => x.username)).toEqual(["a%b_c!d"]);
	});

	it("正常 keyword 两侧包裹 %", () => {
		expect(likePattern("张三")).toBe("%张三%");
	});
});
