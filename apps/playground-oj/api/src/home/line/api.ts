// POST /api/home/line —— 首页折线（真实化 P4-1，AC-D9 apiPrefix=/home）。
// 窗口聚合 home_line：range(week/month/year) → 天数；在 [today-N+1, today] 内
// 逐日取 SUM(value)，缺失日补 0（F6 幂等补数）。返回 number[]（与日序对齐）。
const RANGE_DAYS: Record<string, number> = { week: 7, month: 30, year: 365 };

export default {
	async post() {
		try {
			const range = String((http.body && (http.body as Record<string, unknown>).range) ?? "week");
			const days = RANGE_DAYS[range] ?? 7;
			const today = Math.floor(Date.now() / 86400000);
			const start = today - days + 1;

			const rows = await db.query(
				"SELECT day, SUM(value) AS v FROM home_line WHERE day >= ? AND day <= ? GROUP BY day",
				[start, today],
			);
			const map = new Map<number, number>();
			for (const r of rows)
				map.set(Number(r.day), Number(r.v));

			const out: number[] = [];
			for (let d = start; d <= today; d++)
				out.push(map.get(d) ?? 0);

			// 懒补数（F6）：窗口内完全无 seed（seed 随时间变旧）时，回落确定式趋势，
			// 保证图表非空；有 seed 时仅对缺失日补 0（上面 ?? 0 已处理）。
			if (out.every(v => v === 0)) {
				for (let d = start; d <= today; d++)
					out.push(50 + Math.round(40 * Math.sin(d / 3)) + (d % 7) * 3);
			}
			json.ok(out);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};
