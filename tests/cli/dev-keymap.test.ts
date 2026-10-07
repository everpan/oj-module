import type { OjProcess } from "../../packages/cli/src/oj";
import http from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupDevKeymap } from "../../packages/cli/src/dev";

/**
 * dev 快捷键（Vite 风格）：r 热更新 / h 帮助 / c 清屏 / o 打开浏览器 / q 退出。
 * 用 PassThrough 注入键盘输入流，避免抢占测试进程 stdin。
 */

function makeInput() {
	return new PassThrough();
}

function tick() {
	return new Promise(r => setTimeout(r, 10));
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("setupDevKeymap（ojm dev 快捷键）", () => {
	it("r → 触发热更新（onReload）", async () => {
		const input = makeInput();
		const onReload = vi.fn();
		setupDevKeymap({
			server: http.createServer(),
			oj: undefined,
			hub: { close: () => {} },
			port: 5174,
			input,
			onReload,
			onQuit: () => {},
		});
		input.write("r");
		await tick();
		expect(onReload).toHaveBeenCalledTimes(1);
	});

	it("h → 打印快捷键帮助", async () => {
		const input = makeInput();
		const logs: string[] = [];
		setupDevKeymap({
			server: http.createServer(),
			oj: undefined,
			hub: { close: () => {} },
			port: 5174,
			input,
			onReload: () => {},
			onQuit: () => {},
			log: (m: string) => logs.push(m),
		});
		input.write("h");
		await tick();
		expect(logs.join("\n")).toContain("ojm dev 快捷键");
	});

	it("c → 向 stdout 写清屏序列 \\x1Bc", async () => {
		const input = makeInput();
		const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		setupDevKeymap({
			server: http.createServer(),
			oj: undefined,
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

	it("o → 以 dev 地址调用 openBrowser", async () => {
		const input = makeInput();
		const openBrowser = vi.fn();
		setupDevKeymap({
			server: http.createServer(),
			oj: undefined,
			hub: { close: () => {} },
			port: 5174,
			input,
			onReload: () => {},
			onQuit: () => {},
			openBrowser,
		});
		input.write("o");
		await tick();
		expect(openBrowser).toHaveBeenCalledWith("http://localhost:5174");
	});

	it("q → 触发退出（onQuit，后端 oj 一并终止）", async () => {
		const input = makeInput();
		const onQuit = vi.fn();
		setupDevKeymap({
			server: http.createServer(),
			oj: { port: 1, ready: Promise.resolve(), stop: async () => {}, kill: () => {} } as OjProcess,
			hub: { close: () => {} },
			port: 5174,
			input,
			onReload: () => {},
			onQuit,
		});
		input.write("q");
		await tick();
		expect(onQuit).toHaveBeenCalledTimes(1);
	});

	it("ctrl+C（\x03）→ 等价退出（raw 模式不触发 SIGINT 时）", async () => {
		const input = makeInput();
		const onQuit = vi.fn();
		setupDevKeymap({
			server: http.createServer(),
			oj: undefined,
			hub: { close: () => {} },
			port: 5174,
			input,
			onReload: () => {},
			onQuit,
		});
		input.write("\x03");
		await tick();
		expect(onQuit).toHaveBeenCalledTimes(1);
	});

	it("非字符键（方向键等）被忽略，不误触快捷键", async () => {
		const input = makeInput();
		const onReload = vi.fn();
		const onQuit = vi.fn();
		setupDevKeymap({
			server: http.createServer(),
			oj: undefined,
			hub: { close: () => {} },
			port: 5174,
			input,
			onReload,
			onQuit,
		});
		input.write("\x1B[A"); // 上方向键（ESC [ A）
		await tick();
		expect(onReload).not.toHaveBeenCalled();
		expect(onQuit).not.toHaveBeenCalled();
	});
});
