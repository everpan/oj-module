// BDD：文档存在性断言（P2-14 文档包与真源同步）——devkit 手册「打包与分发」「签名与信任」
// 两正式章节（P1-11 承诺兑现）、三视角指南深检 truthful 口径、教学文档 §6 主路径带签名。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("devkit 手册两章节（P2-14：文档存在性）", () => {
	const manual = read("docs/devkit/manual.md");

	it("§11 方案包：打包与分发——build --bundle/Form B 索引规范/分发源", () => {
		expect(manual).toContain("## §11 方案包：打包与分发");
		expect(manual).toContain("ojm build --bundle");
		expect(manual).toContain("bundles.yaml");
		expect(manual).toContain("逐字");
	});

	it("§12 签名与信任——keygen→sign→install 流程 + TOFU + bootstrap key", () => {
		expect(manual).toContain("## §12 签名与信任");
		expect(manual).toContain("ojm keygen --id");
		expect(manual).toContain("ojm sign dist/");
		expect(manual).toContain("ojm trust confirm --task");
		expect(manual).toContain("BOOTSTRAP_KEY");
		expect(manual).toContain("G4 硬 fail-closed");
	});
});

describe("三视角指南 + 教学文档（P2-14：truthful 口径）", () => {
	it("指南 §3.3 深检改 truthful：端点已兑现、界面入口归 oj-market、报告结构 {ok,checks,advise}", () => {
		const guide = read("docs/prd/solution/archive/202610171354-lifecycle-guide.md");
		expect(guide).toContain("POST /api/_platform/solutions/verify");
		expect(guide).toContain("{ok, checks, advise}");
		expect(guide).toContain("由市场方案（oj-market）实现");
		expect(guide).not.toContain("### 3.3 深度校验按钮");
	});

	it("教学文档 §6 主路径 build --bundle → sign → install；八坑表含签名坑", () => {
		const t = read("docs/prd/solution/archive/202610172100-solution-authoring-tutorial.md");
		expect(t).toContain("ojm sign dist/demo-market-0.1.0.tgz");
		expect(t).toContain("needs_trust");
		expect(t).toContain("sig_missing");
	});

	it("ojm usage 文本含 trust/keygen/sign（P2-4 接线缺口闭合）", () => {
		const usage = read("packages/cli/src/usage.ts");
		for (const cmd of ["ojm trust ls|add|revoke|confirm", "ojm keygen --id", "ojm sign <file.tgz>"]) {
			expect(usage).toContain(cmd);
		}
	});
});
