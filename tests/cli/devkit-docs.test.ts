// BDD：文档存在性断言（P2-14 文档包与真源同步）——devkit 手册「打包与分发」「签名与信任」
// 两正式章节（P1-11 承诺兑现）、三视角指南深检 truthful 口径、教学文档 §6 主路径带签名。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
		expect(manual).toContain("硬 fail-closed：未签名包拒装");
	});
});

/**
 * devkit 随 `ojm init` 进业务工程，读者手里没有框架仓的设计/评审文档——
 * `P2-14` / `C3` / `AC-D9` / `G4` 这类内部代号对他们不可解码，违背 devkit 的自包含承诺。
 * 本守卫钉死「交付四件套零内部代号」；确需追溯的出处写在框架仓文档，不进 devkit。
 */
describe("devkit 自包含（零仓库内部代号）", () => {
	it("sKILL/manual/README/framework-dev/教学文档/企微手册 不含设计与评审代号", () => {
		const pattern = /\b(P\d+(-[0-9A-Z]+)?|C\d+(-\d+)?|AC-[A-Z]+-?\d*|S0\d{2}|R\d+|D1\d|B-\d+|G\d|M0\d{2})\b/;
		for (const name of ["SKILL.md", "manual.md", "README.md", "framework-dev.md", "module-dev-and-cdn-playground.md", "menu-rules.md", "wecom-daikaifa.md"]) {
			const hit = read(`docs/devkit/${name}`).match(pattern);
			expect(hit?.[0], `docs/devkit/${name} 含内部代号：${hit?.[0]}`).toBeUndefined();
		}
	});
});

/**
 * devkit 目录结构（2026-10-20 合并 oj-api-dev 快照后；2026-10-21 增教学文档；
 * 2026-10-30 增企微代开发手册）：
 * docs/devkit/ 一棵树覆盖前后端两侧，但两套分发链不变——顶层 8 个 ojm 侧文件
 * 随 cli 包发货（→ .claude/skills/ojm-module-dev/），oj-api-dev/ 子目录是 oj 侧
 * devkit 的快照（与 ~/.local/share/oj/devkit/ 逐字节一致，仅本仓参考、不发货）。
 * 本守卫钉死这个结构：快照文件若被平铺进顶层，会误随 cli 包发货且与 oj 版本漂移。
 */
describe("devkit 目录结构（ojm 侧发货 + oj-api-dev 快照子目录）", () => {
	const OJM_FILES = ["SKILL.md", "manual.md", "README.md", "framework-dev.md", "sql-builder-missing-capabilities-pr.md", "module-dev-and-cdn-playground.md", "menu-rules.md", "wecom-daikaifa.md"];
	const SNAPSHOT_FILES = [
		"SKILL.md",
		"README.md",
		"api-manual.md",
		"scenarios.md",
		"sql-builder-guide.md",
		"oj-test-guide.md",
		"global.d.ts",
		"oj-modules.d.ts",
		"oidc-implementation.md",
		"oidc-integration.md",
	];

	it("docs/devkit/ 顶层文件恰为 8 个 ojm 侧文件（快照不得平铺进同步源）", () => {
		const top = readdirSync(join(ROOT, "docs/devkit"))
			.filter(n => !n.startsWith(".") && statSync(join(ROOT, "docs/devkit", n)).isFile())
			.sort();
		expect(top).toEqual([...OJM_FILES].sort());
	});

	it("docs/devkit/oj-api-dev/ 恰为 10 个 oj 侧快照文件", () => {
		const snap = readdirSync(join(ROOT, "docs/devkit/oj-api-dev")).sort();
		expect(snap).toEqual([...SNAPSHOT_FILES].sort());
	});

	it("旧目录 docs/oj-api-dev/ 已删除（快照只在 devkit 子目录一处）", () => {
		expect(existsSync(join(ROOT, "docs/oj-api-dev"))).toBe(false);
	});

	it("本仓维护的活文档零 docs/oj-api-dev 旧路径引用（历史 plan 档案除外）", () => {
		// 只扫本仓维护的活文档；docs/superpowers/ 与 .superpowers/ 是历史计划档案，
		// 记录当时的路径事实，按「如实记录」不回改。快照子目录是上游字节 vendored，
		// 其内容以上游为准，同样不扫。
		const living = [
			...OJM_FILES.map(n => `docs/devkit/${n}`),
			"docs/README.md",
			"docs/prd/framework-verification-playbook.md",
		];
		for (const p of living) {
			expect(read(p), `${p} 仍引用已删除的 docs/oj-api-dev/`).not.toContain("docs/oj-api-dev");
		}
	});
});

/**
 * 企微代开发手册是「业务工程自助接上真实套件」的唯一入口（随 `ojm init` 分发），
 * 必须与模板里的部署常量保持同步：六项 `vars` 少写一项，读者就会在启动时撞 400，
 * 却不知道这些值该去企微后台哪个页面取。故以 `config.ts` 的 REQUIRED 表为真源
 * 反向校验手册，并钉死「三视角结构」与分发链路——文档漏发货等于没有。
 */
describe("企微代开发手册与部署常量同步", () => {
	const doc = read("docs/devkit/wecom-daikaifa.md");
	const config = read("packages/cli/templates/src/auth/api/_shared/wecom/config.ts");

	it("六项部署常量逐个出现在手册（真源：config.ts 的 REQUIRED 表）", () => {
		const names = [...config.matchAll(/"(wecom_[a-z_]+)"/g)].map(m => m[1]!);
		const required = [...new Set(names)].sort();
		expect(required).toHaveLength(6);
		for (const name of required)
			expect(doc, `手册缺 ${name} 的取值位置/缺失后果`).toContain(name);
	});

	it("三个派生地址与开通顺序的硬依赖写清楚", () => {
		for (const s of ["/api/auth/wecom/event", "/api/auth/wecom/callback", "10 分钟", "503"]) {
			expect(doc, `手册缺关键事实：${s}`).toContain(s);
		}
	});

	it("三视角（用户 / 开发 / 部署）+ 故障速查结构齐备", () => {
		for (const h of ["## 5. 用户手册", "## 6. 开发手册", "## 7. 部署", "## 8. 故障速查", "## 2. 凭据清单"])
			expect(doc, `手册缺章节：${h}`).toContain(h);
	});

	it("ojm init 会分发该文件（否则业务工程拿不到，自治性落空）", () => {
		expect(read("packages/cli/src/init.ts")).toContain("\"wecom-daikaifa.md\"");
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
