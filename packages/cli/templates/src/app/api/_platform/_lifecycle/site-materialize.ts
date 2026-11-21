// 站点运行时物化（overlay 化 Phase 3，主文档 §4.3/§4.7）：modules.json 的唯一写者。
// 生命周期各动作（deployWeb/setEnabled/uninstall/补偿/catch-up）只改 overlay 真源
// （sys_module_overlay 表），本模块据「当前清单 + overlay 行 + face 旁车」重算并原子写回
// （D13）；内容零变化时不写盘（mtime 不扰动 no-cache/304 消费面）。
//
// 单写者铁律：除本模块外，任何路径不得 read-modify-write modules.json（legacy 回落
// 分支仅限 overlay 表不存在的老平台，P2-T4 混合态）。
//
// materialize 纯函数与 cli 侧 packages/cli/src/build/materialize.ts 互为有意复制的
// 双生（运行面 templates 与构建面 cli 不共享代码产物，DRY 违反是有意的）——语义修改
// 必须双边同步；报错文案逐字一致是 spec 钉。

import type { OverlayRow } from "./overlay";
import type { StateStore } from "./state";
import { atomicWriteText, fsFace, isMissingPath } from "./atomic";
import { readOverlayDbSeq, readOverlayRows } from "./overlay";

/** 物化层行（materialize 纯函数输入；manifest 缺省 = 无 face 旁车 → 按名叠启停掩码） */
export interface SiteOverlayEntry {
	name: string
	version: string
	/** face 旁车内容（entry/css/chunks/integrity 等 extras）；undefined = 无 face */
	manifest?: Record<string, unknown>
	/** 启停以 overlay 真源（DB 行）为准 */
	enabled: boolean
}

interface ManifestEntry {
	name: string
	enabled: boolean
	[extra: string]: unknown
}

/**
 * 合并基线与叠加层。纯函数：无副作用、不改输入。
 * 运行时语义与 cli 侧构建期 materialize 不同（有意分叉，注释互指）：
 * - 有 face 行：基线同名条目**原位替换/追加**——运行时基线是已合并清单（含上次部署的
 *   方案条目），重装/升级必须就换代；双轨同名红线由构建期 cli 侧把守（源码树引入同名
 *   模块时 ojm build 即拒），运行时仅拦「版本不同的非旁车同名条目」残余情形。
 * - 无 face 行：基线同名 → 叠启停掩码；无此名 → 孤儿跳过。
 * - dropNames（基线中方案轨条目名，由调用方按「face 旁车在盘」判定）：无对应 face 行
 *   → 从清单剔除（卸载/补偿的行已删，残留条目不得复活）。
 * - omitNames（本次操作显式除名，如卸载/补偿的方案名）：无条件剔除——legacy 条目可能
 *   无 face 旁车（P1 时代），单靠 dropNames 判不掉；行删除先于物化，行面已无法表达。
 */
export function materialize(baseline: ManifestEntry[], overlay: SiteOverlayEntry[], dropNames: Set<string>, omitNames?: Set<string>): ManifestEntry[] {
	const faceNames = new Set(overlay.filter(o => o.manifest !== undefined).map(o => o.name));
	const merged: ManifestEntry[] = [];
	for (const m of baseline) {
		if (omitNames?.has(m.name)) {
			continue;
		}
		if (dropNames.has(m.name) && !faceNames.has(m.name)) {
			continue; // 方案轨残留（行已删）：剔除，不复活
		}
		merged.push(m);
	}
	for (const o of overlay) {
		if (omitNames?.has(o.name)) {
			continue; // 显式除名优先于 face 行（卸载面不应再被任何行复活）
		}
		if (o.manifest !== undefined) {
			const idx = merged.findIndex(m => m.name === o.name);
			const next = { ...o.manifest, name: o.name, version: o.version, enabled: o.enabled } as ManifestEntry;
			if (idx >= 0) {
				const cur = merged[idx]!;
				if (cur.version !== o.version && !dropNames.has(o.name)) {
					throw new Error(
						`[ojm] 已装方案「${o.name}」与源码树模块同名（双轨同名红线）：请卸载该方案（ojm uninstall ${o.name}）或改源码模块名后重建。`,
					);
				}
				merged[idx] = next; // 原位替换（位置保持，菜单序稳定）
			}
			else {
				merged.push(next);
			}
			continue;
		}
		const idx = merged.findIndex(m => m.name === o.name);
		if (idx >= 0) {
			merged[idx] = { ...merged[idx], enabled: o.enabled };
			continue;
		}
		// 孤儿（基线无此名且无 face）：跳过——调用方负责告警与审计
	}
	return merged;
}

