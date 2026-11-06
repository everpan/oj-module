/**
 * oj.ts 的 healthHostOf：健康轮询跟随 server.host，通配/缺省回退回环。
 * （preview 改绑局域网 IP 时，回环硬编码会让就绪轮询永不成功。）
 */
import { describe, expect, it } from "vitest";
import { healthHostOf } from "../oj";

describe("healthHostOf", () => {
	it.each([
		[undefined, "127.0.0.1"],
		["", "127.0.0.1"],
		["0.0.0.0", "127.0.0.1"],
		["::", "127.0.0.1"],
		["127.0.0.1", "127.0.0.1"],
		["192.168.1.10", "192.168.1.10"],
	])("host=%j → 轮询 %j", (host, expected) => {
		expect(healthHostOf(host)).toBe(expected);
	});
});
