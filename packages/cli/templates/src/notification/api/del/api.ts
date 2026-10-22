// POST /api/notification/del —— 删除一条通知（发射原语 HTTP 入口）。
// 按人项校验归属，非本人返回 403；广播项仅删本人回执。Bearer 守卫保护。
import { delNotice } from "../_shared/notify";

// POST /api/notification/del —— 删除一条通知（发射原语 HTTP 入口）。
// 按人项校验归属，非本人返回 403；广播项仅删本人回执。Bearer 守卫保护。
// userId 类型数组表达 z.union（同 push）；缺省回落当前用户。
const handler = {
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

handler.post.schema = {
	body: {
		type: "object",
		required: ["id"],
		properties: {
			id: { type: "string" },
			userId: { type: ["string", "number"] },
		},
	},
};

export default handler;
