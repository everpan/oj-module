// GET /api/web/hello —— 演示业务端点（Bearer 守卫保护）。
// 改完保存即生效（oj dev/ts 热更）；新增/删除模块目录需重启 ram dev。
export default {
	get() {
		json.ok({
			message: "hello from oj",
			user: http.user?.id ?? null,
		});
	},
};
