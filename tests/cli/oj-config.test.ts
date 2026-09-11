import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readOjApiPrefix, readOjPort, readOjServerField } from "../../packages/cli/src/oj-config";

/**
 * 设计 §4：ojm 用正则从 api/config.yaml 读 server 段字段（不为 YAML 解析
 * 引依赖）。config 由 ojm init 生成，miss 即被手改——直接报错而非静默回落
 * （oj 代码默认 9778，静默回落只会与实际监听端口错位，审阅记录二）。
 */
describe("readOjPort", () => {
	it("读取 server.port（init 模板形态）", () => {
		const file = writeConfig("server:\n  host: \"127.0.0.1\"\n  port: 9778\n  base: \"/api\"\n");
		expect(readOjPort(file)).toBe(9778);
	});

	it("行内注释不误读；引号数字可读", () => {
		expect(readOjPort(writeConfig("server:\n  port: 9778 # keep\n"))).toBe(9778);
		expect(readOjPort(writeConfig("server:\n  port: \"9778\"\n"))).toBe(9778);
	});

	it("只认 server: 块内的 port，不吞其他段的同名键", () => {
		const file = writeConfig("blob:\n  port: 1111\nserver:\n  port: 9778\n");
		expect(readOjPort(file)).toBe(9778);
	});

	it("miss 直接报错（提示 server.port，不静默回落）", () => {
		const file = writeConfig("server:\n  host: \"127.0.0.1\"\n");
		expect(() => readOjPort(file)).toThrowError(/server\.port/);
	});
});

describe("readOjServerField", () => {
	it("读取 server.base 等其他字段", () => {
		const file = writeConfig("server:\n  base: \"/api\"\n  port: 9778\n");
		expect(readOjServerField(file, "base")).toBe("/api");
	});

	it("miss 返回 undefined", () => {
		const file = writeConfig("server:\n  port: 9778\n");
		expect(readOjServerField(file, "host")).toBeUndefined();
	});
});

describe("readOjApiPrefix", () => {
	it("优先读新键 api_prefix（devkit 手册 §10）", () => {
		const file = writeConfig("server:\n  api_prefix: /v1/api\n  base: /old\n");
		expect(readOjApiPrefix(file)).toBe("/v1/api");
	});

	it("旧工程回落兼容键 base", () => {
		const file = writeConfig("server:\n  base: \"/api\"\n  port: 9778\n");
		expect(readOjApiPrefix(file)).toBe("/api");
	});

	it("两键皆缺 → 默认 /api", () => {
		const file = writeConfig("server:\n  port: 9778\n");
		expect(readOjApiPrefix(file)).toBe("/api");
	});
});

function writeConfig(content: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-cfg-"));
	const file = path.join(dir, "config.yaml");
	fs.writeFileSync(file, content);
	return file;
}
