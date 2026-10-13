// POST /api/notification/notifications/read —— 单条通知已读。
// body.id 为命名空间串 "u:<id>"（按人）/"b:<id>"（广播）；按人项校验归属，非本人 403。
// Bearer 守卫保护。复用运行时 notify 原语 markRead。
import { markRead } from "@oj-module/runtime/notify";

export default {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		const body = (http.body ?? {}) as { id?: unknown };
		const id = String(body.id ?? "");
		if (!id) {
			json.fail(400, "id is required");
			return;
		}
		try {
			await markRead(id, uid);
			json.ok(null);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
