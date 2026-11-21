// 重建合并已装方案登记（支柱二 / U5 根治，2026-11-07 实锤）：ojm dev / ojm build 重建
// modules.json 只收源码树模块，已装方案的登记被冲掉（市场菜单消失），愈合此前只能
// backfill + 逐方案重装。两段式：
//   restoreInstalledFaces —— release 整树擦除（site-merge rmSync dist）后，从版本目录
//     （<apiDist>/<name>-<ver>/，web-only 包 = 整包含 web/ 树）把 web 面重物化到
//     dist/web/modules/；dev 形态不擦除，face 在盘即跳过（幂等）。
//   mergeInstalledModules —— 清单写出前，把 sidecar state（modules/.solutions/state.yaml）
//     里已装且 face 在盘的方案并回清单；条目形状读 face 版本目录的 `.ojm-module.json`
//     旁车（deploy-web 落，含 dependencies/peerRuntime 等 extras 原样），enabled 以
//     sidecar state 为真源。源码树同名 → fail-fast（双轨同名红线，不静默覆盖）。
//
// sidecar state 是受限 YAML 子集（两层 map + 标量），与 templates state.ts 读写格式同纪律。

import type { OverlayEntry } from "./materialize";
import type { BuiltModule } from "./module-build";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { materialize } from "./materialize";

/** sidecar state 的最小消费形状（完整条目见 templates state.ts SolutionEntry） */
interface StateDoc {
	solutions?: Record<string, { version?: unknown, enabled?: unknown, overlay_seq?: unknown }>
}

/** 读 sidecar 已装方案（无文件/损坏/无 solutions 段 → null，调用方零动作） */
function readInstalledState(projectRoot: string): Record<string, { version: string, enabled: boolean, overlaySeq?: number }> | null {
	const statePath = path.join(projectRoot, "modules", ".solutions", "state.yaml");
	if (!fs.existsSync(statePath))
		return null;
	let doc: StateDoc;
	try {
		doc = parseYaml(fs.readFileSync(statePath, "utf-8")) as StateDoc;
	}
	catch {
		return null;
	}
	if (doc === null || typeof doc !== "object" || doc.solutions === null || typeof doc.solutions !== "object")
		return null;
	const out: Record<string, { version: string, enabled: boolean, overlaySeq?: number }> = {};
	for (const [name, e] of Object.entries(doc.solutions)) {
		if (e === null || typeof e !== "object")
			continue;
		if (typeof e.version !== "string" || e.version === "")
			continue;
		out[name] = {
			version: e.version,
			enabled: e.enabled !== false,
			...(typeof e.overlay_seq === "number" ? { overlaySeq: e.overlay_seq } : {}),
		};
	}
	return Object.keys(out).length === 0 ? null : out;
}

/**
 * 离线 fail-stale 仲裁（Phase 3 / P3-T6，BDD「断网不用过期货」）：overlay-cache.json 记
 * 本节点最近一次在线物化时的 DB seq（site-materialize 落）。DB 已知走到 cache.db_seq，
 * 而 sidecar 条目携带的 overlay_seq 落后（或无 seq 可判）→ 这份缓存是过期货——拒绝覆盖
 * modules.json + 报警（throw），宁可构建失败也不静默复活错误启停态。愈合：联网跑一次
 * 构建/任意生命周期 API（catch-up 重跑物化并补 sidecar seq），序号对齐后自然放行。
 */
function assertOverlayCacheFresh(projectRoot: string, state: Record<string, { overlaySeq?: number }>): void {
	const cachePath = path.join(projectRoot, "modules", ".solutions", "overlay-cache.json");
	if (!fs.existsSync(cachePath))
		return; // 从未在线物化：无已知 DB seq，无从判 stale（legacy 形态照跑）
	let cache: { db_seq?: unknown };
	try {
		cache = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as { db_seq?: unknown };
	}
	catch {
		return; // cache 损坏不阻断（等同缺失）
	}
	const dbSeq = typeof cache.db_seq === "number" ? cache.db_seq : 0;
	if (dbSeq <= 0)
		return;
	const stale = Object.entries(state)
		.filter(([, e]) => e.overlaySeq === undefined || e.overlaySeq < dbSeq)
		.map(([name]) => name);
	if (stale.length === 0)
		return;
	const msg = `[ojm] ⚠️ 离线构建拒写（fail-stale）：sidecar 缓存序号落后已知 DB seq ${dbSeq}（方案：${stale.join("、")}）——断网不用过期货。请联网执行一次 ojm build / 任意生命周期操作（catch-up 补齐缓存序号）后重试。`;
	console.error(msg);
	throw new Error(msg);
}

