import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLayout, resolveWatchTarget } from "../../packages/cli/src/layout";

/**
 * D11：布局探测收敛单一模块。2026-09-11 硬切换后只认
 * `web/src` + `web/dist`（uni-dev），旧 `modules/` 布局不再探测。
 * 关键约束：watch 目标绝不能含产物目录——watch `web/` 会把自身
 * 重建产物当源码变更，造成自触发重建循环（设计 §4 / 审阅记录一）。
 */
describe("resolveLayout", () => {
	it("web/src 存在 → 产物 web/dist，watch web/src", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lay-new-"));
		fs.mkdirSync(path.join(root, "web/src"), { recursive: true });

		const layout = resolveLayout(root);

		expect(layout.kind).toBe("new");
		expect(layout.modulesSrc).toBe(path.join(root, "web/src"));
		expect(layout.distDir).toBe(path.join(root, "web/dist"));
		expect(layout.watchTarget).toBe(path.join(root, "web/src"));
	});

	it("无 web/（存量 modules/ 工程）→ 人话报错提示迁移", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lay-old-"));
		fs.mkdirSync(path.join(root, "modules/demo"), { recursive: true });

		expect(() => resolveLayout(root)).toThrowError(/只认 web\/src/);
	});

	it("平铺 web/<name>/（框架根仓形态）→ kind flat，产物 build/", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lay-flat-"));
		fs.mkdirSync(path.join(root, "web/home"), { recursive: true });

		const layout = resolveLayout(root);

		expect(layout.kind).toBe("flat");
		expect(layout.modulesSrc).toBe(path.join(root, "web"));
		expect(layout.distDir).toBe(path.join(root, "build"));
		expect(layout.watchTarget).toBe(path.join(root, "web"));
	});

	it("resolveWatchTarget 与 resolveLayout().watchTarget 一致", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lay-"));
		fs.mkdirSync(path.join(root, "web/src"), { recursive: true });
		expect(resolveWatchTarget(root)).toBe(resolveLayout(root).watchTarget);
	});
});
