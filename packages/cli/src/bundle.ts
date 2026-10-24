// 方案包构建（P1-11，`ojm build --bundle`）：bundle 级契约校验（fail-fast 先于打包）
// → 组装 tgz 内布局（契约 §2.9）→ 确定性打包（C2-32）+ sha256。
// bundle 级契约文件名：解决方案优先 `solution.yaml`；旧方案回退 `manifest.yaml`。
// 之所以用 solution.yaml 而非根目录 manifest.yaml：oj 按 `manifest.yaml` 枚举发现 api 后端模块
// （模块级 `src/<name>/api/manifest.yaml`），根目录再放一份 bundle 契约会污染后端的「搜索枚举」，
// 让 oj 误把 bundle 契约当 api 模块——故用独立文件名隔开两条枚举（避免后端搜索枚举与 bundle 冲突）。
//
// 多方案（2026-10-22，docs/plans/2026-10-22-1640-multi-solution-bundle-design.md）：
// 一个脚手架可有多份用户方案，各自一份模块级契约。契约解析优先级矩阵：
//   --bundle <name> → src/<name>/solution.yaml（无则 manifest.yaml 回退）；
//                     未命中再比对工程根契约的 name === <name>；都不中 → 报错。
//                     内置名拒绝（第一方请在框架仓模板工程打包——那里无 builtin 清单）。
//   无参 + 工程根契约 → 只打根契约，src 契约被跳过打 hint。根 solution.yaml 场景与旧行为
//                     逐字节一致；根 manifest.yaml 与 src 模块契约并存时旧版取 src 契约
//                     （旧优先级 ②>③）、现取根契约——多方案矩阵定版「根压 src」（B11）。
//   无参 + 无根契约   → 收集全部非内置模块级契约逐个打包；
//                     零份用户契约 → 友好报错指向 `ojm new`
//   模块级契约强校验 name === 目录名（B8；跨契约查重因 B8 不可达已不实现，见计划文档 B7 决策）。
//   两段式：全部校验（纯读零写盘）先于全部组装——校验失败 dist/ 零增量，
//   发布者不会把半截批次扫进 CDN 索引（build-index 全量收目录）。
//
// 组装映射（对齐 P1-9 staging copy 源一层定版，unpack 布局即安装器 extract 段消费面）：
//   <project>/solution.yaml | manifest.yaml          → 工程根契约（旧单方案写法）
//   <project>/src/<模块>/solution.yaml | manifest.yaml → 模块级契约（绝不进 <模块>/api/，§1.2 红线）
//   任一处均 → <name>-<version>/manifest.yaml（Form A；tgz 内名固定为 manifest.yaml）
//   <project>/dist/api/<name>-<version>/        → <name>-<version>/api/<name>-<version>/（oj build 产物原样，C2-31 分层核对）
//   <project>/dist/web/modules/<name>/          → <name>-<version>/web/modules/<name>/（只入包方案自己的模块；
//                                                 web.entry/css 存在性复核）
// 红线：modules.json 禁入包（C2-31——该清单由安装器在目标站点 upsert，防覆盖宿主清单）；
// 文件面契约（tables↔schema.yaml、locales 双语齐备）构建期 fail-fast（契约 §4.1 构建列）。
import type { ProjectLayout } from "./layout";
import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { readModuleDefinition } from "./build";
import { readBuiltinModules } from "./builtin";
import { createDeterministicTgz } from "./deterministic-tar";
import { apiSrcOf, resolveLayout, webSrcOf } from "./layout";
import { assertValidSolutionName, checkLocalesComplete, checkTablesAgainstSchema, isReferenceApiForm, NAME_RE, parseManifest, referencedI18nKeys, validateContract } from "./manifest-contract";
import { deriveManifestRoutes, reconcileManifestRoutes } from "./manifest-routes-derive";

export interface BundleBuildResult {
	tgz: string
	sha256: string
	name: string
	version: string
}

