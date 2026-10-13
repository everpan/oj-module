// POST /api/notification/push —— 给指定用户推一条按人通知（发射原语 HTTP 入口）。
// 真正逻辑在 _shared/notify.pushNotice（任一后端模块也可直接 import 调用，无需走 HTTP）。
// Bearer 守卫保护；收件人过滤是发送方责任（原语不做业务判断）。
import { pushNotice } from "../_shared/notify";

export default {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		const b = (http.body ?? {}) as {
			userId?: unknown
			title?: unknown
			message?: unknown
			link?: unknown
			avatar?: unknown
			category?: unknown
		};
		const target = b.userId ?? uid;
		if (!b.title || !b.message) {
			json.fail(400, "title and message are required");
			return;
		}
		try {
			const id = await pushNotice({
				userId: target as string | number,
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
