import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildModules } from "../../packages/cli/src/build";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 设计 §4.1-④（M1 T6）：tailwind 模块构建管线。
 *  - 模块 entry `import "./styles.css"` → 产物含编译后 css，modules.json `css[]` 收录
 *  - 模块无任何 css 入口 → 零 css 产物、零开销
 */

// 独立夹具根：build-layout 等测试并发共用 .tmp-fx，本套清场不得误删邻套夹具
const FIXTURE_ROOT = path.join(PROJECT_ROOT, ".tmp-fx-tw");

// 夹具直接复用模板文件：测试同时守护「模板本身可编译、可出产物」
const TEMPLATE_STYLES = fs.readFileSync(
	path.join(PROJECT_ROOT, "packages/cli/templates/web/src/styles.css"),
	"utf-8",
);

function makeFixture(withCss: boolean): string {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, "tailwind-"));
	const modulesDir = path.join(root, "web/src");
	fs.mkdirSync(modulesDir, { recursive: true });
	const entry = [
		"import { defineModule } from \"@oj-module/runtime\";",
		withCss ? "import \"./styles.css\";" : "",
		// 命中一个工具类候选，让 tailwind 有确定产物可断言
		withCss ? "export const cls = \"tw:flex\";" : "",
		"export default defineModule({ name: \"fx\", description: \"fixture\", version: \"0.1.0\" });",
		"",
	].filter(line => line !== "").join("\n");
	fs.writeFileSync(path.join(modulesDir, "entry.ts"), entry);
	if (withCss)
		fs.writeFileSync(path.join(modulesDir, "styles.css"), TEMPLATE_STYLES);
	fs.writeFileSync(
		path.join(root, "web.config.ts"),
		`export default { baseUrl: "", modules: [{ name: "fx", entry: "${modulesDir}/entry.ts" }] };\n`,
	);
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx-proj", type: "module" }));
	return root;
}

interface ManifestEntry {
	name: string
	css: string[]
}

function readManifest(root: string): ManifestEntry[] {
	return JSON.parse(fs.readFileSync(path.join(root, "web/dist/modules.json"), "utf-8")) as ManifestEntry[];
}

function moduleCssFiles(root: string): string[] {
	const dir = path.join(root, "web/dist/modules/fx/0.1.0");
	return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".css")) : [];
}

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("tailwind 模块管线", () => {
	it("带 styles.css 的模块：产物含编译后 css 且 modules.json css[] 收录", async () => {
		const root = makeFixture(true);
		await buildModules(root);

		const files = moduleCssFiles(root);
		expect(files.length, "模块产物应含 css 文件").toBeGreaterThanOrEqual(1);

		const css = files.map(f => fs.readFileSync(path.join(root, "web/dist/modules/fx/0.1.0", f), "utf-8")).join("\n");
		expect(css, "css 应已被 tailwind 编译，不残留 @import 指令").not.toContain("@import \"tailwindcss");
		expect(css, "css 应含带前缀的编译工具类").toContain(".tw\\:flex");
		expect(css, "模板禁 preflight，不应混入 reset（与 runtime 对齐防 antd 冲突）").not.toContain("::backdrop");

		const mod = readManifest(root).find(m => m.name === "fx");
		expect(mod, "manifest 应含 fx 模块").toBeTruthy();
		expect(mod!.css.length, "manifest css[] 应收录产物 css").toBe(files.length);
		expect(mod!.css[0]).toMatch(/^\/modules\/fx\/0\.1\.0\/.*\.css$/);
	}, 60_000);

	it("无 css 入口的模块：零 css 产物、manifest css[] 为空", async () => {
		const root = makeFixture(false);
		await buildModules(root);

		expect(moduleCssFiles(root), "零 css 模块不应产出 css").toEqual([]);
		const mod = readManifest(root).find(m => m.name === "fx");
		expect(mod!.css).toEqual([]);
	}, 60_000);
});
