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
describe("devkit 自包含（零仓库内部代号 / 零包外路径）", () => {
	it("sKILL/manual/README/framework-dev/教学文档/企微两本手册/发布 walkthrough 不含设计与评审代号", () => {
		const pattern = /\b(P\d+(-[0-9A-Z]+)?|C\d+(-\d+)?|AC-[A-Z]+-?\d*|S0\d{2}|R\d+|D1\d|B-\d+|G\d|M0\d{2})\b/;
		for (const name of ["SKILL.md", "manual.md", "README.md", "framework-dev.md", "module-dev-and-cdn-playground.md", "menu-rules.md", "wecom-daikaifa.md", "wecom-internal-app.md", "publish-walkthrough.md"]) {
			const hit = read(`docs/devkit/${name}`).match(pattern);
			expect(hit?.[0], `docs/devkit/${name} 含内部代号：${hit?.[0]}`).toBeUndefined();
		}
	});

	it("随 ojm init 分发的 6 个文件不引用包外路径（docs/prd、docs/guides、../oj-api-dev）", () => {
		// 分发清单的权威源是 init.ts 第 4b 步；这里按同一份名单反向校验，
		// 任何一条指向框架仓的路径在业务工程里都是死链。
		const init = read("packages/cli/src/init.ts");
		const distributed = ["SKILL.md", "manual.md", "README.md", "wecom-daikaifa.md", "wecom-internal-app.md", "publish-walkthrough.md"];
		for (const name of distributed) expect(init, `init.ts 未分发 ${name}`).toContain(`"${name}"`);
		for (const name of distributed) {
			const body = read(`docs/devkit/${name}`);
			const hit = body.match(/docs\/(?:prd|guides|plans|archive)\/|\.\.\/oj-api-dev/);
			expect(hit?.[0], `docs/devkit/${name} 引用了包外路径：${hit?.[0]}`).toBeUndefined();
		}
	});
});

/**
 * devkit 目录结构（2026-10-20 合并 oj-api-dev 快照后；2026-10-21 增教学文档；
 * 2026-10-30 增企微代开发手册；2026-11-01 增企业内部应用手册；
 * 2026-11-03 增发布全流程 walkthrough）：
 * docs/devkit/ 一棵树覆盖前后端两侧，但两套分发链不变——顶层 10 个 ojm 侧文件
 * 随 cli 包发货（→ .claude/skills/ojm-module-dev/），oj-api-dev/ 子目录是 oj 侧
 * devkit 的快照（与 ~/.local/share/oj/devkit/ 逐字节一致，仅本仓参考、不发货）。
 * 本守卫钉死这个结构：快照文件若被平铺进顶层，会误随 cli 包发货且与 oj 版本漂移。
 */
