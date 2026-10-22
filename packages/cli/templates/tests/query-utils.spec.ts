// BDD：查询工具——paginate（limit 钳 200 / truncated）+ likePattern（keyword≥2、LIKE 转义）。
// AC 锚点：AC1-24（钳制与截断）、AC1-22（keyword<2 → 400）。ESCAPE '!' 三方言同语义（sqlite/mysql/pg）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { beforeAll, describe, expect, it } from "vitest";

import { likePattern, paged, pagedFactory } from "../src/_platform/api/_shared/service/infra/query";
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

describe("AC1-24（构造器工厂）：pagedFactory 复用同一组条件", () => {
	// L2 记录型假构造器：pagedFactory 是纯编排（count 聚合 + 条件分页 + 截断判定），
	// SQL 渲染/执行在 oj 二进制内，vitest 无真 builder 载体（架构定论：builder 纯 Rust
	// 实现，无 JS 模块可导；SQL 断言走 oj test / oj exec，见 devkit oj-test-guide.md）。
	// 这里只断言编排契约：mk 各跑一次、count 走聚合 select、total=0 不跑 list。
	function fakeBuilder(total: number, rows: any[]) {
		const calls: string[] = [];
		let countPath = false;
		const b: any = {
			select: (cols: any[]) => {
				countPath = cols.some((c: any) => c && typeof c === "object" && c.fn === "count");
				calls.push(`select:${JSON.stringify(cols)}`);
				return b;
			},
			where: (cond: any) => {
				calls.push(`where:${JSON.stringify(cond)}`);
				return b;
			},
			orderBy: (items: any[]) => {
				calls.push(`orderBy:${JSON.stringify(items)}`);
				return b;
			},
			limit: (n: number) => {
				calls.push(`limit:${n}`);
				return b;
			},
			offset: (n: number) => {
				calls.push(`offset:${n}`);
				return b;
			},
			all: async () => (countPath ? [{ c: total }] : rows),
		};
		return { b, calls };
	}

	it("count + list 各跑一次：count 走聚合 select（不受 LIMIT 钳制），list 带 orderBy/limit/offset", async () => {
		const built: Array<{ calls: string[] }> = [];
		const mk = () => {
			const f = fakeBuilder(301, Array.from({ length: 200 }, (_, i) => ({ id: 300 - i })));
			built.push(f);
			return f.b;
		};
		const r = await pagedFactory<any>(mk, { page: 1, size: 500 });
		expect(built).toHaveLength(2);
		expect(built[0].calls.some(c => c.startsWith("select:") && c.includes("\"count\""))).toBe(true);
		expect(built[1].calls.includes("limit:200")).toBe(true); // 500 被钳 200
		expect(built[1].calls.includes("offset:0")).toBe(true);
		expect(r.total).toBe(301);
		expect(r.size).toBe(200);
		expect(r.list.length).toBe(200);
		expect(r.truncated).toBe(true); // 301 > 1*200
	});

	it("条件经 mk 工厂收敛（contains 替代 LIKE ? ESCAPE '!'）：两次构造都带上 where", async () => {
		const built: Array<{ calls: string[] }> = [];
		const mk = () => {
			const f = fakeBuilder(1, [{ id: 7, username: "contains_me" }]);
			f.b.where({ field: "username", op: "contains", value: "contains" });
			built.push(f);
			return f.b;
		};
		const r = await pagedFactory<any>(mk, { size: 10 });
		expect(built).toHaveLength(2);
		for (const f of built)
			expect(f.calls.some(c => c.startsWith("where:") && c.includes("contains"))).toBe(true);
		expect(r.total).toBe(1);
		expect(r.truncated).toBe(false);
	});

	it("total=0 → 不跑 list 查询（省一次往返），缺省 page=1/size=20", async () => {
		const built: Array<{ calls: string[] }> = [];
		const mk = () => {
			const f = fakeBuilder(0, []);
			built.push(f);
			return f.b;
		};
		const r = await pagedFactory<any>(mk, {});
		expect(built).toHaveLength(1); // 只跑了 count
		expect(r.list).toEqual([]);
		expect(r.truncated).toBe(false);
		expect(r.size).toBe(20);
	});
});
