import type { InstallContext } from "../../../templates/api/src/_platform/_lifecycle/steps/preflight";

// BDD：bundle 级 manifest.yaml 契约校验（P1-11，C2 规则构建列）。
// 规则真源：docs/prd/solution/202610171254-lifecycle-manifest-contract.md（C2-01~33 构建列，§4.1 矩阵）；
// 期望真源：同目录 fixtures/（fixture-valid 零违规、fixture-invalid 七码齐报）。
// 实现纪律（契约 §0/夹具 README）：收集全部违规后统一报出，不在首条违规停。
// 双端一致：同一夹具既跑本侧 validateContract，也跑 isolate 侧 preflight——两份实现由夹具钉住。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
// 跨端引用（双端一致钉）：被测实现同仓分居两运行时（计划 §1「两运行时取舍」），
// 测试直接互调，比「两套件各读同一夹具」更强——漂移即本文件红。
import { preflight } from "../../../templates/api/src/_platform/_lifecycle/steps/preflight";
import { checkLocalesComplete, checkTablesAgainstSchema, parseManifest, validateContract } from "../../manifest-contract";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const readText = (p: string) => readFileSync(join(FIXTURES, p), "utf8");

const VALID = parse(readText("fixture-valid/manifest.yaml")) as Record<string, unknown>;
const INVALID = parse(readText("fixture-invalid/manifest.yaml")) as Record<string, unknown>;

/** fixture-invalid 期望违规码（夹具 README/EXPECTED-VIOLATIONS 逐字） */
const INVALID_CODES = ["C2-01", "C2-02", "C2-16", "C2-17", "C2-22", "C2-23", "C2-26"];

function clauseOf(violations: string[]): string[] {
	return violations.map(v => /【([^】]+)】/.exec(v)?.[1] ?? "");
}

// ── 双端一致：同一夹具，Node validateContract 与 isolate preflight 互认 ──

describe("双端一致（夹具 §5：DRY 于夹具而非运行时）", () => {
	it("fixture-valid：validateContract 零违规，preflight 也通过", async () => {
		expect(validateContract(VALID)).toEqual([]);
		const r = await preflight(makeCtx(structuredClone(VALID)));
		expect(r.ok).toBe(true);
	});

	it("fixture-invalid：两端均拒绝，且 validateContract 报出七码全集", async () => {
		const violations = validateContract(INVALID);
		expect(violations.length).toBeGreaterThan(0);
		expect(clauseOf(violations)).toEqual(expect.arrayContaining(INVALID_CODES));
		const r = await preflight(makeCtx(structuredClone(INVALID)));
		expect(r.ok).toBe(false);
		for (const code of INVALID_CODES)
			expect(r.message).toContain(code);
	});
});

// ── 表驱动：每规则一拒例（单点变异合法夹具）+ 共享过例 ──

interface RuleCase {
	rule: string
	clause: string
	/** 违规串中除编号外必须出现的关键词（防「编号出现但语义报错」的假绿） */
	keyword: string
	mutate: (m: any) => void
}

