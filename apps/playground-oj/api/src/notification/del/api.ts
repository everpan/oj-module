// POST /api/notification/del —— 删除一条通知（发射原语 HTTP 入口）。
// 按人项校验归属，非本人返回 403；广播项仅删本人回执。Bearer 守卫保护。
import { delNotice } from "../_shared/notify";

// 契约（v0.1.71「最新方式」）：动词挂 `.schema` 四通道；union 用类型数组表达（见 userId）。
const del = {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		const b = (http.body ?? {}) as { id?: unknown, userId?: unknown };
		const id = String(b.id ?? "");
		if (!id) {
			json.fail(400, "id is required");
			return;
		}
		const target = b.userId ?? uid;
		try {
			const ok = await delNotice(id, target as string | number);
			if (!ok) {
				json.fail(403, "forbidden");
				return;
			}
			json.ok(null);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

del.post.schema = {
	body: {
		type: "object",
		required: ["id"],
		properties: {
			id: { type: "string" },
			userId: { type: ["string", "number"] },
		},
	},
};

export default del;
