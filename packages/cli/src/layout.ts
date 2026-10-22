/**
 * 模块工程布局探测（设计 D11，2026-09-11 硬切换；2026-10 增补 module-root）。
 *
 * dev/build/preview 对「源码目录、产物目录、watch 目录」的全部路径取值
 * 一律经此模块，禁止各自手拼——布局分叉点收敛一处。
 *
 * 三种布局（互斥）：
 *   module-root  <project>/src/<name>/{api,web}   新布局：一目录一模块（设计 v2）
 *   new           <project>/web/src/<name>        历史 uni-dev 布局
 *   flat          <project>/web/<name>            框架根仓 dogfooding（产物落 build/）
 *
 * module-root 的判定只认「模块根标记文件」而不是单纯的 src/ 存在性：工程里
 * 常有不属于模块的 src/（脚本、共享库），凭目录名猜会误判。
 * `src/<x>/api/manifest.yaml` 与 `src/<x>/web/entry.ts` 是唯一真源（设计 C-6：
 * 一侧可缺省，两侧皆无则不是模块）。
 *
 * 产物根（2026-10-22 起收进工程根单一 dist/，原 {web,api}/dist 与源码混树）：
 *   dist/api   oj 扁平 release 根（<name>-<version>/ 同层兄弟 + manifests.yaml），三种布局一致
 *   dist/web   站点产物（shell + modules/ + modules.json）；flat 例外：框架根仓维持 build/
 * 产物按模块聚合已被设计 §2.2 否决（实证见该节），禁止在此引入第二套形状。
 *
 * watch 目标绝不含产物目录：若 watch `web/`，重建产物（dist/web）
 * 会反过来触发重建，形成自触发循环（设计 §4）。
 */

import fs from "node:fs";
import path from "node:path";

export type LayoutKind = "module-root" | "new" | "flat";

/** 模块一侧的可缺省组合：两侧皆无不是模块（设计 C-6） */
export interface ModuleSides {
	name: string
	/** 后端源码目录 `<project>/src/<name>/api`（无此侧为 undefined） */
	apiSrc?: string
	/** 前端源码目录 `<project>/src/<name>/web`（无此侧为 undefined） */
	webSrc?: string
}

export interface ProjectLayout {
	kind: LayoutKind
	projectRoot: string
	/** 模块源码目录：module-root → `<project>/src`；new → `<project>/web/src`；flat → `<project>/web` */
	modulesSrc: string
	/** 站点产物根：module-root / new → `<project>/dist/web`；flat → `<project>/build`（框架根仓约定） */
	distDir: string
	/** oj 扁平 release 根：恒为 `<project>/dist/api`（不随布局变化；无布局回退同值） */
	apiDist: string
	/** fs.watch 目标（纯源码，永不落产物） */
	watchTarget: string
	/**
	 * oj 的 `--module-root` 取值（源码树根目录），仅 module-root 有值。
	 *
	 * v0.1.85 语义：在**该目录的子树内递归**找 `manifest.yaml`，命中即停；模块身份取
	 * manifest 的 `name`（目录名只作定位）。它与 `-d`/`--api-path` **互斥**——两者都是
	 * 「源码树根」，同时给会被 clap 拒掉，所以调用方是二选一，不是「-d + 附加旗标」。
	 */
	moduleRoot?: string
}

function isDir(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	}
	catch {
		return false;
	}
}

function isFile(p: string): boolean {
	try {
		return fs.statSync(p).isFile();
	}
	catch {
		return false;
	}
}

/**
 * 扫描 module-root 布局的 `src/`：返回模块清单与「像模块但缺标记文件」的坏目录。
 *
 * 坏目录只在 module-root 被判定为当前布局后才报错（见 resolveLayout），
 * 否则一个恰好带 `src/utils/api/` 的历史工程会被误伤。
 */
