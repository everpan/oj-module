// GET /api/web/hello —— 演示业务端点（Bearer 守卫保护）。
// 改完保存即生效（oj dev/ts 热更）；新增/删除模块目录需重启 ojm dev。
const handler = {
	get() {
		json.ok({
			message: "hello from oj",
			user: http.user?.id ?? null,
		});
	},
};

// 出参：演示端点（hello 文案 + 当前用户 id）
handler.get.response = {
	type: "object",
	required: ["message", "user"],
	properties: {
		message: { type: "string" },
		user: { type: ["number", "null"] },
	},
};

export default handler;
