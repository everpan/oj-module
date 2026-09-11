// playground 工程 mock：login 模块自有认证接口（模块命名空间 /login，
// 与框架内置 auth/* 无交集）。AC-D16：oj 信封 {code,msg,data}，
// HTTP 状态 = code（0→200，由 ojm dev mock 服务按信封 code 置状态）。
export default [
	{
		url: "/login/login",
		method: "post",
		response: ({ body }) => {
			if (!body.username || !body.password) {
				return { code: 400, msg: "账号或密码错误", data: null };
			}
			return { code: 0, msg: "ok", data: { token: `mock-token-${body.username}`, refreshToken: `mock-refresh-${body.username}` } };
		},
	},
	{ url: "/login/logout", method: "post", response: () => ({ code: 0, msg: "ok", data: null }) },
	{ url: "/login/user-info", method: "get", response: () => ({ code: 0, msg: "ok", data: { id: "1", avatar: "", username: "Admin", email: "", phoneNumber: "", description: "manager", roles: ["admin"] } }) },
];