function scanModuleRoot(projectRoot: string): { modules: ModuleSides[], broken: string[] } | null {
	const srcDir = path.join(projectRoot, "src");
	if (!isDir(srcDir))
		return null;

	const modules: ModuleSides[] = [];
	const broken: string[] = [];
	// 按名字排序：readdir 的顺序取决于文件系统与创建历史（同一份源码在不同机器上可能不同），
	// 而枚举顺序会进入构建顺序与产物内容——不排序则「同布局两次构建 sha256 相等」无法保证。
	const entries = fs.readdirSync(srcDir, { withFileTypes: true })
		.filter(ent => ent.isDirectory() && !ent.name.startsWith("."))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	for (const ent of entries) {
		const dir = path.join(srcDir, ent.name);
		const apiDir = path.join(dir, "api");
		const webDir = path.join(dir, "web");
		const hasApi = isFile(path.join(apiDir, "manifest.yaml"));
		const hasWeb = isFile(path.join(webDir, "entry.ts"));
		if (!hasApi && !hasWeb) {
			// 只把「有 api/ 或 web/ 子目录但缺标记」算坏目录；纯共享库目录（无两者）静默跳过
			if (isDir(apiDir) || isDir(webDir))
				broken.push(ent.name);
			continue;
		}
		modules.push({
			name: ent.name,
			apiSrc: hasApi ? apiDir : undefined,
			webSrc: hasWeb ? webDir : undefined,
		});
	}
	return { modules, broken };
}

/** 历史布局：`web/src` 为 uni-dev 工程；`web/<name>/entry.ts` 为框架根仓 */
function detectLegacyKind(projectRoot: string): LayoutKind | null {
	if (isDir(path.join(projectRoot, "web", "src")))
		return "new";
	const webDir = path.join(projectRoot, "web");
	if (isDir(webDir)) {
		for (const ent of fs.readdirSync(webDir, { withFileTypes: true })) {
			if (ent.isDirectory() && isFile(path.join(webDir, ent.name, "entry.ts")))
				return "flat";
		}
	}
	return null;
}

/**
 * 探测布局；工程里没有任何模块源码时返回 null（供 `buildBackend` 这类「没有源码就
 * 跳过」的调用方使用）。布局存在但**自相矛盾**（双树并存 / src 下有坏模块目录）仍抛错。
 */
export function tryResolveLayout(projectRoot: string): ProjectLayout | null {
	const scanned = scanModuleRoot(projectRoot);
	const isModuleRoot = !!scanned && scanned.modules.length > 0;
	const legacyKind = detectLegacyKind(projectRoot);

	// 互斥：两套源码树同时存在时静默选一个，会让 `ojm build` 构建 A 而 `ojm dev` 预览 B
	if (isModuleRoot && legacyKind) {
		throw new Error(
			`[ojm] ${projectRoot} 同时存在两套模块源码树：src/<name>/{api,web} 与 `
			+ `${legacyKind === "new" ? "web/src/<name>" : "web/<name>"}。\n`
			+ "布局互斥，无法判断以哪套为准——请显式移除其中一套后重试。",
		);
	}

	if (scanned && (isModuleRoot || legacyKind === null) && scanned.broken.length > 0) {
		throw new Error(
			`[ojm] ${projectRoot}/src 下这些目录既无 api/manifest.yaml 也无 web/entry.ts：\n${
				scanned.broken.map(n => `  - src/${n}/`).join("\n")}\n`
				+ "module-root 布局里一个目录 = 一个模块，至少需要其中一侧；"
				+ "若这些目录不是模块（脚本、共享库），请移到 src/ 之外。",
		);
	}

	if (isModuleRoot) {
		return {
			kind: "module-root",
			projectRoot,
			modulesSrc: path.join(projectRoot, "src"),
			distDir: path.join(projectRoot, "dist", "web"),
			apiDist: path.join(projectRoot, "dist", "api"),
			watchTarget: path.join(projectRoot, "src"),
			moduleRoot: path.join(projectRoot, "src"),
		};
	}

	if (legacyKind === "new") {
		return {
			kind: "new",
			projectRoot,
			modulesSrc: path.join(projectRoot, "web", "src"),
			distDir: path.join(projectRoot, "dist", "web"),
			apiDist: path.join(projectRoot, "dist", "api"),
			watchTarget: path.join(projectRoot, "web", "src"),
		};
	}

	// 框架根仓：平铺 web/<name>/（readModuleDefinition 的裸说明符扫描复用此探测，B10）
	if (legacyKind === "flat") {
		return {
			kind: "flat",
			projectRoot,
			modulesSrc: path.join(projectRoot, "web"),
			distDir: path.join(projectRoot, "build"),
			apiDist: path.join(projectRoot, "dist", "api"),
			watchTarget: path.join(projectRoot, "web"),
		};
	}

	return null;
}

