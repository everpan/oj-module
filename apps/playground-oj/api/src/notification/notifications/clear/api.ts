// POST /api/notification/notifications/clear —— 清空通知（按当前用户）。
// 删按人项 + 删本人广播回执（列表消失）。Bearer 守卫保护。复用 notify 原语 clearNotices。
import { clearNotices } from "@oj-module/runtime/notify";

export default {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		try {
			await clearNotices(uid);
			json.ok(null);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
