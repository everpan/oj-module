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
		expect(readOjApiPrefix(config)).toBe("/api"); // mounts 模型：api 挂载 prefix
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
		// DDD reshape：会话聚合三动词收模块根 api.ts 嵌套组（login/logout/refresh 组名=路径段）
		expect(fs.existsSync(path.join(dest, "api/src/auth/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/auth/_shared/session.ts"))).toBe(true);
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
		expect(fs.existsSync(path.join(dest, "web/src/home/entry.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "web/src/home/pages/index.tsx"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "web/src/demo/entry.ts"))).toBe(true);
		// login 模块提供 /login：shell 宿主不挂 runtime 内置 baseRoutes，
		// 缺它则登出/回跳登录无路由可跳
		const loginEntry = path.join(dest, "web/src/login/entry.ts");
		expect(fs.existsSync(loginEntry)).toBe(true);
		expect(fs.existsSync(path.join(dest, "web/src/login/pages/login.tsx"))).toBe(true);
		expect(fs.readFileSync(loginEntry, "utf-8")).toContain("path: \"/login\"");
		const modulesConfig = fs.readFileSync(path.join(dest, "web.config.ts"), "utf-8");
		expect(modulesConfig).toContain("\"home\"");
		expect(modulesConfig).toContain("\"login\"");
		// personal-center（设计 T1）：runtime user-menu 固定导航 /personal-center/my-profile，
		// 模板缺它则点击落空（与缺 home/login 同型）
		expect(modulesConfig).toContain("\"personal-center\"");
		expect(fs.existsSync(path.join(dest, "web/src/personal-center/entry.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "web/src/personal-center/pages/my-profile/index.tsx"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "web/src/personal-center/locales/zh-CN.json"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "web/src/personal-center/locales/en-US.json"))).toBe(true);
		// 后端（T2）：manifest + upload handler（handler `.schema` 取代旧 contract.ts）；
		// 生成物（routes.json/openapi.yaml）不进模板，单一事实源改 openapi.json
		expect(fs.existsSync(path.join(dest, "api/src/personal-center/manifest.yaml"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/personal-center/contract.ts"))).toBe(false);
		expect(fs.existsSync(path.join(dest, "api/src/personal-center/upload/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/personal-center/routes.json"))).toBe(false);
		// 头像上传链路（T3）：users 表补 avatar_base64 列，user-info 返回它
		expect(fs.existsSync(path.join(dest, "api/src/_platform/migrations/0002__add_users_avatar_base64.sql"))).toBe(true);
		expect(fs.readFileSync(path.join(dest, "api/src/_platform/schema.yaml"), "utf-8")).toContain("avatar_base64");
		expect(fs.readFileSync(path.join(dest, "api/src/web/user-info/api.ts"), "utf-8")).toContain("avatar_base64");
		expect(fs.existsSync(path.join(dest, "web.config.ts"))).toBe(true);
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
		// notifications 模块（root 级兜底，只读）：runtime 通知铃未接 provider 时的
		// 回落端点。G5 起不再持有表结构/种子（迁归 notification 模块，评审 b3 决策），
		// 但查询须返回 id（G4 NotificationItem.id 必填）
		expect(fs.existsSync(path.join(dest, "api/src/notifications/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/notifications/migrations/0001__create_notifications.sql"))).toBe(false);
		expect(fs.readFileSync(path.join(dest, "api/src/notifications/api.ts"), "utf-8")).toContain("id: Number(r.id)");
		// notification 模块（G5 契约化通知互动 + DDD reshape）：表/种子/迁移归属本模块，
		// handler 收模块根嵌套组单文件（notifications 含 read/read-all/clear 子组 +
		// push + "push-broadcast" 字符串键组），_shared/notify 共享发射原语，del/ 例外保留
		expect(fs.readFileSync(path.join(dest, "api/src/notification/manifest.yaml"), "utf-8")).toContain("notifications");
		expect(fs.existsSync(path.join(dest, "api/src/notification/migrations/0001__create_notifications.sql"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/notification/seed.sql"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/notification/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/notification/_shared/notify.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "api/src/notification/del/api.ts"))).toBe(true);
		const notificationApi = fs.readFileSync(path.join(dest, "api/src/notification/api.ts"), "utf-8");
		for (const marker of ["notifications", "push", "push-broadcast"])
			expect(notificationApi).toContain(marker);
		// 迁移后 notification 走 handler `.schema`（contract.ts 已删），已读/清空原语在 _shared/notify
		const notificationContract = fs.readFileSync(path.join(dest, "api/src/notification/_shared/notify.ts"), "utf-8");
		for (const name of ["markRead", "markAllRead", "clearNotices"])
			expect(notificationContract).toContain(name);
		// web 侧：entry 注册四方法 provider + ojm api 生成 client 签入模板（评审 b5）
		const notificationEntry = fs.readFileSync(path.join(dest, "web/src/notification/entry.ts"), "utf-8");
		for (const name of ["fetchNotifications", "markRead", "markAllRead", "clearAll"])
			expect(notificationEntry).toContain(name);
		expect(fs.existsSync(path.join(dest, "web/src/notification/__client/api.ts"))).toBe(true);
		expect(fs.existsSync(path.join(dest, "web/src/notification/__client/api.schemas.ts"))).toBe(true);
		// web.config.ts 必须登记 notification：未登记的模块不加载，provider 不注册，
		// 通知铃将永远停留在内置只读兜底（BDD 5.4#2 的前提）
		expect(modulesConfig).toContain("\"notification\"");
		expect(modulesConfig).toContain("web/src/notification/entry.ts");
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
	 * 模板仓库内置 demo-only 模块（供 templates 自身当可运行 demo 演示），但
	 * `ojm init` 不得把它们拷进用户工程——拷了会留下「web.config 启用但文件缺失」
	 * 的死条目，工程一开就崩。排除清单在 templates/init.exclude.yaml。
	 */
	it("demo-only 模块不进 init 产物，且 web.config.ts 同步剥离对应条目", async () => {
		const dest = path.join(tmpRoot(), "demo-proj");
		await initProject(dest, initOpts);

		// 1) demo-only 模块文件一律不拷
		for (const mod of [
			"api/src/demo",
			"api/src/home",
			"web/src/about",
			"web/src/access",
			"web/src/exception",
			"web/src/outside",
			"web/src/route-nest",
			"web/src/oj-market",
		])
			expect(fs.existsSync(path.join(dest, mod))).toBe(false);

		// 2) 默认模块照常在
		for (const mod of ["web/src/home", "web/src/demo", "web/src/login", "web/src/notification"])
			expect(fs.existsSync(path.join(dest, mod))).toBe(true);

		// 3) web.config.ts：demo 条目与 #region 标记一并剥离（不留指向缺失文件的死条目）
		const config = fs.readFileSync(path.join(dest, "web.config.ts"), "utf-8");
		for (const name of ["about", "access", "exception", "outside", "route-nest", "oj-market"])
			expect(config).not.toContain(`"${name}"`);
		expect(config).not.toContain("#region demo-only");
		expect(config).not.toContain("#endregion");
		// 剥离不能误伤默认条目
		for (const entry of ["web/src/home/entry.ts", "web/src/notification/entry.ts"])
			expect(config).toContain(entry);

		// 4) 运行期专属产物/模板元数据不泄漏进用户工程
		expect(fs.existsSync(path.join(dest, "init.exclude.yaml"))).toBe(false);
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
		const config = fs.readFileSync(path.join(dest, "api/config.yaml"), "utf-8");
		expect(config).toMatch(/jwt_secret:\s*"?ENC\[TESTSEALED\]"?/);
		expect(config).toMatch(/secrets:/);
		expect(config).toMatch(/private_key_path/);
		expect(fs.existsSync(path.join(dest, "api/config", "secrets-private.pem"))).toBe(true);
	});

	it("oj 不支持 secret（旧版/桩）→ 保留明文且不失败", async () => {
		const dest = path.join(tmpRoot(), "seal-fallback");
		await initProject(dest, initOpts);
		const config = fs.readFileSync(path.join(dest, "api/config.yaml"), "utf-8");
		expect(config).toMatch(/jwt_secret:\s*[0-9a-f]{32,}/);
		expect(config).not.toMatch(/ENC\[/);
	});
});
