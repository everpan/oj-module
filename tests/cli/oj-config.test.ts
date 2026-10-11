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

	// 行级正则读不出流式的 server: { port: 9778 }——改真 YAML 解析后才成立
	it("流式写法 server: { port: 9778 } 也能读（真 YAML 解析）", () => {
		const file = writeConfig("server: { port: 9778, base: \"/api\" }\nblob:\n  port: 1\n");
		expect(readOjPort(file)).toBe(9778);
		expect(readOjApiPrefix(file)).toBe("/api");
	});

	it("yAML 非法 → 人话报错（不是 YAML 库原始堆栈）", () => {
		const file = writeConfig("server:\n  port: 9778\n bad indent: [\n");
		expect(() => readOjPort(file)).toThrowError(/config\.yaml.*解析失败|解析失败/);
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
	it("读 mounts 中首个含 api: 条目的 prefix（devkit 手册 §10 mounts 模型）", () => {
		const file = writeConfig("mounts:\n  - prefix: /v1/api\n    api: src\n");
		expect(readOjApiPrefix(file)).toBe("/v1/api");
	});

	it("mounts 无 api 条目 → 回落 /api", () => {
		const file = writeConfig("mounts:\n  - prefix: \"/\"\n    web: ../web/dist\n    spa: true\n");
		expect(readOjApiPrefix(file)).toBe("/api");
	});

	it("无 mounts → 默认 /api", () => {
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
