// POST /api/notification/notifications/read-all —— 全部通知已读（按当前用户）。
// 按人项全置位 + 广播回执全 upsert。Bearer 守卫保护。复用 notify 原语 markAllRead。
import { markAllRead } from "@oj-module/runtime/notify";

export default {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		try {
			await markAllRead(uid);
			json.ok(null);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
