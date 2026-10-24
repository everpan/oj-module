import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { listenOnFreePort } from "../static-handler";

// 回归：listen(port, cb) 的 cb 在重试成功后以旧端口先 resolve——
// 日志「改用 5175」与「已启动 5174」并存且实际监听在 5175（2026-10-24）。
describe("listenOnFreePort", () => {
	const cleanup: Server[] = [];

	afterEach(() => {
		for (const s of cleanup.splice(0))
			s.close();
	});

	it("占用首端口时顺延，返回端口与实际监听端口一致", async () => {
		const occupier = http.createServer(() => {}).listen(0);
		cleanup.push(occupier);
		await new Promise<void>(r => occupier.on("listening", r));
		const busy = (occupier.address() as AddressInfo).port;

		const server = http.createServer(() => {});
		cleanup.push(server);
		const port = await listenOnFreePort(server, busy);
		expect(port).toBe(busy + 1);
		// 旧 bug 在此暴露：resolve 的是 busy，实际却监听在 busy+1
		expect((server.address() as AddressInfo).port).toBe(port);
	});

	it("首端口空闲时原样监听", async () => {
		const server = http.createServer(() => {});
		cleanup.push(server);
		const port = await listenOnFreePort(server, 0);
		expect((server.address() as AddressInfo).port).toBe(port);
	});
});
