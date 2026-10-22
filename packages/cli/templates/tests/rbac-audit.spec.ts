// BDD：审计出口——recordOp 落 sys_oplog 契约、auditOp fire-and-forget、403 分钟窗口聚合（AC1-29）。
// 夹具即真实库：断言 sys_oplog 行内容；fire-and-forget 用「DB 损坏也不抛出」验证。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { auditDeny, auditOp, recordOp, resetDenyAudit } from "../src/_platform/api/_shared/service/infra/audit";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	g.http = {};
	resetDenyAudit();
	dbo.exec("DELETE FROM sys_oplog");
});

function rows() {
	return dbo.prepare("SELECT * FROM sys_oplog ORDER BY id").all() as Record<string, unknown>[];
}

describe("recordOp：sys_oplog 落表契约", () => {
	it("写全字段：action/module/version/target/detail(level=6 默认)", async () => {
		g.http = { user: { id: 1 } }; // fixture admin（username='admin'）
		await recordOp({
			action: "role.create",
			module: "framework",
			version: "0.2.0",
			target: "custom.ops",
			detail: { title: "运维" },
		});
		const [r] = rows();
		expect(r.action).toBe("role.create");
		expect(r.module).toBe("framework");
		expect(r.version).toBe("0.2.0");
		expect(r.target).toBe("custom.ops");
		expect(JSON.parse(String(r.detail))).toEqual({ title: "运维" });
		expect(Number(r.level)).toBe(6);
		expect(Number(r.user_id)).toBe(1);
		expect(r.username).toBe("admin");
		expect(Number(r.create_time)).toBeGreaterThan(0);
	});

	it("无用户（系统动作）→ username='system'、user_id=0", async () => {
		await recordOp({ action: "solution.uninstall", module: "framework" });
		const [r] = rows();
		expect(r.username).toBe("system");
		expect(Number(r.user_id)).toBe(0);
	});
});

describe("auditOp：fire-and-forget", () => {
	it("正常落表", async () => {
		g.http = { user: { id: 1 } };
		auditOp({ action: "user.roles.update", module: "framework", target: "u2" });
		await vi.waitFor(() => expect(rows().length).toBe(1));
	});

	it("DB 失败也不抛出（不阻断业务主链）", async () => {
		g.http = { user: { id: 1 } };
		vi.spyOn(g.db, "exec").mockRejectedValueOnce(new Error("db down"));
		expect(() => auditOp({ action: "x.y", module: "framework" })).not.toThrow();
		await new Promise(r => setImmediate(r));
	});
});

describe("AC1-29：403 失败审计分钟窗口聚合（首条 + 计数，不逐条落表）", () => {
	it("同 (user, code) 连续拒绝 3 次 → 1 行，detail.count=3", async () => {
		g.http = { user: { id: 1 } };
		auditDeny("wiki.page.delete");
		auditDeny("wiki.page.delete");
		auditDeny("wiki.page.delete");
		await vi.waitFor(() => {
			const rs = rows();
			if (rs.length === 1 && JSON.parse(String(rs[0].detail)).count === 3)
				return;
			throw new Error("not yet");
		});
		expect(rows().length).toBe(1);
	});

	it("窗口过期（>60s）后首条另起一行", async () => {
		g.http = { user: { id: 1 } };
		auditDeny("wiki.page.delete");
		await vi.waitFor(() => expect(rows().length).toBe(1));
		vi.setSystemTime(Date.now() + 61_000);
		auditDeny("wiki.page.delete");
		await vi.waitFor(() => expect(rows().length).toBe(2));
	});

	it("不同 code / 不同用户各自独立聚合", async () => {
		g.http = { user: { id: 1 } };
		auditDeny("wiki.page.delete");
		auditDeny("wiki.page.edit");
		g.http = { user: { id: 2 } };
		auditDeny("wiki.page.delete");
		await vi.waitFor(() => expect(rows().length).toBe(3));
	});
});
