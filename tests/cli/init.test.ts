import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject, resolveVersionMatrix } from "../../packages/cli/src/init";
import { readOjPort, readOjServerField } from "../../packages/cli/src/oj-config";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 设计 §3：`ojm init` 产物契约（TDD）。
 *
 * 覆盖：全树关键文件、config.yaml 关键字段（host 127.0.0.1 / port 9778 /
 * api_prefix /api / auth 段 jwt_secret 非占位符）、证书三件套、bin/oj 可执行
 * （oj 经 npm 包 @oj-bin/oj 联网安装，测试注入桩安装器）、非空目录守卫、幂等补缺
 * （config 永不覆盖）。
 */

function tmpRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "ojm-init-"));
}

/** 桩 oj 安装器：模拟 @oj-bin/oj 安装产物（二进制 + 版本标记 + devkit） */
function fakeOjInstall(binDir: string): Promise<void> {
	fs.mkdirSync(path.join(binDir, "devkit"), { recursive: true });
	fs.writeFileSync(path.join(binDir, "oj"), "#!/bin/sh\necho oj\n");
	fs.chmodSync(path.join(binDir, "oj"), 0o755);
	fs.writeFileSync(path.join(binDir, ".oj-version"), "v0.1.0\n");
	fs.writeFileSync(path.join(binDir, "devkit/SKILL.md"), "skill\n");
	fs.writeFileSync(path.join(binDir, "devkit/api-manual.md"), "manual\n");
	fs.writeFileSync(path.join(binDir, "devkit/global.d.ts"), "types\n");
	return Promise.resolve();
}

const initOpts = { yes: true, ojInstaller: fakeOjInstall } as const;

