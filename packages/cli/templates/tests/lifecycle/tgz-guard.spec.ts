// BDD：tgz 成员守卫（R1，P1-2）。zip-slip 防护的校验核。
// 输入契约：`tar -tvzf` 的逐行输出；成员名取行内最后一个空格分隔字段；
// 条目类型取权限串首字符（l=symlink、h=hardlink）；symlink 行成员名取箭头左侧。
// 拒绝：绝对路径、任何 `..` 段、l/h 条目、空成员名、反斜杠路径；`./` 前缀相对合法。
import { describe, expect, it } from "vitest";

import { MAX_ENTRIES, MAX_PACKAGE_BYTES, MAX_SINGLE_ENTRY_BYTES, MAX_UNPACKED_BYTES } from "../../src/_platform/api/_lifecycle/limits";
import { accumulateTarVolume, checkTarVolumeLimits, extractTarEntrySize, validateTarListing } from "../../src/_platform/api/_lifecycle/tgz-guard";

describe("validateTarListing（R1）", () => {
	it("正常成员列表通过", () => {
		expect(validateTarListing([
			"drwxr-xr-x  0 ever staff    0 10 17 12:00 wiki-0.2.0/",
			"-rw-r--r--  0 ever staff   42 10 17 12:00 wiki-0.2.0/src/manifest.yaml",
		])).toEqual({ ok: true });
	});

	it("嵌套合法相对路径通过", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 12:00 wiki-0.2.0/src/a/b/c.yaml",
		])).toEqual({ ok: true });
	});

	it("`./` 前缀视为相对合法", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff   42 10 17 12:00 ./wiki-0.2.0/src/manifest.yaml",
		])).toEqual({ ok: true });
	});

	it("成员名含连续点但非 `..` 段通过", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 12:00 wiki-0.2.0/a..b/file",
		])).toEqual({ ok: true });
	});

	it("`../evil` 拒绝并报 offender", () => {
		expect(validateTarListing([
			"drwxr-xr-x  0 ever staff    0 10 17 12:00 wiki-0.2.0/",
			"-rw-r--r--  0 ever staff    7 10 17 12:00 ../evil",
		])).toEqual({ ok: false, offender: "../evil" });
	});

	it("路径中段的 `..` 拒绝", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 12:00 wiki-0.2.0/../../etc/passwd",
		])).toEqual({ ok: false, offender: "wiki-0.2.0/../../etc/passwd" });
	});

	it("绝对路径拒绝", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 12:00 /etc/passwd",
		])).toEqual({ ok: false, offender: "/etc/passwd" });
	});

	it("symlink（l 类型）拒绝，offender 取箭头左侧成员名", () => {
		expect(validateTarListing([
			"lrwxr-xr-x  0 ever staff    0 10 17 12:00 link -> /etc",
		])).toEqual({ ok: false, offender: "link" });
	});

	it("hardlink（h 类型）拒绝", () => {
		expect(validateTarListing([
			"hrwxr-xr-x  0 ever staff    0 10 17 12:00 wiki-0.2.0/dup",
		])).toEqual({ ok: false, offender: "wiki-0.2.0/dup" });
	});

	it("空成员名（无字段的退化行）拒绝", () => {
		expect(validateTarListing([""])).toEqual({ ok: false, offender: "" });
	});

	it("windows 风格反斜杠路径防御性拒绝", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 12:00 wiki-0.2.0\\src\\manifest.yaml",
		])).toEqual({ ok: false, offender: "wiki-0.2.0\\src\\manifest.yaml" });
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 12:00 ..\\evil",
		])).toEqual({ ok: false, offender: "..\\evil" });
	});

	it("空格成员名内藏 `..` 逃逸拒绝（R1 评审构造行）", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 15:01 ./wiki-0.2.0/../../evil pwn",
		])).toEqual({ ok: false, offender: "./wiki-0.2.0/../../evil" });
	});

	it("空格成员名以 `/` 开头的逃逸形态拒绝", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 15:01 /etc x",
		])).toEqual({ ok: false, offender: "/etc" });
	});

	it("`tar: …` 警告杂行拒绝（tar 的 stderr 混入）", () => {
		expect(validateTarListing([
			"tar: ../evil",
		])).toEqual({ ok: false, offender: "../evil" });
	});

	it("多个坏成员时报第一个 offender", () => {
		expect(validateTarListing([
			"-rw-r--r--  0 ever staff    7 10 17 12:00 /abs",
			"-rw-r--r--  0 ever staff    7 10 17 12:00 ../evil",
		])).toEqual({ ok: false, offender: "/abs" });
	});
});

