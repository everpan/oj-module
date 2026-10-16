// 进程内限速（滑动窗口计数，单实例语义）。B5 登录限速复用本工具扩 IP/username 双维度；
// ponytail: 进程内 Map 无分布式一致性——多实例部署时换 Redis 同源（接口限速的已知上限）。
const hits = new Map<string, { start: number, count: number }>();

/** key 维度（如 `contacts:<uid>` / `login:<ip>:<username>`）：窗口内超 limit → 429。 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
	const now = Date.now();
	const w = hits.get(key);
	if (!w || now - w.start >= windowMs) {
		hits.set(key, { start: now, count: 1 });
		return;
	}
	w.count += 1;
	if (w.count > limit)
		throw Object.assign(new Error("rate limited"), { status: 429 });
}
