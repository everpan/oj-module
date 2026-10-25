import type { SolutionState, StateStore } from "../../src/_platform/api/_lifecycle/state";
import type { InstallContext } from "../../src/_platform/api/_lifecycle/steps/preflight";
// BDD：安装预检规则引擎（P1-5，R7/R8/R9/R24，十阶段状态机 stage 1）。
// 规则真源：docs/prd/solution/202610171254-lifecycle-manifest-contract.md（C2-01~33 安装列）；
// 期望真源：packages/cli/src/lifecycle/__tests__/fixtures/（fixture-valid 零违规、fixture-invalid 七码齐报）。
// 实现纪律（契约 §0/夹具 README）：收集全部违规后统一报出，不在首条违规停。
// 表驱动：每条规则一拒例 + 一过例；过例复用 fixture-valid 全字段合法清单，拒例仅做单点变异。
import { readFileSync } from "node:fs";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { preflight } from "../../src/_platform/api/_lifecycle/steps/preflight";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../src/lifecycle/__tests__/fixtures");
const VALID = parse(readFileSync(join(FIXTURES, "fixture-valid/manifest.yaml"), "utf8")) as any;

/** 宿主 versions.json 假数据（C2-09 真源键：@oj-module/runtime，shell/src/manifest.ts P7.6） */
const HOST_OK = { "@oj-module/runtime": "0.1.80" };

function stateStore(solutions: SolutionState["solutions"] = {}): StateStore {
	return { read: () => ({ solutions: { ...solutions } }), write: async () => {} };
}

function ctx(overrides: Partial<InstallContext> = {}): InstallContext {
	return {
		manifest: structuredClone(VALID),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		hostVersions: HOST_OK,
		hostApiVersion: "0.1.0", // C2-11 真源默认值（= market/api.ts API_VERSION；C2-11 describe 内按用例覆盖）
		...overrides,
	};
}

interface RuleCase {
	rule: string
	clause: string
	/** message 中除条款编号外必须出现的关键词（防「编号出现但语义报错」的假绿） */
	keyword: string
	mutate?: (m: any) => void
	/** 拒例专用站点状态（占用检测注入已装方案） */
	state?: SolutionState["solutions"]
}

const RULES: RuleCase[] = [
	{ rule: "name 白名单（大写拒绝）", clause: "C2-01", keyword: "name", mutate: (m) => { m.name = "Demo"; } },
	{ rule: "name 保留名（market，R9）", clause: "C2-01", keyword: "保留名", mutate: (m) => { m.name = "market"; } },
	{ rule: "name 保留名（oj，REG-CS7）", clause: "C2-01", keyword: "保留名", mutate: (m) => { m.name = "oj"; } },
	{ rule: "name 保留名（ojm，REG-CS7）", clause: "C2-01", keyword: "保留名", mutate: (m) => { m.name = "ojm"; } },
	{ rule: "name 保留名（registry，REG-CS7）", clause: "C2-01", keyword: "保留名", mutate: (m) => { m.name = "registry"; } },
	{ rule: "version 禁 +（oj 相容排除，附录 B-1）", clause: "C2-02", keyword: "version", mutate: (m) => { m.version = "1.0.0+build.5"; } },
	{
		rule: "方案名已被已装方案占用（拒装）",
		clause: "C2-13/14",
		keyword: "占用",
		state: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1730000000000 } },
	},
	{ rule: "api.prefix 保留段（system）", clause: "C2-13", keyword: "保留", mutate: (m) => { m.api.prefix = "/api/system"; } },
	{ rule: "web.route_prefix 保留段（system）", clause: "C2-14", keyword: "保留", mutate: (m) => { m.web.route_prefix = "/system"; } },
	{ rule: "peerRuntime 宿主 runtime 不满足", clause: "C2-09", keyword: "不满足", mutate: (m) => { m.peerRuntime = ">=9.9.9"; } },
	{ rule: "anonymous 越段（R8 段内收敛）", clause: "C2-26", keyword: "首段", mutate: (m) => { m.api.anonymous = ["system/health"]; } },
	{ rule: "anonymous _system 禁入（语法层拒绝）", clause: "C2-26", keyword: "语法", mutate: (m) => { m.api.anonymous = ["_system/health"]; } },
	{ rule: "anonymous 登录端点禁令（R8/S1）", clause: "C2-26", keyword: "登录", mutate: (m) => { m.api.anonymous = ["demo-solution/login"]; } },
	{ rule: "路由 category 三值（D4，personal 已废弃）", clause: "C2-17", keyword: "category", mutate: (m) => { m.routes[0].category = "personal"; } },
	{ rule: "路由 path 语法（参数段拒绝）", clause: "C2-17", keyword: "path", mutate: (m) => { m.routes[0].path = "/demo-solution/:id"; } },
	{ rule: "required_permission 悬空（C2-21）", clause: "C2-21", keyword: "required_permission", mutate: (m) => { m.routes[1].required_permission = "demo-solution.absent"; } },
	{ rule: "permission code 强制 <name>. 前缀", clause: "C2-15", keyword: "code", mutate: (m) => { m.permissions[0].code = "other.view"; } },
	{ rule: "role permissions 悬空引用", clause: "C2-16", keyword: "悬空", mutate: (m) => { m.roles[0].permissions = ["demo-solution.absent"]; } },
	{ rule: "设置组 label_key 必填", clause: "C2-22", keyword: "label_key", mutate: (m) => { delete m.settings.groups[0].label_key; } },
	{ rule: "设置键所有权 moduleOf(key)===name（R24）", clause: "C2-23", keyword: "所有权", mutate: (m) => { m.settings.groups[0].items[0].key = "framework.site_title"; } },
	{
		rule: "type=enum 缺 options",
		clause: "C2-24",
		keyword: "options",
		mutate: (m) => {
			m.settings.groups[0].items[0].type = "enum";
			delete m.settings.groups[0].items[0].options;
		},
	},
	{ rule: "health 须为本方案路由或其子路径", clause: "C2-33", keyword: "路由", mutate: (m) => { m.health = "/other-thing"; } },
	{ rule: "web.entry 版本段必须 === version", clause: "C2-27", keyword: "entry", mutate: (m) => { m.web.entry = "modules/demo-solution/9.9.9/entry.js"; } },
	{ rule: "api.module 存在时必须 === name", clause: "C2-12", keyword: "api.module", mutate: (m) => { m.api.module = "other-solution"; } },
];