export function resolveLayout(projectRoot: string): ProjectLayout {
	const layout = tryResolveLayout(projectRoot);
	if (layout)
		return layout;
	throw new Error(
		`[ojm] ${projectRoot} 下未发现模块源码（硬切换后只认 web/src；2026-10 起也认 src/<name>/{api,web}）：\n`
		+ "  - 新布局：src/<name>/{api/manifest.yaml 或 web/entry.ts}\n"
		+ "  - 历史布局：web/src/<name>（uni-dev）或 web/<name>/entry.ts（框架根仓）\n"
		+ "存量 modules/ 工程请迁移：modules/ → web/，modules.config.ts → web.config.ts。",
	);
}

/**
 * 枚举 module-root 布局的模块（设计 C-6：真源是标记文件，不是人工登记的 web.config.ts）。
 * 历史布局的模块顺序由 `web.config.ts` 的 `modules` 决定，此处不适用。
 */
export function scanModules(layout: ProjectLayout): ModuleSides[] {
	if (layout.kind !== "module-root")
		throw new Error(`[ojm] scanModules 只适用于 module-root 布局，当前为 ${layout.kind}`);
	return scanModuleRoot(layout.projectRoot)?.modules ?? [];
}

/** 契约工具的处理单元：模块名 + 该模块 api 侧目录（handler 目录镜像的根） */
export interface ApiModuleRoot {
	name: string
	dir: string
}

/**
 * 历史布局的模块 api 根：`<project>/api/src/<name>`。
 *
 * 单独导出是因为**纯后端工程**可能只有 `api/src` 而没有 `web/src`——`tryResolveLayout`
 * 会返回 null，契约工具仍要能对账。
 */
export function legacyApiModuleRoots(projectRoot: string): ApiModuleRoot[] {
	const root = path.join(projectRoot, "api", "src");
	if (!isDir(root))
		return [];
	return fs.readdirSync(root, { withFileTypes: true })
		.filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
		.map(entry => ({ name: entry.name, dir: path.join(root, entry.name) }));
}

/**
 * 枚举后端模块的 api 根，供 `ojm api` 生成 / `--check` 对账**按模块**扫描。
 *
 * 为什么不直接 walk `apiModulesSrc(layout)`：module-root 布局的树根是 `src`，模块的
 * api 侧在 `<src>/<name>/api`，中间那层 `api` 是**布局分隔符、不是路由段**。拿 `src`
 * 当扫描根会双重出错——路由镜像多出 `api` 段（`system/api/users` ≠ 真实 `system/users`），
 * 且 `src/<name>/web/__client/api.ts` 这种前端生成物也会被当 handler 扫进来。
 *
 * module-root → 按 `<name>/api/manifest.yaml` 判模块（与 build 同源，name 取 manifest）；
 * 历史布局    → `<project>/api/src` 的一级目录即模块。
 */
export function apiModuleRoots(layout: ProjectLayout): ApiModuleRoot[] {
	if (layout.kind !== "module-root")
		return legacyApiModuleRoots(layout.projectRoot);
	return scanModules(layout)
		.filter((m): m is ModuleSides & { apiSrc: string } => !!m.apiSrc)
		.map(m => ({ name: m.name, dir: m.apiSrc }));
}

/** `<project>/src/<name>` */
export function moduleDir(layout: ProjectLayout, name: string): string {
	return path.join(layout.modulesSrc, name);
}

/**
 * 后端源码根。module-root 为 `<modulesSrc>/<name>/api`（模块的 api 侧目录）；
 * 历史布局为 `<project>/api/src/<name>`——不在 modulesSrc 之下，必须走 projectRoot。
 */
