// GET /api/demo/todos —— 演示待办列表（真实化 P3-2，AC-D9 apiPrefix=/demo）。
// Bearer 守卫保护；keyword 模糊过滤 title；snake_case → camelCase，done 映射布尔。

// 契约（v0.1.71「最新方式」）：动词挂 `.schema` 四通道（params/query/body/response），
// oj 运行期据此校验入参、并供 `oj openapi` 生成 openapi.json → 前端 `ojm api` 生成 __client。
const todos = {
	async get() {
		const kw = http.query.keyword;
		const where = kw ? "WHERE title LIKE ?" : "";
		const params = kw ? [`%${kw}%`] : [];
		try {
			// 保留 db.query：WHERE 由 JS 字符串拼接动态生成（规则5）
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

todos.get.schema = {
	query: {
		type: "object",
		properties: { keyword: { type: "string" } },
	},
};

// oj v0.1.72 起出参走平级 .response（.schema 只放入参）。
todos.get.response = {
	type: "object",
	required: ["list", "total"],
	properties: {
		list: {
			type: "array",
			items: {
				type: "object",
				required: ["id", "title", "done"],
				properties: {
					id: { type: "number" },
					title: { type: "string" },
					done: { type: "boolean" },
				},
			},
		},
		total: { type: "number" },
	},
};

export default todos;
