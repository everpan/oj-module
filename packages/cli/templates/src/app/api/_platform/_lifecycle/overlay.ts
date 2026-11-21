// sys_module_overlay 表读写：模块启停状态唯一真源（overlay 化改造，主文档 §4.3/§4.7）。
//
// 铁律：
// - 同一模块任何时刻最多一行启用（DB 部分唯一索引 ux_overlay_one_enabled 硬强制，
//   本模块不自作聪明绕开）；升级/降级 = 同一逻辑批次内置新停旧（原子换版），
//   任何一步失败整体报错，绝不留下双启用中间态（唯一索引兜底拒写）。
// - 指纹/entry/chunks 永不写本表——SRI 信任根只在构建侧基线（modules.base.json）。
// - seq 单调递增（max+1）；sidecar 离线缓存携带物化时 seq，断网构建对不上号
//   即 fail-stale 拒写（cli 侧 installed-merge 消费）。
//
// db 为 oj isolate 注入全局（同 installer.ts:43 惯例；测试装 globalThis.db 内存桩，
// 本模块不直接 import db——经 globalThis 取，保持 service 层同构）。

export interface OverlayRow {
	id?: number
	name: string
	version: string
	/** 0/1；1 的行受部分唯一索引约束（每 name 至多一行） */
	enabled: number
	source: "builtin" | "solution"
	/** 方案 face 目录引用（builtin 为 null） */
	face_ref: string | null
	/** 单调递增：每次变更 +1，sidecar 缓存携带物化时 seq 供 fail-stale 仲裁 */
	seq: number
	actor: string
	changed_at: number
	/** 旧值→新值审计（JSON 文本），物化单点顺手落（主文档 §4.7） */
	old_state: string | null
}

/** 避免循环依赖的最小清单条目形态（backfill 第三路消费） */
export interface OverlayBackfillInput {
	/** 安装锁：name → version（solution 登记，启用态真源之一） */
	lock: Record<string, string>
	/** sidecar solutions：name → { version, enabled }（启用态真源之二） */
	solutions: Record<string, { version: string, enabled?: boolean }>
	/** 老 modules.json 条目（第三路：enabled=false 的唯一可靠存留点，含 builtin） */
	manifest: Array<{ name: string, version: string, enabled?: boolean }>
	actor: string
}

export interface BackfillResult {
	inserted: number
	updated: number
	/** 未落库的行数（默认启用且无需改动的条目） */
	skipped: number
}

function db(): any {
	return (globalThis as any).db;
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

export async function readOverlayRows(): Promise<OverlayRow[]> {
	try {
		return await db().table("sys_module_overlay").select(["id", "name", "version", "enabled", "source", "face_ref", "seq", "actor", "changed_at", "old_state"]).all() as OverlayRow[];
	}
	catch {
		// 表不存在（平台未升级）：按空 overlay 处理——基线默认全启用（fail-open 降级，
		// 与 recordHistory 守卫同口径；不可 fail-closed，否则老站升级前构建全炸）
		return [];
	}
}

async function nextSeq(): Promise<number> {
	const rows = await readOverlayRows();
	return rows.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0) + 1;
}

async function findRow(name: string, version: string): Promise<OverlayRow | undefined> {
	const rows = await readOverlayRows();
	return rows.find(r => r.name === name && r.version === version);
}

/**
 * 按 (name, version) upsert：已存在则整行覆盖（含 enabled/审计/seq），不存在则插入。
 * 唯一索引冲突（同名同版本并发插入）→ 抛给调用方按人话处理。
 */
export async function upsertOverlayRow(input: Omit<OverlayRow, "id" | "seq" | "changed_at"> & { changed_at?: number }): Promise<OverlayRow> {
	const seq = await nextSeq();
	const row: OverlayRow = { ...input, seq, changed_at: input.changed_at ?? nowSeconds() };
	const existing = await findRow(row.name, row.version);
	if (existing?.id !== undefined) {
		await db().table("sys_module_overlay").update({ enabled: row.enabled, source: row.source, face_ref: row.face_ref, seq: row.seq, actor: row.actor, changed_at: row.changed_at, old_state: row.old_state }).where({ field: "id", op: "eq", value: existing.id }).run();
		return row;
	}
	await db().table("sys_module_overlay").insert({ name: row.name, version: row.version, enabled: row.enabled, source: row.source, face_ref: row.face_ref, seq: row.seq, actor: row.actor, changed_at: row.changed_at, old_state: row.old_state }).run();
	return row;
}

export interface SwapInput {
	name: string
	/** 目标启用版本（须已有行；安装流水线装完产物后调用） */
	version: string
	actor: string
}

/**
 * 原子换版：同批「置旧行停用 → 置目标行启用」，seq 同为新值。
 * 先停后启：即使中途失败，唯一索引也保证绝不出现双启用；
 * 最坏残留「零启用」，由 verify/catch-up 以 DB 对账发现并报警（fail-visible）。
 */