describe("preflight 规则表（每规则一拒例 + 一过例）", () => {
	for (const c of RULES) {
		it(`拒例【${c.clause}】${c.rule}`, async () => {
			const m = structuredClone(VALID);
			c.mutate?.(m);
			const r = await preflight(ctx({ manifest: m, state: stateStore(c.state) }));
			expect(r.stage).toBe("preflight");
			expect(r.ok).toBe(false);
			expect(r.retryable).toBe(false);
			expect(r.message).toContain(c.clause);
			expect(r.message).toContain(c.keyword);
		});

		it(`过例【${c.clause}】${c.rule}`, async () => {
			const r = await preflight(ctx({ state: stateStore(c.state ? {} : c.state) }));
			expect(r.ok).toBe(true);
		});
	}
});

describe("rEG-CS7 保留名（安装期 reserved_name 终止态，红队 F5）", () => {
	it("name=oj/ojm/registry → 预检拒且 code=reserved_name，解压前即拒（stage 1 早于 download/extract）", async () => {
		for (const bad of ["oj", "ojm", "registry"]) {
			const m = structuredClone(VALID);
			m.name = bad;
			const r = await preflight(ctx({ manifest: m }));
			expect(r.ok).toBe(false);
			expect(r.code).toBe("reserved_name");
			expect(r.retryable).toBe(false);
			expect(r.message).toContain("为保留名");
		}
	});

	it("真实第一方方案名（oj-registry）安装预检不被误伤", async () => {
		const m = structuredClone(VALID);
		m.name = "oj-registry";
		const r = await preflight(ctx({ manifest: m }));
		expect(r.code === "reserved_name").toBe(false);
	});
});

