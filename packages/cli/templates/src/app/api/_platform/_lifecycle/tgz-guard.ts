// tgz 成员守卫（R1）：zip-slip 防护的校验核，纯函数、无依赖。
// 输入契约：`tar -tvzf` 的逐行输出（P1-6 extract 步骤必须喂 verbose 形态；
// 非 verbose `tar -tzf` 是裸成员名，首字符会撞 l/h 误拒——勿换）。
// 条目类型取权限串首字符（l=symlink、h=hardlink）；symlink 行成员名取 ` -> ` 左侧。
// 拒绝：绝对路径、任何 `..` 段、l/h 条目、空成员名、反斜杠路径（防御性）；
// `./` 前缀视为相对合法（归一化后必须在包根内）。

import { MAX_ENTRIES, MAX_SINGLE_ENTRY_BYTES, MAX_UNPACKED_BYTES } from "./limits";

function extractMemberName(line: string): string {
	const arrow = line.indexOf(" -> ");
	const entry = arrow === -1 ? line : line.slice(0, arrow);
	const trimmed = entry.trim();
	if (trimmed === "")
		return "";
	const fields = trimmed.split(/\s+/);
	return fields[fields.length - 1];
}

export function validateTarListing(lines: string[]): { ok: true } | { ok: false, offender: string } {
	for (const line of lines) {
		const name = extractMemberName(line);
		// 空成员名：退化行（空行/无名字段）一律拒绝，安全边界不做容错
		if (name === "")
			return { ok: false, offender: "" };
		const type = line.trimStart()[0];
		if (type === "l" || type === "h")
			return { ok: false, offender: name };
		// 成员名并非可靠来源：bsdtar 成员名可含空格，`../evil` 可藏在中段 token 里。
		// 路径检查覆盖行的全部空白分隔 token（日期/时刻 token 不含 `..`，不误杀）；
		// 任一 token 以 `/` 开头即拒（封「空格名 `/etc x`」形态）。
		// `C:/x` 这类盘符前缀不拒：POSIX 下是合法相对目录名、无逃逸力，反斜杠形态才拒。
		for (const token of line.split(/\s+/)) {
			if (token === "")
				continue;
			if (token.startsWith("/") || token.includes("\\"))
				return { ok: false, offender: token };
			if (token.split("/").includes(".."))
				return { ok: false, offender: token };
		}
	}
	return { ok: true };
}

// ── REG-CS8 体积闸门（红队 F1）：复用同一份 tar 清单累加体积/条目数/单条目最大体积，不额外跑一次 tar ──

/** 体积闸门错误码（installer 据此置 task.error.reason；retryable 恒 false——体积超限非可重试） */
export type VolumeCode = "too_many_entries" | "unpacked_too_large" | "entry_too_large";

export interface TarVolume {
	/** 成员条目数（含目录条目） */
	entries: number
	/** 未压缩总体积（字节） */
	totalUncompressed: number
	/** 单条目最大未压缩体积（字节） */
	maxEntry: number
}

/**
 * 从 `tar -tvzf` verbose 行提取未压缩体积（字节）。
 * 体积恒位于「日期组」紧邻左侧、成员名之前；日期组跨实现形态：
 *   GNU:  <size> [MM DD | YYYY-MM-DD] [HH:MM]   —— 旧 mtime（>6 月）省略时刻，只剩日期
 *   BSD:  <size> Mon DD [HH:MM | YYYY]          —— 旧 mtime 省略时刻，只剩年份
 * 旧实现只锚定 HH:MM，旧 mtime 行（无时刻）回退 0，使大包绕过 REG-CS8 体积闸门（zip bomb）。
 * 这里分两路：含时刻的行仍按时间回退定位（兼容 GNU-ISO / GNU 月日 / BSD 三态）；
 * 无时刻的旧 mtime 行改锚定「日期组」（ISO 日期或月份名），取前一 token 为 size。
 * 无日期组的畸形行回退 0。
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^[A-Z]{3}$/i;
const TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const DAY_OR_YEAR = /^\d{1,2}$|^\d{4}$/;

/** 定位日期组首 token 索引：含时刻则回退时间锚点；否则锚定 ISO 日期或「月份名 + 其后跟日/年份」 */
function findDateGroupStart(tokens: string[]): number {
	const timeIdx = tokens.findIndex(t => TIME.test(t));
	if (timeIdx >= 1)
		return ISO_DATE.test(tokens[timeIdx - 1]!) ? timeIdx - 1 : timeIdx - 2;
	for (let i = tokens.length - 1; i >= 0; i--) {
		const t = tokens[i]!;
		if (ISO_DATE.test(t))
			return i;
		if (MONTH.test(t)) {
			const next = tokens[i + 1] ?? "";
			if (DAY_OR_YEAR.test(next))
				return i;
		}
	}
	return -1;
}

export function extractTarEntrySize(line: string): number {
	const tokens = line.trim().split(/\s+/);
	if (tokens.length < 2)
		return 0;
	const dateGroupStart = findDateGroupStart(tokens);
	if (dateGroupStart < 1)
		return 0;
	const n = Number(tokens[dateGroupStart - 1]!.replace(/,/g, ""));
	return Number.isFinite(n) ? n : 0;
}

/** 累加清单体积统计（条目数 / 未压缩总体积 / 单条目最大体积） */
export function accumulateTarVolume(lines: string[]): TarVolume {
	let entries = 0;
	let totalUncompressed = 0;
	let maxEntry = 0;
	for (const line of lines) {
		if (line.trim() === "")
			continue;
		entries++;
		const size = extractTarEntrySize(line);
		totalUncompressed += size;
		if (size > maxEntry)
			maxEntry = size;
	}
	return { entries, totalUncompressed, maxEntry };
}

/**
 * 体积闸门（REG-CS8）：复用 validateTarListing 已消费的同一份 tar 清单逐项累加——
 * 条目数 / 未压缩总体积 / 单条目最大体积任一超限即拒，零解压零落盘。
 * 检查序：条目数 → 总体积 → 单条目（先罚「整体维度」，再罚「单点维度」）。
 */
export function checkTarVolumeLimits(lines: string[]): { ok: true, volume: TarVolume } | { ok: false, code: VolumeCode, offender: string, volume: TarVolume } {
	const volume = accumulateTarVolume(lines);
	if (volume.entries > MAX_ENTRIES) {
		return { ok: false, code: "too_many_entries", offender: `${volume.entries} 个成员（上限 ${MAX_ENTRIES}）`, volume };
	}
	if (volume.totalUncompressed > MAX_UNPACKED_BYTES) {
		return { ok: false, code: "unpacked_too_large", offender: `${volume.totalUncompressed} 字节（上限 ${MAX_UNPACKED_BYTES}）`, volume };
	}
	if (volume.maxEntry > MAX_SINGLE_ENTRY_BYTES) {
		return { ok: false, code: "entry_too_large", offender: `${volume.maxEntry} 字节（上限 ${MAX_SINGLE_ENTRY_BYTES}）`, volume };
	}
	return { ok: true, volume };
}
