import { respond } from "#/_platform/_shared/respond";
// GET /api/system/login-methods —— 登录方式发现（C5/D2；匿名端点：登录前无 token，
// 项目 config.yaml auth.anonymous_paths 必须列 /system/login-methods，漏列则握手 401 登录页必坏）。
import { listLoginMethods } from "#/_platform/_shared/service/domain/settings";

async function get() {
	await respond(async () => {
		return listLoginMethods();
	});
}
get.schema = {
	description: "登录方式发现（匿名端点，登录前调用）：返回已启用的登录方式与站点标题，登录页据此渲染入口。必须列在 config 的 auth.anonymous_paths，漏列会让登录页握手 401。",
};

get.response = {
	type: "object",
	required: ["methods", "site_title"],
	properties: {
		methods: { type: "array", items: { type: "string" } },
		site_title: { type: "string" },
	},
};

export default { get };