/**
 * 方案名正则（`--bundle <name>` / `ojm new <name>` 入口校验共用，DRY）：
 * 与契约 C2-01 同一条（小写字母开头 kebab-case，≤64）——入口先校验，
 * 契约校验再做正式判罚；挡住 ../ 路径穿越与引号/换行注入。
 * 校验函数本体在 manifest-contract.ts（new 入口不拖入打包模块图），此处 re-export 兼容既有引用。
 */
export const SOLUTION_NAME_RE = NAME_RE;
export { assertValidSolutionName } from "./manifest-contract";

/** 打包目标：一份契约 = 一个方案包 */
interface BundleTarget {
	/** 契约文件路径（solution.yaml 或 manifest.yaml） */
	contractPath: string
	/** 模块级契约所在 src/<name> 目录名（工程根契约为 undefined） */
	moduleDir?: string
}

/**
 * 收集模块级契约（`src/<name>/` 根下，solution.yaml 优先于 manifest.yaml 回退；
 * 绝不进 `<模块>/api/`——与 oj 的 api 枚举撞车红线，§1.2）。按目录名排序保证确定性。
 */
function collectModuleContracts(projectRoot: string): BundleTarget[] {
	const srcDir = path.join(projectRoot, "src");
	if (!fs.existsSync(srcDir))
		return [];
	const out: BundleTarget[] = [];
	for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
		if (!e.isDirectory() || e.name.startsWith("."))
			continue;
		const dir = path.join(srcDir, e.name);
		const sol = path.join(dir, "solution.yaml");
		const man = path.join(dir, "manifest.yaml");
		if (fs.existsSync(sol))
			out.push({ contractPath: sol, moduleDir: e.name });
		else if (fs.existsSync(man))
			out.push({ contractPath: man, moduleDir: e.name });
	}
	out.sort((a, b) => (a.moduleDir! < b.moduleDir! ? -1 : a.moduleDir! > b.moduleDir! ? 1 : 0));
	return out;
}

/** 读契约 name 用于优先级矩阵的快速比对（坏契约不在此处报错——planBundle 会给正式错误） */
function peekContractName(contractPath: string): string | undefined {
	try {
		const parsed = parseManifest(fs.readFileSync(contractPath, "utf8"));
		return parsed.ok ? (parsed.manifest.name as string) : undefined;
	}
	catch {
		return undefined;
	}
}

/**
 * 契约解析复数化（优先级矩阵见文件头注释）。
 * 内置排除只是便利机制不是安全边界：伪造/删除名单的最坏后果在打包侧，
 * 安装侧信任链（签名 + 信任库，fail-closed）与它无关。
 */
