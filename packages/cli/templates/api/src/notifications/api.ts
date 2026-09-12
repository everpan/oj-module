// GET /api/notifications —— 通知列表（runtime 通知铃的内置 root 级兜底端点）。
//
// runtime 的 fetchNotifications 在未注册 notificationsApi provider 时，直接
// `request.get("notifications")` → 本端点；返回 NotificationItem[]（信封内 data）。
// 查 notifications 表，is_read(0/1) 映射为布尔 isRead；Bearer 守卫保护。
//
// G5：本目录只保留只读兜底——表结构/种子迁归 api/src/notification/ 模块
// （评审 b3 双模块同表冲突决策）；查询须返回 id（G4 NotificationItem.id 必填）。
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
				id: Number(r.id),
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