/** 原始旁车读取（无降级）：缺失/损坏/name 不符 → null（ensureFaceSidecar 与合并面共用） */
function parseFaceSidecar(faceDir: string, name: string): Record<string, unknown> | null {
	const sidecarPath = path.join(faceDir, ".ojm-module.json");
	let entry: unknown;
	try {
		entry = JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
	}
	catch {
		return null;
	}
	if (entry === null || typeof entry !== "object" || Array.isArray(entry))
		return null;
	const e = entry as Record<string, unknown>;
	if (e.name !== name || typeof e.entry !== "string" || e.entry === "")
		return null;
	return e;
}

/** face 版本目录的条目旁车（deploy-web 落）；缺失/损坏 → 降级重建最小条目 */
function readFaceSidecar(faceDir: string, name: string, version: string): Record<string, unknown> | null {
	return parseFaceSidecar(faceDir, name) ?? ensureFaceSidecar(faceDir, name, version);
}

/**
 * 确保 face 旁车在场：缺失/损坏（两类正当形态——release 从版本目录重物化的 face
 * （旁车只落站点 face 目录，不进包/版本目录）+ 旁车特性引入前的旧安装）→ entry.js
 * 在盘则重建最小条目（entry 路径按布局推导、css 顶层扫描；integrity 不可知缺省省略，
 * 宿主无 SRI 加载）并落回 face 目录，告警有痕。在场且合法 → 原样返回。entry.js 也缺 → null。
 */
function ensureFaceSidecar(faceDir: string, name: string, version: string): Record<string, unknown> | null {
	// 在场且合法 → 原样返回（二次重物化旁车随版本目录同行，不重建不告警）
	const existing = parseFaceSidecar(faceDir, name);
	if (existing !== null)
		return existing;
	const entryFile = path.join(faceDir, "entry.js");
	if (!fs.existsSync(entryFile))
		return null;
	const css = fs.readdirSync(faceDir)
		.filter(f => f.endsWith(".css"))
		.sort()
		.map(f => `/modules/${name}/${version}/${f}`); // 根绝对路径：浏览器裸 import 契约
	console.warn(`[ojm] ⚠️ 已装方案「${name}@${version}」缺条目旁车 .ojm-module.json，重建最小条目并入（extras/integrity 失，重装可恢复完整形状）`);
	const minimal: Record<string, unknown> = {
		name,
		entry: `/modules/${name}/${version}/entry.js`,
		enabled: true,
		version,
		chunks: [],
		...(css.length > 0 ? { css } : {}),
	};
	// 重建结果落回旁车：dist/web 是擦除重建产物，不写则每次 release build 重复告警
	try {
		fs.writeFileSync(path.join(faceDir, ".ojm-module.json"), `${JSON.stringify(minimal, null, 2)}\n`);
	}
	catch {
		// 写不进（只读挂载等）不阻断——下次重建重走本降级，告警有痕
	}
	return minimal;
}

/**
 * release 擦除后重物化已装方案 web 面：face 缺失而版本目录含
 * `<apiDist>/<name>-<ver>/web/modules/<name>/<ver>` → 整目录拷回 dist/web/modules。
 * api-only 包（版本目录无 web 树）与版本目录缺失（dev 形态无 dist/api）→ 跳过，
 * 由 mergeInstalledModules 的 face 缺失告警收口。
 */
export function restoreInstalledFaces(projectRoot: string, distDir: string, apiDist: string): string[] {
	const state = readInstalledState(projectRoot);
	if (state === null)
		return [];
	const restored: string[] = [];
	for (const [name, e] of Object.entries(state)) {
		const faceDir = path.join(distDir, "modules", name, e.version);
		if (fs.existsSync(faceDir))
			continue;
		const versionDir = path.join(apiDist, `${name}-${e.version}`, "web", "modules", name, e.version);
		if (!fs.existsSync(versionDir))
			continue;
		fs.cpSync(versionDir, faceDir, { recursive: true });
		// 版本目录根旁车随行入 face（旁车持久化在根、web 子树之外——不拷则 face 仍缺，
		// 每次 release build 重复走最小条目重建降级）。
		const rootSidecar = path.join(apiDist, `${name}-${e.version}`, ".ojm-module.json");
		const faceSidecar = path.join(faceDir, ".ojm-module.json");
		if (!fs.existsSync(faceSidecar) && fs.existsSync(rootSidecar)) {
			try {
				fs.copyFileSync(rootSidecar, faceSidecar);
			}
			catch {
				// 拷不进则下方 ensureFaceSidecar 降级重建，告警有痕
			}
		}
		// 旁车随重建落回版本目录根：release 每次 mergeShellSite 擦除 dist/web，
		// 旁车只留 face 目录会被一并抹掉——版本目录（安装器私有面）是跨擦除的持久化位。
		// （存在合法旁车时原样写回，幂等。）
		const sidecar = ensureFaceSidecar(faceDir, name, e.version);
		if (sidecar !== null) {
			try {
				fs.writeFileSync(path.join(apiDist, `${name}-${e.version}`, ".ojm-module.json"), `${JSON.stringify(sidecar, null, 2)}\n`);
			}
			catch {
				// 版本目录只读等极端形态：下轮重建重走降级，告警有痕
			}
		}
		restored.push(name);
	}
	if (restored.length > 0)
		console.log(`[ojm] 已装方案 web 面从版本目录重物化：${restored.join("、")}`);
	return restored;
}

