// POST /api/notification/notifications/read —— 单条通知已读（G4）。
// body: { id }；把对应行 is_read 置 1。Bearer 守卫保护。
export default {
	async post() {
		try {
			const body = (http.body ?? {}) as { id?: unknown };
			const id = Number(body.id);
			if (!Number.isFinite(id)) {
				json.fail(400, "id is required");
				return;
			}
			await db.query("UPDATE notifications SET is_read = 1 WHERE id = ?", [id]);
			json.ok(null);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
