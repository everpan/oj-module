// BDD：config.yaml 文本锚点编辑（R18，P1-3）。安装器改写 config.yaml 的唯一手段。
// 约束：禁止 yaml 解析/stringify 回写——用户注释、缩进、空行、键序必须逐字保留。
// 锚点为整行注释（如 `# ojm:mount`）；插入位置=锚点行下一行，缩进继承锚点行；
// 锚点已存在=原样返回（幂等）；锚点缺失=可读错误（message 含锚点名）。
import { describe, expect, it } from "vitest";

import { hasAnchor, insertAnchor } from "../../src/_platform/_lifecycle/text-edit";

describe("insertAnchor（R18）", () => {
	it("带注释的 config.yaml 插入后注释/缩进/空行/键序逐字保留", () => {
		const content = [
			"# 用户全局注释，必须保留",
			"server:",
			"  port: 8080",
			"",
			"  # ojm:reload",
			"database:",
			"  host: localhost",
		].join("\n");
		const result = insertAnchor(content, "# ojm:reload", "reload_api: true");
		expect(result).toBe([
			"# 用户全局注释，必须保留",
			"server:",
			"  port: 8080",
			"",
			"  # ojm:reload",
			"  reload_api: true",
			"database:",
			"  host: localhost",
		].join("\n"));
	});

	it("锚点后已紧跟同内容块时原样返回（幂等）", () => {
		const content = "server:\n  # ojm:mount\n  mount: []";
		expect(insertAnchor(content, "# ojm:mount", "mount: []")).toBe(content);
	});

	it("连续两次调用同一锚点，第二次为 no-op", () => {
		const content = "server:\n  # ojm:mount";
		const once = insertAnchor(content, "# ojm:mount", "mount: []");
		const twice = insertAnchor(once, "# ojm:mount", "mount: []");
		expect(twice).toBe(once);
	});

	it("锚点注释行必须整行匹配：子串提及行不算锚点，插入定位到真实锚点行", () => {
		const content = "# 参考 ojm:mount 文档\nserver:\n  # ojm:mount";
		const result = insertAnchor(content, "# ojm:mount", "mount: []");
		expect(result).toBe("# 参考 ojm:mount 文档\nserver:\n  # ojm:mount\n  mount: []");
	});

	it("只有相似锚点行（前缀超集）而无真实锚点时报错", () => {
		expect(() => insertAnchor("# ojm:mounts\nserver: {}", "# ojm:mount", "mount: []"))
			.toThrowError(/# ojm:mount/);
	});

	it("content 无锚点时报错，message 含锚点名", () => {
		expect(() => insertAnchor("server:\n  port: 8080", "# ojm:mount", "mount: []"))
			.toThrowError(/# ojm:mount/);
	});

	it("锚点在末行且无尾随换行时正确换行插入", () => {
		const result = insertAnchor("# ojm:mount", "# ojm:mount", "mount: []");
		expect(result).toBe("# ojm:mount\nmount: []");
	});
});

describe("hasAnchor（R18）", () => {
	it("锚点行存在返回 true", () => {
		expect(hasAnchor("a: 1\n  # ojm:mount\nb: 2", "# ojm:mount")).toBe(true);
	});

	it("锚点仅作为子串出现返回 false", () => {
		expect(hasAnchor("# 参考 ojm:mount 文档", "# ojm:mount")).toBe(false);
		expect(hasAnchor("# ojm:mounts", "# ojm:mount")).toBe(false);
	});

	it("锚点不存在返回 false", () => {
		expect(hasAnchor("a: 1\nb: 2", "# ojm:mount")).toBe(false);
	});
});
