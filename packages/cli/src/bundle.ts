// 方案包构建（P1-11，`ojm build --bundle`）：manifest.yaml 契约校验（fail-fast 先于打包）
// → 组装 tgz 内布局（契约 §2.9）→ 确定性打包（C2-32）+ sha256。
// 组装映射（对齐 P1-9 staging copy 源一层定版，unpack 布局即安装器 extract 段消费面）：
//   <project>/manifest.yaml                     → <name>-<version>/manifest.yaml（Form A）
//   <project>/api/dist/<name>-<version>/        → <name>-<version>/api/<name>-<version>/（oj build 产物原样，C2-31 分层核对）
//   <project>/web/dist/modules/                 → <name>-<version>/web/modules/（web.entry/css 存在性复核）
// 红线：modules.json 禁入包（C2-31——该清单由安装器在目标站点 upsert，防覆盖宿主清单）；
// 文件面契约（tables↔schema.yaml、locales 双语齐备）构建期 fail-fast（契约 §4.1 构建列）。
import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { createDeterministicTgz } from "./deterministic-tar";
import { checkLocalesComplete, checkTablesAgainstSchema, parseManifest, referencedI18nKeys, validateContract } from "./manifest-contract";

export interface BundleBuildResult {
	tgz: string
	sha256: string
	name: string
	version: string
}

/**
 * 从方案工程产出可安装 tgz + sha256。
 * @param projectRoot 方案工程根（manifest.yaml 所在目录）
 * @param opts 输出与选项
 * @param opts.out 输出目录，缺省 `dist/`；产物 `<name>-<version>.tgz`
 */
export async function buildBundle(projectRoot: string, opts: { out?: string } = {}): Promise<BundleBuildResult> {
	// 1) 读入并校验契约（构建即校验，坏清单出不了包）
	const manifestPath = path.join(projectRoot, "manifest.yaml");
	if (!fs.existsSync(manifestPath)) {
		throw new Error(`[ojm] 方案包构建失败：${projectRoot} 下缺少 manifest.yaml（bundle 级契约是打包入口，写法见 devkit 手册「打包与分发」）`);
	}
	const parsed = parseManifest(fs.readFileSync(manifestPath, "utf8"));
	if (!parsed.ok) {
		throw new Error(`[ojm] 方案包构建失败：${parsed.error}`);
	}
	const m = parsed.manifest;
	const violations = validateContract(m);
	if (violations.length > 0) {
		throw new Error(`[ojm] 方案包构建失败：manifest.yaml 契约校验未通过（${violations.length} 项违规，全量列出）：\n${violations.map(x => `- ${x}`).join("\n")}`);
	}
	const name = m.name as string;
	const version = m.version as string;

	// 2) 文件面契约（§4.1 构建列专属执行点；manifest 内在规则已在 validateContract 全量通过）
	const fileViolations = [
		...checkTables(m, projectRoot, name),
		...checkLocales(m, projectRoot, name),
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

	// 3) 组装 staging：<name>-<version>/ 单根
	const staging = fs.mkdtempSync(path.join(projectRoot, ".ojm-bundle-"));
	try {
		const root = path.join(staging, `${name}-${version}`);
		fs.mkdirSync(root);
		fs.copyFileSync(manifestPath, path.join(root, "manifest.yaml"));

		// api：oj build 产物原样入包（编译编排不在此重跑——作者先 oj build，本命令只校验与组装；
		// 编排接线随 P1-15 方案脚手架定形）
		if (m.api !== undefined) {
			const built = path.join(projectRoot, "api/dist", `${name}-${version}`);
			if (!fs.existsSync(built)) {
				throw new Error(`[ojm] 方案包构建失败：缺少 oj build 产物 ${path.relative(projectRoot, built)}（manifest 声明了 api 段；先对 api/ 运行 oj build，产物原样入包）`);
			}
			const layoutViolations = checkModuleManifest(built, name, version, m.summary as string);
			if (layoutViolations.length > 0) {
				throw new Error(`[ojm] 方案包构建失败：分层核对未通过（C2-31）：\n${layoutViolations.map(x => `- ${x}`).join("\n")}`);
			}
			fs.cpSync(built, path.join(root, "api", `${name}-${version}`), { recursive: true });
		}

		// web：站点构建模块产物入包（web 段缺省 = 纯后端方案，整段跳过）
		if (m.web !== undefined) {
			const webModules = path.join(projectRoot, "web/dist/modules");
			if (!fs.existsSync(webModules)) {
				throw new Error("[ojm] 方案包构建失败：缺少站点构建产物 web/dist/modules（manifest 声明了 web 段；先运行 ojm build 生成模块产物）");
			}
			fs.cpSync(webModules, path.join(root, "web", "modules"), { recursive: true });
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
		const outDir = path.resolve(projectRoot, opts.out ?? "dist");
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

/** C2-31 分层核对：模块级 manifest 仅 oj 原生键，且 name/version/desc 与 bundle 级逐一相等（oj 启动强校验同源） */
function checkModuleManifest(built: string, name: string, version: string, summary: string): string[] {
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
	if (mm.desc !== summary) {
		out.push(`模块级 desc「${String(mm.desc)}」必须 === bundle summary「${summary}」（安装器写 desc 即取 summary）`);
	}
	return out;
}

/** api.tables ↔ schema.yaml 表集对照（C2-12a 构建列；schema 缺失/声明不一致均 fail-fast） */
function checkTables(m: Record<string, unknown>, projectRoot: string, name: string): string[] {
	const api = m.api as Record<string, unknown> | undefined;
	if (api === undefined || api.tables === undefined)
		return [];
	const schemaPath = path.join(projectRoot, "api/src", name, "schema.yaml");
	if (!fs.existsSync(schemaPath)) {
		return [`【C2-12a】api.tables 已声明但缺少 ${path.relative(projectRoot, schemaPath)}，无法对照表集（oj 冗余校验同源）`];
	}
	return checkTablesAgainstSchema(m, fs.readFileSync(schemaPath, "utf8"));
}

/** locales 双语齐备（C2-25 构建列缺 key fail-fast；安装期信任构建产物不重复校验） */
function checkLocales(m: Record<string, unknown>, projectRoot: string, name: string): string[] {
	if (referencedI18nKeys(m).length === 0)
		return [];
	const dir = path.join(projectRoot, "web/src", name, "locales");
	const texts: Partial<Record<"zh-CN" | "en-US", string>> = {};
	const out: string[] = [];
	for (const lang of ["zh-CN", "en-US"] as const) {
		const p = path.join(dir, `${lang}.json`);
		if (!fs.existsSync(p)) {
			out.push(`【C2-25】manifest 引用了 i18n key 但缺少 ${path.relative(projectRoot, p)}（双语齐备，D4）`);
			continue;
		}
		texts[lang] = fs.readFileSync(p, "utf8");
	}
	return [...out, ...checkLocalesComplete(m, texts["zh-CN"] ?? "", texts["en-US"] ?? "")];
}

/** 私钥/凭证文件名红线（P2-4 入包自检）：*.pem / *.key / .env / id_ed25519|id_rsa */
const FORBIDDEN_MEMBER = /\.(?:pem|key)$|^\.env$|^id_(?:ed25519|rsa)$/;

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
				throw new Error(`[ojm] 打包自检失败（P2-4 入包红线）：私钥/凭证文件「${e.name}」禁入方案包（*.pem / *.key / .env / id_ed25519 / id_rsa）——签名私钥永不入包，签名经 detached .sig 侧车随包分发（包内只含产物与公钥）。位置：${p}`);
			}
		}
	};
	visit(root);
}
