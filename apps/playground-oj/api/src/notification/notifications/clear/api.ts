// POST /api/notification/notifications/clear —— 清空通知（G4）。
// 清空 notifications 全表。Bearer 守卫保护。
export default {
	async post() {
		try {
			await db.query("DELETE FROM notifications", []);
			json.ok(null);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
