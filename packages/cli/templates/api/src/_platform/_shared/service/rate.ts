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

// ---- 登录限速（AC1-26）：(IP, username) 连败阈值 → 429 + 指数 backoff ----
// 进程内 Map（与 rateLimit 同上限注释：多实例换 Redis 同源）。

export interface LoginThrottleOpts {
	/** 连败阈值（默认 6，AC1-26） */
	threshold?: number
	/** 基础 backoff（默认 15s）；第 n 次超阈失败阻断 base × 2^(n - threshold) */
	baseBackoffMs?: number
	now?: () => number
}

interface LoginFailState {
	count: number
	blockedUntil: number
}

const loginFails = new Map<string, LoginFailState>();

/** 登录失败计数 +1；达到阈值即按指数 backoff 设阻断窗口。返回累计连败数。 */
export function loginFailed(key: string, opts: LoginThrottleOpts = {}): number {
	const threshold = opts.threshold ?? 6;
	const base = opts.baseBackoffMs ?? 15_000;
	const now = opts.now?.() ?? Date.now();
	const s = loginFails.get(key) ?? { count: 0, blockedUntil: 0 };
	s.count += 1;
	if (s.count >= threshold)
		s.blockedUntil = now + base * 2 ** (s.count - threshold);
	loginFails.set(key, s);
	return s.count;
}

/** 登录前检查：阻断期内抛 429；且每次尝试都累加失败并指数延长（防阻断期无脑重试）。 */
export function loginBlocked(key: string, opts: LoginThrottleOpts = {}): void {
	const threshold = opts.threshold ?? 6;
	const base = opts.baseBackoffMs ?? 15_000;
	const now = opts.now?.() ?? Date.now();
	const s = loginFails.get(key);
	if (!s || s.blockedUntil <= now)
		return;
	s.count += 1;
	s.blockedUntil = now + base * 2 ** (s.count - threshold);
	throw Object.assign(new Error("too many login attempts"), { status: 429, retryAfterMs: s.blockedUntil - now });
}

/** 登录成功清零连败。 */
export function loginSucceeded(key: string): void {
	loginFails.delete(key);
}

/** 清登录限速状态（测试夹具/运维排障用）。 */
export function resetLoginThrottle(): void {
	loginFails.clear();
}
