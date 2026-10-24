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
 * verbose 行形态跨实现有差异，按「时间锚点」稳健解析：先定位含 ":" 的时间 token，
 * 其左侧紧邻的日期区（ISO 日期 / 月日）之前那个数值 token 即 size——
 * 兼容 GNU（`YYYY-MM-DD HH:MM` 合并日期）、GNU 月日形、BSD（`Mon DD HH:MM`）三态。
 * 解析不出（畸形行 / 目录行无尺寸）回退 0，不影响 zip-slip 判定。
 */
export function extractTarEntrySize(line: string): number {
	const tokens = line.trim().split(/\s+/);
	if (tokens.length < 2)
		return 0;
	let timeIdx = -1;
	for (let i = 0; i < tokens.length; i++) {
		if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(tokens[i]!)) {
			timeIdx = i;
			break;
		}
	}
	if (timeIdx < 1)
		return 0;
	// timeIdx-1：BSD = 日（数字）；GNU-ISO = 日期；GNU 月日形 = 日
	const beforeTime = tokens[timeIdx - 1]!;
	let sizeIdx: number;
	if (/^\d{4}-\d{2}-\d{2}$/.test(beforeTime)) {
		sizeIdx = timeIdx - 2; // GNU-ISO：日期在 timeIdx-1，size 在 timeIdx-2
	}
	else {
		sizeIdx = timeIdx - 3; // BSD / GNU 月日：月(timeIdx-2) 日(timeIdx-1) 之前是 size
	}
	if (sizeIdx < 0)
		return 0;
	const n = Number(tokens[sizeIdx]);
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