// ── REG-CS8 体积闸门（红队 F1）：复用同一份 tar 清单累加，不额外跑一次 tar ──

describe("extractTarEntrySize（REG-CS8 跨实现形态稳健解析）", () => {
	it("gNU 月日形（-rw-r--r-- … SIZE 10 17 12:00 name）解析出 size", () => {
		expect(extractTarEntrySize("-rw-r--r--  0 ever staff   42 10 17 12:00 wiki-0.2.0/src/manifest.yaml")).toBe(42);
	});

	it("gNU-ISO 形（-rw-r--r-- … SIZE 2026-10-17 12:00 name）解析出 size", () => {
		expect(extractTarEntrySize("-rw-r--r--  0 ever staff   42 2026-10-17 12:00 wiki-0.2.0/src/manifest.yaml")).toBe(42);
	});

	it("bSD 形（-rw-r--r-- … SIZE Mon DD HH:MM name）解析出 size", () => {
		expect(extractTarEntrySize("-rw-r--r--  0 ever staff   42 Oct 17 12:00 wiki-0.2.0/src/manifest.yaml")).toBe(42);
	});

	it("目录行（size=0）解析为 0，不影响体积判定", () => {
		expect(extractTarEntrySize("drwxr-xr-x  0 ever staff    0 10 17 12:00 wiki-0.2.0/")).toBe(0);
	});

	it("畸形行（无日期组）回退 0，不抛错", () => {
		expect(extractTarEntrySize("-rw-r--r--  0 ever staff")).toBe(0);
	});

	it("gNU 旧 mtime 形（省略时刻，只剩 ISO 日期）解析出 size，不漏体积闸门", () => {
		expect(extractTarEntrySize("-rw-r--r--  0 ever staff   42 2026-10-17 wiki-0.2.0/src/manifest.yaml")).toBe(42);
	});

	it("bSD 旧 mtime 形（省略时刻，年份替代）解析出 size，不漏体积闸门", () => {
		expect(extractTarEntrySize("-rw-r--r--  0 ever staff   42 Oct 17 2023 wiki-0.2.0/src/manifest.yaml")).toBe(42);
	});

	it("旧 mtime 大单条目仍命中 entry_too_large（REG-CS8 不漏）", () => {
		const big = MAX_SINGLE_ENTRY_BYTES + 1;
		const r = checkTarVolumeLimits([
			`-rw-r--r--  0 ever staff   ${big} 2026-10-17 wiki-0.2.0/bomb`,
		]);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.code).toBe("entry_too_large");
	});
});

describe("accumulateTarVolume（REG-CS8 累加统计）", () => {
	it("累加条目数/未压缩总体积/单条目最大体积", () => {
		const v = accumulateTarVolume([
			"drwxr-xr-x  0 ever staff    0 10 17 12:00 wiki-0.2.0/",
			"-rw-r--r--  0 ever staff   10 10 17 12:00 wiki-0.2.0/a",
			"-rw-r--r--  0 ever staff   30 10 17 12:00 wiki-0.2.0/b",
		]);
		expect(v).toEqual({ entries: 3, totalUncompressed: 40, maxEntry: 30 });
	});

	it("空行/退化行跳过不计数", () => {
		const v = accumulateTarVolume(["", "   ", "-rw-r--r--  0 ever staff    7 10 17 12:00 wiki-0.2.0/x"]);
		expect(v).toEqual({ entries: 1, totalUncompressed: 7, maxEntry: 7 });
	});
});

