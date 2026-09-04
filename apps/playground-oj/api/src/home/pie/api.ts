// GET /api/home/pie —— 首页饼图（真实化 P4-1，AC-D9 apiPrefix=/home）。
// 按 category 聚合 home_pie，返回 {code,value} 数组（对齐契约 pieData）。
export default {
	async get() {
		try {
			const rows = await db.query(
				"SELECT category, SUM(value) AS v FROM home_pie GROUP BY category",
				[],
			);
			json.ok(rows.map(r => ({ code: String(r.category), value: Number(r.v) })));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
