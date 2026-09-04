// GET /api/system/role-list —— 角色列表（分页 + 过滤，AC-D9 apiPrefix=/system）。
// 真实化（P3-1）：查 system.roles 表，snake_case → camelCase，Bearer 守卫保护。
export default {
	async get() {
		const name = http.query.name;
		const code = http.query.code;
		const statusRaw = http.query.status;

		const current = Math.max(1, Number(http.query.current ?? 1));
		const pageSize = Math.max(1, Number(http.query.pageSize ?? 10));

		const where: string[] = [];
		const params: unknown[] = [];
		if (name) {
			where.push("name LIKE ?");
			params.push(`%${name}%`);
		}
		if (code) {
			where.push("code LIKE ?");
			params.push(`%${code}%`);
		}
		if (statusRaw !== undefined && statusRaw !== "") {
			where.push("status = ?");
			params.push(Number(statusRaw));
		}
		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

		try {
			const totalRows = await db.query(`SELECT COUNT(*) AS c FROM roles ${whereSql}`, params);
			const total = Number(totalRows[0]?.c ?? 0);

			const offset = (current - 1) * pageSize;
			const rows = await db.query(
				`SELECT id, name, code, status, remark, create_time, update_time
         FROM roles ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
				[...params, pageSize, offset],
			);

			const list = rows.map(r => ({
				id: Number(r.id),
				name: String(r.name),
				code: String(r.code),
				status: Number(r.status),
				remark: String(r.remark),
				createTime: Number(r.create_time),
				updateTime: Number(r.update_time),
			}));

			json.ok({ list, total, pageSize, current });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
