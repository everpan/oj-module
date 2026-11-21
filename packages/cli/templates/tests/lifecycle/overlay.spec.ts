// BDD：sys_module_overlay 表语义（实施计划 Phase 2 / P2-T1~T3）。
// 单模块单启用版本（部分唯一索引硬约束）/ 原子换版 / 三路 backfill。
// db 用 globalThis 内存桩（同 installer.spec 范式），桩内模拟 ux_overlay_one_enabled
// 部分唯一索引：enabled=1 的行同 name 至多一行，违反即抛（与 sqlite/pg DDL 同语义）。
import type { OverlayRow } from "../../src/app/api/_platform/_lifecycle/overlay";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backfillOverlay, readOverlayRows, setOverlayEnabled, swapEnabledVersion, upsertOverlayRow } from "../../src/app/api/_platform/_lifecycle/overlay";

const g = globalThis as any;

/** 内存 db 桩：rows 为唯一真相，模拟 update/insert/select 链式面 + 部分唯一索引 */
function memDb(initial: OverlayRow[] = []) {
	const rows: OverlayRow[] = initial.map((r, i) => ({ ...r, id: r.id ?? i + 1 }));
	const match = (w: { field: string, op: string, value: unknown }) => (r: any) => r[w.field] === w.value;
	g.db = {
		table: () => ({
			insert: (obj: Record<string, unknown>) => ({
				run: async () => {
					// 模拟 ux_overlay_name_version + ux_overlay_one_enabled
					if (rows.some(r => r.name === obj.name && r.version === obj.version))
						throw new Error("UNIQUE constraint failed: ux_overlay_name_version");
					if (obj.enabled === 1 && rows.some(r => r.name === obj.name && Number(r.enabled) === 1))
						throw new Error("UNIQUE constraint failed: ux_overlay_one_enabled");
					rows.push({ ...obj, id: rows.length + 1 } as OverlayRow);
				},
			}),
			update: (obj: Record<string, unknown>) => ({
				where: (w: { field: string, op: string, value: unknown }) => ({
					run: async () => {
						const hit = rows.find(match(w));
						if (!hit)
							return;
						const next = { ...hit, ...obj };
						if (Number(next.enabled) === 1 && rows.some(r => r.id !== hit.id && r.name === hit.name && Number(r.enabled) === 1))
							throw new Error("UNIQUE constraint failed: ux_overlay_one_enabled");
						Object.assign(hit, obj);
					},
				}),
			}),
			select: (fields: string[]) => ({
				all: async () => rows.map(r => Object.fromEntries(fields.map(f => [f, (r as any)[f]]))),
				where: (w: { field: string, op: string, value: unknown }) => ({
					all: async () => rows.filter(match(w)).map(r => Object.fromEntries(fields.map(f => [f, (r as any)[f]]))),
				}),
			}),
		}),
		__rows: rows,
	};
}

beforeEach(() => {
	memDb();
});

afterEach(() => {
	g.db = undefined;
});

function row(name: string, version: string, enabled: number, extra: Partial<OverlayRow> = {}): Omit<OverlayRow, "id" | "seq" | "changed_at"> {
	return { name, version, enabled, source: "solution", face_ref: null, actor: "tester", old_state: null, ...extra };
}

describe("单模块单启用版本（部分唯一索引硬约束）", () => {
	it("启用第二版本必被拒（DB 层，不靠应用层自觉）", async () => {
		await upsertOverlayRow(row("wiki", "0.1.3", 1));
		await expect(upsertOverlayRow(row("wiki", "0.2.0", 1))).rejects.toThrow("ux_overlay_one_enabled");
	});

	it("同版本同态幂等（upsert 覆盖，不产生第二行）", async () => {
		await upsertOverlayRow(row("wiki", "0.1.3", 1));
		await upsertOverlayRow(row("wiki", "0.1.3", 1, { actor: "tester-2" }));
		const rows = await readOverlayRows();
		expect(rows.filter(r => r.name === "wiki")).toHaveLength(1);
		expect(rows[0].actor).toBe("tester-2");
	});
});

