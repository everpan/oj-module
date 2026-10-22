// L1 回归（`oj test` 收集，*.test.ts；与 vitest 的 *.spec.ts 互不干扰）。
//
// 为什么有这类文件：SQL 构造器是 oj 二进制内的纯 Rust 实现，vitest 夹具够不着真
// builder（架构定论：无 JS 模块可导、不写运行时垫片）——模板 tests/*.spec.ts 只能做
// L2 记录型断言。**真执行面**（SQL 渲染 / 真过滤 / 真转义）在这里经 oj test 闭环：
// 真 v8 + 真路由/鉴权 + 真迁移/seed + 真 db + 真构造器（方法论见 devkit oj-test-guide.md）。
//
// 覆盖 0.1.81/0.1.82 构造器迁移的关键行为：
//   ① settings 真构造器（IN + LIMIT）——vitest 侧同源码 5 个用例红海的对照面；
//   ② demo/todos：whereIf 真跳过（无 keyword 不过滤）+ contains 真渲染（%kw% + 元字符转义）；
//   ③ notification：join ON 值条件 + UNION ALL + 字面量列 {lit,as} 的真渲染（场景 41 同款）。
//
// 登录账号：fixtures 的 l1tester（src/_platform/fixtures/l1-test-user.sql，仅 oj test 灌入）。
// 不用 seed 的 admin：其 must_change=1（判权端点恒 403）且初始口令 123456 会随用户
// 首登改密漂移——L1 绑 admin 曾实测 401。l1tester 为 additive 专用账号（must_change=0）。
//
// 运行：cd packages/cli/templates/api && ~/.local/share/oj/oj test -c config.yaml -d src -t tests

const L1_USER = { username: "l1tester", password: "l1test1234" };
const asL1 = async () => ({ Authorization: `Bearer ${await client.login(L1_USER.username, L1_USER.password)}` });

describe("l1：0.1.81/0.1.82 构造器迁移真执行面", () => {
	it("匿名 login-methods：真构造器（IN + LIMIT 渲染）返回 200 + 方法数组", async () => {
		const r = await client.get("/system/login-methods");
		expect(r.status).toBe(200);
		const body = JSON.parse(r.body);
		expect(body.code).toBe(0);
		expect(Array.isArray(body.data.methods)).toBeTruthy();
		expect(body.data.methods).toContain("local");
	});

	it("demo/todos 无 keyword：whereIf 真跳过（不发射条件），全量 4 条", async () => {
		const h = await asL1();
		const r = await client.get("/demo/todos", { headers: h });
		expect(r.status).toBe(200);
		const body = JSON.parse(r.body);
		expect(body.data.total).toBe(4);
		expect(body.data.list.length).toBe(4); // L1 expect 无 toHaveLength（契约见 api-manual §9）
	});

	it("demo/todos keyword=契约：contains 真渲染（%kw%）精确命中 1 条", async () => {
		const h = await asL1();
		const r = await client.get(`/demo/todos?keyword=${encodeURIComponent("契约")}`, { headers: h });
		expect(r.status).toBe(200);
		const body = JSON.parse(r.body);
		expect(body.data.total).toBe(1);
		expect(String(body.data.list[0].title)).toContain("契约");
	});

	it("demo/todos keyword=%：LIKE 元字符经引擎转义不泛化（0 命中且不炸）", async () => {
		const h = await asL1();
		const r = await client.get(`/demo/todos?keyword=${encodeURIComponent("%")}`, { headers: h });
		expect(r.status).toBe(200);
		expect(JSON.parse(r.body).data.total).toBe(0);
	});

	it("notification 列表：join ON 值条件 + UNION + 字面量 scope 列真渲染，按人/广播分流", async () => {
		const h = await asL1();
		// 自给自足（oj-test-guide §6 纪律：按自己推的行精确断言，不依赖 seed 的 user_id=1）：
		// 先清空本人视图，再经真 push 端点各发一条按人 + 一条广播，回来过 list 断言。
		const clear = await client.post("/notification/notifications/clear", { headers: h });
		expect(clear.status).toBe(200);

		const pushUser = await client.post("/notification/push", {
			headers: h,
			body: JSON.stringify({ title: "L1 按人通知", message: "join ON 值条件 + UNION 真渲染" }),
		});
		expect(pushUser.status).toBe(200);
		const userId = String(JSON.parse(pushUser.body).data.id);
		expect(userId.startsWith("u:")).toBeTruthy(); // 命名空间 id：按人

		const pushBcast = await client.post("/notification/push-broadcast", {
			headers: h,
			body: JSON.stringify({ title: "L1 广播通知", message: "LEFT JOIN 回执 + 字面量 scope 列" }),
		});
		expect(pushBcast.status).toBe(200);
		const bcastId = String(JSON.parse(pushBcast.body).data.id);
		expect(bcastId.startsWith("b:")).toBeTruthy(); // 命名空间 id：广播

		const r = await client.get("/notification/notifications", { headers: h });
		expect(r.status).toBe(200);
		const list = JSON.parse(r.body).data as Array<Record<string, unknown>>;
		expect(Array.isArray(list)).toBeTruthy();
		const byId = new Map(list.map(n => [String(n.id), n]));
		// {lit:"user",as:"scope"} / {lit:"broadcast",...} 经 UNION 落到首列名——两条各带正确作用域
		expect(byId.get(userId)?.scope).toBe("user");
		expect(byId.get(bcastId)?.scope).toBe("broadcast");
		expect(String(byId.get(userId)?.title)).toBe("L1 按人通知");
		expect(String(byId.get(bcastId)?.title)).toBe("L1 广播通知");
	});
});
