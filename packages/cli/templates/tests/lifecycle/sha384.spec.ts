// BDD：纯 JS SHA-384（B-11 真机补面）。oj isolate 无 sha384 原语而契约 C2-28 钉死
// `sha384-<base64>`——安装器（isolate 内）必须与 ojm build（Node 侧）同算法重算比对。
// 向量真源 = FIPS 180-4 官方样例 + node:crypto 交叉验证（长度跨 0/128 字节块边界）。
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bytesToBase64, sha384B64, sha384Bytes } from "../../src/_platform/api/_lifecycle/sha384";

const hex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

describe("sha384Bytes（FIPS 180-4 向量）", () => {
	it("空串", () => {
		expect(hex(sha384Bytes(new Uint8Array(0)))).toBe("38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b");
	});

	it("\"abc\"（官方样例）", () => {
		expect(hex(sha384Bytes(new TextEncoder().encode("abc")))).toBe("cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7");
	});

	it("双块以上长输入（1129 字节伪随机）与 node:crypto 逐字一致", () => {
		const data = new Uint8Array(1129);
		for (let i = 0; i < data.length; i++) {
			data[i] = (i * 131 + 7) & 0xFF;
		}
		const expected = createHash("sha384").update(data).digest("hex");
		expect(hex(sha384Bytes(data))).toBe(expected);
	});

	it("块边界邻域（127/128/129/255/256 字节）与 node:crypto 交叉一致", () => {
		for (const len of [1, 63, 64, 111, 112, 113, 127, 128, 129, 255, 256, 257]) {
			const data = new Uint8Array(len).fill(0xA5);
			expect(hex(sha384Bytes(data)), `len=${len}`).toBe(createHash("sha384").update(data).digest("hex"));
		}
	});
});

describe("sha384B64（C2-28 integrity 形态）", () => {
	it("与 node:crypto 的 base64 摘要拼接一致：sha384-<b64>", () => {
		const data = new TextEncoder().encode("demo-solution entry.js");
		const expected = `sha384-${createHash("sha384").update(data).digest("base64")}`;
		expect(sha384B64(data)).toBe(expected);
		expect(sha384B64(data)).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
	});

	it("bytesToBase64 与 Buffer base64 一致", () => {
		expect(bytesToBase64(new Uint8Array([0, 1, 2, 250, 251]))).toBe(Buffer.from([0, 1, 2, 250, 251]).toString("base64"));
	});
});
