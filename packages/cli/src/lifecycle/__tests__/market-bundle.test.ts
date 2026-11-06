import { execFileSync } from "node:child_process";
// BDD：oj-market 第一方方案包（Phase B T1）——市场 UI 以**纯 web 方案包**形态分发：
// 契约 src/oj-market/solution.yaml（web-only：api 编排面留在平台，随脚手架内置不随包），
// `ojm build --bundle oj-market` 产出 dist/oj-market-0.2.0.tgz（+ 发包人 ojm sign 平台签名）。
// 版本基线 0.2.0（20261106-2122 拍板）；entry.ts 版本与契约版本同源漂移由本 spec 钉住。
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildBundle } from "../../bundle";
import { validateContract } from "../../manifest-contract";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "../../../templates");
const CONTRACT = join(TEMPLATES, "src/oj-market/solution.yaml");

/** tar 成员清单（与 bundle.test 同原语） */
function tarList(tgz: string): string[] {
	const out = execFileSync("tar", ["-tzf", tgz], { encoding: "utf-8" });
	return out.split("\n").filter(Boolean);
}

describe("oj-market 方案包契约（T1）", () => {
	it("src/oj-market/solution.yaml 在位：name=oj-market、version=0.2.0、web-only（无 api 段）、契约零违规", () => {
		expect(existsSync(CONTRACT)).toBe(true);
		const m = parse(readFileSync(CONTRACT, "utf8")) as Record<string, unknown>;
		expect(m).toMatchObject({ name: "oj-market", version: "0.2.0" });
		expect(m.api).toBeUndefined(); // 安装编排面留在平台（src/oj-market/api 内置不随包）
		const web = m.web as Record<string, unknown>;
		expect(web.entry).toBe("modules/oj-market/0.2.0/entry.js");
		expect(validateContract(m)).toEqual([]);
	});

	it("模板工程 builtin 名单不含 oj-market（第一方打包放行；用户工程名单由 init 按白名单派生仍含——两侧语义分歧是本用例钉住的裁决）", () => {
		const p = join(TEMPLATES, "src/.ojm-builtin.json");
		const list = JSON.parse(readFileSync(p, "utf8")) as { modules: string[] };
		expect(list.modules).not.toContain("oj-market");
	});

	it("版本同源：web entry.ts 模块版本 = 契约版本（0.2.0 基线，双写漂移即红）", async () => {
		const { readModuleDefinition } = await import("../../build/module-def");
		const def = await readModuleDefinition(join(TEMPLATES, "src/oj-market/web/entry.ts"), TEMPLATES);
		expect(def.version).toBe("0.2.0");
	});
});

describe("oj-market 方案包组装（T1，scratch 工程钉布局）", () => {
	let project: string;
	let out: string;

	beforeEach(() => {
		project = mkdtempSync(join(tmpdir(), "ojm-market-bundle-"));
		out = mkdtempSync(join(tmpdir(), "ojm-market-out-"));
		// 契约原样入 scratch（唯一真源，勿在测试里另写一份）
		mkdirSync(join(project, "src/oj-market"), { recursive: true });
		cpSync(CONTRACT, join(project, "src/oj-market/solution.yaml"));
		// 模块标记（布局探测）+ 无 category 路由的 entry 桩（derive 空 → 保留契约 routes）
		mkdirSync(join(project, "src/oj-market/web/locales"), { recursive: true });
		writeFileSync(join(project, "src/oj-market/web/entry.ts"), "export default { name: \"oj-market\", version: \"0.2.0\", routes: [] };\n");
		writeFileSync(join(project, "src/oj-market/web/locales/zh-CN.json"), JSON.stringify({ menu: { main: "方案市场" } }));
		writeFileSync(join(project, "src/oj-market/web/locales/en-US.json"), JSON.stringify({ menu: { main: "Market" } }));
		// 站点构建产物桩（版本段 === 0.2.0）
		mkdirSync(join(project, "dist/web/modules/oj-market/0.2.0"), { recursive: true });
		writeFileSync(join(project, "dist/web/modules/oj-market/0.2.0/entry.js"), "export default {};\n");
	});

	afterEach(() => {
		rmSync(project, { recursive: true, force: true });
		rmSync(out, { recursive: true, force: true });
	});

	it("buildBundle --bundle oj-market：纯 web 包（manifest + web/modules + 双语 locales，无 api/ 成员）", async () => {
		const [r] = await buildBundle(project, { out, name: "oj-market" });
		expect(r).toMatchObject({ name: "oj-market", version: "0.2.0" });
		expect(r!.sha256).toMatch(/^[a-f0-9]{64}$/);
		const names = tarList(r!.tgz);
		expect(names).toContain("oj-market-0.2.0/manifest.yaml");
		expect(names).toContain("oj-market-0.2.0/web/modules/oj-market/0.2.0/entry.js");
		expect(names).toContain("oj-market-0.2.0/web/modules/oj-market/locales/zh-CN.json");
		expect(names).toContain("oj-market-0.2.0/web/modules/oj-market/locales/en-US.json");
		expect(names.some(n => n.includes("/api/"))).toBe(false);
		// 确定性：同输入两次打包哈希一致（C2-32）
		const [r2] = await buildBundle(project, { out, name: "oj-market" });
		expect(r2!.sha256).toBe(r!.sha256);
	});
});
