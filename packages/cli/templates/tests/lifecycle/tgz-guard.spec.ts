// BDD：tgz 成员守卫（R1，P1-2）。zip-slip 防护的校验核。
// 输入契约：`tar -tvzf` 的逐行输出；成员名取行内最后一个空格分隔字段；
// 条目类型取权限串首字符（l=symlink、h=hardlink）；symlink 行成员名取箭头左侧。
// 拒绝：绝对路径、任何 `..` 段、l/h 条目、空成员名、反斜杠路径；`./` 前缀相对合法。
import { describe, expect, it } from "vitest";

import { validateTarListing } from "../../src/_platform/api/_lifecycle/tgz-guard";

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
