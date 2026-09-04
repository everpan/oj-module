// GET /api/web/user-info —— 前端登录链用户信息端点（Bearer 守卫保护）。
// 响应一律走 json.ok/json.fail 信封（oj 红线）；前端 runtime 适配层（D10）
// 负责把 {code:0,data} 转成前端 {code:200,result}。
export default {
	get() {
		json.ok({
			id: String(http.user?.id ?? "1"),
			avatar: "",
			username: "admin",
			email: "admin@example.com",
			phoneNumber: "",
			description: "oj demo user",
			roles: http.user?.roles ?? ["admin"],
			permissions: [],
		});
	},
};
