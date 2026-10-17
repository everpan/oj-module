// BDD：config.yaml 文本锚点编辑（R18，P1-3）。安装器改写 config.yaml 的唯一手段。
// 约束：禁止 yaml 解析/stringify 回写——用户注释、缩进、空行、键序必须逐字保留。
// 锚点为整行注释（如 `# ojm:mount`）；插入位置=锚点行下一行，缩进继承锚点行；
// 锚点已存在=原样返回（幂等）；锚点缺失=可读错误（message 含锚点名）。
import { describe, expect, it } from "vitest";

import { bumpInstallSeq, ensureReloadApi, hasAnchor, insertAnchor } from "../../src/_platform/_lifecycle/text-edit";

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

describe("ensureReloadApi（P1-10，D3 一次性注入集收口：S1-1 定稿无需改 mounts）", () => {
	it("无 reload_api 键且锚点在 → 锚点下插入 reload_api: true（缩进继承、注释逐字保留），changed=true", () => {
		const content = "server:\n  port: 8080\n  # 用户注释保留\n  # ojm:reload\ndb:\n  default: x";
		const r = ensureReloadApi(content);
		expect(r.changed).toBe(true);
		expect(r.content).toBe("server:\n  port: 8080\n  # 用户注释保留\n  # ojm:reload\n  reload_api: true\ndb:\n  default: x");
	});

	it("reload_api: true 已在 → no-op（无锚点也不报错），changed=false", () => {
		const content = "server:\n  reload_api: true\n  port: 1";
		const r = ensureReloadApi(content);
		expect(r.changed).toBe(false);
		expect(r.content).toBe(content);
	});

	it("显式 reload_api: false → 拒绝（用户主动关闭，不偷偷翻转），message 可读", () => {
		expect(() => ensureReloadApi("server:\n  reload_api: false # 运维明确关闭"))
			.toThrowError(/reload_api/);
	});

	it("无键且锚点缺失 → 可读报错（不猜插入位置，锚点随模板发布，P1-16 接线）", () => {
		expect(() => ensureReloadApi("server:\n  port: 1")).toThrowError(/# ojm:reload/);
	});
});

describe("bumpInstallSeq（B-11 reload 触发面：vars 安装序号自增，PRD E5 实测 vars 改动可热生效）", () => {
	it("0 → 1 自增，其余行（注释/缩进/键序）逐字保留", () => {
		const content = "mounts: []\nvars:\n  ojm_install_seq: 0\n# 尾注释保留";
		const r = bumpInstallSeq(content);
		expect(r.seq).toBe(1);
		expect(r.content).toBe("mounts: []\nvars:\n  ojm_install_seq: 1\n# 尾注释保留");
	});

	it("多次调用累加（N → N+1），行内尾注释原样保留", () => {
		const content = "vars:\n  ojm_install_seq: 41 # 安装序号";
		const r1 = bumpInstallSeq(content);
		expect(r1.seq).toBe(42);
		expect(r1.content).toBe("vars:\n  ojm_install_seq: 42 # 安装序号");
		const r2 = bumpInstallSeq(r1.content);
		expect(r2.seq).toBe(43);
	});

	it("键缺失 → 可读报错（用户删行 = 显式退出热更触发，安装器不猜位置）", () => {
		expect(() => bumpInstallSeq("vars:\n  other: 1")).toThrowError(/ojm_install_seq/);
	});

	it("值非数字（行存在但形状不符）→ 视同缺失，可读报错不猜", () => {
		expect(() => bumpInstallSeq("vars:\n  ojm_install_seq: abc")).toThrowError(/ojm_install_seq/);
	});
});
