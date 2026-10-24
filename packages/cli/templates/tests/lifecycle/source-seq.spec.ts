// BDD：源代次水位（REG-CS2 防回放）——站点按源记住「见过的最大 seq」，回退即拒。
//
// 表 `reg_source_seq` 由 _platform 0014 迁移建；夹具直读真实迁移文件，与迁移零漂移。
// 四条负向是 G7 的重点：水位写坏 / 表不存在 / 值非法都必须**拒**，不能静默当「第一次见」——
// 静默重置等于把「防回放」降级成「每次都当第一次见」，攻击者先破坏状态再回放即可穿透。
import { beforeEach, describe, expect, it } from "vitest";
import { guardAndRecordSourceSeq, readSourceSeq, SOURCE_SEQ_TABLE } from "../../src/_platform/api/_lifecycle/source-seq";
import { installDb } from "../fixture";

const SRC = "https://cdn.example.com/solutions";

let dbo: any;

beforeEach(() => {
	dbo = installDb();
});

describe("given 站点第一次见某个源 When 拉到它的索引", () => {
	it("then 记录水位并放行（prev = null）", async () => {
		expect(await readSourceSeq(SRC)).toBeNull();
		expect(await guardAndRecordSourceSeq(SRC, 3)).toEqual({ ok: true, prev: null });
		expect(await readSourceSeq(SRC)).toBe(3);
	});
});

describe("given 同一代重复拉取 When 再判一次", () => {
	it("then 幂等放行，且不改写水位（不误伤正常重复请求）", async () => {
		await guardAndRecordSourceSeq(SRC, 5);
		expect(await guardAndRecordSourceSeq(SRC, 5)).toEqual({ ok: true, prev: 5 });
		expect(await readSourceSeq(SRC)).toBe(5);
	});
});

describe("given 源返回更旧的代次 When 判水位", () => {
	it("then 拒 index_stale，且不把水位拉低（回放改不了水位）", async () => {
		await guardAndRecordSourceSeq(SRC, 7);
		expect(await guardAndRecordSourceSeq(SRC, 3)).toEqual({ ok: false, code: "index_stale", prev: 7 });
		expect(await readSourceSeq(SRC)).toBe(7);
	});
});

describe("given 水位被写成非法值 When 判水位", () => {
	it("then 按 index_state_corrupt 拒（不静默重置成「没见过」）", async () => {
		dbo.prepare(`INSERT INTO ${SOURCE_SEQ_TABLE} (source_url, max_seq, updated_at) VALUES (?, ?, ?)`).run(SRC, 0, 1);
		expect(await readSourceSeq(SRC)).toBe("corrupt");
		expect(await guardAndRecordSourceSeq(SRC, 9)).toEqual({ ok: false, code: "index_state_corrupt", prev: null });
	});
});

describe("given 水位表不存在（站点未 migrate）When 判水位", () => {
	it("then 按 index_state_corrupt 拒（fail-closed，不悄悄放行）", async () => {
		dbo.exec(`DROP TABLE ${SOURCE_SEQ_TABLE}`);
		expect(await guardAndRecordSourceSeq(SRC, 1)).toEqual({ ok: false, code: "index_state_corrupt", prev: null });
	});
});
