import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initProject, resolveVersionMatrix } from "../../packages/cli/src/init";
import { readOjApiPrefix, readOjPort, readOjServerField } from "../../packages/cli/src/oj-config";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 设计 §3：`ojm init` 产物契约（TDD）。
 *
 * 覆盖：全树关键文件、config.yaml 关键字段（host 127.0.0.1 / port 9778 /
 * api_prefix /api / auth 段 jwt_secret 非占位符）、证书三件套、bin/oj 可执行
 * （oj 经 npm 包 @oj-bin/oj 联网安装，测试注入桩安装器）、非空目录守卫、幂等补缺
 * （config 永不覆盖）。
 *
 * 布局：`src/<name>/{api,web}`（module-root）。config.yaml 与证书目录 `config/`
 * 在工程根——它们必须与 `src/` 同级，否则 oj 的 project root 收缩到 api/、
 * 带 `../` 相对 import 的 handler 会被判 escapes project root（layout.ts 有详述）。
 */

function tmpRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "ojm-init-"));
}

/**
 * 桩 oj 安装器：模拟 @oj-bin/oj 安装产物（二进制 + 版本标记 + devkit）。
 *
 * `-V` 与 `build --help` 都要能应答：重跑 init 时既有 bin/oj 会先过 §7 能力闸门，
 * 只会 echo 的假二进制会拿到「无法解析版本」的告警路径（虽放行，但不是被测形态）。
 */
function fakeOjInstall(binDir: string): Promise<void> {
	fs.mkdirSync(path.join(binDir, "devkit"), { recursive: true });
	fs.writeFileSync(path.join(binDir, "oj"), [
		"#!/bin/sh",
		"if [ \"$1\" = \"-V\" ]; then echo \"oj 0.1.86\"; exit 0; fi",
		"if [ \"$1\" = \"build\" ]; then echo \"      --module-root <MODULE_ROOT>  源码树根\"; exit 0; fi",
		"echo oj",
	].join("\n"));
	fs.chmodSync(path.join(binDir, "oj"), 0o755);
	fs.writeFileSync(path.join(binDir, ".oj-version"), "v0.1.86\n");
	fs.writeFileSync(path.join(binDir, "devkit/SKILL.md"), "skill\n");
	fs.writeFileSync(path.join(binDir, "devkit/api-manual.md"), "manual\n");
	fs.writeFileSync(path.join(binDir, "devkit/global.d.ts"), "types\n");
	fs.writeFileSync(path.join(binDir, "devkit/sql-builder-guide.md"), "guide\n");
	fs.writeFileSync(path.join(binDir, "devkit/oj-test-guide.md"), "guide\n");
	return Promise.resolve();
}

const initOpts = { yes: true, ojInstaller: fakeOjInstall } as const;