const RULES: RuleCase[] = [
	{ rule: "name 白名单（大写拒绝）", clause: "C2-01", keyword: "name", mutate: (m) => { m.name = "Demo"; } },
	{ rule: "name 保留名（market，R9）", clause: "C2-01", keyword: "保留名", mutate: (m) => { m.name = "market"; } },
	{ rule: "version 禁 +（oj 相容排除，附录 B-1）", clause: "C2-02", keyword: "version", mutate: (m) => { m.version = "1.0.0+build.5"; } },
	{ rule: "version 禁下划线（契约收紧）", clause: "C2-02", keyword: "version", mutate: (m) => { m.version = "1.0.0_beta"; } },
	{ rule: "title ≤100", clause: "C2-03", keyword: "title", mutate: (m) => { m.title = "x".repeat(101); } },
	{ rule: "summary 必填", clause: "C2-04", keyword: "summary", mutate: (m) => { delete m.summary; } },
	{ rule: "summary 必须单行", clause: "C2-04", keyword: "单行", mutate: (m) => { m.summary = "第一行\n第二行"; } },
	{ rule: "description ≤2000", clause: "C2-05", keyword: "description", mutate: (m) => { m.description = "x".repeat(2001); } },
	{ rule: "icon 语法（http(s)/ 绝对路径）", clause: "C2-06", keyword: "icon", mutate: (m) => { m.icon = "ftp://x/y.svg"; } },
	{ rule: "license SPDX 简化式", clause: "C2-07", keyword: "license", mutate: (m) => { m.license = "没有空格的中文许可证!"; } },
	{ rule: "homepage http(s)", clause: "C2-07", keyword: "homepage", mutate: (m) => { m.homepage = "example.com"; } },
	{ rule: "keywords 项语法", clause: "C2-07", keyword: "keywords", mutate: (m) => { m.keywords = ["合法", "ok2"]; } },
	{ rule: "keywords ≤10", clause: "C2-07", keyword: "keywords", mutate: (m) => { m.keywords = Array.from({ length: 11 }, (_, i) => `k${i}`); } },
	{ rule: "changelog 必填（R27）", clause: "C2-08", keyword: "changelog", mutate: (m) => { delete m.changelog; } },
	{ rule: "changelog 数组条目非空", clause: "C2-08", keyword: "changelog", mutate: (m) => { m.changelog = [""]; } },
	{ rule: "changelog ≤50 条", clause: "C2-08", keyword: "changelog", mutate: (m) => { m.changelog = Array.from({ length: 51 }, (_, i) => `v${i}`); } },
	{ rule: "peerRuntime 暂不支持算子（<= 构建期即拒）", clause: "C2-09", keyword: "范围算子", mutate: (m) => { m.peerRuntime = "<=0.1.0"; } },
	{ rule: "peerRuntime 语法（version 部分遵守 C2-02）", clause: "C2-09", keyword: "peerRuntime", mutate: (m) => { m.peerRuntime = ">=beta1"; } },
	{ rule: "peerOj 语法（P1 声明不强制，语法由构建期负责）", clause: "C2-10", keyword: "peerOj", mutate: (m) => { m.peerOj = "1.0.0+build"; } },
	{ rule: "peerFramework 语法", clause: "C2-10", keyword: "peerFramework", mutate: (m) => { m.peerFramework = ">=^0.2"; } },
	{ rule: "peerPlatform 语法", clause: "C2-11", keyword: "peerPlatform", mutate: (m) => { m.peerPlatform = "1.0.0_beta"; } },
	{ rule: "api.module 存在时必须 === name", clause: "C2-12", keyword: "api.module", mutate: (m) => { m.api.module = "other-solution"; } },
	{ rule: "api.prefix 语法", clause: "C2-13", keyword: "api.prefix", mutate: (m) => { m.api.prefix = "/api/Demo"; } },
	{ rule: "api.prefix 保留段（system）", clause: "C2-13", keyword: "保留名", mutate: (m) => { m.api.prefix = "/api/system"; } },
	{ rule: "api.tables 项语法", clause: "C2-12a", keyword: "api.tables", mutate: (m) => { m.api.tables = ["1Bad"]; } },
	{ rule: "api.deps 键语法", clause: "C2-12b", keyword: "api.deps", mutate: (m) => { m.api.deps = { Bad_Key: ">=0.1.0" }; } },
	{ rule: "api.deps 值暂不支持算子", clause: "C2-12b", keyword: "范围算子", mutate: (m) => { m.api.deps = { other: "<1.0.0" }; } },
	{ rule: "anonymous 越段（R8 段内收敛）", clause: "C2-26", keyword: "首段", mutate: (m) => { m.api.anonymous = ["system/health"]; } },
	{ rule: "anonymous 登录端点禁令（R8/S1）", clause: "C2-26", keyword: "登录", mutate: (m) => { m.api.anonymous = ["demo-solution/login"]; } },
	{ rule: "anonymous 语法（前导斜杠拒绝）", clause: "C2-26", keyword: "语法", mutate: (m) => { m.api.anonymous = ["/demo-solution/ping"]; } },
	{ rule: "web.route_prefix 保留段", clause: "C2-14", keyword: "保留名", mutate: (m) => { m.web.route_prefix = "/system"; } },
	{ rule: "web.entry 版本段必须 === version", clause: "C2-27", keyword: "web.entry", mutate: (m) => { m.web.entry = "modules/demo-solution/9.9.9/entry.js"; } },
	{ rule: "web.css 后缀与版本段", clause: "C2-27", keyword: "web.css", mutate: (m) => { m.web.css = ["modules/demo-solution/9.9.9/x.css"]; } },
	{ rule: "web.integrity 形态（sha384-64base64）", clause: "C2-28", keyword: "web.integrity", mutate: (m) => { m.web.integrity = "md5-AAAA"; } },
	{ rule: "permission code 强制 <name>. 前缀", clause: "C2-15", keyword: "code", mutate: (m) => { m.permissions[0].code = "other.view"; } },
	{ rule: "permission title_key 命名空间", clause: "C2-15", keyword: "title_key", mutate: (m) => { m.permissions[0].title_key = "other:perm.view"; } },
	{ rule: "role name <name>.<role>", clause: "C2-16", keyword: "role", mutate: (m) => { m.roles[0].name = "demo-solution.Admin"; } },
	{ rule: "role permissions 悬空引用", clause: "C2-16", keyword: "悬空", mutate: (m) => { m.roles[0].permissions = ["demo-solution.absent"]; } },
	{ rule: "路由 category 三值（D4，personal 已废弃）", clause: "C2-17", keyword: "category", mutate: (m) => { m.routes[0].category = "personal"; } },
	{ rule: "路由 path 语法（参数段拒绝）", clause: "C2-17", keyword: "path", mutate: (m) => { m.routes[0].path = "/demo-solution/:id"; } },
	{ rule: "路由 order 必填整数", clause: "C2-17", keyword: "order", mutate: (m) => { delete m.routes[0].order; } },
	{ rule: "required_permission 悬空（C2-21）", clause: "C2-21", keyword: "required_permission", mutate: (m) => { m.routes[1].required_permission = "demo-solution.absent"; } },
	{ rule: "设置组标识语法", clause: "C2-22", keyword: "设置组", mutate: (m) => { m.settings.groups[0].group = "Display"; } },
	{ rule: "设置组 label_key 必填", clause: "C2-22", keyword: "label_key", mutate: (m) => { delete m.settings.groups[0].label_key; } },
	{ rule: "设置组 items 非空", clause: "C2-22", keyword: "items", mutate: (m) => { m.settings.groups[0].items = []; } },
	{ rule: "设置键所有权 moduleOf(key)===name（R24）", clause: "C2-23", keyword: "所有权", mutate: (m) => { m.settings.groups[0].items[0].key = "framework.site_title"; } },
	{ rule: "设置项 type 枚举", clause: "C2-24", keyword: "type", mutate: (m) => { m.settings.groups[0].items[0].type = "varchar"; } },
	{ rule: "type=enum 缺 options", clause: "C2-24", keyword: "options", mutate: (m) => {
		m.settings.groups[0].items[0].type = "enum";
		delete m.settings.groups[0].items[0].options;
	} },
	{ rule: "设置项 default 必须字符串", clause: "C2-24", keyword: "default", mutate: (m) => { m.settings.groups[0].items[0].default = 20; } },
	{ rule: "设置项 label_key 命名空间", clause: "C2-24", keyword: "label_key", mutate: (m) => { m.settings.groups[0].items[0].label_key = "framework:settings.x"; } },
	{ rule: "health 须为本方案路由或其子路径", clause: "C2-33", keyword: "路由", mutate: (m) => { m.health = "/other-thing"; } },
	{ rule: "archive Form A 禁 sha256（自引用悖论，附录 B-2）", clause: "C2-29", keyword: "sha256", mutate: (m) => { m.archive.sha256 = "a".repeat(64); } },
	{ rule: "archive Form A 禁 signature", clause: "C2-29", keyword: "signature", mutate: (m) => { m.archive.signature = { alg: "Ed25519" }; } },
	{ rule: "archive.file 命名", clause: "C2-29", keyword: "archive.file", mutate: (m) => { m.archive.file = "wrong.tgz"; } },
	{ rule: "顶层未知键拒绝（防拼写漂移静默失效）", clause: "§1", keyword: "未知", mutate: (m) => { m.visibility = "public"; } },
];

