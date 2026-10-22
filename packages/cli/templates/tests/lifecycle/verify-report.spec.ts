// BDD：P2-8 深检报告结构 + 留存 N=10 + 可信性项（trust_state）+ i18n 降级项 + 设值不进报告。
// 纯模块单测（verify-report.ts）+ 端点编排（persist-on-POST / GET verify/last / 降级项 / secret 不泄漏）。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（verify-checks.spec 同约定） */
import type { FsFace } from "../../src/_platform/api/_lifecycle/atomic";
import type { VerifyReport } from "../../src/_platform/api/_lifecycle/verify-report";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getLastReport,
	persistReport,
	VERIFY_REPORTS_KEEP,
	verifyReportsDirOf,
} from "../../src/_platform/api/_lifecycle/verify-report";
import { createSolutionsApi, solutionsEnv } from "../../src/_platform/api/solutions/api";
import { installDb } from "../fixture";

const g = globalThis as any;

function nodeFsFace(): FsFace {
	return {
		writeFile: (path, data) => fsp.writeFile(path, data),
		readFile: path => fsp.readFile(path),
		mkdir: (path, opts) => fsp.mkdir(path, opts),
		remove: (path, opts) => fsp.rm(path, opts),
		rename: (oldPath, newPath) => fsp.rename(oldPath, newPath),
		copyFile: (src, dest) => fsp.copyFile(src, dest),
		readdir: path => fsp.readdir(path),
	};
}

// 每用例独立临时根；report 目录随用随建（atomicWriteText 会 mkdir）。
let root: string;
let reportsDir: string;
async function freshRoot(): Promise<void> {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-vr-"));
	reportsDir = join(root, "verify-reports");
}
async function cleanupRoot(): Promise<void> {
	await fsp.rm(root, { recursive: true, force: true });
}