describe("initProject", () => {
	it("按设计 §3 生成全栈工程全树", async () => {
		const dest = path.join(tmpRoot(), "demo-proj");
		await initProject(dest, initOpts);

		// 后端（语义断言：模板可能被 lint 重排格式，键值契约不变）
		const config = path.join(dest, "config.yaml");
		expect(readOjServerField(config, "host")).toBe("127.0.0.1");
		expect(readOjPort(config)).toBe(9778);
		expect(readOjApiPrefix(config)).toBe("/api"); // mounts 模型：api 挂载 prefix
		expect(readOjServerField(config, "public_key_path")).toBe("./config/public.pem");
		expect(readOjServerField(config, "certificate_path")).toBe("./config/cert.jws");
		const configText = fs.readFileSync(config, "utf-8");
		expect(configText).toContain("auth:");
		expect(configText).not.toContain("__JWT_SECRET__");
		// users 表归属 _platform 伪模块（§3-D2 归属图单源，参考 oj sample）；
		// DDL 归 migrations（S006 seed 纪律：seed 只放数据，oj build 检查）
		expect(fs.existsSync(path.join(dest, "src/_platform/api/seed.sql"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/_platform/api/migrations/0001__create_users.sql"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/_platform/api/schema.yaml"))).toBe(true);
		// auth 模块（§8：auth 端点是业务路由；anonymous_paths 显式匿名）
		expect(fs.existsSync(path.join(dest, "src/auth/api/manifest.yaml"))).toBe(true);
		// DDD reshape：会话聚合三动词收模块根 api.ts 嵌套组（login/logout/refresh 组名=路径段）
		expect(fs.existsSync(path.join(dest, "src/auth/api/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/auth/api/_shared/session.ts"))).toBe(true);
		expect(fs.readFileSync(path.join(dest, "src/auth/api/manifest.yaml"), "utf-8")).toMatch(/_platform:\s*\^?0\.1\.0/);
		expect(fs.existsSync(path.join(dest, "src/web/api/manifest.yaml"))).toBe(true);
		expect(fs.readFileSync(path.join(dest, "src/web/api/manifest.yaml"), "utf-8")).toMatch(/^name:\s*web/m);

		// 证书三件套（现场签发；config.yaml 在工程根 → 证书落 <根>/config/）
		for (const name of ["private.pem", "public.pem", "cert.jws"])
			expect(fs.existsSync(path.join(dest, "config", name))).toBe(true);

		// tests 分发白名单：业务工程可跑的 scaffold 测试逐条收录……
		expect(fs.existsSync(path.join(dest, "tests/fixture.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "tests/rbac-seed.spec.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "tests/seed-role-accounts.spec.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "tests/lifecycle/trust.spec.ts"))).toBe(true);
		// ……而带 cli 包环境假设的一律不分发（oj-bin 仓夹具路径 / packages/cli 全树私钥扫）：
		// 拷进业务工程即死文件，且重跑 init 会反复复活（oj-wiki 0.2.25 升级实踩）
		for (const banned of [
			"tests/lifecycle/preflight.spec.ts",
			"tests/lifecycle/installer.spec.ts",
			"tests/lifecycle/market-api.spec.ts",
			"tests/lifecycle/steps-fs.spec.ts",
			"tests/lifecycle/sig-fixtures.spec.ts",
			"tests/lifecycle/bootstrap.spec.ts",
		])
			expect(fs.existsSync(path.join(dest, banned))).toBe(false);

		// bin/oj（桩安装器模拟 @oj-bin/oj 产物：可执行 + 版本标记）
		const oj = path.join(dest, "bin/oj");
		expect(fs.existsSync(oj)).toBe(true);
		expect(fs.statSync(oj).mode & 0o111).not.toBe(0);
		expect(fs.readFileSync(path.join(dest, "bin/.oj-version"), "utf-8").trim()).toBe("v0.1.86");

		// devkit 拷贝
		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/SKILL.md"))).toBe(true);
		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/api-manual.md"))).toBe(true);
		// v0.1.82 起 devkit 新增两份专题指南（api-manual/SKILL 引用），有则拷
		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/sql-builder-guide.md"))).toBe(true);
		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/oj-test-guide.md"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "global.d.ts"))).toBe(true);

		// 前端模块与工程文件
		// home 提供 /home：shell 预构建把 VITE_BASE_HOME_PATH 定为 /home，
		// 登录回跳 / logo / tabbar 均指向它，缺则落错误边界
		expect(fs.existsSync(path.join(dest, "src/home/web/entry.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/home/web/pages/index.tsx"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/demo/web/entry.ts"))).toBe(true);
		// login 模块提供 /login：shell 宿主不挂 runtime 内置 baseRoutes，
		// 缺它则登出/回跳登录无路由可跳
		const loginEntry = path.join(dest, "src/login/web/entry.ts");
		expect(fs.existsSync(loginEntry)).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/login/web/pages/login.tsx"))).toBe(true);
		expect(fs.readFileSync(loginEntry, "utf-8")).toContain("path: \"/login\"");
		const modulesConfig = fs.readFileSync(path.join(dest, "web.config.ts"), "utf-8");
		expect(modulesConfig).toContain("\"home\"");
		expect(modulesConfig).toContain("\"login\"");
		// personal-center（设计 T1）：runtime user-menu 固定导航 /personal-center/my-profile，
		// 模板缺它则点击落空（与缺 home/login 同型）
		expect(modulesConfig).toContain("\"personal-center\"");
		expect(fs.existsSync(path.join(dest, "src/personal-center/web/entry.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/personal-center/web/pages/my-profile/index.tsx"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/personal-center/web/locales/zh-CN.json"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/personal-center/web/locales/en-US.json"))).toBe(true);
		// 后端（T2）：manifest + upload handler（handler `.schema` 取代旧 contract.ts）；
		// 生成物（routes.json/openapi.yaml）不进模板，单一事实源改 openapi.json
		expect(fs.existsSync(path.join(dest, "src/personal-center/api/manifest.yaml"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/personal-center/api/contract.ts"))).toBe(false);
		expect(fs.existsSync(path.join(dest, "src/personal-center/api/upload/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/personal-center/api/routes.json"))).toBe(false);
		// 头像上传链路（T3）：users 表补 avatar_base64 列，user-info 返回它
		expect(fs.existsSync(path.join(dest, "src/_platform/api/migrations/0002__add_users_avatar_base64.sql"))).toBe(true);
		expect(fs.readFileSync(path.join(dest, "src/_platform/api/schema.yaml"), "utf-8")).toContain("avatar_base64");
		expect(fs.readFileSync(path.join(dest, "src/web/api/user-info/api.ts"), "utf-8")).toContain("avatar_base64");
		expect(fs.existsSync(path.join(dest, "web.config.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "tsconfig.json"))).toBe(true);
		expect(fs.existsSync(path.join(dest, ".gitignore"))).toBe(true);
		// env.d.ts 提供 import.meta.env 类型，否则生成 client 会让 typecheck 报 TS2339
		expect(fs.existsSync(path.join(dest, "env.d.ts"))).toBe(true);
		const tsconfig = JSON.parse(fs.readFileSync(path.join(dest, "tsconfig.json"), "utf-8"));
		expect(tsconfig.include).toContain("env.d.ts");
		// .ojm-api-exempt.json：内置 auth/web handler 有意无契约，ojm api --check 需豁免清单
		// 新布局在工程根（与 config.yaml 同级），历史布局在 api/ 下——加载器两处都认
		expect(fs.existsSync(path.join(dest, ".ojm-api-exempt.json"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/.ojm-api-exempt.json"))).toBe(false);
		const exempt = JSON.parse(fs.readFileSync(path.join(dest, ".ojm-api-exempt.json"), "utf-8"));
		expect(exempt.modules).toContain("web");
		expect(exempt.paths).toContain("/auth/*");
		// 通知聚合单一属主 = notification 模块（DDD）：root 级 notifications 兜底模块已删，
		// 模板恒注册 provider，兜底端点不可达（2026-10-20 聚合收敛）
		expect(fs.existsSync(path.join(dest, "src/notifications"))).toBe(false);
		// notification 模块（G5 契约化通知互动 + DDD reshape）：表/种子/迁移归属本模块，
		// handler 收模块根嵌套组单文件（notifications 含 read/read-all/clear 子组 +
		// push + "push-broadcast" 字符串键组），_shared/notify 共享发射原语，del/ 例外保留
		expect(fs.readFileSync(path.join(dest, "src/notification/api/manifest.yaml"), "utf-8")).toContain("notifications");
		expect(fs.existsSync(path.join(dest, "src/notification/api/migrations/0001__create_notifications.sql"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/notification/api/seed.sql"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/notification/api/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/notification/api/_shared/notify.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/notification/api/del/api.ts"))).toBe(true);
		const notificationApi = fs.readFileSync(path.join(dest, "src/notification/api/api.ts"), "utf-8");
		for (const marker of ["notifications", "push", "push-broadcast"])
			expect(notificationApi).toContain(marker);
		// 迁移后 notification 走 handler `.schema`（contract.ts 已删），已读/清空原语在 _shared/notify
		const notificationContract = fs.readFileSync(path.join(dest, "src/notification/api/_shared/notify.ts"), "utf-8");
		for (const name of ["markRead", "markAllRead", "clearNotices"])
			expect(notificationContract).toContain(name);
		// web 侧：entry 注册四方法 provider + ojm api 生成 client 签入模板（评审 b5）
		const notificationEntry = fs.readFileSync(path.join(dest, "src/notification/web/entry.ts"), "utf-8");
		for (const name of ["fetchNotifications", "markRead", "markAllRead", "clearAll"])
			expect(notificationEntry).toContain(name);
		expect(fs.existsSync(path.join(dest, "src/notification/web/__client/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/notification/web/__client/api.schemas.ts"))).toBe(true);
		// web.config.ts 必须登记 notification：未登记的模块不加载，provider 不注册，
		// 通知铃将永远停留在内置只读兜底（BDD 5.4#2 的前提）
		expect(modulesConfig).toContain("\"notification\"");
		expect(modulesConfig).toContain("src/notification/web/entry.ts");
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

	/**
	 * 布局契约（设计 v2）：一目录一模块，config.yaml / 证书 / 种子 / 测试在工程根，
	 * 源码面只有 `src/`。旧 `api/src` + `web/src` 双树不得残留——`layout.ts` 判定
	 * 两套源码树并存会直接抛错，用户拿到工程连 `ojm build` 都跑不起来。
	 */
	it("产物是 src/<name>/{api,web} 单树，config/证书/种子/测试在工程根", async () => {
		const dest = path.join(tmpRoot(), "layout");
		await initProject(dest, initOpts);

		// 单一源码树；旧布局的两棵树与 api/ 源码目录都不存在
		expect(fs.existsSync(path.join(dest, "api/src"))).toBe(false);
		expect(fs.existsSync(path.join(dest, "web/src"))).toBe(false);
		// 后端构建产物落点仍是扁平根 dist/api（layout.apiDist 恒为 <project>/dist/api）
		expect(fs.existsSync(path.join(dest, "api"))).toBe(false);

		// 工程根：config.yaml + config/ + 种子 + 后端 tsconfig / vitest / tests / 豁免清单
		for (const rel of [
			"config.yaml",
			"config/private.pem",
			"config/public.pem",
			"config/cert.jws",
			"seed.mysql.sql",
			"seed.pg.sql",
			"vitest.config.ts",
			"src/tsconfig.json",
			"tests",
			".ojm-api-exempt.json",
		])
			expect(fs.existsSync(path.join(dest, rel)), rel).toBe(true);

		// 后端 tsconfig 只收后端（排除 web 侧）；前端 tsconfig 反向排除 api。
		// 排除 glob 必须是「精确一层」：宽 glob 会把「模块名就叫 web」的 src/web/api
		// 整棵排除（实测漏检 3 个后端文件，typecheck 全绿但没检查）。
		const apiTsconfig = JSON.parse(fs.readFileSync(path.join(dest, "src/tsconfig.json"), "utf-8"));
		expect(apiTsconfig.include).toContain(".");
		expect(apiTsconfig.exclude).toContain("*/web");
		const webTsconfig = JSON.parse(fs.readFileSync(path.join(dest, "tsconfig.json"), "utf-8"));
		expect(webTsconfig.exclude).toContain("src/*/api");
		for (const exclude of [[...apiTsconfig.exclude], [...webTsconfig.exclude]])
			expect(exclude.join(",")).not.toContain("**/");

		// 别名在 TS 侧的投影：tsconfig 的 paths 表达不了模块相对解析，且替换值只允许
		// 一个 `*`，只能按模块枚举 → 生成物必须与目标工程的模块清单同源（现场生成，
		// 照拷模板会把 demo/home 这两个模板自运行模块带进来）。
		expect(apiTsconfig.extends).toContain("../tsconfig.paths.json");
		const pathsFile = path.join(dest, "tsconfig.paths.json");
		expect(fs.existsSync(pathsFile)).toBe(true);
		const aliasPaths = JSON.parse(
			fs.readFileSync(pathsFile, "utf-8").replace(/^\s*\/\/.*$/gm, ""),
		).compilerOptions.paths as Record<string, string[]>;
		const apiModules = fs.readdirSync(path.join(dest, "src"))
			.filter(name => fs.existsSync(path.join(dest, "src", name, "api/manifest.yaml")));
		expect(Object.keys(aliasPaths).sort()).toEqual(apiModules.map(name => `#/${name}/*`).sort());
		for (const name of apiModules)
			expect(aliasPaths[`#/${name}/*`]).toEqual([`./src/${name}/api/*`]);
		// 类型兜底：`#*` 的 ambient 声明（非模块文件，放 global.d.ts 里不生效）
		expect(fs.existsSync(path.join(dest, "types/oj-modules.d.ts"))).toBe(true);

		// 每个 src/<name>/ 至少一侧：api/manifest.yaml 或 web/entry.ts（layout 的模块判定口径）
		for (const name of fs.readdirSync(path.join(dest, "src"))) {
			const dir = path.join(dest, "src", name);
			if (!fs.statSync(dir).isDirectory())
				continue;
			const hasApi = fs.existsSync(path.join(dir, "api/manifest.yaml"));
			const hasWeb = fs.existsSync(path.join(dir, "web/entry.ts"));
			expect(hasApi || hasWeb, `src/${name} 既无 api/manifest.yaml 也无 web/entry.ts`).toBe(true);
		}
	});

	/**
	 * 模板仓库内置 demo-only 模块（供 templates 自身当可运行 demo 演示），但
	 * `ojm init` 不得把它们拷进用户工程——拷了会留下「web.config 启用但文件缺失」
	 * 的死条目，工程一开就崩。白名单在 templates/init.include.yaml：demo-only
	 * 模块不收录，故不拷。
	 */
	it("demo-only 模块不进 init 产物，且 web.config.ts 同步剥离对应条目", async () => {
		const dest = path.join(tmpRoot(), "demo-proj");
		await initProject(dest, initOpts);

		// 1) demo-only 模块文件一律不拷
		for (const mod of [
			"src/demo/api",
			"src/home/api",
			"src/about",
			"src/access",
			"src/exception",
			"src/outside",
			"src/route-nest",
		])
			expect(fs.existsSync(path.join(dest, mod))).toBe(false);

		// 1b) demo-only api 模块的前端 __client 生成物同样不拷（旧派生规则）：
		//     client 留着会指向不存在的端点；但 demo/home 的页面源码照拷
		for (const mod of ["src/demo/web/__client", "src/home/web/__client"])
			expect(fs.existsSync(path.join(dest, mod))).toBe(false);
		expect(fs.existsSync(path.join(dest, "src/demo/web/entry.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/home/web/entry.ts"))).toBe(true);

		// 2) 默认模块照常在（oj-market 0.2.8 起默认下发：方案市场前端 +
		//    _platform 市场编排面 /api/_platform/market/*）
		for (const mod of ["src/home/web", "src/demo/web", "src/login/web", "src/notification/web", "src/oj-market/web"])
			expect(fs.existsSync(path.join(dest, mod))).toBe(true);
		//    其 __tests__ 不进脚手架（用户工程无 web 侧 vitest 基建）
		expect(fs.existsSync(path.join(dest, "src/oj-market/web/__tests__"))).toBe(false);
		expect(fs.existsSync(path.join(dest, "src/oj-market/web/entry.ts"))).toBe(true);

		// 3) web.config.ts：demo 条目与 #region 标记一并剥离（不留指向缺失文件的死条目）；
		//    oj-market 条目保留（默认模块，不再走 demo-only 剥离）
		const config = fs.readFileSync(path.join(dest, "web.config.ts"), "utf-8");
		for (const name of ["about", "access", "exception", "outside", "route-nest"])
			expect(config).not.toContain(`"${name}"`);
		expect(config).toContain("\"oj-market\"");
		expect(config).not.toContain("#region demo-only");
		expect(config).not.toContain("#endregion");
		// 剥离不能误伤默认条目
		for (const entry of ["src/home/web/entry.ts", "src/notification/web/entry.ts"])
			expect(config).toContain(entry);

		// 4) openapi.json：demo-only 模块（demo/home）的端点被裁掉——留着会让
		//    新工程一上手跑 `ojm api --check` 就报「有契约无 handler」；白名单内
		//    模块的端点照留
		const openapi = JSON.parse(fs.readFileSync(path.join(dest, "openapi.json"), "utf-8")) as {
			paths: Record<string, unknown>
		};
		const openapiPaths = Object.keys(openapi.paths);
		for (const mod of ["demo", "home"])
			expect(openapiPaths.some(p => p.startsWith(`/api/${mod}/`))).toBe(false);
		expect(openapiPaths.some(p => p.startsWith("/api/system/"))).toBe(true);

		// 5) 模板自运行产物/元数据不泄漏进用户工程：白名单自身、模板的
		//    package.json（由 init 现场生成）、各级 node_modules 均不在拷贝结果里
		expect(fs.existsSync(path.join(dest, "init.include.yaml"))).toBe(false);
		expect(fs.existsSync(path.join(dest, "node_modules"))).toBe(false);
		expect(fs.existsSync(path.join(dest, "src/node_modules"))).toBe(false);
		const pkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf-8"));
		expect(pkg.name).not.toBe("@oj-module/template-demo");
		for (const deps of [pkg.dependencies ?? {}, pkg.devDependencies ?? {}]) {
			for (const spec of Object.values(deps))
				expect(String(spec)).not.toMatch(/workspace:|catalog:/);
		}
	});

	it("非空目录无 yes → 拒绝；yes → 幂等补缺且 config.yaml 永不覆盖", async () => {
		const dest = path.join(tmpRoot(), "proj");
		fs.mkdirSync(dest, { recursive: true });
		fs.writeFileSync(path.join(dest, "user-file.txt"), "keep");

		await expect(initProject(dest)).rejects.toThrowError(/非空/);

		await initProject(dest, initOpts);
		const configPath = path.join(dest, "config.yaml");
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

	/**
	 * pnpm-workspace.yaml 不再由模板拷贝（模板自带一份会让 pnpm 把 templates 当
	 * workspace 根，`cd templates && pnpm i` 找不到父级 catalog），改由 init 生成。
	 */
	it("全新工程无 pnpm-workspace.yaml → init 生成（构建审批 + redocly 钉版）", async () => {
		const dest = path.join(tmpRoot(), "proj-fresh");
		fs.mkdirSync(dest, { recursive: true });
		await initProject(dest, initOpts);
		const yaml = fs.readFileSync(path.join(dest, "pnpm-workspace.yaml"), "utf-8");
		expect(yaml).toMatch(/^\s+esbuild:\s*true$/m);
		expect(yaml).toContain("'@redocly/cli': 2.51.0");
	});

	/**
	 * .gitignore 与 pnpm-workspace.yaml 同型：npm/pnpm pack 会剥离 `.gitignore`
	 * 点文件（0.2.5 发布实测：include 清单收录它 → 安装包缺文件 → readInitInclude
	 * fail-fast → init 整体中断、目标目录留空），故不随模板拷贝，改由 init 生成。
	 */
	it("全新工程由 init 生成 .gitignore；已存在则永不覆盖", async () => {
		const dest = path.join(tmpRoot(), "proj-gitignore");
		await initProject(dest, initOpts);
		const gitignore = path.join(dest, ".gitignore");
		expect(fs.existsSync(gitignore)).toBe(true);
		const text = fs.readFileSync(gitignore, "utf-8");
		// 现场产物不入仓：dev 下载的 bin/oj、sqlite/日志/私钥、各级构建产物。
		// 新布局 config.yaml 在工程根，故 sqlite/logs/证书都相对工程根，不再有 api/ 前缀。
		for (const rule of ["node_modules/", "bin/", "db.sqlite", "logs/", "config/*.pem", "config/cert.jws", "dist/"])
			expect(text).toContain(rule);

		const dest2 = path.join(tmpRoot(), "proj-gitignore-keep");
		fs.mkdirSync(dest2, { recursive: true });
		fs.writeFileSync(path.join(dest2, ".gitignore"), "custom-rules\n");
		await initProject(dest2, initOpts);
		expect(fs.readFileSync(path.join(dest2, ".gitignore"), "utf-8")).toBe("custom-rules\n");
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

	/**
	 * bin/devkit 来自用户本地 oj 版本，旧版没有 v0.1.82 的两份专题指南属正常
	 * 版本 skew——「有则拷、无则跳过」，init 不挂。
	 */
	it("旧版 devkit 缺 v0.1.82 两份专题指南 → init 照常完成，仅少两份文档", async () => {
		const dest = path.join(tmpRoot(), "old-devkit");
		const oldInstall = (binDir: string): Promise<void> => {
			fs.mkdirSync(path.join(binDir, "devkit"), { recursive: true });
			fs.writeFileSync(path.join(binDir, "oj"), [
				"#!/bin/sh",
				"if [ \"$1\" = \"-V\" ]; then echo \"oj 0.1.86\"; exit 0; fi",
				"if [ \"$1\" = \"build\" ]; then echo \"      --module-root <MODULE_ROOT>  源码树根\"; exit 0; fi",
				"echo oj",
			].join("\n"));
			fs.chmodSync(path.join(binDir, "oj"), 0o755);
			fs.writeFileSync(path.join(binDir, ".oj-version"), "v0.1.86\n");
			fs.writeFileSync(path.join(binDir, "devkit/SKILL.md"), "skill\n");
			fs.writeFileSync(path.join(binDir, "devkit/api-manual.md"), "manual\n");
			fs.writeFileSync(path.join(binDir, "devkit/global.d.ts"), "types\n");
			return Promise.resolve();
		};
		await initProject(dest, { yes: true, ojInstaller: oldInstall });

		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/SKILL.md"))).toBe(true);
		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/sql-builder-guide.md"))).toBe(false);
		expect(fs.existsSync(path.join(dest, ".claude/skills/oj-api-dev/oj-test-guide.md"))).toBe(false);
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

/**
 * 凭据密封（oj v0.1.33）：`auth.jwt_secret` 不该明文落盘。init 在 oj 就位后
 * 现场 keygen + seal，把明文换成 `ENC[...]`，并写 `secrets:` 段指向私钥。
 * 失败（oj 缺失/命令不支持）→ 保留明文并告警，init 不因此失败。
 */
describe("initProject 凭据密封", () => {
	function sealableOj(binDir: string) {
		return Promise.resolve().then(() => {
			fs.mkdirSync(binDir, { recursive: true });
			const bin = path.join(binDir, "oj");
			fs.writeFileSync(bin, [
				"#!/bin/sh",
				"if [ \"$1\" = \"-V\" ]; then echo \"oj 0.1.86\"; exit 0; fi",
				"if [ \"$1\" = \"secret\" ] && [ \"$2\" = \"keygen\" ]; then",
				"  printf 'PRIV\\n' > \"$4/secrets-private.pem\"",
				"  printf 'PUB\\n' > \"$4/secrets-public.pem\"",
				"  exit 0",
				"fi",
				"if [ \"$1\" = \"secret\" ] && [ \"$2\" = \"seal\" ]; then",
				"  printf 'ENC[TESTSEALED]\\n'",
				"  exit 0",
				"fi",
				"exit 0",
			].join("\n"));
			fs.chmodSync(bin, 0o755);
		});
	}

	it("oj 可用 → jwt_secret 换成 ENC[...] 并写 secrets 段", async () => {
		const dest = path.join(tmpRoot(), "seal-ok");
		await initProject(dest, { yes: true, ojInstaller: sealableOj });
		const config = fs.readFileSync(path.join(dest, "config.yaml"), "utf-8");
		expect(config).toMatch(/jwt_secret:\s*"?ENC\[TESTSEALED\]"?/);
		expect(config).toMatch(/secrets:/);
		expect(config).toMatch(/private_key_path/);
		// 密钥对落 config/（config.yaml 同级），路径前缀随之从 api/config 改为 config
		expect(config).toContain("./config/secrets-private.pem");
		expect(fs.existsSync(path.join(dest, "config", "secrets-private.pem"))).toBe(true);
	});

	it("oj 不支持 secret（旧版/桩）→ 保留明文且不失败", async () => {
		const dest = path.join(tmpRoot(), "seal-fallback");
		await initProject(dest, initOpts);
		const config = fs.readFileSync(path.join(dest, "config.yaml"), "utf-8");
		expect(config).toMatch(/jwt_secret:\s*[0-9a-f]{32,}/);
		expect(config).not.toMatch(/ENC\[/);
	});
});

/**
 * 设计 §7「双探」/ 评审 BLOCKING #8：已有 `bin/oj` 不再「存在即跳过」。
 *
 * 用户常把旧工程的 `bin/` 整个拷进新目录；早前 init 静默通过，直到 `ojm build`
 * 才死在 `--module-root` 不认——那时模板/证书/package.json 都已写了一半。
 */
describe("initProject 既有 bin/oj 能力闸门", () => {
	/** 桩二进制：`-V` 输出给定版本，其余子命令输出给定帮助文本 */
	function preinstalledOj(version: string, help = "usage: oj\n"): (binDir: string) => Promise<void> {
		return (binDir: string): Promise<void> => {
			fs.mkdirSync(binDir, { recursive: true });
			const bin = path.join(binDir, "oj");
			fs.writeFileSync(bin, [
				"#!/bin/sh",
				`if [ "$1" = "-V" ]; then echo "oj ${version}"; exit 0; fi`,
				`printf '%s\\n' '${help.trim()}'`,
				"exit 0",
			].join("\n"));
			fs.chmodSync(bin, 0o755);
			return Promise.resolve();
		};
	}

	it("既有 bin/oj 低于最低版本 → 抛错且给出 ojm vendor --force 处置", async () => {
		const dest = path.join(tmpRoot(), "old-oj");
		await preinstalledOj("0.1.84")(path.join(dest, "bin"));

		await expect(initProject(dest, { yes: true })).rejects.toThrowError(/低于 ojm 要求的最低版本/);
		await expect(initProject(dest, { yes: true })).rejects.toThrowError(/ojm vendor --force/);
		// 闸门在任何模板写入之前：工程根只有我们伪造的 bin/
		expect(fs.readdirSync(dest)).toEqual(["bin"]);
		expect(fs.existsSync(path.join(dest, "config.yaml"))).toBe(false);
	});

	it("版本够但 --module-root 缺失 → 抛错（声明新、能力旧）", async () => {
		const dest = path.join(tmpRoot(), "caps-miss");
		await preinstalledOj("0.2.0")(path.join(dest, "bin"));

		await expect(initProject(dest, { yes: true })).rejects.toThrowError(/不接受 --module-root/);
	});

	it("版本够且有 --module-root → 放行，走幂等补缺", async () => {
		const dest = path.join(tmpRoot(), "caps-ok");
		await preinstalledOj("0.2.0", "      --module-root <MODULE_ROOT>  源码树根\n")(path.join(dest, "bin"));

		await initProject(dest, { yes: true });
		expect(fs.existsSync(path.join(dest, "config.yaml"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "src/home/web/entry.ts"))).toBe(true);
	});
});
