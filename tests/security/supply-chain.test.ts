import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

const NPMJS = "https://registry.npmjs.org/";

function readPkg(name: string) {
	return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, `packages/${name}/package.json`), "utf-8"));
}

/**
 * P6.6 / §4.8 供应链（O2 已定公开 npm）：
 *  - 安装走 .npmrc 镜像加速，**发布**必须锁定官方 registry
 *    （publishConfig.registry 覆盖，防误发私有/镜像源）；
 *  - scoped 包公开访问需显式 access: public；
 *  - 发布流程约束（2FA / --provenance / --frozen-lockfile /
 *    npm audit signatures）记录在 README 发布章节；
 *  - R13（不签名，O3 已定）在 README 明示。
 */
describe("供应链加固（P6.6）", () => {
	// P7.10 决策翻转：P6.6 曾定「shell 保持 private 以 dist 交付」，但外部工程的
	// ojm dev/build 需要宿主产物，不发布则 US-1/US-2 第一步即失败（评审 F5）。
	// P1 起宿主并入 cli（shell-dist/ 随 cli 发布），发布面收敛为 runtime + cli 两包
	it.each(["runtime", "cli"])("%s 包 publishConfig 锁定官方 registry 且公开访问", (name) => {
		const pkg = readPkg(name);
		expect(pkg.private).toBeUndefined();
		expect(pkg.publishConfig?.registry).toBe(NPMJS);
		expect(pkg.publishConfig?.access).toBe("public");
	});

	it(".npmrc 锁定安装源并开启 provenance", () => {
		const npmrc = fs.readFileSync(path.join(PROJECT_ROOT, ".npmrc"), "utf-8");
		expect(npmrc).toMatch(/registry=https:\/\/registry\.npmmirror\.com/);
		expect(npmrc).toMatch(/provenance=true/);
	});

	it("rEADME 明示 R13 不签名残留风险与发布 checklist", () => {
		const readme = fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf-8");
		expect(readme).toContain("R13");
		expect(readme).toContain("--provenance");
		expect(readme).toContain("--frozen-lockfile");
	});
});
