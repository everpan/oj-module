// 部署步骤（P1-9，十阶段 stage deploying；R18/R30 前半）：解压 staging 内 web/ 产物树真复制到
// 站点 web 模块目录（<dist>/modules/<name>/<version>/…，布局与 packages/cli/src/build.ts 产物形态、
// shell-dist 静态服务约定一致），随后读-改-原子写 upsert modules.json。
// 站点路径全部 ctx 注入（stagingDir/siteModulesDir/modulesJsonPath）——安装器不硬编码站点布局；
// fs 依赖同 atomic.ts（globalThis.fs 面，测试注入 node 适配）。
// D13：modules.json 一切写入经 atomicWriteText——读者（并发 fetch）永不见半截 JSON（AC-P1-12）；
// 损坏清单拒绝 upsert（避免覆盖丢失他模块条目），宁可 fail-closed。
// R30：entry/css 路径 POSIX 分隔符序列化（Windows 侧反斜杠统一归一）。
// R10：integrity 由调用方（P1-10 对验签后包内容重算）传入，本步不计算；缺省回落 manifest.web.integrity
// （构建器计算值）——integrity 必须基于包内容，防 manifest 与产物错配。
// entry 浏览器加载验证不在安装器范围（Node import 必假绿——设计 §4.1）：宿主 error boundary 兜底
// + P2 深检可见，本步只保证落位与清单一致。

import type { FsFace } from "../atomic";
import type { InstallContext } from "./preflight";
import { atomicWriteText, fsFace } from "../atomic";

/**
 * modules.json 模块条目（对齐 shell 消费面 packages/cli/shell/src/manifest.ts 透传注释与
 * shell/src/preload.ts HostModule：name/entry/enabled/dependencies/peerRuntime/css 必透传）。
 * 构建器其余字段（version/chunks）经索引签名原样透传，upsert 不裁剪。
 */
export interface ModuleEntry {
	name: string
	entry: string
	enabled: boolean
	dependencies?: string[]
	peerRuntime?: string
	css?: string[]
	integrity?: string
	[extra: string]: unknown
}

