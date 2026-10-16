// BDD：登录限速——AC1-26 同 (IP, username) 连败阈值 → 429 + 指数 backoff；
// 阻塞期内尝试继续累加并指数延长（防阻断期无脑重试）；成功清零。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, describe, expect, it } from "vitest";

import { loginBlocked, loginFailed, loginSucceeded, resetLoginThrottle } from "../src/_platform/_shared/service/rate";

let NOW = 0;

const OPTS = { threshold: 6, baseBackoffMs: 15_000, now: () => NOW };

afterEach(() => {
	resetLoginThrottle();
	NOW = 0;
});

describe("AC1-26：连败阈值与指数 backoff", () => {
	it("前 5 次失败不阻塞，第 6 次失败后第 7 次尝试 429（该次尝试即延长一档）", () => {
		for (let i = 0; i < 5; i++)
			expect(loginFailed("ip|bob", OPTS)).toBe(i + 1);
		expect(loginFailed("ip|bob", OPTS)).toBe(6); // 第 6 次失败 → 触发 base 阻断
		NOW += 1;
		// 第 7 次尝试：429；尝试本身累加失败并把 backoff 延长到 base×2
		expect(() => loginBlocked("ip|bob", OPTS)).toThrowError(expect.objectContaining({ status: 429, retryAfterMs: 30_000 }));
	});

	it("指数延长：阻塞期内继续尝试 backoff ×2（30s → 60s）", () => {
		for (let i = 0; i < 6; i++)
			loginFailed("ip|amy", OPTS);
		NOW += 1;
		expect(() => loginBlocked("ip|amy", OPTS)).toThrowError(expect.objectContaining({ retryAfterMs: 30_000 })); // 第 7 次尝试
		NOW += 1000; // 仍在 30s 窗口内
		expect(() => loginBlocked("ip|amy", OPTS)).toThrowError(expect.objectContaining({ retryAfterMs: 60_000 }));
	});

	it("backoff 窗口过后放行且计数保留（再败一次即重回阻断）", () => {
		for (let i = 0; i < 6; i++)
			loginFailed("ip|dan", OPTS);
		NOW += 16_000; // 15s backoff 过期
		loginBlocked("ip|dan", OPTS); // 不抛（窗口已过，count=6 保留）
		expect(loginFailed("ip|dan", OPTS)).toBe(7); // 再来一次失败 → 立即重回阻断
		expect(() => loginBlocked("ip|dan", OPTS)).toThrowError(expect.objectContaining({ status: 429 }));
	});

	it("成功清零：loginSucceeded 后同 key 不再阻塞", () => {
		for (let i = 0; i < 6; i++)
			loginFailed("ip|eve", OPTS);
		loginSucceeded("ip|eve");
		loginBlocked("ip|eve", OPTS); // 不抛
	});

	it("不同 (IP, username) 互不影响", () => {
		for (let i = 0; i < 6; i++)
			loginFailed("ip1|x", OPTS);
		loginBlocked("ip2|x", OPTS); // 不同 IP 不抛
		loginBlocked("ip1|y", OPTS); // 不同 username 不抛
	});
});
