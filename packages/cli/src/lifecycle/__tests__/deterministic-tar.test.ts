// BDD：确定性 tgz（P1-11，契约 C2-32/C2-30）。
// 硬验收（简报逐字）：同一目录两次打包 sha256 必须相等——mtime/umask/遍历序不得泄漏进产物。
// 打包自检（C2-30 构建列）：symlink/硬链接成员拒绝；产物可被系统 tar -tvzf/-xzf 消费
// （安装侧 extract 段即系统 tar，P1-6 铁律①——本侧产物与彼侧输入契约互为镜像）。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeterministicTgz } from "../../deterministic-tar";

let dir: string;
let outDir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ojm-dtar-src-"));
	outDir = mkdtempSync(join(tmpdir(), "ojm-dtar-out-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	rmSync(outDir, { recursive: true, force: true });
});

/** 组装样例树（单根 pkg/ = bundle staging 形态）：文件（多目录嵌套）/空目录/utf-8 内容；b-dir 先创建（创建序 ≠ 字典序） */
function makeTree(root: string): void {
	const p = join(root, "pkg");
	mkdirSync(join(p, "b-dir/sub"), { recursive: true });
	mkdirSync(join(p, "a-dir"), { recursive: true });
	writeFileSync(join(p, "b-dir/sub/entry.js"), "export default 1;\n");
	writeFileSync(join(p, "b-dir/zh.txt"), "中文内容\n");
	writeFileSync(join(p, "root.txt"), "root\n");
	writeFileSync(join(p, "a-dir/first.css"), ".a{}\n");
	mkdirSync(join(p, "b-dir/empty-dir"), { recursive: true }); // 空目录（fixture migrations/ 同形态）
}

/** 全树设置指定 mtime（确定性负对照：mtime 不得泄漏进包） */
function setTreeMtime(root: string, mtime: Date): void {
	const walk = (p: string) => {
		utimesSync(p, mtime, mtime);
		if (!statSync(p).isDirectory())
			return;
		for (const e of readdirSync(p))
			walk(join(p, e));
	};
	walk(root);
}

/** 打包 + 以系统 `tar -tvzf` 读回成员名列表（安装侧 extract 段同款消费面） */
async function packAndList(tgz: string): Promise<{ names: string[], listing: string[], sha256: string }> {
	const sha256 = await createDeterministicTgz(dir, join(outDir, tgz));
	const listing = tarList(join(outDir, tgz));
	return { names: memberNames(listing), listing, sha256 };
}

describe("createDeterministicTgz · 确定性（C2-32 硬验收）", () => {
	it("同目录两次打包 sha256 相等（mtime/遍历序不泄漏）", async () => {
		makeTree(dir);
		setTreeMtime(dir, new Date(1_700_000_000_000));
		const sha1 = await createDeterministicTgz(dir, join(outDir, "a.tgz"));
		setTreeMtime(dir, new Date(1_800_000_000_000));
		const sha2 = await createDeterministicTgz(dir, join(outDir, "b.tgz"));
		expect(sha1).toMatch(/^[a-f0-9]{64}$/);
		expect(sha1).toBe(sha2);
	});

	it("内容变化 → sha256 变化（负对照：不是恒等哈希）", async () => {
		makeTree(dir);
		const sha1 = await createDeterministicTgz(dir, join(outDir, "a.tgz"));
		writeFileSync(join(dir, "root.txt"), "changed\n");
		const sha2 = await createDeterministicTgz(dir, join(outDir, "b.tgz"));
		expect(sha1).not.toBe(sha2);
	});

	it("成员按路径字典序（创建顺序无关）、单根居首", async () => {
		makeTree(dir);
		const { names } = await packAndList("a.tgz");
		const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		expect(names).toEqual(sorted);
		expect(names[0]).toMatch(/\/$/); // 唯一顶层目录成员居首
	});
});

describe("createDeterministicTgz · 产物可被系统 tar 消费（extract 段输入契约）", () => {
	it("tar -tvzf：单根、含空目录成员、mtime 显示 1970（=0）", async () => {
		makeTree(dir);
		const { names, listing } = await packAndList("a.tgz");
		const topDirs = names.filter(n => n.endsWith("/") && !n.slice(0, -1).includes("/"));
		expect(topDirs).toHaveLength(1);
		expect(names).toContain(`${topDirs[0]}b-dir/empty-dir/`);
		expect(listing.join("\n")).toContain("1970");
	});

	it("tar -xzf 解压还原：内容一致、权限 0644/0755（umask 无关）、空目录还原", async () => {
		makeTree(dir);
		const { names } = await packAndList("a.tgz");
		const extractDir = join(outDir, "unpacked");
		mkdirSync(extractDir);
		execFileSync("tar", ["-xzf", join(outDir, "a.tgz"), "-C", extractDir]);
		const root = join(extractDir, names[0]!.slice(0, -1));
		expect(readFileSync(join(root, "b-dir/zh.txt"), "utf8")).toBe("中文内容\n");
		expect(existsSync(join(root, "b-dir/empty-dir"))).toBe(true);
		expect(statSync(join(root, "b-dir/sub/entry.js")).mode & 0o777).toBe(0o644);
		expect(statSync(join(root, "b-dir")).mode & 0o777).toBe(0o755);
	});
});

describe("createDeterministicTgz · 打包自检（C2-30 构建列）", () => {
	it("symlink 成员拒绝（tar 忠实还原链接，校验为安全必需）", async () => {
		makeTree(dir);
		symlinkSync(join(dir, "root.txt"), join(dir, "evil-link"));
		await expect(createDeterministicTgz(dir, join(outDir, "a.tgz"))).rejects.toThrow(/symlink|链接/i);
	});

	it("超长路径（ustar name+prefix 容量外）拒绝且可读", async () => {
		// 单文件名 250 字符（fs 文件名上限内、无 "/" 可拆 prefix）→ ustar 必然容量外
		writeFileSync(join(dir, "x".repeat(250)), "x");
		await expect(createDeterministicTgz(dir, join(outDir, "a.tgz"))).rejects.toThrow(/路径|155|100/);
	});

	it("输出自动建父目录并落盘", async () => {
		makeTree(dir);
		const out = join(outDir, "deep/nested/pkg.tgz");
		await createDeterministicTgz(dir, out);
		expect(existsSync(out)).toBe(true);
	});
});

// ── 助手 ──

function tarList(tgz: string): string[] {
	return execFileSync("tar", ["-tvzf", tgz], { encoding: "utf8" })
		// 铁律②（P1-6）：tar 输出恒带尾随换行，trim 后再 split
		.trim()
		.split("\n");
}

/** 从 `tar -tvzf` 行提取成员名（bsdtar：`-rw-r--r-- 0/0 2026-.. name`；成员名不含空格——确定性产物） */
function memberNames(listing: string[]): string[] {
	return listing.map((line) => {
		const m = /\s(?:\d+|\S[^\s/]*\/\S+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s(.+)$/.exec(line);
		return m ? m[1]! : line.split(" ").pop()!;
	});
}