describe("原子换版", () => {
	it("升级 = 同一批次内置新停旧，seq 同为新值，审计落库", async () => {
		await upsertOverlayRow(row("wiki", "0.1.3", 1));
		await upsertOverlayRow(row("wiki", "0.2.0", 0));
		const seqBefore = Math.max(...(await readOverlayRows()).map(r => r.seq));

		const r = await swapEnabledVersion({ name: "wiki", version: "0.2.0", actor: "ops" });
		expect(r.ok).toBe(true);

		const rows = await readOverlayRows();
		const oldRow = rows.find(x => x.version === "0.1.3")!;
		const newRow = rows.find(x => x.version === "0.2.0")!;
		expect(Number(oldRow.enabled)).toBe(0);
		expect(Number(newRow.enabled)).toBe(1);
		// 同一批次：seq 同值且恰好比旧值 +1
		expect(oldRow.seq).toBe(newRow.seq);
		expect(newRow.seq).toBe(seqBefore + 1);
		// 审计：actor/changed_at/old_state
		expect(newRow.actor).toBe("ops");
		expect(newRow.old_state).toBe(JSON.stringify({ enabled: 0 }));
	});

	it("目标版本无记录 → 人话拒绝", async () => {
		await upsertOverlayRow(row("wiki", "0.1.3", 1));
		const r = await swapEnabledVersion({ name: "wiki", version: "9.9.9", actor: "ops" });
		expect(r.ok).toBe(false);
		expect(r.message).toContain("无 overlay 记录");
	});

	it("已唯一启用目标版本 → 幂等放行", async () => {
		await upsertOverlayRow(row("wiki", "0.2.0", 1));
		const r = await swapEnabledVersion({ name: "wiki", version: "0.2.0", actor: "ops" });
		expect(r.ok).toBe(true);
		expect(r.message).toContain("幂等");
	});
});

describe("启停当前启用版本", () => {
	it("停用后再启用往返，seq 单调递增", async () => {
		await upsertOverlayRow(row("wiki", "0.2.0", 1));
		const seq0 = (await readOverlayRows())[0].seq;
		await setOverlayEnabled({ name: "wiki", enabled: false, actor: "ops" });
		await setOverlayEnabled({ name: "wiki", enabled: true, actor: "ops" });
		const rows = await readOverlayRows();
		expect(Number(rows[0].enabled)).toBe(1);
		expect(rows[0].seq).toBeGreaterThan(seq0);
	});
});

describe("三路 backfill（漏第三路 = 停用 builtin 升级当晚复活）", () => {
	it("锁/sidecar/老清单三路各有归属（数据表）", async () => {
		const result = await backfillOverlay({
			lock: { wiki: "0.2.0" },
			solutions: {
				wiki: { version: "0.2.0", enabled: true },
				crm: { version: "0.1.0", enabled: false },
			},
			manifest: [
				{ name: "home", version: "1.0.0", enabled: false },
				{ name: "crm", version: "0.1.0", enabled: false },
				{ name: "oj-market", version: "0.2.7", enabled: true },
			],
			actor: "backfill",
		});

		const rows = await readOverlayRows();
		const byKey = new Map(rows.map(r => [`${r.name}@${r.version}`, r]));
		// ① 锁 → solution 登记（未在清单中被标停用的 wiki 保持启用）
		expect(byKey.get("wiki@0.2.0")).toMatchObject({ enabled: 1, source: "solution" });
		// ② sidecar 停用 + ③ 老清单同标停用：仍以停用收敛（单状态源，两条来源一致）
		expect(byKey.get("crm@0.1.0")).toMatchObject({ enabled: 0, source: "solution" });
		// ③ 老清单停用：builtin（home 无锁无 sidecar）也要活——漏这路 = 升级当晚复活
		expect(byKey.get("home@1.0.0")).toMatchObject({ enabled: 0, source: "builtin" });
		// 默认启用且不冲突的 oj-market 不落库（基线承载默认态）
		expect(byKey.has("oj-market@0.2.7")).toBe(false);
		expect(result.inserted + result.updated + result.skipped).toBeGreaterThan(0);
	});

	it("重复 backfill 幂等（已一致行计入 skipped）", async () => {
		const input = {
			lock: { wiki: "0.2.0" },
			solutions: {},
			manifest: [],
			actor: "backfill",
		};
		const first = await backfillOverlay(input);
		expect(first.inserted).toBe(1);
		const second = await backfillOverlay(input);
		expect(second.inserted).toBe(0);
		expect(second.skipped).toBe(1);
	});
});
