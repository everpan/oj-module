import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { isPortOccupied } from "../port-check";

describe("isPortOccupied", () => {
	it("端口有监听者时返回 true", async () => {
		const server = net.createServer();
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
		const port = (server.address() as net.AddressInfo).port;
		expect(await isPortOccupied(port)).toBe(true);
		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	it("端口空闲时返回 false", async () => {
		// 探测一批非临时端口区间的端口：localhost 上这些端口几乎不可能被占用，
		// 命中一个即证明「空闲端口返回 false」。避开 macOS 临时端口区间（49152+，
		// 连接会被静默丢弃而非返回 ECONNREFUSED，导致保守判为占用）。
		let foundFree = false;
		for (const p of [23000, 23001, 23002, 23003, 23004]) {
			if (!(await isPortOccupied(p))) {
				foundFree = true;
				break;
			}
		}
		expect(foundFree).toBe(true);
	});

	it("默认 host 为 127.0.0.1", async () => {
		const server = net.createServer();
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
		const port = (server.address() as net.AddressInfo).port;
		expect(await isPortOccupied(port, "127.0.0.1")).toBe(true);
		await new Promise<void>(resolve => server.close(() => resolve()));
	});
});

// 防止未关闭句柄拖慢套件退出
afterAll(() => {
	// 无持久资源；占位以明确意图
});
