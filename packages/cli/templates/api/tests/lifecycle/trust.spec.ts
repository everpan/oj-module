// BDD：宿主信任库（P2-2，契约 v1.3 §2.11 C2-38/39，G3 双轨第一轨 / G5）+ 市场运维端点（superadmin，R9）。
// store 层：空库/幂等/首次绑定不可改/多 key/吊销/损坏 fail-closed/.bak 回落/并发读不见半截/审计。
// 端点层：GET /market/trust、POST /market/trust/key、DELETE /market/trust/key?key_id=（del 动词 + query，system/roles 同款先例）。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（market-api.spec 同约定） */
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import type { MarketEnv } from "../../src/_platform/market/api";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrustStore, isValidKeyId } from "../../src/_platform/_lifecycle/trust";
import { invalidateAllUsers } from "../../src/_platform/_shared/service/access";
import { createMarketApi } from "../../src/_platform/market/api";
import { installDb } from "../fixture";

const g = globalThis as any;

const PUB_A = "a".repeat(64);
const PUB_B = "b".repeat(64);

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

/** sha256Hex 指纹面（契约 §2.11；真机由 oj crypto 增补面提供，测试经 opts.fingerprintOf 注入同值实现） */
function fingerprintOf(publicKeyHex: string): string {
	return createHash("sha256").update(Buffer.from(publicKeyHex, "hex")).digest("hex");
}

let root: string;
let trustPath: string;
let auditLog: { action: string, target: string, detail: unknown, level?: number }[];

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-trust-"));
	trustPath = join(root, ".solutions", "trusted-keys.yaml");
	g.fs = nodeFsFace();
	auditLog = [];
});

