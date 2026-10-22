import type { OjProcess } from "../../packages/cli/src/oj";
import http from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinFooter, setupDevKeymap } from "../../packages/cli/src/dev";

/**
 * dev 快捷键提示常驻底栏（DECSTBM 滚动区）：末行画提示，日志在其上方滚动。
 * 见 docs/plans/2026-10-22-dev-footer-plan.md 用例 F1–F6 / K1。
 */

function makeInput() {
	return new PassThrough();
}

function tick() {
	return new Promise(r => setTimeout(r, 10));
}

function makeTty(rows = 24) {
	const written: string[] = [];
	const stream = {
		isTTY: true,
		rows,
		write: (chunk: unknown) => {
			written.push(String(chunk));
			return true;
		},
	} as unknown as NodeJS.WriteStream;
	return { stream, written };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("pinFooter（快捷键提示常驻底栏）", () => {
	it("f1 TTY 初始化：设滚动区 1..rows-1，末行渲染提示", () => {
		const { stream, written } = makeTty(24);
		const footer = pinFooter("[ojm] 快捷键：r 热更新 · q 退出", stream);
		expect(footer).toBeDefined();
		const out = written.join("");
		expect(out).toContain("\x1B[1;23r");
		expect(out).toContain("\x1B[24;1H");
		expect(out).toContain("[ojm] 快捷键：r 热更新 · q 退出");
		footer!.stop();
	});

	it("f2 非 TTY：返回 undefined 且零输出（回退一次性打印）", () => {
		const { stream, written } = makeTty(24);
		Object.assign(stream, { isTTY: false });
		expect(pinFooter("x", stream)).toBeUndefined();
		expect(written).toHaveLength(0);
	});

	it("f3 行数不足（rows=2）：返回 undefined，末行无空间不折腾", () => {
		const { stream } = makeTty(2);
		expect(pinFooter("x", stream)).toBeUndefined();
	});

	it("f4 清屏用 ED（\x1B[2J，保留滚动区）而非 RIS（\x1Bc），并重绘提示", () => {
		const { stream, written } = makeTty(24);
		const footer = pinFooter("[ojm] 快捷键", stream)!;
		written.length = 0;
		footer.clear();
		const out = written.join("");
		expect(out).toContain("\x1B[2J");
		expect(out).not.toContain("\x1Bc");
		expect(out).toContain("[ojm] 快捷键");
		footer.stop();
	});

	it("f5 SIGWINCH 按新行数重建滚动区并重绘", async () => {
		const { stream, written } = makeTty(24);
		const footer = pinFooter("[ojm] 快捷键", stream)!;
		written.length = 0;
		(stream as unknown as { rows: number }).rows = 40;
		process.emit("SIGWINCH");
		await tick();
		const out = written.join("");
		expect(out).toContain("\x1B[1;39r");
		expect(out).toContain("\x1B[40;1H");
		footer.stop();
	});

	it("f6 stop 恢复全屏滚动区，且幂等", () => {
		const { stream, written } = makeTty(24);
		const footer = pinFooter("[ojm] 快捷键", stream)!;
		written.length = 0;
		footer.stop();
		footer.stop();
		expect(written.join("").split("\x1B[r")).toHaveLength(2);
	});
});

describe("setupDevKeymap clearScreen 注入（K1）", () => {
	it("注入 clearScreen 后按 c：走注入实现，不再直接写 \\x1Bc", async () => {
		const input = makeInput();
		const clearScreen = vi.fn();
		const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		setupDevKeymap({
			server: http.createServer(),
			oj: undefined,
			hub: { close: () => {} },
			port: 5174,
			input,
			onReload: () => {},
			onQuit: () => {},
			clearScreen,
		});
		input.write("c");
		await tick();
		expect(clearScreen).toHaveBeenCalledTimes(1);
		expect(spy).not.toHaveBeenCalledWith("\x1Bc");
	});

	it("k2 未注入按 c：默认仍写 \x1Bc（既有行为）", async () => {
		const input = makeInput();
		const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		setupDevKeymap({
			server: http.createServer(),
			oj: { port: 1, ready: Promise.resolve(), stop: async () => {}, kill: () => {} } as OjProcess,
			hub: { close: () => {} },
			port: 5174,
			input,
			onReload: () => {},
			onQuit: () => {},
		});
		input.write("c");
		await tick();
		expect(spy).toHaveBeenCalledWith("\x1Bc");
	});
});