export async function swapEnabledVersion(input: SwapInput): Promise<{ ok: boolean, message: string }> {
	const rows = (await readOverlayRows()).filter(r => r.name === input.name);
	if (rows.length === 0)
		return { ok: false, message: `换版失败：「${input.name}」无 overlay 记录（先经安装登记）` };
	const target = rows.find(r => r.version === input.version);
	if (!target)
		return { ok: false, message: `换版失败：「${input.name}@${input.version}」无 overlay 记录（先经安装登记）` };
	if (Number(target.enabled) === 1 && rows.filter(r => Number(r.enabled) === 1).length === 1)
		return { ok: true, message: `「${input.name}@${input.version}」已是唯一启用版本（幂等）` };
	const seq = await nextSeq();
	const at = nowSeconds();
	for (const r of rows.filter(r => Number(r.enabled) === 1 && r.version !== input.version)) {
		await db().table("sys_module_overlay").update({ enabled: 0, seq, actor: input.actor, changed_at: at, old_state: JSON.stringify({ enabled: 1 }) }).where({ field: "id", op: "eq", value: r.id }).run();
	}
	await db().table("sys_module_overlay").update({ enabled: 1, seq, actor: input.actor, changed_at: at, old_state: JSON.stringify({ enabled: Number(target.enabled) }) }).where({ field: "id", op: "eq", value: target.id }).run();
	return { ok: true, message: `「${input.name}」已换版至 ${input.version}（原子换版，旧版本已停用）` };
}

/**
 * 启停「当前启用版本」：按 name 找到启用行（无启用行则找唯一一行），置目标态。
 * 唯一索引兜底：启用时若已有他行启用，DB 层拒绝（双启用不可能）。
 */
export async function setOverlayEnabled(input: { name: string, enabled: boolean, actor: string }): Promise<{ ok: boolean, message: string }> {
	const rows = (await readOverlayRows()).filter(r => r.name === input.name);
	if (rows.length === 0)
		return { ok: false, message: `启停失败：「${input.name}」无 overlay 记录` };
	const current = rows.find(r => Number(r.enabled) === 1) ?? rows[0];
	const seq = await nextSeq();
	await db().table("sys_module_overlay").update({ enabled: input.enabled ? 1 : 0, seq, actor: input.actor, changed_at: nowSeconds(), old_state: JSON.stringify({ enabled: Number(current.enabled) }) }).where({ field: "id", op: "eq", value: current.id }).run();
	return { ok: true, message: `「${input.name}」已${input.enabled ? "启用" : "停用"}` };
}

/**
 * 三路 backfill（主文档 §6.2-高2 / A3；漏第三路 = 升级当晚停用 builtin 静默复活）：
 *   ① 锁      → solution 登记（enabled=1）
 *   ② sidecar → solution enabled（以其 enabled 为准，缺省 true）
 *   ③ 老 modules.json 的 enabled=false → 停用行（版本取条目自身 version；
 *      source 依 ①② 判定：登记过的 = solution，否则 builtin）
 * 默认启用且不冲突的条目不落库（基线承载默认态）——skipped 计数。
 */
export async function backfillOverlay(input: OverlayBackfillInput): Promise<BackfillResult> {
	const result: BackfillResult = { inserted: 0, updated: 0, skipped: 0 };
	const desired = new Map<string, { version: string, enabled: boolean, source: "builtin" | "solution" }>();

	for (const [name, version] of Object.entries(input.lock))
		desired.set(`${name}@${version}`, { version, enabled: true, source: "solution" });

	for (const [name, e] of Object.entries(input.solutions)) {
		const version = input.lock[name] ?? e.version;
		desired.set(`${name}@${version}`, { version, enabled: e.enabled !== false, source: "solution" });
	}

	// 第三路（优先级最高——它是 enabled=false 的唯一可靠存留点）
	for (const e of input.manifest) {
		if (e.enabled === false) {
			const known = desired.get(`${e.name}@${e.version}`);
			desired.set(`${e.name}@${e.version}`, { version: e.version, enabled: false, source: known?.source ?? "builtin" });
		}
	}

	const existing = await readOverlayRows();
	for (const [key, want] of desired) {
		const [name] = key.split("@");
		const before = existing.find(r => r.name === name && r.version === want.version);
		if (before && Number(before.enabled) === (want.enabled ? 1 : 0) && before.source === want.source) {
			result.skipped++;
			continue;
		}
		await upsertOverlayRow({
			name,
			version: want.version,
			enabled: want.enabled ? 1 : 0,
			source: want.source,
			face_ref: null,
			actor: input.actor,
			old_state: before ? JSON.stringify({ enabled: Number(before.enabled) }) : null,
		});
		if (before)
			result.updated++;
		else
			result.inserted++;
	}
	return result;
}