afterEach(async () => {
	g.fs = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

function store(): ReturnType<typeof createTrustStore> {
	return createTrustStore(trustPath, { audit: e => auditLog.push({ action: e.action, target: e.target, detail: e.detail, level: e.level }), fingerprintOf });
}

describe("信任库 store（C2-38/39）", () => {
	it("空库：list 空数组 / get null，不报错", async () => {
		const s = store();
		expect(await s.list()).toEqual([]);
		expect(await s.get("ojm.test")).toBeNull();
	});

	it("add → get/list 命中；落盘为受限 YAML 子集", async () => {
		const s = store();
		expect(await s.add("ojm.test", PUB_A, { operator: "admin" })).toBe("added");
		expect(await s.get("ojm.test")).toBe(PUB_A);
		expect(await s.list()).toEqual([{ key_id: "ojm.test", public_key: PUB_A, added_at: expect.any(Number) }]);
		const text = await fsp.readFile(trustPath, "utf8");
		expect(text).toMatch(/^trusted_keys:\n {2}ojm\.test:\n {4}public_key: "a{64}"\n {4}added_at: \d+\n$/);
	});

	it("同 key 同公钥幂等：exists_same，盘上内容不变", async () => {
		const s = store();
		await s.add("ojm.test", PUB_A);
		const before = await fsp.readFile(trustPath, "utf8");
		expect(await s.add("ojm.test", PUB_A)).toBe("exists_same");
		expect(await fsp.readFile(trustPath, "utf8")).toBe(before);
	});

	it("首次绑定不可改：同 key_id 异公钥 = 409 trust_bound_mismatch（含双方指纹），库内原值不动", async () => {
		const s = store();
		await s.add("ojm.test", PUB_A);
		await expect(s.add("ojm.test", PUB_B)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("首次绑定不可改") });
		await expect(s.add("ojm.test", PUB_B)).rejects.toThrow(/库内指纹 [0-9a-f]{64} ≠ 新钥指纹 [0-9a-f]{64}/);
		expect(await s.get("ojm.test")).toBe(PUB_A);
	});

	it("多 key 共存（轮换过渡期）：两个 key_id 均在列", async () => {
		const s = store();
		await s.add("ojm.old", PUB_A);
		await s.add("ojm.new", PUB_B);
		const rows = await s.list();
		expect(rows.map(r => r.key_id)).toEqual(["ojm.new", "ojm.old"]); // 字典序
	});

	it("吊销：remove → get null；再 remove → false；审计留痕", async () => {
		const s = store();
		await s.add("ojm.test", PUB_A, { operator: "admin" });
		expect(await s.remove("ojm.test", { operator: "admin" })).toBe(true);
		expect(await s.get("ojm.test")).toBeNull();
		expect(await s.remove("ojm.test")).toBe(false);
		expect(auditLog.map(e => e.action)).toEqual(["solution.trust.add", "solution.trust.revoke"]);
		expect(auditLog[0]).toMatchObject({ target: "ojm.test", detail: { key_id: "ojm.test", operator: "admin", fingerprint: fingerprintOf(PUB_A) } });
	});

	it("审计 operator 不可得 → 记 unknown 且告警级 level=4（不静默 null，P2-5）", async () => {
		const s = store();
		await s.add("ojm.test", PUB_A); // 无 operator
		expect(auditLog[0]?.level).toBe(4);
		expect(auditLog[0]?.detail).toMatchObject({ operator: "unknown" });
		await s.remove("ojm.test"); // 无 operator
		expect(auditLog[1]?.level).toBe(4);
		expect(auditLog[1]?.detail).toMatchObject({ operator: "unknown" });
	});

	it("审计 operator 可得 → 记真值且 info 级 level=6", async () => {
		const s = store();
		await s.add("ojm.test", PUB_A, { operator: "admin" });
		expect(auditLog[0]?.level).toBe(6);
		expect(auditLog[0]?.detail).toMatchObject({ operator: "admin" });
	});

	it("key_id 命名空间违规拒（C2-37）：单段裸名 / 大写 / 空段", async () => {
		const s = store();
		await expect(s.add("test", PUB_A)).rejects.toMatchObject({ status: 400 });
		await expect(s.add("Default.x", PUB_A)).rejects.toMatchObject({ status: 400 });
		await expect(s.add("a..b", PUB_A)).rejects.toMatchObject({ status: 400 });
		expect(isValidKeyId("ojm.test")).toBe(true);
		expect(isValidKeyId("pub.team.key-2")).toBe(true);
		expect(isValidKeyId("test")).toBe(false);
	});

	it("public_key 非 64hex 拒（400）", async () => {
		const s = store();
		await expect(s.add("ojm.test", "abc")).rejects.toMatchObject({ status: 400 });
		await expect(s.add("ojm.test", "A".repeat(64))).rejects.toMatchObject({ status: 400 });
	});

	it("损坏 fail-closed：主与 .bak 皆不可解析 → 500 可读报错（含路径与修法）", async () => {
		await fsp.mkdir(join(root, ".solutions"), { recursive: true });
		await fsp.writeFile(trustPath, "trusted_keys: [1, 2, 3]\n");
		const s = store();
		await expect(s.list()).rejects.toMatchObject({ status: 500, message: expect.stringContaining(trustPath) });
	});

	it(".bak 回落：主损坏 + .bak 完好 → 自动回落并留 note；下次写入自愈", async () => {
		const s0 = store();
		await s0.add("ojm.test", PUB_A);
		await s0.add("ojm.other", PUB_B); // 第二次写后 .bak = 只含 ojm.test 的前一版
		const bak = await fsp.readFile(`${trustPath}.bak`, "utf8");
		expect(bak).toContain("ojm.test");
		expect(bak).not.toContain("ojm.other");

		await fsp.writeFile(trustPath, "garbage: {{\n");
		const s1 = store();
		const rows = await s1.list();
		expect(rows.map(r => r.key_id)).toEqual(["ojm.test"]); // 回落 .bak
		expect(s1.corruptNote?.()).toContain("已自动回落");

		await s1.add("ojm.third", PUB_A); // 写入自愈：主文件重建、note 清零、.bak 不被垃圾覆盖
		const healed = await fsp.readFile(trustPath, "utf8");
		expect(healed).toContain("ojm.test");
		expect(healed).toContain("ojm.third");
		expect(await fsp.readFile(`${trustPath}.bak`, "utf8")).toBe(bak);
		expect((store()).corruptNote?.()).toBeNull();
	});

	it("并发读不见半截：写与读交叉进行，读方永远得到完整旧版或完整新版", async () => {
		const s = store();
		// 单写者顺序写（trust 变更经端点/CLI 串行到达；跨进程并发锁属安装互斥面，R17/R31）
		const writer = (async () => {
			for (let i = 0; i < 20; i++)
				await s.add(`pub.k${i}`, i % 2 === 0 ? PUB_A : PUB_B);
		})();
		const sizes: number[] = [];
		for (let round = 0; round < 500; round++) {
			const rows = await s.list(); // 半截文件会在此抛错（严格解析）
			sizes.push(rows.length);
		}
		await writer;
		expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
		expect((await s.list()).length).toBe(20);
	});
});

describe("信任库运维端点（superadmin，R9）", () => {
	let sharedRoot: string;
	let last: { status: number, data?: unknown, msg?: string } | null;

	beforeEach(async () => {
		sharedRoot = join(root, "modules");
		const dbo = installDb(); // 注入 g.db（node:sqlite 内存库 + 真实迁移）
		dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
		g.yaml = { parse: async (t: string) => JSON.parse(t) };
		g.http = { user: { id: 1 }, query: {}, body: {} };
		g.json = {
			ok: (data: unknown) => { last = { status: 200, data }; },
			fail: (status: number, msg: string) => { last = { status, msg }; },
		};
		last = null;
	});

	afterEach(async () => {
		g.db = undefined;
		g.http = undefined;
		g.json = undefined;
		g.yaml = undefined;
		invalidateAllUsers();
	});

	function makeEnv(): MarketEnv {
		return {
			sharedRoot,
			staging: join(sharedRoot, ".staging"),
			taskDir: join(sharedRoot, ".install-tasks"),
			statePath: join(sharedRoot, ".solutions", "state.yaml"),
			trustPath,
			dbPath: join(root, "db.sqlite"),
			siteModulesDir: join(root, "dist", "modules"),
			modulesJsonPath: join(root, "dist", "modules.json"),
			apiPrefix: "/api",
		};
	}

	it("未登录 / 非 superadmin 一律 403（拒权不泄露存在性，同 market 编排面口径）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = {}; // 无 user：currentAccess deny（403，不区分「未登录」与「无权」）
		await api.trust.get();
		expect(last).toMatchObject({ status: 403 });
		g.http = { user: { id: 2 } }; // 登录但非 superadmin
		await api.trust.get();
		expect(last).toMatchObject({ status: 403 });
	});

	it("GET trust：空库返回 {keys: [], note: null}", async () => {
		const api = createMarketApi(makeEnv());
		await api.trust.get();
		expect(last).toMatchObject({ status: 200, data: { keys: [], note: null } });
	});

	it("POST trust/key：缺参 400；坏 key_id 400；正常 added → 幂等 exists_same；撞绑定 409", async () => {
		const api = createMarketApi(makeEnv());
		g.http.body = {};
		await api.trust.key.post();
		expect(last).toMatchObject({ status: 400 });

		g.http.body = { key_id: "test", public_key: PUB_A };
		await api.trust.key.post();
		expect(last).toMatchObject({ status: 400 });

		g.http.body = { key_id: "ojm.test", public_key: PUB_A };
		await api.trust.key.post();
		expect(last).toMatchObject({ status: 200, data: { result: "added" } });
		await api.trust.key.post();
		expect(last).toMatchObject({ status: 200, data: { result: "exists_same" } });

		g.http.body = { key_id: "ojm.test", public_key: PUB_B };
		await api.trust.key.post();
		expect(last).toMatchObject({ status: 409 });
	});

	it("DELETE trust/key：吊销成功 / 无此 key 皆可断言；审计落 sys_oplog（operator=admin）", async () => {
		const api = createMarketApi(makeEnv());
		g.http.body = { key_id: "ojm.test", public_key: PUB_A };
		await api.trust.key.post();
		await new Promise(r => setTimeout(r, 20)); // auditOp fire-and-forget：等落库

		g.http.query = { key_id: "ojm.test" };
		await api.trust.key.del();
		expect(last).toMatchObject({ status: 200, data: { revoked: true } });

		await api.trust.key.del();
		expect(last).toMatchObject({ status: 200, data: { revoked: false } });

		g.http.query = {};
		await api.trust.key.del();
		expect(last).toMatchObject({ status: 400 });

		const rows = await (g.db.query as (sql: string, p?: unknown[]) => Promise<Array<Record<string, unknown>>>)("select action, target, detail from sys_oplog where action like 'solution.trust.%' order by id");
		expect(rows.map(r => r.action)).toEqual(["solution.trust.add", "solution.trust.revoke"]);
		expect(rows[0]).toMatchObject({ target: "ojm.test" });
		expect(JSON.parse(String(rows[0].detail))).toMatchObject({ key_id: "ojm.test", operator: "admin" });
	});
});