describe("initProject", () => {
	it("按设计 §3 生成全栈工程全树", async () => {
		const dest = path.join(tmpRoot(), "demo-proj");
		await initProject(dest, initOpts);

		// 后端（语义断言：模板可能被 lint 重排格式，键值契约不变）
		const config = path.join(dest, "api/config.yaml");
		expect(readOjServerField(config, "host")).toBe("127.0.0.1");
		expect(readOjPort(config)).toBe(9778);
		expect(readOjServerField(config, "api_prefix")).toBe("/api");
		expect(readOjServerField(config, "public_key_path")).toBe("./config/public.pem");
		expect(readOjServerField(config, "certificate_path")).toBe("./config/cert.jws");
		const configText = fs.readFileSync(config, "utf-8");
		expect(configText).toContain("auth:");
		expect(configText).not.toContain("__JWT_SECRET__");
		// users 表归属 _platform 伪模块（§3-D2 归属图单源，参考 oj sample）；
		// DDL 归 migrations（S006 seed 纪律：seed 只放数据，oj build 检查）
		expect(fs.existsSync(path.join(dest, "api/src/_platform/seed.sql"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/_platform/migrations/0001__create_users.sql"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/_platform/schema.yaml"))).toBe(true);
		// auth 模块（§8：auth 端点是业务路由；anonymous_paths 显式匿名）
		expect(fs.existsSync(path.join(dest, "api/src/auth/manifest.yaml"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/auth/login/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/auth/refresh/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/auth/logout/api.ts"))).toBe(true);
		expect(fs.readFileSync(path.join(dest, "api/src/auth/manifest.yaml"), "utf-8")).toMatch(/_platform:\s*\^?0\.1\.0/);
		expect(fs.existsSync(path.join(dest, "api/src/web/manifest.yaml"))).toBe(true);
		expect(fs.readFileSync(path.join(dest, "api/src/web/manifest.yaml"), "utf-8")).toMatch(/^name:\s*web/m);

		// 证书三件套（现场签发）
		for (const name of ["private.pem", "public.pem", "cert.jws"])
			expect(fs.existsSync(path.join(dest, "api/config", name))).toBe(true);

		// bin/oj（桩安装器模拟 @oj-bin/oj 产物：可执行 + 版本标记）
		const oj = path.join(dest, "bin/oj");
		expect(fs.existsSync(oj)).toBe(true);
		expect(fs.statSync(oj).mode & 0o111).not.toBe(0);
		expect(fs.readFileSync(path.join(dest, "bin/.oj-version"), "utf-8").trim()).toBe("v0.1.0");

		// devkit 拷贝
		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/SKILL.md"))).toBe(true);
		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/api-manual.md"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "global.d.ts"))).toBe(true);

		// 前端模块与工程文件
		// home 提供 /home：shell 预构建把 VITE_BASE_HOME_PATH 定为 /home，
		// 登录回跳 / logo / tabbar 均指向它，缺则落错误边界
		expect(fs.existsSync(path.join(dest, "modules/src/home/entry.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "modules/src/home/pages/index.tsx"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "modules/src/demo/entry.ts"))).toBe(true);
		// login 模块提供 /login：shell 宿主不挂 runtime 内置 baseRoutes，
		// 缺它则登出/回跳登录无路由可跳
		const loginEntry = path.join(dest, "modules/src/login/entry.ts");
		expect(fs.existsSync(loginEntry)).toBe(true);
		expect(fs.existsSync(path.join(dest, "modules/src/login/pages/login.tsx"))).toBe(true);
		expect(fs.readFileSync(loginEntry, "utf-8")).toContain("path: \"/login\"");
		const modulesConfig = fs.readFileSync(path.join(dest, "modules.config.ts"), "utf-8");
		expect(modulesConfig).toContain("\"home\"");
		expect(modulesConfig).toContain("\"login\"");
		// personal-center（设计 T1）：runtime user-menu 固定导航 /personal-center/my-profile，
		// 模板缺它则点击落空（与缺 home/login 同型）
		expect(modulesConfig).toContain("\"personal-center\"");
		expect(fs.existsSync(path.join(dest, "modules/src/personal-center/entry.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "modules/src/personal-center/pages/my-profile/index.tsx"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "modules/src/personal-center/pages/settings/index.tsx"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "modules/src/personal-center/locales/zh-CN.json"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "modules/src/personal-center/locales/en-US.json"))).toBe(true);
		// 后端（T2）：manifest + contract + upload handler；生成物（routes.json/openapi.yaml）不进模板
		expect(fs.existsSync(path.join(dest, "api/src/personal-center/manifest.yaml"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/personal-center/contract.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/personal-center/upload/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/personal-center/routes.json"))).toBe(false);
		// 头像上传链路（T3）：users 表补 avatar_base64 列，user-info 返回它
		expect(fs.existsSync(path.join(dest, "api/src/_platform/migrations/0002__add_users_avatar_base64.sql"))).toBe(true);
		expect(fs.readFileSync(path.join(dest, "api/src/_platform/schema.yaml"), "utf-8")).toContain("avatar_base64");
		expect(fs.readFileSync(path.join(dest, "api/src/web/user-info/api.ts"), "utf-8")).toContain("avatar_base64");
		expect(fs.existsSync(path.join(dest, "modules.config.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "tsconfig.json"))).toBe(true);
		expect(fs.existsSync(path.join(dest, ".gitignore"))).toBe(true);
		// env.d.ts 提供 import.meta.env 类型，否则生成 client 会让 typecheck 报 TS2339
		expect(fs.existsSync(path.join(dest, "env.d.ts"))).toBe(true);
		const tsconfig = JSON.parse(fs.readFileSync(path.join(dest, "tsconfig.json"), "utf-8"));
		expect(tsconfig.include).toContain("env.d.ts");
		// api/.ojm-api-exempt.json：内置 auth/web/notifications handler 有意无契约，ojm api --check 需豁免清单
		expect(fs.existsSync(path.join(dest, "api/.ojm-api-exempt.json"))).toBe(true);
		const exempt = JSON.parse(fs.readFileSync(path.join(dest, "api/.ojm-api-exempt.json"), "utf-8"));
		expect(exempt.modules).toContain("web");
		expect(exempt.modules).toContain("notifications");
		expect(exempt.paths).toContain("/auth/*");
		// notifications 模块：root 级 /api/notifications（runtime 通知铃兜底），需表 + handler
		expect(fs.existsSync(path.join(dest, "api/src/notifications/api.ts"))).toBe(true);
		expect(fs.readFileSync(path.join(dest, "api/src/notifications/manifest.yaml"), "utf-8")).toMatch(/tables:[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*-\s*notifications/);
		expect(fs.existsSync(path.join(dest, "api/src/notifications/migrations/0001__create_notifications.sql"))).toBe(true);
		const pkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf-8"));
		expect(pkg.scripts.dev).toContain("ojm dev");
		expect(pkg.scripts.preview).toContain("ojm preview");
		// 版本钉死：不允许 workspace:/catalog: 逃逸进外部工程
		for (const deps of [pkg.dependencies ?? {}, pkg.devDependencies ?? {}]) {
			for (const spec of Object.values(deps))
				expect(String(spec)).not.toMatch(/workspace:|catalog:/);
		}
		expect(pkg.devDependencies["@oj-module/cli"]).not.toBe("*");
		// runtime 必须显式声明：ojm api 在 Node 侧求值契约时按裸说明符解析
		// `@oj-module/runtime/contract[/errors]`（P1 起 contract 并入 runtime）
		expect(pkg.devDependencies["@oj-module/runtime"]).not.toBe("*");
		// home 首页图表演示的依赖：运行时走宿主 importmap，工程侧只需类型 → devDeps 须钉版
		for (const dep of ["echarts", "echarts-for-react", "react-countup", "dayjs"])
			expect(pkg.devDependencies[dep]).not.toBe("*");
		// personal-center 的 ProForm 依赖（T6）：importmap 供运行时，工程侧钉类型
		expect(pkg.devDependencies["@ant-design/pro-components"]).toBeTruthy();
		expect(pkg.devDependencies["@ant-design/pro-components"]).not.toBe("*");
		// tooling 钉版（T5）：矩阵收录 typescript/@types/react，不再回退 "*"
		expect(pkg.devDependencies.typescript).not.toBe("*");
		expect(pkg.devDependencies["@types/react"]).not.toBe("*");
	});

	it("非空目录无 yes → 拒绝；yes → 幂等补缺且 config.yaml 永不覆盖", async () => {
		const dest = path.join(tmpRoot(), "proj");
		fs.mkdirSync(dest, { recursive: true });
		fs.writeFileSync(path.join(dest, "user-file.txt"), "keep");

		await expect(initProject(dest)).rejects.toThrowError(/非空/);

		await initProject(dest, initOpts);
		const configPath = path.join(dest, "api/config.yaml");
		const configBefore = fs.readFileSync(configPath, "utf-8");
		const tampered = `${configBefore}# tampered\n`;
		fs.writeFileSync(configPath, tampered);

		await initProject(dest, initOpts);

		expect(fs.readFileSync(configPath, "utf-8")).toBe(tampered); // 永不覆盖
		expect(fs.readFileSync(path.join(dest, "user-file.txt"), "utf-8")).toBe("keep");
	});

	it("发布实测 bug1：已有最小 package.json → 合并补缺，既有键永不覆盖", async () => {
		const dest = path.join(tmpRoot(), "proj");
		fs.mkdirSync(dest, { recursive: true });
		fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({
			name: "my-app",
			scripts: { dev: "custom-dev" },
			dependencies: { "@oj-module/cli": "^0.1.0" },
		}, null, 2));

		await initProject(dest, initOpts);

		const pkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf-8"));
		expect(pkg.name).toBe("my-app"); // 既有字段不动
		expect(pkg.scripts.dev).toBe("custom-dev"); // 既有 script 不覆盖
		expect(pkg.scripts.build).toContain("ojm build"); // 缺的补上
		expect(pkg.scripts.preview).toContain("ojm preview");
		expect(pkg.dependencies["@oj-module/cli"]).toBe("^0.1.0"); // 既有依赖不动
		expect(pkg.devDependencies["@oj-module/runtime"]).toBeTruthy();
		// P1：shell 不再是独立包（宿主产物并入 cli），工程 devDeps 不应再出现它
		expect(pkg.devDependencies["@oj-module/shell"]).toBeUndefined();
		// pnpm v11 构建审批只读 pnpm-workspace.yaml 的 allowBuilds 映射
		expect(fs.readFileSync(path.join(dest, "pnpm-workspace.yaml"), "utf-8")).toMatch(/^\s+esbuild:\s*true$/m);
	});

	it("pnpm-workspace.yaml 已存在 → 合并 esbuild 审批，其它键保留", async () => {
		const dest = path.join(tmpRoot(), "proj");
		fs.mkdirSync(dest, { recursive: true });
		// pnpm v11 首次 install 自动生成的形态：占位行 + 策略段
		fs.writeFileSync(path.join(dest, "pnpm-workspace.yaml"), [
			"allowBuilds:",
			"  esbuild: set this to true or false",
			"minimumReleaseAgeExclude:",
			"  - \"@oj-module/cli@0.1.0\"",
			"",
		].join("\n"));

		await initProject(dest, initOpts);

		const yaml = fs.readFileSync(path.join(dest, "pnpm-workspace.yaml"), "utf-8");
		expect(yaml).toMatch(/^\s+esbuild:\s*true$/m); // 占位被填成 true
		expect(yaml).toContain("minimumReleaseAgeExclude"); // 既有段保留
		expect(yaml).toContain("@oj-module/cli@0.1.0");
	});

	it("pnpm-workspace.yaml 无 allowBuilds 段 → 追加；显式 false → 尊重不动", async () => {
		const destA = path.join(tmpRoot(), "proj-a");
		fs.mkdirSync(destA, { recursive: true });
		fs.writeFileSync(path.join(destA, "pnpm-workspace.yaml"), "packages: []\n");
		await initProject(destA, initOpts);
		expect(fs.readFileSync(path.join(destA, "pnpm-workspace.yaml"), "utf-8")).toMatch(/allowBuilds:\n\s+esbuild:\s*true/);

		const destB = path.join(tmpRoot(), "proj-b");
		fs.mkdirSync(destB, { recursive: true });
		fs.writeFileSync(path.join(destB, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: false\n");
		await initProject(destB, initOpts);
		expect(fs.readFileSync(path.join(destB, "pnpm-workspace.yaml"), "utf-8")).toContain("esbuild: false"); // 用户显式选择不动
	});

	it("发布实测 bug2：shell-dist 不可达 → 回退 cli 内置矩阵钉版（发布包形态）", () => {
		// 伪造「发布包」cliRoot：无 shell-dist/ 产物，只有 package.json + vendor
		const fakeCli = path.join(tmpRoot(), "cli");
		fs.mkdirSync(path.join(fakeCli, "vendor"), { recursive: true });
		fs.writeFileSync(path.join(fakeCli, "package.json"), JSON.stringify({ name: "@oj-module/cli", version: "9.9.9" }));
		fs.writeFileSync(path.join(fakeCli, "vendor/host-versions.json"), JSON.stringify({
			matrix: { "react": "19.2.0", "antd": "6.0.0", "@oj-module/runtime": "0.1.0" },
		}));

		const { matrix } = resolveVersionMatrix(fakeCli);
		expect(matrix.react).toBe("19.2.0");
		expect(matrix["@oj-module/runtime"]).toBe("0.1.0");
	});

	it("cli 内置版本矩阵真实存在且含核心项（发布内容物契约）", () => {
		const bundled = JSON.parse(fs.readFileSync(
			path.join(PROJECT_ROOT, "packages/cli/vendor/host-versions.json"),
			"utf-8",
		));
		for (const key of ["react", "antd", "react-router", "@oj-module/runtime", "typescript", "@types/react"])
			expect(bundled.matrix[key]).toBeTruthy();
	});

	it("全新工程落 pnpm-workspace.yaml（pnpm v11 esbuild 构建审批）", async () => {
		const dest = path.join(tmpRoot(), "demo-proj");
		await initProject(dest, initOpts);
		const yaml = fs.readFileSync(path.join(dest, "pnpm-workspace.yaml"), "utf-8");
		expect(yaml).toMatch(/allowBuilds:\n\s+esbuild:\s*true/);
	});
});
