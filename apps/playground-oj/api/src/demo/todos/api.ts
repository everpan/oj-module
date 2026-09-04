// GET /api/demo/todos —— 演示待办列表（真实化 P3-2，AC-D9 apiPrefix=/demo）。
// Bearer 守卫保护；keyword 模糊过滤 title；snake_case → camelCase，done 映射布尔。
export default {
	async get() {
		const kw = http.query.keyword;
		const where = kw ? "WHERE title LIKE ?" : "";
		const params = kw ? [`%${kw}%`] : [];
		try {
			const totalRows = await db.query(`SELECT COUNT(*) AS c FROM todos ${where}`, params);
			const total = Number(totalRows[0]?.c ?? 0);
			const rows = await db.query(
				`SELECT id, title, done, create_time, update_time FROM todos ${where} ORDER BY id ASC`,
				params,
			);
			const list = rows.map(r => ({
				id: Number(r.id),
				title: String(r.title),
				done: Number(r.done) === 1,
			}));
			json.ok({ list, total });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