describe("checkTarVolumeLimits（REG-CS8 三闸：条目数 → 总体积 → 单条目，先罚整体再罚单点）", () => {
	it("合法清单通过，并回传 volume", () => {
		const lines = [
			"drwxr-xr-x  0 ever staff    0 10 17 12:00 wiki-0.2.0/",
			"-rw-r--r--  0 ever staff   42 10 17 12:00 wiki-0.2.0/src/manifest.yaml",
		];
		const r = checkTarVolumeLimits(lines);
		expect(r.ok).toBe(true);
		if (r.ok)
			expect(r.volume).toEqual({ entries: 2, totalUncompressed: 42, maxEntry: 42 });
	});

	it("too_many_entries：条目数 > 上限（MAX_ENTRIES）即拒", () => {
		const lines: string[] = [];
		for (let i = 0; i < MAX_ENTRIES + 1; i++)
			lines.push(`-rw-r--r--  0 ever staff    1 10 17 12:00 wiki-0.2.0/f${i}`);
		const r = checkTarVolumeLimits(lines);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.code).toBe("too_many_entries");
			expect(r.offender).toContain(String(MAX_ENTRIES + 1));
		}
	});

	it("unpacked_too_large：未压缩总体积 > 上限（MAX_UNPACKED_BYTES）即拒", () => {
		// 单条目均 < 上限（40MB），靠总和越界——确认命中「总体积闸」而非「单条目闸」
		const safe = 40 * 1024 * 1024;
		const n = Math.ceil((MAX_UNPACKED_BYTES + 1) / safe);
		const lines: string[] = [];
		for (let i = 0; i < n; i++)
			lines.push(`-rw-r--r--  0 ever staff   ${safe} 10 17 12:00 wiki-0.2.0/f${i}`);
		const r = checkTarVolumeLimits(lines);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.code).toBe("unpacked_too_large");
			expect(r.volume.entries).toBe(n);
		}
	});

	it("entry_too_large：单条目未压缩体积 > 上限（MAX_SINGLE_ENTRY_BYTES）即拒", () => {
		const big = MAX_SINGLE_ENTRY_BYTES + 1;
		const r = checkTarVolumeLimits([
			"drwxr-xr-x  0 ever staff    0 10 17 12:00 wiki-0.2.0/",
			`-rw-r--r--  0 ever staff   ${big} 10 17 12:00 wiki-0.2.0/bomb`,
		]);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.code).toBe("entry_too_large");
			expect(r.offender).toContain(String(big));
		}
	});

	it("三闸序位：条目数越界先于总体积/单条目（批量伪造清单优先罚整体维度）", () => {
		// 同一条清单既条目数越界、又单条目越界——应报 too_many_entries（先罚整体）
		const lines: string[] = [];
		for (let i = 0; i < MAX_ENTRIES + 1; i++)
			lines.push(`-rw-r--r--  0 ever staff   ${MAX_SINGLE_ENTRY_BYTES + 1} 10 17 12:00 wiki-0.2.0/f${i}`);
		const r = checkTarVolumeLimits(lines);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.code).toBe("too_many_entries");
	});
});

describe("体积上限常量（REG-CS8，Q13 拍板数值，全仓单源）", () => {
	it("四常数口径与需求一致（50MB/200MB/5000/50MB）", () => {
		expect(MAX_PACKAGE_BYTES).toBe(50 * 1024 * 1024);
		expect(MAX_UNPACKED_BYTES).toBe(200 * 1024 * 1024);
		expect(MAX_ENTRIES).toBe(5000);
		expect(MAX_SINGLE_ENTRY_BYTES).toBe(50 * 1024 * 1024);
	});
});