/**
 * 条目路径根绝对归一（2026-11-07 hotfix）：modules.json 被宿主浏览器裸 import(entry)，
 * entry/css 必须是根绝对路径。旁车可能是历史无前导斜杠形态（旧安装器透传 preflight
 * C2-27 包内相对路径）——并入时归一，并把归一结果落回 face 旁车（一次愈合，不再回归）。
 */
function normalizeEntryPaths(entry: Record<string, unknown>): Record<string, unknown> {
	const rootAbs = (p: unknown): unknown => {
		if (typeof p !== "string" || p === "")
			return p;
		return p.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(p) || p.startsWith("//") ? p : `/${p}`;
	};
	const out: Record<string, unknown> = { ...entry, entry: rootAbs(entry.entry) };
	if (Array.isArray(entry.css))
		out.css = entry.css.map(rootAbs);
	return out;
}

/**
 * 清单写出前并入已装方案 + 叠加停用掩码：sidecar 已装且 face 旁车在盘 → 条目并回
 * （enabled 以 sidecar 为真源）；无 face 且基线含同名 → 按名叠 enabled 掩码
 * （builtin 停用由此跨构建存活，P3 修复）；无 face 且基线无此名 → 跳过 + 告警
 * （登记不凭空重建；愈合 = 重装该方案）。源码树同名（有 face）→ 抛错 fail-fast
 * （双轨同名红线）。
 *
 * 本函数只是「读盘组装 + 副作用落盘」的外壳：合并语义在 materialize() 纯函数
 * （Phase 1/2 / A1 重构，行为不变——报错文案逐字沿用，spec 无需改）。
 */
export function mergeInstalledModules(projectRoot: string, distDir: string, built: BuiltModule[]): BuiltModule[] {
	const state = readInstalledState(projectRoot);
	if (state === null)
		return built;
	assertOverlayCacheFresh(projectRoot, state);
	// 读盘组装叠加层（face 缺失 → 掩码或告警，不凭空重建）
	const overlay: OverlayEntry[] = [];
	const writebacks: Array<{ faceDir: string, entry: Record<string, unknown>, normalized: Record<string, unknown> }> = [];
	for (const [name, e] of Object.entries(state)) {
		const faceDir = path.join(distDir, "modules", name, e.version);
		if (built.some(m => m.name === name)) {
			// 基线含同名：先试真旁车（真方案 face → 双轨同名红线 fail-fast），
			// 无旁车则按名叠启停掩码——绝不走 ensureFaceSidecar（它会把刚构建出的
			// entry.js 误判为方案 face 合成假条目，触发红线误报；builtin 停用
			// 由此跨构建存活，P3 修复）。
			const sidecar = parseFaceSidecar(faceDir, name);
			if (sidecar === null) {
				overlay.push({ name, version: e.version, enabled: e.enabled });
				continue;
			}
			const normalized = normalizeEntryPaths(sidecar);
			if (JSON.stringify(normalized) !== JSON.stringify(sidecar))
				writebacks.push({ faceDir, entry: sidecar, normalized });
			overlay.push({ name, version: e.version, manifest: normalized, enabled: e.enabled });
			continue;
		}
		const entry = readFaceSidecar(faceDir, name, e.version);
		if (entry === null) {
			console.warn(`[ojm] ⚠️ 已装方案「${name}@${e.version}」的 web 面/条目旁车缺失，重建清单不并入（愈合：ojm install ${name}@${e.version}）`);
			continue;
		}
		const normalized = normalizeEntryPaths(entry);
		if (JSON.stringify(normalized) !== JSON.stringify(entry))
			writebacks.push({ faceDir, entry, normalized });
		overlay.push({ name, version: e.version, manifest: normalized, enabled: e.enabled });
	}
	const merged = materialize(built, overlay);
	// 归一化回写（唯一保留的写副作用：一次愈合，不再回归）
	for (const w of writebacks) {
		try {
			fs.writeFileSync(path.join(w.faceDir, ".ojm-module.json"), `${JSON.stringify(w.normalized, null, 2)}\n`);
		}
		catch {
			// 旁车只读等极端形态：下次重建重归一，运行期有 resolveModuleEntryUrl 兜底
		}
	}
	return merged;
}
