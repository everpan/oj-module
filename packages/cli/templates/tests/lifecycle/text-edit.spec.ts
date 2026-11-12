// BDD：config.yaml 文本锚点编辑（R18，P1-3）。安装器改写 config.yaml 的唯一手段。
// 约束：禁止 yaml 解析/stringify 回写——用户注释、缩进、空行、键序必须逐字保留。
// 锚点为整行注释（如 `# ojm:mount`）；插入位置=锚点行下一行，缩进继承锚点行；
// 锚点已存在=原样返回（幂等）；锚点缺失=可读错误（message 含锚点名）。
import * as fsp from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { appendAnonymousPaths, ensureMcpModule, ensureReloadApi, hasAnchor, insertAnchor, removeAnonymousPaths, removeMcpModule } from "../../src/app/api/_platform/_lifecycle/text-edit";

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

describe("模板 config.yaml 随发锚点（P1-16 接线②：ensureReloadApi 键缺失插入路径的闭环依据）", () => {
	it("模板 config.yaml 带整行 # ojm:reload 锚点；键在 → ensureReloadApi no-op", async () => {
		const cfg = await fsp.readFile(new URL("../../config.yaml", import.meta.url), "utf8");
		expect(hasAnchor(cfg, "# ojm:reload")).toBe(true);
		const r = ensureReloadApi(cfg);
		expect(r.changed).toBe(false);
	});

	it("用户删键保锚点 → ensureReloadApi 锚点下插回 reload_api: true（缩进继承）", async () => {
		const cfg = await fsp.readFile(new URL("../../config.yaml", import.meta.url), "utf8");
		const stripped = cfg.split("\n").filter(l => !/^\s*reload_api\s*:/.test(l)).join("\n");
		const r = ensureReloadApi(stripped);
		expect(r.changed).toBe(true);
		expect(r.content).toContain("reload_api: true");
		expect(r.content).toContain("# ojm:reload");
	});
});

