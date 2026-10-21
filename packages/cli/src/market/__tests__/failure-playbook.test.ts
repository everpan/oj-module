// market/failure-playbook spec（T12 收尾）：失败文案表的 traceability——
// 每个 neg 场景预期命中的失败码都必须有双段式条目（成因 + 下一步），漏一条即失败。
import { describe, expect, it } from "vitest";

import { FAILURE_PLAYBOOK } from "../failure-playbook";

/** 各 neg op 预期命中的失败码（补新 neg op 时同步加行，保持可追溯） */
const REQUIRED_CODES = [
	"sig_missing", // neg-nosig
	"tampered", // neg-tamper
	"unknown_key", // neg-stranger
	"rollback_guard", // rollback
	"index_sig", // neg-badindex
	"zip_slip", // neg-evil
] as const;

describe("given 失败文案表 When 逐条核对", () => {
	it("then 每个 neg 场景的预期失败码都有条目，且双段式字段非空", () => {
		const byCode = new Map(FAILURE_PLAYBOOK.map(e => [e.code, e]));
		for (const code of REQUIRED_CODES) {
			const entry = byCode.get(code);
			expect(entry, `缺失败码 ${code} 的文案条目`).toBeDefined();
			expect(entry!.stage.trim()).not.toBe("");
			expect(entry!.cause.trim()).not.toBe("");
			expect(entry!.next.trim()).not.toBe("");
		}
	});

	it("then code 无重复（表是字典不是日志）", () => {
		const codes = FAILURE_PLAYBOOK.map(e => e.code);
		expect(new Set(codes).size).toBe(codes.length);
	});
});
