// POST /api/notification/notifications/read-all —— 全部通知已读（G4）。
// 把 notifications 表 is_read 全置 1。Bearer 守卫保护。
export default {
	async post() {
		try {
			await db.query("UPDATE notifications SET is_read = 1", []);
			json.ok(null);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