describe("validateContract 规则表（每规则一拒例）", () => {
	it("共享过例：未变异的 fixture-valid 零违规", () => {
		expect(validateContract(VALID)).toEqual([]);
	});

	it("非对象 manifest：统一报出单条可读违规", () => {
		for (const bad of [null, "x", 42, []]) {
			const v = validateContract(bad);
			expect(v.length).toBeGreaterThan(0);
			expect(v[0]).toContain("manifest");
		}
	});

	for (const c of RULES) {
		it(`拒例【${c.clause}】${c.rule}`, () => {
			const m = structuredClone(VALID);
			c.mutate(m);
			const violations = validateContract(m);
			const hit = violations.find(v => v.includes(c.clause));
			expect(hit, `期望包含【${c.clause}】的违规，实际：\n${violations.join("\n")}`).toBeTruthy();
			expect(hit).toContain(c.keyword);
		});
	}
});

// ── parseManifest ──

describe("parseManifest", () => {
	it("合法 yaml → ok:true 且返回对象", () => {
		const r = parseManifest(readText("fixture-valid/manifest.yaml"));
		expect(r.ok).toBe(true);
		if (r.ok)
			expect(r.manifest.name).toBe("demo-solution");
	});

	it("非法 yaml 语法 → ok:false 可读错误（不含堆栈噪音）", () => {
		const r = parseManifest("name: [unclosed");
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.error).toContain("manifest.yaml");
	});

	it("顶层非映射（数组/标量）→ ok:false", () => {
		for (const bad of ["- a\n- b\n", "42\n", "null\n"]) {
			const r = parseManifest(bad);
			expect(r.ok).toBe(false);
		}
	});
});

