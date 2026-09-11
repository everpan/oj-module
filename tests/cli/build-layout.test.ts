import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildBackend, buildModules, readModuleDefinition } from "../../packages/cli/src/build";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 设计 §5（D8/D11）：build 的布局感知与职责边界。
 *  - buildModules 产物随布局：新布局 modules/dist，旧布局 dist/
 *  - 全站合并（mergeSite）只属 `ram build`：先清场再拷 shell dist，防旧哈希资产累积
 *  - buildBackend 编排 `bin/oj build`：绝对路径、绝不 migrate（零 DB 副作用）
 */

const FIXTURE_ROOT = path.join(PROJECT_ROOT, ".tmp-fx");

const ENTRY = `import { defineModule } from "@react-antd-module/runtime";
export default defineModule({ name: "fx", description: "fixture", version: "0.1.0" });
`;

function makeFixture(kind: "new" | "legacy"): string {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	// 夹具根落在仓库根下的临时目录：宿主产物已并入 cli（resolveShellDist 走包内
	// shell-dist），不再依赖夹具相对仓库根的层级
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, `build-${kind}-`));
	const modulesDir = kind === "new" ? path.join(root, "modules/src") : path.join(root, "modules");
	fs.mkdirSync(modulesDir, { recursive: true });
	fs.writeFileSync(path.join(modulesDir, "entry.ts"), ENTRY);
	fs.writeFileSync(
		path.join(root, "modules.config.ts"),
		`export default { baseUrl: "", modules: [{ name: "fx", entry: "${modulesDir}/entry.ts" }] };\n`,
	);
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx-proj", type: "module" }));
	return root;
}

function makeStubOj(root: string): string {
	const binDir = path.join(root, "bin");
	fs.mkdirSync(binDir, { recursive: true });
	const stub = path.join(binDir, "oj");
	fs.writeFileSync(
		stub,
		`#!/usr/bin/env node\nimport fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(path.join(root, "oj-args.json"))}, JSON.stringify(process.argv.slice(2)));\n`,
	);
	fs.chmodSync(stub, 0o755);
	fs.mkdirSync(path.join(root, "api/src/web"), { recursive: true });
	fs.writeFileSync(path.join(root, "api/src/web/manifest.yaml"), "name: \"web\"\nversion: \"0.1.0\"\n");
	return stub;
}

describe("readModuleDefinition 元数据读取封闭性（外部工程未装依赖也可读）", () => {
	it("entry 顶层 import 的未安装包被桩化：具名导入（含 JSX 顶层求值）不触达 node_modules", async () => {
		const root = makeFixture("new");
		// 模拟真实模板形态：顶层具名导入 + JSX 元素在模块顶层求值（createElement）
		fs.writeFileSync(path.join(root, "modules/src/entry.ts"), [
			"import React from \"react\";",
			"import * as ReactDOM from \"react-dom\";",
			"import { Button } from \"antd\";",
			"import { defineModule } from \"@react-antd-module/runtime\";",
			"import { missing } from \"no-such-pkg-xyz\";",
			"export default defineModule({",
			"  name: \"fx\",",
			"  description: \"fixture\",",
			"  version: \"0.1.0\",",
			"  routes: [{ path: \"/x\", element: React.createElement(Button) }, { path: \"/y\", element: missing && null }, { path: \"/z\", element: ReactDOM.createRoot(\"x\") }],",
			"});",
			"",
		].join("\n"));
		const def = await readModuleDefinition(path.join(root, "modules/src/entry.ts"), root);
		expect(def.name).toBe("fx");
	});
});

describe("buildModules 布局感知", () => {
	it("新布局产物落 modules/dist", async () => {
		const root = makeFixture("new");
		await buildModules(root);
		expect(fs.existsSync(path.join(root, "modules/dist/modules.json"))).toBe(true);
		expect(fs.existsSync(path.join(root, "modules/dist/modules/fx/0.1.0/entry.js"))).toBe(true);
	});

	it("旧布局产物落 dist（scripts/build-modules.ts 依赖的行为不变）", async () => {
		const root = makeFixture("legacy");
		await buildModules(root);
		expect(fs.existsSync(path.join(root, "dist/modules.json"))).toBe(true);
	});

	it("mergeSite：先清场再拷 shell dist，旧哈希资产不残留", async () => {
		const root = makeFixture("new");
		const distDir = path.join(root, "modules/dist");
		fs.mkdirSync(distDir, { recursive: true });
		fs.writeFileSync(path.join(distDir, "stale-old-hash.js"), "stale");

		await buildModules(root, { mergeSite: true });

		expect(fs.existsSync(path.join(distDir, "stale-old-hash.js"))).toBe(false);
		expect(fs.existsSync(path.join(distDir, "index.html"))).toBe(true);
		expect(fs.existsSync(path.join(distDir, "versions.json"))).toBe(true);
		expect(fs.existsSync(path.join(distDir, "modules.json"))).toBe(true);
	});
});

describe("buildBackend（oj build 编排，D8）", () => {
	it("无 api/src 返回 false，不 spawn", async () => {
		const root = makeFixture("new");
		expect(await buildBackend(root)).toBe(false);
	});

	it("有 api/src 时 spawn bin/oj build：绝对路径参数、不含 migrate", async () => {
		const root = makeFixture("new");
		makeStubOj(root);

		const built = await buildBackend(root);

		expect(built).toBe(true);
		const args = JSON.parse(fs.readFileSync(path.join(root, "oj-args.json"), "utf-8")) as string[];
		expect(args[0]).toBe("build");
		expect(args).not.toContain("migrate");
		const dirFlag = args[args.indexOf("-d") + 1];
		const outFlag = args[args.indexOf("-o") + 1];
		expect(path.isAbsolute(dirFlag)).toBe(true);
		expect(path.isAbsolute(outFlag)).toBe(true);
		expect(dirFlag).toBe(path.join(root, "api/src"));
		expect(outFlag).toBe(path.join(root, "api/dist"));
	});

	it("bin/oj 缺失 → 人话报错指向 init 补缺", async () => {
		const root = makeFixture("new");
		fs.mkdirSync(path.join(root, "api/src/web"), { recursive: true });
		await expect(buildBackend(root)).rejects.toThrowError(/init/);
	});
});

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});
