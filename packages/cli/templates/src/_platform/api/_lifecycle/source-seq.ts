// REG-CS2 索引新鲜度（防回放/降级）：站点按源记住「见过的最大 seq」，回退即拒。
//
// 记在站点 DB（`reg_source_seq`，0014 迁移）而不记在 CLI：受害者是**站点**——镜像把旧索引
// 回放给谁，谁就是被降级的一方（D1 已定，CLI/API 一致）。CLI 侧 `ojm market verify` 是
// 离线单点校验，没有「上次见过的 seq」，故不做这项判定。
//
// fail-closed 口径（与 REG-CS1 同源）：
// - 读不到 / 读到非正整数 / 写入失败 —— 一律按 `index_state_corrupt` 拒，不静默重置。
//   静默重置等于把「防回放」降级成「每次都当第一次见」，攻击者先破坏状态再回放即穿。
// - 表不存在同样算读不到：迁移由 _platform 自带，起不来就该响，不该悄悄放行。

// db 为 oj isolate 注入全局（同模板 service 层惯例，history.ts 同款；测试由夹具装 globalThis.db）
declare const db: { table: (name: string) => any };

export const SOURCE_SEQ_TABLE = "reg_source_seq";

/** 判定：ok = 放行并已记录；!ok = 拒，`code` 区分「回放/降级」与「状态损坏」 */
export type SourceSeqVerdict = {
	ok: true
	prev: number | null
} | {
	ok: false
	code: "index_stale" | "index_state_corrupt"
	prev: number | null
};

/**
 * 比对并推进某个源的最大 seq。
 *
 * - 首次见（无行）→ 记录并放行；
 * - 同 seq 重复拉取 → 放行（幂等，不误伤正常重复请求），不重复写；
 * - seq 回退（< 记录值）→ `index_stale` 拒，且不覆盖记录（不能让回放把水位拉低）。
 */
export async function guardAndRecordSourceSeq(source: string, seq: number): Promise<SourceSeqVerdict> {
	const prev = await readSourceSeq(source);
	if (prev === "corrupt")
		return { ok: false, code: "index_state_corrupt", prev: null };
	if (prev !== null && seq < prev)
		return { ok: false, code: "index_stale", prev };
	if (prev === seq)
		return { ok: true, prev };
	await writeSourceSeq(source, seq);
	return { ok: true, prev };
}

/** 读取记录：无行 → null；读不到或非正整数 → "corrupt"（bigint 是 pg/mysql 的整型口径，一并认） */
export async function readSourceSeq(source: string): Promise<number | null | "corrupt"> {
	let rows: Array<{ max_seq?: unknown }>;
	try {
		rows = await db.table(SOURCE_SEQ_TABLE)
			.select(["max_seq"])
			.where({ field: "source_url", op: "eq", value: source })
			.limit(1)
			.all() as Array<{ max_seq?: unknown }>;
	}
	catch {
		return "corrupt";
	}
	if (!Array.isArray(rows) || rows.length === 0)
		return null;
	const raw = rows[0]?.max_seq;
	if (typeof raw === "bigint")
		return raw >= 1n ? Number(raw) : "corrupt";
	if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1)
		return raw;
	return "corrupt";
}

/** 写入（首次 insert / 其后 update）；写失败抛 —— 由调用方按 fail-closed 转成 index_state_corrupt */
export async function writeSourceSeq(source: string, seq: number): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	const rows = await db.table(SOURCE_SEQ_TABLE)
		.select(["source_url"])
		.where({ field: "source_url", op: "eq", value: source })
		.limit(1)
		.all() as Array<unknown>;
	if (rows.length === 0)
		await db.table(SOURCE_SEQ_TABLE).insert({ source_url: source, max_seq: seq, updated_at: now }).run();
	else
		await db.table(SOURCE_SEQ_TABLE).update({ max_seq: seq, updated_at: now }).where({ field: "source_url", op: "eq", value: source }).run();
}