describe("模板 config.yaml 随发 MCP 骨架（20261110-1027 T4：server.mcp 段 + 段内锚点）", () => {
	it("模板带整行 # ojm:mcp-modules 锚点，且锚点位于 server.mcp 段内（缩进域校验——防错层级静默忽略，F10）", async () => {
		const cfg = await fsp.readFile(new URL("../../config.yaml", import.meta.url), "utf8");
		expect(hasAnchor(cfg, "# ojm:mcp-modules")).toBe(true);
		const lines = cfg.split("\n");
		const anchorIdx = lines.findIndex(l => l.trim() === "# ojm:mcp-modules");
		// 段内判据：锚点上方最近的更浅缩进结构行是 `mcp:`（而非 server: 直子级）
		const anchorIndent = (/^\s*/.exec(lines[anchorIdx]!) ?? [""])[0]!.length;
		let parent = "";
		for (let i = anchorIdx - 1; i >= 0; i--) {
			const line = lines[i]!;
			if (line.trim() === "" || /^\s*#/.test(line))
				continue;
			const il = (/^\s*/.exec(line) ?? [""])[0]!.length;
			if (il < anchorIndent) {
				parent = line.trim();
				break;
			}
		}
		expect(parent.startsWith("mcp:")).toBe(true);
	});

	it("骨架显式 enabled: true 且 ensureMcpModule 首装登记可直接落锚点（enabled 缺省行为中性，F10）", async () => {
		const cfg = await fsp.readFile(new URL("../../config.yaml", import.meta.url), "utf8");
		expect(cfg).toMatch(/^\s*mcp:\s*$/m);
		// 94323a463 起随站默认开启：企微机器人员工代理（/api/wecom-bot/mcp）要在进程内访问
		// {base}/mcp，关掉它等于机器人链路静默失效。骨架仍必须**显式**写这个键（不靠缺省）。
		expect(cfg).toMatch(/^\s*enabled:\s*true\s*$/m);
		const r = ensureMcpModule(cfg, "wiki");
		expect(r.changed).toBe(true);
		expect(r.content).toContain("modules:");
		expect(r.content).toContain("- wiki");
		// 登记 must not 破坏 platform.modules（模板既有键，config.yaml 116 行附近；
		// wecom-bot 自 94323a463 起随站内置——机器代理要平台内核的 bot 共享内核）
		expect(r.content).toContain("modules: [_platform, oj-market, wecom-bot]");
	});
});

describe("p2-15③ C2-26 anonymous 运行时接线（appendAnonymousPaths：config 独占模型文本手术）", () => {
	const BASE = "auth:\n  anonymous_paths:\n    - /auth/login\n    # 行内注释（模板 config 真形态）\n    - /system/login-methods\n";

	it("追加方案匿名端点：列表尾部插入、统一补前导 /、缩进继承", () => {
		const r = appendAnonymousPaths(BASE, ["demo-solution/ping", "demo-solution/health"]);
		expect(r.added).toEqual(["/demo-solution/ping", "/demo-solution/health"]);
		expect(r.content).toContain("    - /demo-solution/ping");
		expect(r.content).toContain("    - /demo-solution/health");
		// 注释逐字保留 + 既有项不动
		expect(r.content).toContain("# 行内注释（模板 config 真形态）");
		expect(r.content).toContain("- /auth/login");
		expect(r.content).toContain("- /system/login-methods");
	});

	it("幂等：已存在（trim 相等）不重复插入", () => {
		const once = appendAnonymousPaths(BASE, ["demo-solution/ping"]);
		const twice = appendAnonymousPaths(once.content, ["demo-solution/ping"]);
		expect(twice.added).toEqual([]);
		expect(twice.content).toBe(once.content);
		expect(once.content.match(/demo-solution\/ping/g)).toHaveLength(1);
	});

	it("键缺失 = 可读报错不猜位置（用户删键 = 显式退出匿名模型）", () => {
		expect(() => appendAnonymousPaths("server:\n  reload_api: true\n", ["x/y"])).toThrow(/anonymous_paths/);
	});

	// 2026-11-12 演练：强绑定（tenant.require_signed_claim）下 oj 判租户读的是
	// tenant.anonymous_paths；只补 auth 那份会让安装冒烟探活 /api/<name>/ping 恒 403，
	// 安装落 status=partial，walkthrough 8/13 级联失败。故两块同补 / 同摘。
	const DUAL = [
		"auth:",
		"  anonymous_paths:",
		"    - /auth/login",
		"tenant:",
		"  require_signed_claim: true",
		"  anonymous_paths:",
		"    - /system/login-methods",
		"",
	].join("\n");

	it("auth 与 tenant 两份 anonymous_paths 同步追加（强绑定冒烟探活）", () => {
		const r = appendAnonymousPaths(DUAL, ["demo-solution/ping"]);
		expect(r.added).toEqual(["/demo-solution/ping"]);
		const authBlock = r.content.split("tenant:")[0]!;
		const tenantBlock = r.content.split("tenant:")[1]!;
		expect(authBlock).toContain("- /demo-solution/ping");
		expect(tenantBlock).toContain("- /demo-solution/ping");
	});

	it("同步摘除：remove 后两份列表都不留残条目", () => {
		const added = appendAnonymousPaths(DUAL, ["demo-solution/ping"]);
		const r = removeAnonymousPaths(added.content, ["demo-solution/ping"]);
		expect(r.removed).toEqual(["/demo-solution/ping"]);
		expect(r.content).toBe(DUAL);
	});
});

describe("removeAnonymousPaths（P0 §3.5 补偿清单：appendAnonymousPaths 逆操作）", () => {
	const BASE = "auth:\n  anonymous_paths:\n    - /auth/login\n    # 行内注释保留\n    - /system/login-methods\n";

	it("追加后移除 = 还原到追加前形态（注释/缩进/既有项逐字保留）", () => {
		const added = appendAnonymousPaths(BASE, ["demo-solution/ping", "demo-solution/health"]);
		const r = removeAnonymousPaths(added.content, ["demo-solution/ping", "demo-solution/health"]);
		expect(r.removed).toEqual(["/demo-solution/ping", "/demo-solution/health"]);
		expect(r.content).toBe(BASE);
	});

	it("只移除指定项，其余匿名条目不动", () => {
		const added = appendAnonymousPaths(BASE, ["demo-solution/ping", "demo-solution/health"]);
		const r = removeAnonymousPaths(added.content, ["demo-solution/ping"]);
		expect(r.removed).toEqual(["/demo-solution/ping"]);
		expect(r.content).toContain("- /demo-solution/health");
		expect(r.content).toContain("- /auth/login");
		expect(r.content).toContain("- /system/login-methods");
	});

	it("幂等：未含的路径不在列表内 → removed=[] 且内容不变", () => {
		const added = appendAnonymousPaths(BASE, ["demo-solution/ping"]);
		const r = removeAnonymousPaths(added.content, ["other/not-present"]);
		expect(r.removed).toEqual([]);
		expect(r.content).toBe(added.content);
	});

	it("连续两次移除同一批路径，第二次为 no-op（防重复副作用）", () => {
		const added = appendAnonymousPaths(BASE, ["demo-solution/ping"]);
		const once = removeAnonymousPaths(added.content, ["demo-solution/ping"]);
		const twice = removeAnonymousPaths(once.content, ["demo-solution/ping"]);
		expect(twice.removed).toEqual([]);
		expect(twice.content).toBe(once.content);
	});

	it("键缺失 = 没东西可删，no-op（不报错）", () => {
		const r = removeAnonymousPaths("server:\n  reload_api: true\n", ["x/y"]);
		expect(r.removed).toEqual([]);
	});

	it("空路径列表 = no-op", () => {
		expect(removeAnonymousPaths(BASE, []).removed).toEqual([]);
	});
});

// MCP 白名单登记/摘除（20261110-1027 §4.2）：server.mcp.modules 锚点文本手术。
// 红线：`modules:` 键名全局不唯一（模板 config.yaml 另有 platform.modules）——
// 检测必须限定锚点缩进域；写入恒为块列表；flow 风格（用户手写）跳过不改写
// （flow 列表后接块级项是坏 YAML，oj 拒启）。
describe("ensureMcpModule（MCP 白名单登记：段内定界，防 platform.modules 误写）", () => {
	const BASE = [
		"server:",
		"  port: 8080",
		"  mcp:",
		"    enabled: false",
		"    # ojm:mcp-modules",
		"  reload_api: true",
		"platform:",
		"  modules: [_platform, oj-market]",
	].join("\n");

	it("首个方案安装（锚点下无 modules 键）→ 插块列表，platform.modules 不受影响", () => {
		const r = ensureMcpModule(BASE, "wiki");
		expect(r.changed).toBe(true);
		expect(r.skipped).toBeUndefined();
		expect(r.content).toBe([
			"server:",
			"  port: 8080",
			"  mcp:",
			"    enabled: false",
			"    # ojm:mcp-modules",
			"    modules:",
			"      - wiki",
			"  reload_api: true",
			"platform:",
			"  modules: [_platform, oj-market]",
		].join("\n"));
	});

	it("幂等：块列表 [wiki] 追加 order；同方案重复安装 no-op", () => {
		const once = ensureMcpModule(BASE, "wiki");
		const two = ensureMcpModule(once.content, "order");
		expect(two.changed).toBe(true);
		expect(two.content).toContain("      - wiki");
		expect(two.content).toContain("      - order");
		const again = ensureMcpModule(two.content, "order");
		expect(again.changed).toBe(false);
		expect(again.content).toBe(two.content);
	});

	it("flow 风格 modules: [wiki]（用户手写）→ 跳过不改写，skipped=flow", () => {
		const content = BASE.replace("# ojm:mcp-modules", "# ojm:mcp-modules\n    modules: [wiki]");
		const r = ensureMcpModule(content, "order");
		expect(r.changed).toBe(false);
		expect(r.skipped).toBe("flow");
		expect(r.content).toBe(content);
	});

	it("锚点后紧跟其他 mcp 键（allow_anonymous）→ modules 仍插在锚点下方", () => {
		const content = BASE.replace("# ojm:mcp-modules", "# ojm:mcp-modules\n    allow_anonymous: false");
		const r = ensureMcpModule(content, "wiki");
		expect(r.changed).toBe(true);
		expect(r.content.indexOf("modules:")).toBeGreaterThan(r.content.indexOf("# ojm:mcp-modules"));
		expect(r.content).toContain("    allow_anonymous: false");
	});

	it("列表中部有行内注释 → 追加在末项之后，注释逐字保留", () => {
		const withComment = BASE.replace(
			"# ojm:mcp-modules",
			"# ojm:mcp-modules\n    modules:\n      - wiki # 首个方案\n      - order",
		);
		const r = ensureMcpModule(withComment, "extra");
		expect(r.changed).toBe(true);
		expect(r.content).toContain("      - extra");
		expect(r.content).toContain("- wiki # 首个方案");
	});

	it("锚点缺失 → 可读报错（调用方先 hasAnchor 预判做跳过降级）", () => {
		expect(() => ensureMcpModule("server:\n  port: 1", "wiki")).toThrowError(/# ojm:mcp-modules/);
	});
});

describe("removeMcpModule（MCP 白名单摘除：空表连键摘、锚点保留）", () => {
	const SEEDED = [
		"server:",
		"  mcp:",
		"    enabled: false",
		"    # ojm:mcp-modules",
		"    modules:",
		"      - wiki",
		"      - order",
	].join("\n");

	it("摘除指定方案，其余项/缩进逐字保留", () => {
		const r = removeMcpModule(SEEDED, "wiki");
		expect(r.removed).toBe(true);
		expect(r.content).toContain("      - order");
		expect(r.content).not.toContain("- wiki");
	});

	it("摘至空 → modules 键行连摘（回缺省全暴露），锚点保留（后续安装仍可登记）", () => {
		const r = removeMcpModule(SEEDED, "wiki");
		const r2 = removeMcpModule(r.content, "order");
		expect(r2.removed).toBe(true);
		expect(r2.content).not.toContain("modules:");
		expect(r2.content).toContain("# ojm:mcp-modules");
	});

	it("幂等：摘除不在列表中的方案 → removed=false 内容不变", () => {
		const r = removeMcpModule(SEEDED, "not-there");
		expect(r.removed).toBe(false);
		expect(r.content).toBe(SEEDED);
	});

	it("键/锚点缺失 → no-op（从未登记，不报错）", () => {
		const r = removeMcpModule("server:\n  port: 1", "wiki");
		expect(r.removed).toBe(false);
	});

	it("flow 风格 → 跳过不改写，skipped=flow", () => {
		const content = "server:\n  mcp:\n    # ojm:mcp-modules\n    modules: [wiki, order]";
		const r = removeMcpModule(content, "wiki");
		expect(r.removed).toBe(false);
		expect(r.skipped).toBe("flow");
		expect(r.content).toBe(content);
	});

	it("round-trip：登记两案再全摘 = 还原到锚点下无键的基线", () => {
		const BASELINE = "server:\n  mcp:\n    # ojm:mcp-modules";
		const a = ensureMcpModule(BASELINE, "wiki");
		const b = ensureMcpModule(a.content, "order");
		const r1 = removeMcpModule(b.content, "wiki");
		const r2 = removeMcpModule(r1.content, "order");
		expect(r2.content).toBe(BASELINE);
	});
});
