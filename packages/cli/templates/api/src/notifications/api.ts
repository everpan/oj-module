// GET /api/notifications —— 通知列表（runtime 通知铃的内置 root 级兜底端点）。
//
// runtime 的 fetchNotifications 在未注册 notificationsApi provider 时，直接
// `request.get("notifications")` → 本端点；返回 NotificationItem[]（信封内 data）。
// 数据层参考 apps/playground-oj/api/src/notification：查 notifications 表，
// is_read(0/1) 映射为布尔 isRead；Bearer 守卫保护。
//
// 注意：root 级路径无法写进业务契约（defineApi 要求 route 以 "/" 开头），
// 故本模块已在 api/.ojm-api-exempt.json 豁免，ojm api --check 不会误报。
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
