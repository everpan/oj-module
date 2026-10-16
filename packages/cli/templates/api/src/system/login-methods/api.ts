import { respond } from "../../_platform/_shared/respond";
// GET /api/system/login-methods —— 登录方式发现（C5/D2；匿名端点：登录前无 token，
// 项目 config.yaml auth.anonymous_paths 必须列 /system/login-methods，漏列则握手 401 登录页必坏）。
import { listLoginMethods } from "../../_platform/_shared/service/settings";

export default {
	async get() {
		await respond(async () => {
			return listLoginMethods();
		});
	},
};
