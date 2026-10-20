// GET /api/demo/todos —— 演示待办列表（真实化 P3-2，AC-D9 apiPrefix=/demo）。
// Bearer 守卫保护；keyword 模糊过滤 title；snake_case → camelCase，done 映射布尔。

// 契约（v0.1.71「最新方式」）：动词挂 `.schema` 四通道（params/query/body/response），
// oj 运行期据此校验入参、并供 `oj openapi` 生成 openapi.json → 前端 `ojm api` 生成 __client。
const todos = {
	async get() {
		const kw = http.query.keyword;
		const hasKw = typeof kw === "string" && kw.length > 0;
		// 构造器：模糊过滤走语义 op（contains 自动转义 %/_/!），count 走聚合，方言无关。
		const build = () => db.table("todos").whereIf(hasKw, { field: "title", op: "contains", value: kw });
		try {
			const total = Number((await build().select([{ fn: "count", as: "c" }]).all())[0]?.c ?? 0);
			const rows = await build()
				.select(["id", "title", "done", "create_time", "update_time"])
				.orderBy([{ field: "id", dir: "asc" }])
				.all();
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