describe("preflight · C2-09 peerRuntime 范围算子语义", () => {
	it("过例：^ 同主版本且 ≥（宿主 0.1.80 满足 ^0.1.0）", async () => {
		const m = structuredClone(VALID);
		m.peerRuntime = "^0.1.0";
		expect((await preflight(ctx({ manifest: m }))).ok).toBe(true);
	});

	it("拒例：^ 主版本相同但低于基线（宿主 0.1.80 不满足 ^0.2.0）", async () => {
		const m = structuredClone(VALID);
		m.peerRuntime = "^0.2.0";
		const r = await preflight(ctx({ manifest: m }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-09");
	});

	it("拒例：精确声明与宿主不符（=0.9.9）", async () => {
		const m = structuredClone(VALID);
		m.peerRuntime = "=0.9.9";
		const r = await preflight(ctx({ manifest: m }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-09");
	});

	it("拒例：暂不支持的范围算子（<，P1 语义集外）", async () => {
		const m = structuredClone(VALID);
		m.peerRuntime = "<0.9.0";
		const r = await preflight(ctx({ manifest: m }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-09");
		expect(r.message).toContain("暂不支持");
	});

	it("拒例：语法非法（非范围算子字符串）", async () => {
		const m = structuredClone(VALID);
		m.peerRuntime = "latest";
		const r = await preflight(ctx({ manifest: m }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-09");
		expect(r.message).toContain("语法");
	});

	it("拒例：宿主 versions.json 缺失 → 强制比对 fail-closed", async () => {
		const r = await preflight(ctx({ hostVersions: undefined }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-09");
	});

	it("过例：peerRuntime 缺省 → 不做比对（C2-09 可选字段）", async () => {
		const m = structuredClone(VALID);
		delete m.peerRuntime;
		expect((await preflight(ctx({ manifest: m, hostVersions: undefined }))).ok).toBe(true);
	});
});

describe("preflight · C2-11 peerPlatform 范围算子语义（^ 遵循 0.x 口径）", () => {
	const HOST = "0.1.80";
	it("过例：^ 同主版本且 ≥（宿主 0.1.80 满足 ^0.1.0）", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "^0.1.0";
		expect((await preflight(ctx({ manifest: m, hostApiVersion: HOST }))).ok).toBe(true);
	});

	it("拒例：^ 主版本相同但低于基线（宿主 0.1.80 不满足 ^0.2.0）", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "^0.2.0";
		const r = await preflight(ctx({ manifest: m, hostApiVersion: HOST }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-11");
	});

	it("拒例：0.x 口径——^0.1.0 不兼容 0.2.x（minor 不同即不兼容）", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "^0.1.0";
		const r = await preflight(ctx({ manifest: m, hostApiVersion: "0.2.3" }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-11");
	});

	// REG-R9 / 红队 F4：升 0.2.0 后声明 ^0.1.x 的存量包全部装不上。笼统回「不满足」会让人
	// 去改方案版本/代码，真正要改的只有那一行 range——所以文案必须是可执行的迁移指令。
	it("拒例（F4 升版反噬）：host 0.2.x + ^0.1.x → 给出「改成 >=0.1.0」的专属迁移提示", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "^0.1.0";
		const r = await preflight(ctx({ manifest: m, hostApiVersion: "0.2.0" }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-11");
		expect(r.message).toContain(">=0.1.0");
		// 要说清「不是本方案的问题」，否则发布方会去翻自己的代码
		expect(r.message).toContain("不是本方案的问题");
		expect(r.message).toContain("这一条要改的是声明，不是代码");
		// 基线带 prerelease 时提示里只出现核心段（别把 -rc.1 拼进建议的 range 里）
		m.peerPlatform = "^0.1.0-rc.1";
		const r2 = await preflight(ctx({ manifest: m, hostApiVersion: "0.2.0" }));
		expect(r2.message).toContain(">=0.1.0");
		expect(r2.message).not.toContain(">=0.1.0-rc.1");
	});

	it("拒例（不该给迁移提示）：host 0.1.x + ^0.2.0 是「包要求更高版本」，不是升版反噬", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "^0.2.0";
		const r = await preflight(ctx({ manifest: m, hostApiVersion: "0.1.80" }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("需升级宿主平台模块");
		expect(r.message).not.toContain("改成「>=0.2.0」");
	});

	it("过例：0.x 口径——^0.2.0 兼容 0.2.5（minor 相同，patch 更高）", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "^0.2.0";
		expect((await preflight(ctx({ manifest: m, hostApiVersion: "0.2.5" }))).ok).toBe(true);
	});

	it("过例：>= 跨 minor 满足（宿主 0.2.3 满足 >=0.1.0）", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = ">=0.1.0";
		expect((await preflight(ctx({ manifest: m, hostApiVersion: "0.2.3" }))).ok).toBe(true);
	});

	it("拒例：精确声明与宿主不符（=0.1.0 vs 宿主 0.1.80）", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "=0.1.0";
		const r = await preflight(ctx({ manifest: m, hostApiVersion: HOST }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-11");
	});

	it("拒例：暂不支持的范围算子（<，P1 语义集外）", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "<0.9.0";
		const r = await preflight(ctx({ manifest: m, hostApiVersion: HOST }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-11");
		expect(r.message).toContain("暂不支持");
	});

	it("拒例：语法非法（非范围算子字符串）", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "latest";
		const r = await preflight(ctx({ manifest: m, hostApiVersion: HOST }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-11");
		expect(r.message).toContain("语法");
	});

	it("拒例：宿主 API 版本未注入 → 强制比对 fail-closed", async () => {
		const m = structuredClone(VALID);
		m.peerPlatform = "^0.1.0";
		const r = await preflight(ctx({ manifest: m, hostApiVersion: undefined }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("C2-11");
	});

	it("过例：peerPlatform 缺省 → 不做比对（C2-11 可选字段）", async () => {
		const m = structuredClone(VALID);
		delete m.peerPlatform;
		expect((await preflight(ctx({ manifest: m, hostApiVersion: undefined }))).ok).toBe(true);
	});
});

describe("preflight · C2 夹具（双端唯一真源）", () => {
	it("fixture-valid：零违规通过", async () => {
		const r = await preflight(ctx({}));
		expect(r.ok).toBe(true);
		expect(r.stage).toBe("preflight");
		expect(r.message).toContain("预检通过");
	});

	it("fixture-invalid：七码齐报且全量列出（C2-01/02/16/17/22/23/26）", async () => {
		const m = parse(readFileSync(join(FIXTURES, "fixture-invalid/manifest.yaml"), "utf8"));
		const r = await preflight(ctx({ manifest: m, name: "Demo", version: "1.0.0+build.5" }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		// 七码同现于同一条 message = 「收集全部违规后统一报出」纪律的实现证据
		for (const code of ["C2-01", "C2-02", "C2-16", "C2-17", "C2-22", "C2-23", "C2-26"]) {
			expect(r.message).toContain(code);
		}
	});
});