function resolveContractTargets(projectRoot: string, name?: string): BundleTarget[] {
	const builtin = readBuiltinModules(projectRoot);
	const moduleContracts = collectModuleContracts(projectRoot);
	const rootSolution = path.join(projectRoot, "solution.yaml");
	const rootManifest = path.join(projectRoot, "manifest.yaml");
	const rootContract = fs.existsSync(rootSolution) ? rootSolution : fs.existsSync(rootManifest) ? rootManifest : undefined;

	// --bundle <name>：先按目录名选模块级契约，再比对根契约 name
	if (name !== undefined) {
		assertValidSolutionName(name, "--bundle <name>");
		const hit = moduleContracts.find(c => c.moduleDir === name);
		if (hit) {
			if (builtin.has(name)) {
				throw new Error(
					`[ojm] 「${name}」是框架自带方案，不参与用户打包。`
					+ "第一方发布请在框架仓模板工程打包（模板工程无内置名单，走全量打包路径）。",
				);
			}
			return [hit];
		}
		if (rootContract) {
			const rootName = peekContractName(rootContract);
			if (rootName === undefined) {
				throw new Error(
					`[ojm] 方案包构建失败：工程根契约 ${path.basename(rootContract)} 存在但无法解析`
					+ "（name 缺失或文件损坏）——请先修复它，或显式给出 src/<name>/solution.yaml。",
				);
			}
			if (rootName === name) {
				if (builtin.has(name)) {
					console.warn(
						`[ojm] ⚠️ 工程根契约 name「${name}」与框架自带方案同名——`
						+ "确认你要分发的是自有方案而非自带模块的构建产物。",
					);
				}
				return [{ contractPath: rootContract }];
			}
		}
		throw new Error(
			`[ojm] 方案包构建失败：未找到「${name}」的契约`
			+ `（期望 src/${name}/solution.yaml，或工程根契约 name === "${name}"）。`,
		);
	}

	// 无参 + 工程根契约：旧单方案行为零变化（根优先于一切模块级契约）
	if (rootContract) {
		if (moduleContracts.length > 0) {
			console.log(
				`[ojm] 工程根契约优先：跳过 src/ 下 ${moduleContracts.length} 份模块级契约`
				+ "（用 ojm build --bundle <name> 单独打包其中一份）",
			);
		}
		const rootName = peekContractName(rootContract);
		if (rootName !== undefined && builtin.has(rootName)) {
			console.warn(
				`[ojm] ⚠️ 工程根契约 name「${rootName}」与框架自带方案同名——`
				+ "确认你要分发的是自有方案而非自带模块的构建产物。",
			);
		}
		return [{ contractPath: rootContract }];
	}

	// 无参 + 无根契约：全部非内置模块级契约
	for (const c of moduleContracts.filter(c => builtin.has(c.moduleDir!)))
		console.log(`[ojm] 跳过框架自带方案：${c.moduleDir}（不参与用户打包）`);
	const userContracts = moduleContracts.filter(c => !builtin.has(c.moduleDir!));
	if (userContracts.length === 0) {
		throw new Error(
			"[ojm] 方案包构建失败：没有可打包的用户方案（脚手架自带方案不参与打包）。"
			+ "用 ojm new <name> 创建方案后再打包。",
		);
	}
	return userContracts;
}

/** 校验段产物：一份通过全部构建期校验、待组装的方案 */
interface BundlePlan {
	manifest: Record<string, unknown>
	contractPath: string
	moduleDir?: string
	name: string
	version: string
}

/**
 * 校验段（纯读、零写盘）：契约解析 → routes 派生 → 契约校验 → 文件面校验。
 * 模块级契约强校验 name === 目录名（--bundle <name> 按目录名选契约，
 * 产物定位/入口派生全用契约 name，两者不一致会打出名字与目录对不上的包）。
 */
async function planBundle(projectRoot: string, layout: ProjectLayout, target: BundleTarget): Promise<BundlePlan> {
	const parsed = parseManifest(fs.readFileSync(target.contractPath, "utf8"));
	if (!parsed.ok)
		throw new Error(`[ojm] 方案包构建失败：${parsed.error}`);
	const m = parsed.manifest;
	const name = m.name as string;

	if (target.moduleDir !== undefined && name !== target.moduleDir) {
		throw new Error(
			`[ojm] 方案包构建失败：${target.contractPath} 的 name「${name}」与目录名「${target.moduleDir}」不一致`
			+ "（module-root 下契约与模块同位同名）。",
		);
	}

	// R5：manifest.routes 由 entry.ts 路由 handle 自动派生（单一真源），覆盖手工书写。
	// 仅当 entry.ts 声明了 category 路由才覆盖；否则保留 manifest 既有 routes（未迁移方案兼容）。
	// entry 读不出来（如第三依赖未装）时软降级：沿用既有 routes，不阻断打包。
	const entryFile = path.join(webSrcOf(layout, name), "entry.ts");
	if (fs.existsSync(entryFile)) {
		try {
			const def = await readModuleDefinition(entryFile, projectRoot);
			const derived = deriveManifestRoutes(def);
			const { routes, warnings } = reconcileManifestRoutes(
				Array.isArray(m.routes) ? m.routes : [],
				derived,
			);
			for (const w of warnings)
				console.warn(w);
			m.routes = routes;
		}
		catch (e) {
			console.warn(`[ojm] ⚠️ 无法从 entry.ts 派生 routes（${e instanceof Error ? e.message : String(e)}），沿用 manifest.yaml 既有 routes`);
		}
	}

	const violations = validateContract(m);
	if (violations.length > 0) {
		throw new Error(`[ojm] 方案包构建失败：manifest.yaml 契约校验未通过（${violations.length} 项违规，全量列出）：\n${violations.map(x => `- ${x}`).join("\n")}`);
	}
	// R2.2：引用式 solution 提示——api.tables/api.deps 缺省 = 引用包内 manifest.yaml（非漏配）
	if (isReferenceApiForm(m.api)) {
		console.log(
			`[ojm] 引用式方案：api.tables/api.deps 缺省，引用包内 api/${String(m.name)}-${String(m.version)}/manifest.yaml`
			+ "（安装期 C2-31 复核其存在，依赖装配据其回读，非漏配）",
		);
	}
	const version = m.version as string;

	// 文件面契约（§4.1 构建列专属执行点；manifest 内在规则已在 validateContract 全量通过）
	const fileViolations = [
		...checkTables(m, layout, name),
		...checkLocales(m, layout, name),
	];
	if (fileViolations.length > 0) {
		throw new Error(`[ojm] 方案包构建失败：文件面契约未通过（${fileViolations.length} 项，全量列出）：\n${fileViolations.map(x => `- ${x}`).join("\n")}`);
	}

	// order <200 仅构建期 lint 警告不阻断（C2-17：框架项保留 <200 间隔带）
	const routes = Array.isArray(m.routes) ? m.routes as Record<string, unknown>[] : [];
	for (const r of routes) {
		const order = r.order;
		if (typeof order === "number" && order < 200) {
			console.warn(`[ojm] ⚠️ route「${String(r.path)}」order=${order} <200（框架项保留间隔带，建议 ≥200；仅警告不阻断）`);
		}
	}

	return { manifest: m, contractPath: target.contractPath, moduleDir: target.moduleDir, name, version };
}

