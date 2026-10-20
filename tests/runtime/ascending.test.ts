import type { AppRouteRecordRaw } from "#src/router/types";
import { describe, expect, it } from "vitest";

import { ascending } from "#src/router/utils/ascending";

/**
 * 双段序轴契约（2026-10-20）：
 *   - order >= 0：主菜单区，升序在前；
 *   - order < 0 ：底部固定区，升序在后（渲染层 pin 侧边栏底部，-2 在 -1 上面）；
 *   - 未声明 order：数组下标兜底（下标 + 2）；order: 0 是合法值不被吞（?? 判定）；
 *   - 同 order：按根 path 字母序稳定排列。
 */
function route(path: string, order?: number): AppRouteRecordRaw {
	return {
		path,
		handle: order === undefined ? {} : { order },
	} as AppRouteRecordRaw;
}

describe("ascending：双段序轴", () => {
	it("负 order 落末段，段内升序（-2 在 -1 上面）", () => {
		const sorted = ascending([route("/b", -1), route("/a", 10), route("/c", -2)]);
		expect(sorted.map(r => r.path)).toEqual(["/a", "/c", "/b"]);
	});

	it("主区升序 + 未声明按数组下标兜底", () => {
		const sorted = ascending([route("/z"), route("/a", 50), route("/m")]);
		expect(sorted.map(r => r.path)).toEqual(["/z", "/m", "/a"]);
		// 兜底值写入 handle.order：/z 下标 0 → 2，/m 下标 2 → 4
		expect(sorted[0].handle.order).toBe(2);
		expect(sorted[1].handle.order).toBe(4);
	});

	it("order: 0 是合法值，不被兜底吞掉（?? 判定）", () => {
		const sorted = ascending([route("/b", 1), route("/a", 0)]);
		expect(sorted.map(r => r.path)).toEqual(["/a", "/b"]);
		expect(sorted[0].handle.order).toBe(0);
	});

	it("同 order 按根 path 字母序稳定排列", () => {
		const sorted = ascending([route("/charlie", 7), route("/alpha", 7), route("/bravo", 7)]);
		expect(sorted.map(r => r.path)).toEqual(["/alpha", "/bravo", "/charlie"]);
	});

	it("底部段内同 order 同样按根 path 字母序", () => {
		const sorted = ascending([route("/sys", -100), route("/adm", -100)]);
		expect(sorted.map(r => r.path)).toEqual(["/adm", "/sys"]);
	});

	it("无负 order 时顺序与普通升序一致（不产生空段位移）", () => {
		const sorted = ascending([route("/c", 3), route("/a", 1), route("/b", 2)]);
		expect(sorted.map(r => r.path)).toEqual(["/a", "/b", "/c"]);
	});
});