// ── 文件面契约（构建期专属执行点；纯内容入参，fs 在 bundle.ts）──

describe("checkTablesAgainstSchema（C2-12a：构建 ✅ 对照 schema.yaml）", () => {
	const SCHEMA = readText("fixture-valid/api/src/demo-solution/schema.yaml");

	it("fixture-valid tables [note] 与 schema.yaml 表集一致 → 零违规", () => {
		expect(checkTablesAgainstSchema(structuredClone(VALID), SCHEMA)).toEqual([]);
	});

	it("tables 与 schema.yaml 表集不一致 → C2-12a 且指明差额", () => {
		const m = structuredClone(VALID);
		(m.api as any).tables = ["note", "ghost"];
		const v = checkTablesAgainstSchema(m, SCHEMA);
		expect(v[0]).toContain("C2-12a");
		expect(v[0]).toContain("ghost");
	});
});

describe("checkLocalesComplete（C2-25：构建期缺 key fail-fast）", () => {
	const ZH = readText("fixture-valid/web/src/demo-solution/locales/zh-CN.json");
	const EN = readText("fixture-valid/web/src/demo-solution/locales/en-US.json");

	it("fixture-valid 双语齐备 → 零违规", () => {
		expect(checkLocalesComplete(structuredClone(VALID), ZH, EN)).toEqual([]);
	});

	it("zh-CN 缺引用 key → C2-25 且指明 key 与语言", () => {
		const zh = JSON.parse(ZH) as any;
		delete zh.settings.group.display;
		const v = checkLocalesComplete(structuredClone(VALID), JSON.stringify(zh), EN);
		expect(v[0]).toContain("C2-25");
		expect(v[0]).toContain("zh-CN");
		expect(v[0]).toContain("demo-solution:settings.group.display");
	});

	it("en-US 缺引用 key → C2-25 指明 en-US", () => {
		const en = JSON.parse(EN) as any;
		delete en.perm.view;
		const v = checkLocalesComplete(structuredClone(VALID), ZH, JSON.stringify(en));
		expect(v[0]).toContain("C2-25");
		expect(v[0]).toContain("en-US");
	});
});

// ── isolate 侧 preflight 复用助手（与 templates/api/tests/lifecycle/preflight.spec.ts 同构）──

function makeCtx(manifest: unknown): InstallContext {
	return {
		manifest,
		name: typeof (manifest as any)?.name === "string" ? (manifest as any).name : "demo-solution",
		version: typeof (manifest as any)?.version === "string" ? (manifest as any).version : "0.1.0",
		state: { read: () => ({ solutions: {} }), write: async () => {} },
		hostVersions: { "@oj-module/runtime": "0.1.80" },
	};
}