/**
 * 组装段（写盘）：staging 单根 <name>-<version>/ → 红线自检 → 确定性 tgz + sha256。
 * 入包内容与 §11.1 一致：只组装本方案的模块产物（layout.apiDist/<name>-<version>/ 与
 * layout.distDir/modules/<name>/），模板/宿主模块不随包。
 */
async function assembleBundle(projectRoot: string, layout: ProjectLayout, plan: BundlePlan, outDir: string): Promise<BundleBuildResult> {
	const m = plan.manifest;
	const name = plan.name;
	const version = plan.version;

	// 3) 组装 staging：<name>-<version>/ 单根
	const staging = fs.mkdtempSync(path.join(projectRoot, ".ojm-bundle-"));
	try {
		const root = path.join(staging, `${name}-${version}`);
		fs.mkdirSync(root);
		fs.copyFileSync(plan.contractPath, path.join(root, "manifest.yaml"));

		// api：oj build 产物原样入包（编译编排不在此重跑——作者先 oj build，本命令只校验与组装）
		if (m.api !== undefined) {
			const built = path.join(layout.apiDist, `${name}-${version}`);
			if (!fs.existsSync(built)) {
				throw new Error(`[ojm] 方案包构建失败：缺少 oj build 产物 ${path.relative(projectRoot, built)}（manifest 声明了 api 段；先对 api/ 运行 oj build，产物原样入包）`);
			}
			const layoutViolations = checkModuleManifest(built, name, version, m.summary as string);
			if (layoutViolations.length > 0) {
				throw new Error(`[ojm] 方案包构建失败：分层核对未通过（C2-31）：\n${layoutViolations.map(x => `- ${x}`).join("\n")}`);
			}
			fs.cpSync(built, path.join(root, "api", `${name}-${version}`), { recursive: true });
		}

		// web：只入包方案自己的模块产物（web 段缺省 = 纯后端方案，整段跳过）。
		// 为何不是整树：dist/web/modules 里除本方案模块外还有脚手架模板模块（home/login/
		// personal-center/notification/system/oj-market…），而安装器 deployWeb 会把包内
		// web/modules 整树覆盖进目标站 <dist>/modules——整树入包等于用开发机上的模板产物
		// 覆盖目标站同名前端。方案包只该带自己那一份，模板模块属宿主面，不由方案分发。
		if (m.web !== undefined) {
			const webModules = path.join(layout.distDir, "modules");
			if (!fs.existsSync(webModules)) {
				throw new Error(`[ojm] 方案包构建失败：缺少站点构建产物 ${path.relative(projectRoot, webModules)}（manifest 声明了 web 段；先运行 ojm build 生成模块产物）`);
			}
			const ownWeb = path.join(webModules, name);
			if (!fs.existsSync(ownWeb)) {
				throw new Error(`[ojm] 方案包构建失败：缺少本方案的站点产物 ${path.relative(projectRoot, ownWeb)}/（方案包只入包方案自己的模块；请确认 web.config.ts 已登记 ${name} 且本次 ojm build 已产出）`);
			}
			fs.mkdirSync(path.join(root, "web", "modules"), { recursive: true });
			fs.cpSync(ownWeb, path.join(root, "web", "modules", name), { recursive: true });
			const web = m.web as Record<string, unknown>;
			for (const rel of [web.entry, ...(Array.isArray(web.css) ? web.css : [])]) {
				if (typeof rel === "string" && !fs.existsSync(path.join(root, "web", rel))) {
					throw new Error(`[ojm] 方案包构建失败：web 声明的产物不存在：${rel}（C2-27 成品存在性复核；请核对该文件是否已在本次构建产出）`);
				}
			}
		}

		// 红线自检：modules.json 禁入包任何位置（C2-31）+ 私钥/凭证禁入（P2-4 入包红线；
		// 完整性自查发生在确定性打包前的 staging 上）
		assertNoForbiddenMembers(root);

		// 4) 确定性打包（C2-32；symlink 等成员守卫在打包原语内，C2-30）
		const tgzPath = path.join(outDir, `${name}-${version}.tgz`);
		const sha256 = await createDeterministicTgz(staging, tgzPath);
		const size = fs.statSync(tgzPath).size;
		console.log(`[ojm] 方案包已生成 → ${tgzPath}`);
		console.log(`[ojm] sha256：${sha256}（${size} 字节；确定性打包：同输入两次打包哈希一致，C2-32）`);
		return { tgz: tgzPath, sha256, name, version };
	}
	finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * 从方案工程产出可安装 tgz + sha256（多方案：返回 N 份结果，与目标契约一一对应）。
 * 两段式：planBundle 全部先跑完（纯读、零写盘），任一失败 dist/ 零增量；
 * 组装段失败保留已完成产物并在报错中指名失败方案。
 */
export async function buildBundle(projectRoot: string, opts: { out?: string, name?: string } = {}): Promise<BundleBuildResult[]> {
	const targets = resolveContractTargets(projectRoot, opts.name);
	const layout = resolveLayout(projectRoot);
	// 两段式：全部校验先跑完（纯读、零写盘），任一失败 dist/ 零增量——
	// 发布者不会把半截批次扫进 CDN 索引（build-index 全量收目录）。
	// name+version 撞车防护由 planBundle 的 name===目录名 强校验承担：
	// 目录名在单一 src/ 层唯一 ⇒ 契约 name 唯一（评审 B7 与 B8 组合后撞车向量不可达）。
	const plans = await Promise.all(targets.map(t => planBundle(projectRoot, layout, t)));

	const outDir = path.resolve(projectRoot, opts.out ?? "dist");
	const results: BundleBuildResult[] = [];
	for (const plan of plans) {
		try {
			results.push(await assembleBundle(projectRoot, layout, plan, outDir));
		}
		catch (error) {
			const done = results.map(r => `${r.name}-${r.version}`).join(", ");
			throw new Error(
				`[ojm] 方案「${plan.name}」打包失败${done ? `（已完成：${done}）` : ""}：${
					error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
	}
	return results;
}

/**
 * C2-31 分层核对：模块级 manifest 仅 oj 原生键，且 name/version 与 bundle 级逐一相等
 * （oj 启动强校验同源）。
 *
 * 变更（2026-10-21）：`desc === summary` 的等值要求已移除（与安装侧 extract.ts 同步）——
 * 那是构建期映射的产物而不是安全边界，保留它会让 desc 与 summary 一字之差的包直接装不上。
 */
function checkModuleManifest(built: string, name: string, version: string, _summary: string): string[] {
	const p = path.join(built, "manifest.yaml");
	let doc: unknown;
	try {
		doc = parse(fs.readFileSync(p, "utf8"));
	}
	catch (e) {
		return [`api/<name>-<version>/manifest.yaml 读取失败（${e instanceof Error ? e.message : String(e)}）——oj 安装后要真实解析此文件`];
	}
	if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
		return ["api/<name>-<version>/manifest.yaml 必须是键值映射（oj 模块级，仅 oj 原生七键）"];
	}
	const mm = doc as Record<string, unknown>;
	const out: string[] = [];
	if (mm.name !== name) {
		out.push(`模块级 name「${String(mm.name)}」必须 === bundle name「${name}」（oj 启动强校验 name == 目录名）`);
	}
	if (mm.version !== version) {
		out.push(`模块级 version「${String(mm.version)}」必须 === bundle version「${version}」`);
	}
	return out;
}

/** api.tables ↔ schema.yaml 表集对照（C2-12a 构建列；schema 缺失/声明不一致均 fail-fast） */
function checkTables(m: Record<string, unknown>, layout: ProjectLayout, name: string): string[] {
	const api = m.api as Record<string, unknown> | undefined;
	if (api === undefined || api.tables === undefined)
		return [];
	const schemaPath = path.join(apiSrcOf(layout, name), "schema.yaml");
	if (!fs.existsSync(schemaPath)) {
		return [`【C2-12a】api.tables 已声明但缺少 ${path.relative(layout.projectRoot, schemaPath)}，无法对照表集（oj 冗余校验同源）`];
	}
	return checkTablesAgainstSchema(m, fs.readFileSync(schemaPath, "utf8"));
}

/** locales 双语齐备（C2-25 构建列缺 key fail-fast；安装期信任构建产物不重复校验） */
function checkLocales(m: Record<string, unknown>, layout: ProjectLayout, name: string): string[] {
	if (referencedI18nKeys(m).length === 0)
		return [];
	const dir = path.join(webSrcOf(layout, name), "locales");
	const texts: Partial<Record<"zh-CN" | "en-US", string>> = {};
	const out: string[] = [];
	for (const lang of ["zh-CN", "en-US"] as const) {
		const p = path.join(dir, `${lang}.json`);
		if (!fs.existsSync(p)) {
			out.push(`【C2-25】manifest 引用了 i18n key 但缺少 ${path.relative(layout.projectRoot, p)}（双语齐备，D4）`);
			continue;
		}
		texts[lang] = fs.readFileSync(p, "utf8");
	}
	return [...out, ...checkLocalesComplete(m, texts["zh-CN"] ?? "", texts["en-US"] ?? "")];
}

/** 私钥/凭证文件名红线（P2-4 入包自检）：*.pem/*.key/*.p12/*.pfx、.env 系（.env/.env.*）、id_ed25519|id_rsa */
const FORBIDDEN_MEMBER = /\.(?:pem|key|p12|pfx)$|^\.env(?:\.|$)|^id_(?:ed25519|rsa)$/;

/** staging 全树扫描：modules.json 禁入（C2-31 红线）+ 私钥/凭证禁入（P2-4 红线） */
function assertNoForbiddenMembers(root: string): void {
	const visit = (dir: string) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				visit(p);
				continue;
			}
			if (e.isFile() && e.name === "modules.json") {
				throw new Error(`[ojm] 打包自检失败（C2-31）：modules.json 禁入方案包（该清单由安装器在目标站点 upsert，防覆盖宿主清单）——位置：${p}`);
			}
			if (e.isFile() && FORBIDDEN_MEMBER.test(e.name)) {
				throw new Error(`[ojm] 打包自检失败（P2-4 入包红线）：私钥/凭证文件「${e.name}」禁入方案包（*.pem / *.key / *.p12 / *.pfx / .env 系 / id_ed25519 / id_rsa）——签名私钥永不入包，签名经 detached .sig 侧车随包分发（包内只含产物与公钥）。位置：${p}`);
			}
		}
	};
	visit(root);
}
