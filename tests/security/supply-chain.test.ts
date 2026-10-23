import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

function readPkg(name: string) {
	return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, `packages/${name}/package.json`), "utf-8"));
}

/**
 * P6.6 / §4.8 供应链（O2 已定公开 npm）：
 *  - 安装走 .npmrc 镜像加速，**发布**必须锁定官方 registry；
 *    锁定位置 2026-10-23 翻转：publishConfig.registry **已移除**（它压过
 *    --registry 命令行与 .npmrc 作用域映射，模拟发 verdaccio 被迫改 package.json），
 *    改由发版脚本 publish-packages.mjs 的 publishArgs 显式 --registry 钉死——
 *    本文件断言「字段缺席（防回流）+ 脚本钉死」这对**新**契约；
 *  - scoped 包公开访问需显式 access: public；
 *  - 发布流程约束（2FA / --provenance / --frozen-lockfile /
 *    npm audit signatures）记录在 README 发布章节；
 *  - R13（不签名，O3 已定）在 README 明示。
 */
describe("供应链加固（P6.6）", () => {
	// P7.10 决策翻转：P6.6 曾定「shell 保持 private 以 dist 交付」，但外部工程的
	// ojm dev/build 需要宿主产物，不发布则 US-1/US-2 第一步即失败（评审 F5）。
	// P1 起宿主并入 cli（shell-dist/ 随 cli 发布），发布面收敛为 runtime + cli 两包
	it.each(["runtime", "cli"])("%s 包 publishConfig 仅保留 access:public，registry 字段缺席", (name) => {
		const pkg = readPkg(name);
		expect(pkg.private).toBeUndefined();
		// registry 缺席是硬约束：一旦回流，--registry 与 @oj-module:registry 映射
		// 全部失效（publishConfig.registry 优先级最高），verdaccio 模拟发布又得
		// 改 package.json 再复原——2026-10-23 publish-registry-pinning 计划移除的
		expect(pkg.publishConfig?.registry).toBeUndefined();
		expect(pkg.publishConfig?.access).toBe("public");
	});

	it("发版脚本显式钉死官方 registry（publishConfig.registry 移除后的锁定新位置）", () => {
		const script = fs.readFileSync(path.join(PROJECT_ROOT, "scripts/publish-packages.mjs"), "utf-8");
		expect(script).toContain("\"--registry\"");
		expect(script).toContain("https://registry.npmjs.org");
		// 效果级断言（非手段级）：@scope:registry 映射优先级**高于** --registry（npm 官方口径
		// publishConfig > @scope:registry > registry；2026-10-23 实锤——本机 ~/.npmrc 的
		// verdaccio 映射把带 --registry npmjs 的真实发布劫到本地 409）。只钉 --registry
		// 不钉 scope = 没钉死，发布步必须另有压过用户映射的动作（工程级 .npmrc 临时行）。
		expect(script).toContain("@oj-module:registry=");
	});

	it(".npmrc 锁定安装源并开启 provenance", () => {
		const npmrc = fs.readFileSync(path.join(PROJECT_ROOT, ".npmrc"), "utf-8");
		// 安装源统一官方源（分支决策：registry 统一为官方源，发布走 publishConfig.registry）；
		// 镜像域名校验仅保证不回落到默认源之外的不明域
		expect(npmrc).toMatch(/registry=https:\/\/registry\.(?:npmmirror|npmjs)\.(?:com|org)/);
		expect(npmrc).toMatch(/provenance=true/);
	});

	it("rEADME 明示 R13 不签名残留风险与发布 checklist", () => {
		const readme = fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf-8");
		expect(readme).toContain("R13");
		expect(readme).toContain("--provenance");
		expect(readme).toContain("--frozen-lockfile");
	});
});
