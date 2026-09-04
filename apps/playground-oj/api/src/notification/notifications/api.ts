// GET /api/notification/notifications —— 通知列表（真实化 P4-2，AC-D9 apiPrefix=/notification）。
// 真实化：查 notifications 表，is_read 映射布尔；Bearer 守卫保护。
export default {
	async get() {
		try {
			const rows = await db.query(
				"SELECT id, avatar, date, is_read, message, title FROM notifications ORDER BY id DESC",
				[],
			);
			json.ok(rows.map(r => ({
				avatar: String(r.avatar),
				date: String(r.date),
				isRead: Number(r.is_read) === 1,
				message: String(r.message),
				title: String(r.title),
			})));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
