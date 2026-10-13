// POST /api/notification/push-broadcast —— 广播一条通知（全员可见，一行存储）。
// 真正逻辑在运行时 notify.pushBroadcastNotice。Bearer 守卫保护。
import { pushBroadcastNotice } from "@oj-module/runtime/notify";

export default {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		const b = (http.body ?? {}) as {
			title?: unknown
			message?: unknown
			link?: unknown
			avatar?: unknown
			category?: unknown
		};
		if (!b.title || !b.message) {
			json.fail(400, "title and message are required");
			return;
		}
		try {
			const id = await pushBroadcastNotice({
				title: String(b.title),
				message: String(b.message),
				link: b.link != null ? String(b.link) : undefined,
				avatar: b.avatar != null ? String(b.avatar) : undefined,
				category: b.category as never,
			});
			json.ok({ id });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