export function apiSrcOf(layout: ProjectLayout, name: string): string {
	return layout.kind === "module-root"
		? path.join(layout.modulesSrc, name, "api")
		: path.join(layout.projectRoot, "api", "src", name);
}

/**
 * 后端源码的**根**目录：
 *   module-root → `<project>/src`（oj 的 `--module-root` 取源码树根，模块在每层 api 子目录）
 *   历史布局    → `<project>/api/src`（oj 的 `-d` / `--api-path` 取模块目录的父级）
 */
export function apiModulesSrc(layout: ProjectLayout): string {
	return layout.kind === "module-root"
		? layout.modulesSrc
		: path.join(layout.projectRoot, "api", "src");
}

/** 前端源码目录（历史布局与模块目录同体） */
export function webSrcOf(layout: ProjectLayout, name: string): string {
	return layout.kind === "module-root"
		? path.join(layout.modulesSrc, name, "web")
		: path.join(layout.modulesSrc, name);
}

export function resolveWatchTarget(projectRoot: string): string {
	return resolveLayout(projectRoot).watchTarget;
}

/**
 * 定位工程 config.yaml。
 *
 * 唯一规范位置由布局决定：
 *   module-root → `<project>/config.yaml`
 *   历史布局    → `<project>/api/config.yaml`
 *
 * module-root 下没有回退到 `api/config.yaml`：oj 把「项目根」锚定在 **config 文件所在目录**，
 * 相对 import 被钳制在该根内（devkit 手册第 5 章）。源码搬到 `src/` 而 config 留在 `api/`
 * 时，project root 收缩成 `<project>/api`，`src/` 整体落到根之外——凡是带 `../` 相对 import
 * 的 handler 在 `ojm dev` 下会被判 `escapes project root` 而整条路由加载失败
 * （实测：26 个 api 文件 → 只剩 8 个，18 条路由被跳过）。回退会把这个陷阱伪装成「能跑」。
 */
export function resolveConfigPath(projectRoot: string): string {
	const rootConfig = path.join(projectRoot, "config.yaml");
	if (isFile(rootConfig))
		return rootConfig;
	const legacyConfig = path.join(projectRoot, "api", "config.yaml");
	// 源码已是 module-root 但 config 还在 api/ ⇒ 迁移未完成。此时回退会踩上面那个陷阱，
	// 且症状是「部分路由静默消失」，比直接失败更难排查。
	if (isFile(legacyConfig) && (scanModuleRoot(projectRoot)?.modules.length ?? 0) > 0) {
		throw new Error(
			`[ojm] ${projectRoot} 已是 src/<name>/{api,web} 布局，但 config.yaml 仍在 api/ 下。\n`
			+ `请移到 ${rootConfig}（证书目录随之变为 ${path.join(projectRoot, "config")}）。\n`
			+ "oj 以 config 所在目录为 project root：config 留在 api/ 会把 src/ 甩到根外，"
			+ "带 ../ 相对 import 的 handler 会被判 escapes project root 而整条路由不加载。",
		);
	}
	return legacyConfig;
}

/**
 * 证书与密钥的唯一落点：config.yaml 同级的 `config/` 子目录。
 *
 * module-root → `<project>/config/`；历史布局 → `<project>/api/config/`。
 *
 * 三个入口都指向这里，别再各自手拼：
 *   ① `server.public_key_path`     → ./config/public.pem（oj 验签公钥）
 *   ② `server.certificate_path`    → ./config/cert.jws（oj 拒启闸门）
 *   ③ `secrets.private/public_key_path` → ./config/secrets-{private,public}.pem（jwt_secret 密封密钥对）
 * 另加签发私钥 `private.pem`（config 不引用，仅 mintDevCert 产出）。
 *
 * 由 config 位置派生，config 若挪位这里自动跟随——不需要第二处硬编码。
 */
export function resolveCertDir(projectRoot: string): string {
	return path.join(path.dirname(resolveConfigPath(projectRoot)), "config");
}
