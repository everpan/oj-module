// market/report spec（T12 收尾）：报告白黑名单——白名单内容落盘，黑名单字段写盘前被掩码。
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FAILURE_PLAYBOOK } from "../failure-playbook";
import { sanitizeReportText, writeWalkthroughReport } from "../report";

describe("given 含黑名单字段的文本 When 过脱敏", () => {
	it("then Bearer token / JWT / PEM / jwt_secret 全部被掩码，白名单内容（指纹/sha256/key_id）原样保留", () => {
		const text = [
			"authorization: Bearer abc.def-123~",
			"jwt: eyJhbGciOiJ.eyJzdWI.SflKxw",
			"-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMG\n-----END PRIVATE KEY-----",
			"jwt_secret: hunter2",
			"fingerprint 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 / key_id demo.publisher / sha256 abc123",
		].join("\n");
		const out = sanitizeReportText(text);
		expect(out).not.toContain("abc.def-123");
		expect(out).not.toContain("eyJhbGciOiJ");
		expect(out).not.toContain("MIGHAgEAMBMG");
		expect(out).not.toContain("hunter2");
		expect(out).toContain("Bearer ***");
		expect(out).toContain("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"); // 白名单原样
		expect(out).toContain("demo.publisher");
		// 幂等：二次过检不再变化
		expect(sanitizeReportText(out)).toBe(out);
	});
});

describe("given 一次 walkthrough 的行 When 落盘报告", () => {
	it("then 写出 AC 表 + 文案表，且 detail 里的 token 被掩码", () => {
		const dir = mkdtempSync(join(tmpdir(), "ojm-report-"));
		const file = writeWalkthroughReport({
			rows: [
				{ key: "install", title: "安装（11 段）", ok: true, detail: "" },
				{ key: "neg-x", title: "负向示例", ok: false, detail: "泄漏 Authorization: Bearer leAk.ed-tok~en" },
			],
			port: 49999,
			playbook: FAILURE_PLAYBOOK,
			logDir: dir,
		});
		const text = readFileSync(file, "utf-8");
		expect(file).toContain(join(dir, "walkthrough-"));
		expect(text).toContain("| install | PASS | 安装（11 段） |");
		expect(text).toContain("| neg-x | FAIL |");
		expect(text).toContain("sig_missing"); // 文案表段在场
		expect(text).not.toContain("leAk.ed-tok"); // 黑名单兜底生效
	});
});