export interface SiteMaterializeInput {
	/** 站点 modules.json 路径（<dist>/web/modules.json） */
	modulesJsonPath: string
	/** 共享根（manifests.yaml 所在；overlay-cache.json 落 <sharedRoot>/.solutions/） */
	sharedRoot: string
	/** sidecar store（崩溃窗愈合：sidecar enabled/overlay_seq 滞后于 DB 行时补齐；缺省跳过） */
	state?: StateStore
	/** 本次操作显式除名的模块（卸载/补偿传方案名）；无条件从清单剔除 */
	omitNames?: string[]
	/** 操作人（cache 审计字段） */
	actor?: string
}

export interface SiteMaterializeResult {
	ok: boolean
	/** 本次是否实际重写文件（内容零变化 = false） */
	changed: boolean
	/** 物化所据 DB seq（null = overlay 表不可达，本次未物化） */
	dbSeq: number | null
	message: string
}

/** overlay-cache.json 路径：DB seq 持久化标记（catch-up 滞后判定 + cli 离线 fail-stale 仲裁真源） */
export function overlayCachePathOf(sharedRoot: string): string {
	return `${sharedRoot}/.solutions/overlay-cache.json`;
}

interface OverlayCache {
	db_seq: number
	at: number
	actor: string
}

/** 读 cache（reconcile 滞后检测共用）；缺失/损坏 → null（= 从未物化/标记丢失 → 视为滞后） */
export async function readOverlayCacheOf(sharedRoot: string): Promise<{ db_seq: number, at: number, actor: string } | null> {
	return await readOverlayCache(sharedRoot);
}

async function readOverlayCache(sharedRoot: string): Promise<OverlayCache | null> {
	try {
		const parsed = JSON.parse(new TextDecoder().decode(await fsFace().readFile(overlayCachePathOf(sharedRoot)))) as unknown;
		if (typeof parsed !== "object" || parsed === null || typeof (parsed as OverlayCache).db_seq !== "number") {
			return null;
		}
		return parsed as OverlayCache;
	}
	catch {
		return null; // 缺失/损坏 = 从未物化或标记丢失 → catch-up 视为滞后
	}
}

async function writeOverlayCache(sharedRoot: string, cache: OverlayCache): Promise<void> {
	await atomicWriteText(overlayCachePathOf(sharedRoot), `${JSON.stringify(cache, null, 2)}\n`);
}

/** 基线中「方案轨」条目名集合：其版本目录带 face 旁车（.ojm-module.json）即方案部署产物——源码树构建产物无旁车 */
async function solutionTrackNamesOf(webRoot: string, baseline: ManifestEntry[]): Promise<Set<string>> {
	const names = new Set<string>();
	for (const e of baseline) {
		if (typeof e.version !== "string" || e.version === "") {
			continue;
		}
		try {
			await fsFace().readFile(`${webRoot}/modules/${e.name}/${e.version}/.ojm-module.json`);
			names.add(e.name);
		}
		catch {
			// 无旁车 = 源码树/legacy 条目：保留
		}
	}
	return names;
}

/** face_ref（"modules/<name>/<version>"，相对 web 根）→ 旁车内容；缺失/损坏/name 不符 → null */
async function readFaceManifest(webRoot: string, row: OverlayRow): Promise<Record<string, unknown> | null> {
	if (row.face_ref === null || row.face_ref === "") {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(await fsFace().readFile(`${webRoot}/${row.face_ref}/.ojm-module.json`)));
	}
	catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}
	const e = parsed as Record<string, unknown>;
	if (e.name !== row.name || typeof e.entry !== "string" || e.entry === "") {
		return null;
	}
	return e;
}

/**
 * 崩溃窗愈合（catch-up 同函数顺带执行）：sidecar 条目滞后于 DB 行（enabled 或
 * overlay_seq 不一致）→ 以 DB 行为准补齐。仅触碰有 overlay 行的方案，backfill 前
 * 无行的方案不动（P2-T4 混合态不反向驱动）。best-effort：写失败静默（下次物化重试）。
 */
async function healSidecarFromOverlay(rows: OverlayRow[], state: StateStore | undefined): Promise<void> {
	if (state === undefined) {
		return;
	}
	const side = state.read().solutions;
	for (const row of rows) {
		if (row.source !== "solution") {
			continue;
		}
		const entry = side[row.name];
		if (entry === undefined || (entry.version === row.version && entry.enabled === (Number(row.enabled) === 1) && entry.overlay_seq === Number(row.seq))) {
			continue;
		}
		try {
			await state.write({ solutions: { [row.name]: { ...entry, version: row.version, enabled: Number(row.enabled) === 1, overlay_seq: Number(row.seq) } } });
		}
		catch {
			// best-effort：下次物化重试
		}
	}
}

