// 企微指令回调的**重放防护**（2026-10-30 补缺口）。
//
// 为什么必须有第二道：企微的验签只证明「这个报文是拿着 Token 的一方签的」，
// 而 (timestamp, nonce, Encrypt, msg_signature) 这个组合在 Token 不变的前提下
// **永久有效**——服务端不校验 timestamp 的新旧，抓到过一次合法回调的人可以在任意
// 时刻原样重放。最坏的一条是 cancel_auth：重放即触发 disableCorp（整家企业停用 +
// 吊销该企业全部会话），而企微只在「拿不到 success」时才重推，所以它连报警窗口都没有。
// 官方 SDK 的解密样例里同样有这一步（此处原本漏掉）。
//
// 两道闸：
//   1. timestamp 新鲜度：与本机时间偏差超过 ±5 分钟即拒（企微→本站是直连 HTTPS，
//      正常网络与重试延迟在秒级；窗口取 5 分钟只为容忍双方时钟不同步）。
//   2. nonce 幂等：kv.incr 原子计数，首次才写入 TTL。计数而不是读改写，是为了
//      「两个并发同 nonce」也只有一个拿到 1（oj 的 kv 在配了 Redis 时是多实例共享的）。
//
// ⚡ 幂等是「处理成功」才算数：拿到的是一次**占用**（ReplayClaim），调用方处理失败必须
// `release()` 放回。不放回的后果不是理论问题——企微只在「拿不到 success」时重推，而那正是
// 需要重推的时刻；占用不放，重推会被自己的重放守卫判成 400，恢复路径当场死掉
// （2026-11-01 生产日志：create_auth 因上游 502 失败 → 重推 400「nonce 重复」）。
//
// 两条都回调 400：它不是「本站要鉴权」的问题，401 会把排查带偏。
const REPLAY_WINDOW_SECS = 5 * 60;
/** 计数键存活时间：只要盖住重放窗口即可，避免 kv 无界增长 */
const NONCE_TTL_SECS = 2 * REPLAY_WINDOW_SECS;

export interface ReplayGate {
	/** 原子自增并返回新值（kv.incr 同语义） */
	incr: (key: string) => Promise<number>
	expire: (key: string, ttlSecs: number) => Promise<unknown>
	del: (key: string) => Promise<unknown>
	now: () => number
}

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

/** 运行时形态：计数走 kv（Redis 时跨实例），时钟取本机秒级时间戳 */
export function runtimeReplayGate(): ReplayGate {
	return {
		incr: key => kv.incr(key),
		expire: (key, ttlSecs) => kv.expire(key, ttlSecs),
		del: key => kv.del(key),
		now: () => Math.floor(Date.now() / 1000),
	};
}

/** 一次 nonce 占用：处理成功就不必管（TTL 到期自然消失）；失败必须 `release()` */
export interface ReplayClaim {
	release: () => Promise<void>
}

/**
 * 校验一次回调的时效与唯一性。通过 => 返回占用凭据；不通过 => 抛 400。
 * 调用时机：**签名校验之后、解密之前**（先验签避免给未鉴权的请求写 kv，再拦重放省一次解密）。
 *
 * 占用是「这次报文归我处理」，不是「这条报文已经处理成功」——所以失败路径必须放回：
 * 企微的重推是瞬态故障唯一的恢复手段，被自己的重放守卫挡掉等于把恢复路径拆了。
 */
export async function guardReplay(timestampRaw: string, nonce: string, gate: ReplayGate): Promise<ReplayClaim> {
	const ts = Number(timestampRaw);
	if (!Number.isInteger(ts) || ts <= 0)
		fail(400, "回调 timestamp 非法");
	if (Math.abs(gate.now() - ts) > REPLAY_WINDOW_SECS)
		fail(400, "回调 timestamp 超出允许窗口：请检查服务器时间，或该请求为历史回调的重放");
	if (!nonce)
		fail(400, "回调 nonce 缺失");

	const key = `wecom:nonce:${nonce}`;
	const seen = Number(await gate.incr(key));
	if (seen !== 1)
		fail(400, "回调 nonce 重复：同一条指令回调已被处理过（重放请求已拒绝）");
	// 首次访问才有资格设 TTL：设不上就删键——留一个没有过期的计数键既让它永久增长，
	// 也会把未来的同一 nonce（虽概率极低）误判成重放。
	if (!(await gate.expire(key, NONCE_TTL_SECS))) {
		log.warn("wecom replay nonce ttl not set", "key", key);
		await gate.del(key);
	}
	return {
		// 直接 del，不做「是不是我占的那一次」的判断：oj 的 kv 没有 CAS，incr 的返回值
		// 也已被消费在 seen 上。代价是并发同 nonce 时（同一秒内两次投递）可能多放过一次，
		// 但放回的时机只在「处理失败」，而失败的这一条本来就该让企微重推。
		release: async () => {
			await gate.del(key);
		},
	};
}
