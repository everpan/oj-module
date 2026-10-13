// GET /api/notification/notifications —— 通知列表（按人真实通知）。
// 合并：广播(LEFT JOIN 回执算 is_read) UNION 按人(WHERE user_id = ?)，命名空间 id。
// Bearer 守卫保护。直接复用 _shared/notify 原语 noticesFor 保证与发射端单一数据路径。
import { noticesFor } from "../_shared/notify";

export default {
	async get() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		try {
			json.ok(await noticesFor(uid));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