/**
 * 站点物化：读 overlay 行 → 组装叠加层（face 旁车在盘 → 整条目；否则掩码）→
 * 读当前清单为基线 → materialize 纯函数 → 内容变化才原子写（D13）→
 * overlay-cache.json 记 DB seq（catch-up/离线 fail-stale 真源）。
 * overlay 表不可达（老平台/DB 离线）→ 不动文件，调用方走 legacy 回落。
 * 基线损坏 → fail-loud 上抛（绝不覆盖他模块条目）。
 */
export async function siteMaterialize(input: SiteMaterializeInput): Promise<SiteMaterializeResult> {
	const dbSeq = await readOverlayDbSeq();
	if (dbSeq === null) {
		return { ok: true, changed: false, dbSeq: null, message: "overlay 表不可达（老平台/DB 离线），跳过物化（legacy 回落）" };
	}
	const webRoot = input.modulesJsonPath.replace(/\/modules\.json$/, "");
	const rows = await readOverlayRows();
	// 同名多 face 行（升级留下的旧版本行）每名胜出唯一：启用行优先，皆停用取最大 seq——
	// 清单每名恒一条（与旧 upsert 语义一致）；落败行连掩码都不叠（避免旧版本掩码盖新版本）。
	const byName = new Map<string, OverlayRow[]>();
	for (const row of rows) {
		const list = byName.get(row.name) ?? [];
		list.push(row);
		byName.set(row.name, list);
	}
	const overlay: SiteOverlayEntry[] = [];
	for (const list of byName.values()) {
		const withFace: OverlayRow[] = [];
		for (const row of list) {
			if (await readFaceManifest(webRoot, row) !== null) {
				withFace.push(row);
			}
		}
		if (withFace.length > 0) {
			const enabledFace = withFace.find(r => Number(r.enabled) === 1);
			const winner = enabledFace ?? withFace.reduce((a, b) => Number(a.seq) >= Number(b.seq) ? a : b);
			overlay.push({ name: winner.name, version: winner.version, manifest: await readFaceManifest(webRoot, winner) ?? undefined, enabled: Number(winner.enabled) === 1 });
			continue;
		}
		// 全无 face（builtin/旁车缺失）：掩码语义——每名取启用行（无则最大 seq）
		const current = list.find(r => Number(r.enabled) === 1) ?? list.reduce((a, b) => Number(a.seq) >= Number(b.seq) ? a : b);
		overlay.push({ name: current.name, version: current.version, enabled: Number(current.enabled) === 1 });
	}
	const f = fsFace();
	let baseline: ManifestEntry[] = [];
	try {
		const parsed = JSON.parse(new TextDecoder().decode(await f.readFile(input.modulesJsonPath))) as unknown;
		if (!Array.isArray(parsed)) {
			throw new TypeError("modules.json 顶层不是数组");
		}
		baseline = parsed as ManifestEntry[];
	}
	catch (e) {
		if (!isMissingPath(e)) {
			throw new Error(`物化失败：modules.json 不可读或损坏（fail-loud 拒产，请人工修复）：${String(e)}`);
		}
	}
	const merged = materialize(baseline, overlay, await solutionTrackNamesOf(webRoot, baseline), input.omitNames !== undefined ? new Set(input.omitNames) : undefined);
	const next = `${JSON.stringify(merged, null, 2)}\n`;
	let changed = false;
	try {
		const cur = new TextDecoder().decode(await f.readFile(input.modulesJsonPath));
		changed = cur !== next;
	}
	catch {
		changed = true; // 缺失 = 首物化
	}
	if (changed) {
		await atomicWriteText(input.modulesJsonPath, next);
	}
	await healSidecarFromOverlay(rows, input.state);
	await writeOverlayCache(input.sharedRoot, { db_seq: dbSeq, at: Date.now(), actor: input.actor ?? "site-materialize" });
	return { ok: true, changed, dbSeq, message: `物化完成：${overlay.length} 行 overlay${changed ? "，modules.json 已重写" : "，清单已是最新（零写入）"}（DB seq=${dbSeq}）` };
}

/**
 * catch-up 物化（崩溃窗自愈，BDD「数据库写好了，文件没来得及算就崩了」）：
 * overlay-cache.json 的 db_seq < 当前 DB seq（或标记丢失）→ 重跑 siteMaterialize。
 * reconcileOf（市场页刷新对账时点）调用；失败静默不阻断主流程（下次重试）。
 */
export async function catchUpSiteModules(input: SiteMaterializeInput): Promise<SiteMaterializeResult | null> {
	const dbSeq = await readOverlayDbSeq();
	if (dbSeq === null) {
		return null; // DB 不可达：无从判定滞后，legacy 形态不动作
	}
	const cache = await readOverlayCache(input.sharedRoot);
	if (cache !== null && cache.db_seq >= dbSeq) {
		return { ok: true, changed: false, dbSeq, message: `catch-up：清单已对齐（cache seq=${cache.db_seq} >= DB seq=${dbSeq}）` };
	}
	return await siteMaterialize(input);
}
