// 限速出口（B5/AC1-26 + 接口级限速）。反常识修正：oj 运行时每请求重建模块实例，
// 进程内 Map 不跨请求存活（实测模块级计数器恒为初值）——状态全部落库：
// sys_rate_window（滑动窗口计数）/ sys_login_throttle（连败 + 指数 backoff）。
// 落库后重启保留、多实例天然同源（原先「多实例换 Redis」的已知上限就此消除）。
// ponytail: SELECT→DELETE+INSERT/UPDATE 两步写，高并发下窗口计数可能丢几拍——限速场景可容忍。

export interface RateLimitOpts {
	/** 时钟注入（测试用）；缺省 Date.now() */
	now?: () => number
}

/** key 维度（如 `contacts:<uid>` / `login:ip:<ip>`）：窗口内超 limit → 429。 */
export async function rateLimit(key: string, limit: number, windowMs: number, opts: RateLimitOpts = {}): Promise<void> {
	const now = opts.now?.() ?? Date.now();
	const rows = await db.query("select window_start, count from sys_rate_window where rate_key = ?", [key]);
	const w = rows[0] as { window_start: number, count: number } | undefined;
	if (!w || now - Number(w.window_start) >= windowMs) {
		await db.exec("delete from sys_rate_window where rate_key = ?", [key]);
		await db.exec("insert into sys_rate_window (rate_key, window_start, count) values (?, ?, 1)", [key, now]);
		return;
	}
	const count = Number(w.count) + 1;
	await db.exec("update sys_rate_window set count = ? where rate_key = ?", [count, key]);
	if (count > limit)
		throw Object.assign(new Error("rate limited"), { status: 429 });
}

// ---- 登录限速（AC1-26）：(IP, username) 连败阈值 → 429 + 指数 backoff（状态在 sys_login_throttle）----

export interface LoginThrottleOpts extends RateLimitOpts {
	/** 连败阈值（默认 6，AC1-26） */
	threshold?: number
	/** 基础 backoff（默认 15s）；第 n 次超阈失败阻断 base × 2^(n - threshold) */
	baseBackoffMs?: number
}

interface LoginThrottleRow {
	fail_count: number
	blocked_until: number
}

/** 登录失败计数 +1；达到阈值即按指数 backoff 设阻断窗口。返回累计连败数。 */
export async function loginFailed(key: string, opts: LoginThrottleOpts = {}): Promise<number> {
	const threshold = opts.threshold ?? 6;
	const base = opts.baseBackoffMs ?? 15_000;
	const now = opts.now?.() ?? Date.now();
	const rows = await db.query("select fail_count, blocked_until from sys_login_throttle where pair_key = ?", [key]);
	const s = rows[0] as LoginThrottleRow | undefined;
	const count = (s ? Number(s.fail_count) : 0) + 1;
	const blockedUntil = count >= threshold ? now + base * 2 ** (count - threshold) : (s ? Number(s.blocked_until) : 0);
	await db.exec("delete from sys_login_throttle where pair_key = ?", [key]);
	await db.exec("insert into sys_login_throttle (pair_key, fail_count, blocked_until) values (?, ?, ?)", [key, count, blockedUntil]);
	return count;
}

/** 登录前检查：阻断期内抛 429；且每次尝试都累加失败并指数延长（防阻断期无脑重试）。 */
export async function loginBlocked(key: string, opts: LoginThrottleOpts = {}): Promise<void> {
	const threshold = opts.threshold ?? 6;
	const base = opts.baseBackoffMs ?? 15_000;
	const now = opts.now?.() ?? Date.now();
	const rows = await db.query("select fail_count, blocked_until from sys_login_throttle where pair_key = ?", [key]);
	const s = rows[0] as LoginThrottleRow | undefined;
	if (!s || Number(s.blocked_until) <= now)
		return;
	const count = Number(s.fail_count) + 1;
	const blockedUntil = now + base * 2 ** (count - threshold);
	await db.exec("update sys_login_throttle set fail_count = ?, blocked_until = ? where pair_key = ?", [count, blockedUntil, key]);
	throw Object.assign(new Error("too many login attempts"), { status: 429, retryAfterMs: blockedUntil - now });
}

/** 登录成功清零连败。 */
export async function loginSucceeded(key: string): Promise<void> {
	await db.exec("delete from sys_login_throttle where pair_key = ?", [key]);
}

/** 清登录限速状态（测试夹具/运维排障用）。 */
export async function resetLoginThrottle(): Promise<void> {
	await db.exec("delete from sys_login_throttle", []);
}
