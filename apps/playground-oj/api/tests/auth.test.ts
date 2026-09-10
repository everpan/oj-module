// L1 回归测试（oj test，devkit 手册 §9）：登录链 + JS 运行时健康。
//
// 守护的三类回归（2026-09-10 实际发生）：
// 1. auth 模块缺失 → login/logout 404「no route matched」（auth 端点是业务
//    路由，手册 §8：项目必须自带 src/auth/ + anonymous_paths）；
// 2. 发行二进制 JS 运行时损坏（CI 构建把 ext JS 标记为构建机路径，运行时
//    ENOENT）→ 业务 handler 全部 500「js actor dropped job」——login 走
//    JS handler，本文件任一用例失败即暴露；
// 3. anonymous_paths 漏配 → login 被自家 Bearer 守卫拦成 401
//    「missing or invalid bearer token」。
//
// 凭据约定见 api/src/web/seed.sql 注头：admin/common 口令均为 12345。
// 只读 users 表 + 进程内 KV，不改业务数据。

describe("auth 登录链（L1 回归）", () => {
	it("login 成功返回载荷（access_token/refresh_token/expires_in/user）", async () => {
		const resp = await client.post("/auth/login", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "12345" }),
		});
		expect(resp.status).toBe(200);
		const env = JSON.parse(resp.body);
		expect(env.code).toBe(0);
		expect(env.data.access_token.length > 0).toBeTruthy();
		expect(env.data.refresh_token.length > 0).toBeTruthy();
		expect(env.data.expires_in > 0).toBeTruthy();
		expect(env.data.user.roles).toContain("admin");
	});

	it("login 口令错误 → 401 invalid credentials（而非守卫 401）", async () => {
		const resp = await client.post("/auth/login", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "wrong" }),
		});
		expect(resp.status).toBe(401);
		const env = JSON.parse(resp.body);
		// 若 anonymous_paths 漏配，这里会变成守卫的「missing or invalid bearer token」
		expect(env.msg).toBe("invalid credentials");
	});

	it("login 缺字段 → 400", async () => {
		const resp = await client.post("/auth/login", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "admin" }),
		});
		expect(resp.status).toBe(400);
	});

	it("web/user-info 未带 Bearer → 401（受保护路由仍有守卫）", async () => {
		const resp = await client.get("/web/user-info");
		expect(resp.status).toBe(401);
	});

	it("web/user-info 带 Bearer → 200 且身份正确（JS handler 健康）", async () => {
		const token = await client.login("admin", "12345");
		const resp = await client.get("/web/user-info", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(resp.status).toBe(200);
		const env = JSON.parse(resp.body);
		expect(env.code).toBe(0);
		expect(env.data.username).toBe("admin");
	});

	it("refresh 轮换：旧 refresh 用后立即失效", async () => {
		const loginResp = await client.post("/auth/login", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "12345" }),
		});
		const refresh = JSON.parse(loginResp.body).data.refresh_token;

		const first = await client.post("/auth/refresh", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ refresh_token: refresh }),
		});
		expect(first.status).toBe(200);
		const rotated = JSON.parse(first.body).data;
		expect(rotated.refresh_token.length > 0).toBeTruthy();
		expect(rotated.refresh_token !== refresh).toBeTruthy();

		// 旧 refresh 复用 → 401（轮换语义，手册 §8）
		const replay = await client.post("/auth/refresh", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ refresh_token: refresh }),
		});
		expect(replay.status).toBe(401);
	});

	it("logout 删除 refresh session：登出后 refresh → 401", async () => {
		const loginResp = await client.post("/auth/login", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "common", password: "12345" }),
		});
		const { refresh_token: refresh } = JSON.parse(loginResp.body).data;

		const out = await client.post("/auth/logout", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ refresh_token: refresh }),
		});
		expect(out.status).toBe(200);
		expect(JSON.parse(out.body).data === null).toBeTruthy();

		const after = await client.post("/auth/refresh", {
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ refresh_token: refresh }),
		});
		expect(after.status).toBe(401);
	});
});
