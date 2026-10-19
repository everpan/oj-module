// BDD：登录限速——AC1-26 同 (IP, username) 连败阈值 → 429 + 指数 backoff；
// 阻塞期内尝试继续累加并指数延长（防阻断期无脑重试）；成功清零。
// 反常识回归锚点：oj 每请求重建模块实例，进程内 Map 方案真实运行时恒失效——
// 本用例跑真实迁移建出的 sys_login_throttle 表，断言落库语义。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { loginBlocked, loginFailed, loginSucceeded, resetLoginThrottle } from "../src/_platform/_shared/service/infra/rate";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
let NOW = 0;

const OPTS = { threshold: 6, baseBackoffMs: 15_000, now: () => NOW };

beforeAll(() => {
	dbo = installDb();
});

afterEach(async () => {
	await resetLoginThrottle();
	NOW = 0;
});

describe("AC1-26：连败阈值与指数 backoff（DB 状态）", () => {
	it("前 5 次失败不阻塞，第 6 次失败后第 7 次尝试 429（该次尝试即延长一档）", async () => {
		for (let i = 0; i < 5; i++)
			expect(await loginFailed("ip|bob", OPTS)).toBe(i + 1);
		expect(await loginFailed("ip|bob", OPTS)).toBe(6); // 第 6 次失败 → 触发 base 阻断
		NOW += 1;
		// 第 7 次尝试：429；尝试本身累加失败并把 backoff 延长到 base×2
		await expect(loginBlocked("ip|bob", OPTS)).rejects.toMatchObject({ status: 429, retryAfterMs: 30_000 });
	});

	it("指数延长：阻塞期内继续尝试 backoff ×2（30s → 60s）", async () => {
		for (let i = 0; i < 6; i++)
			await loginFailed("ip|amy", OPTS);
		NOW += 1;
		await expect(loginBlocked("ip|amy", OPTS)).rejects.toMatchObject({ retryAfterMs: 30_000 }); // 第 7 次尝试
		NOW += 1000; // 仍在 30s 窗口内
		await expect(loginBlocked("ip|amy", OPTS)).rejects.toMatchObject({ retryAfterMs: 60_000 });
	});

	it("backoff 窗口过后放行且计数保留（再败一次即重回阻断）", async () => {
		for (let i = 0; i < 6; i++)
			await loginFailed("ip|dan", OPTS);
		NOW += 16_000; // 15s backoff 过期
		await loginBlocked("ip|dan", OPTS); // 不抛（窗口已过，count=6 保留）
		expect(await loginFailed("ip|dan", OPTS)).toBe(7); // 再来一次失败 → 立即重回阻断
		await expect(loginBlocked("ip|dan", OPTS)).rejects.toMatchObject({ status: 429 });
	});

	it("成功清零：loginSucceeded 后同 key 不再阻塞", async () => {
		for (let i = 0; i < 6; i++)
			await loginFailed("ip|eve", OPTS);
		await loginSucceeded("ip|eve");
		await loginBlocked("ip|eve", OPTS); // 不抛
	});

	it("不同 (IP, username) 互不影响", async () => {
		for (let i = 0; i < 6; i++)
			await loginFailed("ip1|x", OPTS);
		await loginBlocked("ip2|x", OPTS); // 不同 IP 不抛
		await loginBlocked("ip1|y", OPTS); // 不同 username 不抛
	});

	it("状态落库：连败计数与阻断窗口在 sys_login_throttle 可查（跨请求语义的存证）", async () => {
		for (let i = 0; i < 6; i++)
			await loginFailed("ip|db", OPTS);
		const row = dbo.prepare("SELECT fail_count, blocked_until FROM sys_login_throttle WHERE pair_key = 'ip|db'").get() as { fail_count: number, blocked_until: number };
		expect(row.fail_count).toBe(6);
		expect(row.blocked_until).toBe(15_000); // base × 2^0
	});
});