// ============ verify-report 纯模块 ============
describe("verify-report 纯模块", () => {
	beforeEach(async () => {
		await freshRoot();
		g.fs = nodeFsFace();
	});
	afterEach(async () => {
		g.fs = undefined;
		await cleanupRoot();
	});

	describe("verifyReportsDirOf 目录推导", () => {
		it("默认随 statePath 同目录 verify-reports", () => {
			expect(verifyReportsDirOf({ statePath: "modules/.solutions/state.yaml" })).toBe("modules/.solutions/verify-reports");
		});
		it("显式 verifyReportsDir 优先", () => {
			expect(verifyReportsDirOf({ statePath: "x/state.yaml", verifyReportsDir: "/custom" })).toBe("/custom");
		});
	});

	describe("persist + getLast 往返", () => {
		const report: VerifyReport = { ok: true, checks: [], advise: [] };
		it("落盘后可取回", async () => {
			await persistReport(reportsDir, "demo", report, 1000);
			expect(await getLastReport(reportsDir, "demo")).toEqual(report);
		});
		it("目录缺失 → null（不炸）", async () => {
			expect(await getLastReport(join(root, "nope"), "demo")).toBeNull();
		});
	});

	describe("时间序保留 N=10（第 11 份挤掉第 1 份）", () => {
		const report: VerifyReport = { ok: true, checks: [], advise: [] };
		it("超 10 条删最旧，保留最新 10", async () => {
			for (let i = 1; i <= 11; i++) {
				await persistReport(reportsDir, "demo", report, i * 1000);
			}
			const files = (await fsp.readdir(reportsDir)).filter(n => /^\d+\.json$/.test(n)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
			expect(files.length).toBe(VERIFY_REPORTS_KEEP); // 10
			expect(files[0]).toBe("2000.json"); // 最早 1000 已被挤掉
			expect(files[files.length - 1]).toBe("11000.json"); // 最新仍在
			expect(files).not.toContain("1000.json");
			expect(await getLastReport(reportsDir, "demo")).toEqual(report);
		});
	});

	describe("getLast 按 name 取最新（多方案不串）", () => {
		it("同 name 取最大 createdAt，跨 name 不混淆", async () => {
			const a: VerifyReport = { ok: true, checks: [], advise: ["a"] };
			const b: VerifyReport = { ok: true, checks: [], advise: ["b"] };
			await persistReport(reportsDir, "demo", a, 1000);
			await persistReport(reportsDir, "other", b, 2000);
			await persistReport(reportsDir, "demo", a, 3000); // demo 第二份更新
			expect((await getLastReport(reportsDir, "demo"))?.advise).toEqual(["a"]);
			expect((await getLastReport(reportsDir, "other"))?.advise).toEqual(["b"]);
		});
	});

	describe("损坏文件容错", () => {
		const report: VerifyReport = { ok: true, checks: [], advise: [] };
		it("报告目录内损坏 JSON / 非报告名文件不炸 getLast", async () => {
			await persistReport(reportsDir, "demo", report, 1000);
			await fsp.writeFile(join(reportsDir, "9999.json"), "{not json");
			await fsp.writeFile(join(reportsDir, "notes.txt"), "x");
			expect(await getLastReport(reportsDir, "demo")).toEqual(report);
		});
	});
});

// ============ 端点编排 ============
let dbo: any;
let last: { status: number, msg?: string, data?: unknown } | null;

function okFetch() {
	return async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
}

function setHttp(over: Record<string, unknown> = {}) {
	g.http = { user: { id: 1 }, query: { name: "demo" }, headers: { host: "localhost:9778" }, ...over };
	g.json = {
		ok: (data: unknown) => { last = { status: 200, data }; },
		fail: (status: number, msg: string) => { last = { status, msg }; },
	};
}

function makeEnv() {
	// modulesJsonPath 同 verify-checks.spec：钉进临时目录（缺文件 → 跳过 web 项），
	// 不吃模板本机 `web/dist/modules.json`。
	return { ...solutionsEnv(), sharedRoot: root, statePath: join(root, "state.yaml"), modulesJsonPath: join(root, "modules.json"), verifyReportsDir: reportsDir };
}

async function insertRoute(perm: string | null) {
	dbo.prepare("INSERT INTO sys_solution_route (path, module, category, \"order\", title_key, required_permission, enabled, deprecated) VALUES (?,?,?,?,?,?,?,0)")
		.run("/api/demo", "demo", "main", 200, "demo:menu", perm, 1);
}

async function writeState(trustState?: string) {
	const tail = trustState === undefined ? "" : `\n    trust_state: ${trustState}`;
	await fsp.writeFile(join(root, "state.yaml"), `solutions:\n  demo:\n    version: \"0.1.0\"\n    enabled: true\n    installedAt: 0${tail}\n`);
}

async function endpointBefore() {
	await freshRoot();
	g.fs = nodeFsFace();
	dbo = installDb();
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
	g.yaml = { parse: async (t: string) => JSON.parse(t) };
	g.fetch = okFetch();
	last = null;
}
async function endpointAfter() {
	g.fs = undefined;
	g.http = undefined;
	g.json = undefined;
	g.yaml = undefined;
	g.fetch = undefined;
	g.db = undefined;
	await cleanupRoot();
}

describe("深检可信性项（trust_state）", () => {
	beforeEach(endpointBefore);
	afterEach(endpointAfter);

	it("trusted → 不打 trust 项，ok=true", async () => {
		await insertRoute(null);
		await writeState("trusted");
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as VerifyReport;
		expect(data.ok).toBe(true);
		expect(data.checks.find(c => c.id === "trust")).toBeUndefined();
	});
	it("untrusted → trust error 项（key 已吊销仍在跑，补位）", async () => {
		await insertRoute(null);
		await writeState("untrusted");
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as VerifyReport;
		expect(data.ok).toBe(false);
		expect(data.checks.find(c => c.id === "trust" && c.severity === "error")).toBeDefined();
	});
	it("absent（未写，P1 遗留）→ trust info 项，非阻断", async () => {
		await insertRoute(null);
		await writeState(undefined);
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as VerifyReport;
		expect(data.ok).toBe(true);
		expect(data.checks.find(c => c.id === "trust" && c.severity === "info")).toBeDefined();
	});
	it("absent（显式）→ trust info 项", async () => {
		await insertRoute(null);
		await writeState("absent");
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as VerifyReport;
		expect(data.checks.find(c => c.id === "trust" && c.severity === "info")).toBeDefined();
	});
});

describe("i18n 依赖项 + advise 待查清单", () => {
	beforeEach(endpointBefore);
	afterEach(endpointAfter);

	it("有检查项 → 出现 i18n info 项（非阻断）且 advise 含其 key", async () => {
		// 声明权限点 demo.p 但 sys_permission 为空 → rbac missing_perm error（触发 advise 清单）
		await insertRoute("demo.p");
		await writeState("trusted"); // 干净 trust，避免 error 干扰断言
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as VerifyReport;
		const i18n = data.checks.find(c => c.id === "i18n");
		expect(i18n).toBeDefined();
		expect(i18n?.severity).toBe("info");
		expect(data.advise).toContain("lifecycle.verify.rbac.missing_perm");
		expect(data.advise).toContain("lifecycle.verify.i18n.dependency");
		// advise 去重排序
		expect(data.advise).toEqual([...new Set(data.advise)].sort());
	});
	it("全绿无检查项 → 无 i18n 项、无 advise", async () => {
		await insertRoute(null);
		await writeState("trusted");
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as VerifyReport;
		expect(data.checks.find(c => c.id === "i18n")).toBeUndefined();
		expect(data.advise).toEqual([]);
	});
});

describe("报告落盘 + GET /api/_platform/solutions/verify/last", () => {
	beforeEach(endpointBefore);
	afterEach(endpointAfter);

	it("POST 后 verify-reports 落盘，GET last 取回同内容", async () => {
		await insertRoute(null);
		await writeState("trusted");
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		expect(last?.status).toBe(200);
		const files = (await fsp.readdir(reportsDir)).filter(n => /^\d+\.json$/.test(n));
		expect(files.length).toBe(1);
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.last.get();
		expect(last?.status).toBe(200);
		expect((last?.data as VerifyReport).ok).toBe(true);
	});
	it("GET last 无报告 → 404", async () => {
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.last.get();
		expect(last?.status).toBe(404);
	});
	it("GET last 未登录 → 401", async () => {
		setHttp({ user: undefined });
		await createSolutionsApi(makeEnv()).verify.last.get();
		expect(last?.status).toBe(401);
	});
});

describe("设值不进报告（含 secret 场景钉）", () => {
	beforeEach(endpointBefore);
	afterEach(endpointAfter);

	it("secret 设置值绝不出现在报告任何字段", async () => {
		await insertRoute(null);
		// trusted + 声明两个设置（其一 secret），sys_setting 只装了 api_url → secret_token 缺失项（只报 key）
		await writeState("trusted");
		await fsp.mkdir(join(root, "demo-0.1.0"), { recursive: true });
		await fsp.writeFile(join(root, "demo-0.1.0", "manifest.yaml"), JSON.stringify({
			settings: { groups: [{ group: "g", items: [
				{ key: "demo:secret_token", secret: true },
				{ key: "demo:api_url" },
			] }] },
		}));
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, default_value, label_key, options, secret, deprecated) VALUES (?,?,?,?,?,?,?,?,?,0)")
			.run("demo:api_url", "demo", "g", "string", "https://internal.example.com/token=supersecret", "", "demo:s.api_url", null, 0);
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as VerifyReport;
		// 缺失项确实存在，且只报 key
		expect(data.checks.find(c => c.id === "settings" && c.subject === "demo:secret_token")).toBeDefined();
		// 敏感值绝不进报告（含 secret 标记场景）
		const serialized = JSON.stringify(data);
		expect(serialized).not.toContain("supersecret");
		expect(serialized).not.toContain("https://internal.example.com");
		expect(serialized).not.toContain("token=supersecret");
	});
});