describe("devkit 目录结构（ojm 侧发货 + oj-api-dev 快照子目录）", () => {
	const OJM_FILES = ["SKILL.md", "manual.md", "README.md", "framework-dev.md", "sql-builder-missing-capabilities-pr.md", "module-dev-and-cdn-playground.md", "menu-rules.md", "wecom-daikaifa.md", "wecom-internal-app.md", "wecom-multi-corp-links.md", "publish-walkthrough.md"];
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
		"db-guide.md",
		"deploy-tunnel-recipe.md",
	];

	it("docs/devkit/ 顶层文件恰为 11 个 ojm 侧文件（快照不得平铺进同步源）", () => {
		const top = readdirSync(join(ROOT, "docs/devkit"))
			.filter(n => !n.startsWith(".") && statSync(join(ROOT, "docs/devkit", n)).isFile())
			.sort();
		expect(top).toEqual([...OJM_FILES].sort());
	});

	it("docs/devkit/oj-api-dev/ 恰为 12 个 oj 侧快照文件", () => {
		const snap = readdirSync(join(ROOT, "docs/devkit/oj-api-dev")).sort();
		expect(snap).toEqual([...SNAPSHOT_FILES].sort());
	});

	it("旧目录 docs/oj-api-dev/ 已删除（快照只在 devkit 子目录一处）", () => {
		expect(existsSync(join(ROOT, "docs/oj-api-dev"))).toBe(false);
	});

	/**
	 * 计数漂移守卫（2026-11-04）：README 曾长期写「顶层 9 个文件」「8 个文件」、
	 * framework-dev 与 sync-devkit 注释写「快照 10 个文件」，而实际是 10 / 12。
	 * 这类句子没有守卫就会随每次加文件而失真，读者按数字去数会对不上。
	 */
	it("文档里的 devkit 文件计数与目录实际数量一致", () => {
		for (const p of ["docs/devkit/README.md", "docs/README.md"])
			expect(read(p), `${p} 未按实际写「顶层 ${OJM_FILES.length} 个文件」`).toContain(`顶层 ${OJM_FILES.length} 个文件`);
		expect(read("docs/devkit/README.md")).toContain(`**ojm 侧的 ${OJM_FILES.length} 个文件**`);
		for (const p of ["docs/devkit/framework-dev.md", "packages/cli/scripts/sync-devkit.mjs"])
			expect(read(p), `${p} 未按实际写「${SNAPSHOT_FILES.length} 个文件」`).toContain(`${SNAPSHOT_FILES.length} 个文件`);
	});

	/**
	 * 档位一致性守卫（2026-11-04）：文档曾把 echarts / vditor 写成「宿主 importmap
	 * 提供的单例」，而 shared-deps 里它们是 `bundle: true`（宿主不提供、模块自打包）——
	 * 照着文档写方案的人会以为不用管体积，实测单模块因此多背 1.1MB。
	 * 真源是源码的 bundle 标志，文档必须跟它对齐。
	 */
	it("手册 §2.6 档位与 shared-deps 的 bundle 标志一致", () => {
		const src = read("packages/cli/src/shared-deps.ts");
		const bundlePkgs = [...new Set(
			src.split("\n")
				.filter(l => l.includes("bundle: true"))
				.map(l => l.match(/specifier: "([^"]+)"/)?.[1])
				.filter((s): s is string => s !== undefined)
				// 深路径归一成主包名：echarts/charts → echarts；@scope/pkg 原样保留
				.map(s => (s.startsWith("@") ? s : s.split("/")[0]!)),
		)];
		expect(bundlePkgs.length).toBeGreaterThan(0);

		const manual = read("docs/devkit/manual.md");
		const section = manual.slice(manual.indexOf("### 2.6"), manual.indexOf("### 2.8"));
		expect(section.length).toBeGreaterThan(0);

		for (const pkg of bundlePkgs) {
			expect(section, `手册 §2.6 未提 ${pkg}`).toContain(`\`${pkg}\``);
			// 「宿主」档的表格行不得出现自打包包名
			const hostRows = section.split("\n").filter(l => l.startsWith("|") && l.includes("宿主"));
			for (const row of hostRows)
				expect(row, `手册把 ${pkg} 归到宿主共享档，与 shared-deps 的 bundle: true 矛盾`).not.toContain(`\`${pkg}\``);
		}
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
 * 企微两本手册是「业务工程自助接上真实企业」的唯一入口（随 `ojm init` 分发），
 * 必须与模板里的部署常量保持同步：每项 `vars` 少写一项，读者就会在启动时撞 400，
 * 却不知道这些值该去企微后台哪个页面取。故以 `config.ts` 的 REQUIRED 表为真源
 * 反向校验手册——代开发八项进代开发手册，自建五项进自建手册，两项共用两边都要有——
 * 并钉死「三视角结构」与分发链路：文档漏发货等于没有。
 */
describe("企微两本手册与部署常量同步", () => {
	const daikaifa = read("docs/devkit/wecom-daikaifa.md");
	const internal = read("docs/devkit/wecom-internal-app.md");
	const config = read("packages/cli/templates/src/app/api/auth/_shared/wecom/config.ts");
	// config.ts 里出现的全部变量名即真源；按前缀分派到两本手册
	const all = [...new Set([...config.matchAll(/"(wecom_[a-z_]+)"/g)].map(m => m[1]!))].sort();
	const suiteVars = all.filter(n => !n.startsWith("wecom_corp_") && n !== "wecom_allow_coexist");
	const corpVars = all.filter(n => n.startsWith("wecom_corp_"));

	it("代开发八项常量逐个出现在代开发手册（真源：config.ts 的 REQUIRED 表）", () => {
		expect(suiteVars).toHaveLength(8);
		for (const name of suiteVars)
			expect(daikaifa, `手册缺 ${name} 的取值位置/缺失后果`).toContain(name);
	});

	it("自建五项常量逐个出现在自建手册，两项共用（enc_key / base_url）两边都要有", () => {
		expect(corpVars).toHaveLength(5);
		for (const name of corpVars)
			expect(internal, `自建手册缺 ${name} 的取值位置/缺失后果`).toContain(name);
		for (const name of ["wecom_enc_key", "wecom_base_url"]) {
			expect(internal, `自建手册缺共用项 ${name}`).toContain(name);
			expect(daikaifa, `代开发手册缺共用项 ${name}`).toContain(name);
		}
	});

	it("共存开关在两本手册都写清楚（两套凭据齐了不显式开就 400）", () => {
		for (const [name, doc] of [["wecom-daikaifa.md", daikaifa], ["wecom-internal-app.md", internal]] as const)
			expect(doc, `${name} 未写 wecom_allow_coexist: 'true'`).toContain("wecom_allow_coexist: 'true'");
	});

	it("代开发的三个派生地址与开通顺序的硬依赖写清楚", () => {
		for (const s of ["/api/auth/wecom/event", "/api/auth/wecom/callback", "10 分钟", "503"]) {
			expect(daikaifa, `手册缺关键事实：${s}`).toContain(s);
		}
	});

	it("自建手册写清「回调只填通讯录同步一处」与自建应用的硬约束", () => {
		for (const s of [
			"/api/auth/wecom/event",
			"通讯录同步",
			"接收消息", // 应用自身的接收消息回调必须留空
			"90970", // 自建应用收不到成员变更事件的官方依据
			"验证并接入",
			"可见范围",
		]) {
			expect(internal, `手册缺关键事实：${s}`).toContain(s);
		}
	});

	it("代开发手册三视角（用户 / 开发 / 部署）+ 故障速查结构齐备", () => {
		for (const h of ["## 5. 用户手册", "## 6. 开发手册", "## 7. 部署", "## 8. 故障速查", "## 2. 凭据清单"])
			expect(daikaifa, `手册缺章节：${h}`).toContain(h);
	});

	it("自建手册三视角（用户 / 开发 / 部署）+ 共存 + 故障速查结构齐备", () => {
		for (const h of ["## 2. 凭据清单", "## 5. 用户手册", "## 6. 开发手册", "## 7. 部署", "## 8. 与代开发共存", "## 9. 租户与管理员模型", "## 10. 故障速查"])
			expect(internal, `手册缺章节：${h}`).toContain(h);
	});

	it("ojm init 会分发两本手册（否则业务工程拿不到，自治性落空）", () => {
		const init = read("packages/cli/src/init.ts");
		expect(init).toContain("\"wecom-daikaifa.md\"");
		expect(init).toContain("\"wecom-internal-app.md\"");
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
