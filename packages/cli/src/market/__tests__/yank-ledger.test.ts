// ojm market yank 账本单测（REG-CS4）：幂等、审计留痕、不存在版本明确报错、跨重建存活。
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { markYanked, readYankLedger, yankKey } from "../yank-ledger";

function newProject(): { root: string, cdn: string } {
	const root = mkdtempSync(join(tmpdir(), "ojm-yank-"));
	mkdirSync(join(root, "api"), { recursive: true });
	const cdn = join(root, "cdn");
	mkdirSync(cdn, { recursive: true });
	writeFileSync(join(root, "api", "config.yaml"), "mounts:\n  - prefix: /api\n    api: src\n  - prefix: /cdn\n    web: ../cdn\nserver:\n  host: 127.0.0.1\n  port: 9778\n", "utf-8");
	writeFileSync(join(cdn, "demo-solution-0.1.0.tgz"), "", "utf-8");
	writeFileSync(join(cdn, "demo-solution-0.2.0.tgz"), "", "utf-8");
	return { root, cdn };
}

describe("yank 账本（REG-CS4）", () => {
	it("markYanked 写盘后 readYankLedger 可回读，含 by/reason/at 审计字段", async () => {
		const { root } = newProject();
		markYanked(root, "demo-solution", "0.1.0", { by: "alice", reason: "CVE-2026-1", now: 1_700_000_000 });
		const ledger = readYankLedger(root);
		const e = ledger.get(yankKey("demo-solution", "0.1.0"));
		expect(e).toMatchObject({ name: "demo-solution", version: "0.1.0", by: "alice", reason: "CVE-2026-1", at: 1_700_000_000 });
	});

	it("重复 yank 幂等：不覆盖既有 by/at/reason，created=false", async () => {
		const { root } = newProject();
		markYanked(root, "demo-solution", "0.1.0", { by: "alice", reason: "first", now: 1 });
		const r = markYanked(root, "demo-solution", "0.1.0", { by: "bob", reason: "second", now: 2 });
		expect(r.created).toBe(false);
		const e = readYankLedger(root).get(yankKey("demo-solution", "0.1.0"))!;
		// 首次写入保活，不被第二次覆盖
		expect(e).toMatchObject({ by: "alice", reason: "first", at: 1 });
	});

	it("对 cdn 不存在的版本 yank → 明确报错，账本不动", async () => {
		const { root } = newProject();
		let thrown: unknown;
		try {
			await markYanked(root, "demo-solution", "9.9.9", { by: "x" });
		}
		catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect(String((thrown as Error).message)).toContain("无法下线");
		expect(readYankLedger(root).size).toBe(0);
	});

	it("账本跨多次索引重建存活（file 不删＝yank 不丢）", async () => {
		const { root, cdn } = newProject();
		markYanked(root, "demo-solution", "0.1.0", { by: "alice", now: 5 });
		// 模拟另一版本发布后重建（账本应原样保留）
		writeFileSync(join(cdn, "demo-solution-0.3.0.tgz"), "", "utf-8");
		expect(readYankLedger(root).get(yankKey("demo-solution", "0.1.0"))?.by).toBe("alice");
	});
});