/** R30：POSIX 分隔符序列化——反斜杠/正斜杠混合路径统一为 / */
export function posixPath(p: string): string {
	return p.split(/[\\/]/).join("/");
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 归一化条目：entry/css 路径 POSIX 化；其余字段（含构建器 extras）原样透传 */
function normalizeEntry(entry: ModuleEntry): ModuleEntry {
	const out: ModuleEntry = { ...entry, entry: posixPath(entry.entry) };
	if (Array.isArray(entry.css)) {
		out.css = entry.css.map(c => posixPath(String(c)));
	}
	return out;
}

/**
 * modules.json 读-modify-原子写 upsert（D13）：同名条目整体替换（位置保持）、其余条目原样保留；
 * 清单不存在视同空表创建；清单损坏（非合法 JSON / 非数组）拒绝写入并上抛——绝不覆盖。
 */
export async function upsertModulesJson(entry: ModuleEntry, opts: { modulesJsonPath: string }): Promise<void> {
	const f = fsFace();
	let list: ModuleEntry[] = [];
	try {
		list = JSON.parse(new TextDecoder().decode(await f.readFile(opts.modulesJsonPath)));
	}
	catch (e) {
		if ((e as { code?: string }).code === "ENOENT") {
			list = [];
		}
		else if (e instanceof SyntaxError || !Array.isArray(list)) {
			throw new Error(`modules.json 不是合法 JSON，拒绝 upsert（避免覆盖丢失既有条目，请人工修复后重试）：${String(e)}`);
		}
		else {
			throw e;
		}
	}
	if (!Array.isArray(list)) {
		throw new TypeError("modules.json 顶层不是数组，拒绝 upsert（避免覆盖丢失既有条目）");
	}
	const normalized = normalizeEntry(entry);
	const idx = list.findIndex(e => isObj(e) && e.name === normalized.name);
	if (idx === -1) {
		list.push(normalized);
	}
	else {
		list[idx] = normalized;
	}
	await atomicWriteText(opts.modulesJsonPath, `${JSON.stringify(list, null, 2)}\n`);
}

export interface DeployWebContext extends InstallContext {
	/** 解压暂存目录（web/ 产物树所在；与 download/verify/extract 同目录接力） */
	stagingDir: string
	/** 站点 web 模块目录（<dist>/modules，注入不硬编码） */
	siteModulesDir: string
	/** 站点 modules.json 路径（与 siteModulesDir 同属 <dist>） */
	modulesJsonPath: string
	/** P1-10 对验签后包内容重算的 sha384（sha384-<base64>，R10）；缺省回落 manifest.web.integrity */
	integrity?: string
}

export interface StageResult {
	stage: "deploying"
	ok: boolean
	message: string
	retryable?: boolean
}

/** 递归复制目录树（readdir 成功即按目录递归、抛错即按文件复制——FsFace 无 stat 面的最小判别） */
async function copyTree(src: string, dest: string, f: FsFace): Promise<void> {
	const names = await f.readdir(src);
	await f.mkdir(dest, { recursive: true });
	for (const name of names) {
		const s = `${src}/${name}`;
		const d = `${dest}/${name}`;
		try {
			await copyTree(s, d, f);
		}
		catch {
			await f.copyFile(s, d);
		}
	}
}

export async function deployWeb(ctx: DeployWebContext): Promise<StageResult> {
	const m = isObj(ctx.manifest) ? ctx.manifest : {};
	const web = m.web;
	if (!isObj(web)) {
		return { stage: "deploying", ok: true, message: "部署完成：manifest 无 web 段（api-only 方案），零复制零清单变更" };
	}
	if (typeof web.entry !== "string" || web.entry === "") {
		return { stage: "deploying", ok: false, retryable: false, message: "部署失败：web 段存在但 entry 缺失（C2-27：web 段存在时必填）——契约破坏，重试不自愈" };
	}
	const f = fsFace();
	// 包内 web 树即 modules 子树（C2-27 路径空间 = modules/<name>/<version>/…）：
	// staging/web/modules → 站点 <dist>/modules 一层对齐，不整树套复制（避免 modules/modules 双层嵌套）。
	try {
		await copyTree(`${ctx.stagingDir}/web/modules`, ctx.siteModulesDir, f);
	}
	catch (e) {
		return {
			stage: "deploying",
			ok: false,
			retryable: false,
			message: `部署失败：staging web 产物树（${ctx.stagingDir}/web/modules）不可复制（${String(e)}）——web.entry 已声明而包内 web/modules 缺失属包结构违约（C2-27），重试不自愈`,
		};
	}
	const integrity = typeof ctx.integrity === "string" && ctx.integrity !== ""
		? ctx.integrity
		: typeof web.integrity === "string" ? web.integrity : undefined;
	const entry: ModuleEntry = {
		name: ctx.name,
		entry: posixPath(web.entry),
		enabled: true,
		...(Array.isArray(web.css) ? { css: web.css.map(c => posixPath(String(c))) } : {}),
		...(integrity !== undefined ? { integrity } : {}),
		...(typeof m.peerRuntime === "string" ? { peerRuntime: m.peerRuntime } : {}),
	};
	try {
		await upsertModulesJson(entry, { modulesJsonPath: ctx.modulesJsonPath });
	}
	catch (e) {
		return {
			stage: "deploying",
			ok: false,
			retryable: false,
			message: `部署失败：modules.json upsert 被拒（${String(e)}）——文件已复制、清单未被半写（D13 原子写保证读者无感）`,
		};
	}
	return {
		stage: "deploying",
		ok: true,
		message: `部署完成：staging web/ → ${ctx.siteModulesDir}/，modules.json 已 upsert ${ctx.name}（entry ${entry.entry}${integrity ? `；integrity ${integrity}` : ""}；D13 原子写，读者永不见半截 JSON）`,
	};
}
