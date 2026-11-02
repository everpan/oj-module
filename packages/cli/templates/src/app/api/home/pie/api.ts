// GET /api/home/pie —— 首页饼图（真实化 P4-1，AC-D9 apiPrefix=/home）。
// 按 category 聚合 home_pie，返回 {code,value} 数组（对齐契约 pieData）。

// 契约（oj v0.1.72「最新方式」）：入参挂 `.schema`，出参挂平级 `.response`；
// union 用类型数组表达（见 by）。
const pie = {
	async get() {
		try {
			const rows = await db.table("home_pie").select([
				"category",
				{ fn: "sum", field: "value", as: "v" },
			]).groupBy(["category"]).all();
			json.ok(rows.map(r => ({ code: String(r.category), value: Number(r.v) })));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

pie.get.schema = {
	query: {
		type: "object",
		properties: { by: { type: ["string", "number"] } },
	},
};

pie.get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["value", "code"],
		properties: {
			value: { type: "number" },
			code: { type: "string" },
		},
	},
};

export default pie;
