import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TEMPLATE_DIR } from "../helpers/paths";

/**
 * 多根聚合模块的 client 接线回归（D11 scoped request）。
 *
 * 规则（两条，各自都能独立踩坑）：
 *   1. `__client/index.ts` 的工厂必须在同一根的 `routes.ts` 里创建——构造即 install
 *      完成 apiPrefix 登记 + scoped request 绑定；只 import 不创建 = 运行时
 *      「请求未绑定」/「尚未登记 API 前缀」（2026-09-10 回归）。
 *   2. 生成物落盘位置与认领护栏一致：client 在 `<模块>/web/<api 前缀>/__client`
 *      时，护栏必须指向归属模块（`MODULE_OWNER`），否则 DEV 下误报跨模块认领。
 */

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory())
			walk(full, out);
		else
			out.push(full);
	}
	return out;
}

/** `<...>/<归属模块>/web/<api 前缀>/__client/index.ts` → { owner, apiModule, webDir } */
function locate(clientFile: string): { owner: string, apiModule: string, webDir: string } {
	const rel = path.relative(TEMPLATE_DIR, clientFile).split(path.sep);
	const webIdx = rel.indexOf("web");
	expect(webIdx, `client 应位于 <模块>/web/... 下：${clientFile}`).toBeGreaterThan(0);
	const owner = rel[webIdx - 1]!;
	const next = rel[webIdx + 1]!;
	// 两种形态：多根聚合 `<owner>/web/<api 前缀>/__client`；单模块 `<owner>/web/__client`
	return {
		owner,
		apiModule: next === "__client" ? owner : next,
		webDir: rel.slice(0, webIdx + 1).join("/"),
	};
}

const allClients = walk(path.join(TEMPLATE_DIR, "src"))
	.filter(f => f.endsWith(path.join("__client", "index.ts")));

/**
 * 只测「真正被页面消费」的 client：
 *   - 归属模块有 entry.ts（排除 auth / _platform 的孤儿生成物）；
 *   - 同根的非 __client 源码确实 import 了 `__client`（home 是契约产物但页面未用，
 *     `ojm api --check` 仍要求它存在，故不属于「接线」范畴）。
 */
function consumedByPages(clientFile: string): boolean {
	const rootDir = path.dirname(path.dirname(clientFile));
	return walk(rootDir)
		.filter(f => /\.tsx?$/.test(f) && !f.includes(`${path.sep}__client${path.sep}`))
		.some(f => fs.readFileSync(f, "utf-8").includes("__client"));
}

const clients = allClients.filter((f) => {
	const { webDir } = locate(f);
	return fs.existsSync(path.join(TEMPLATE_DIR, webDir, "entry.ts")) && consumedByPages(f);
});

describe("模板 client 接线（多根聚合）", () => {
	it("至少存在一个被模块消费的生成 client（防止扫描形同虚设）", () => {
		expect(clients.length).toBeGreaterThan(0);
	});

	for (const clientFile of clients) {
		const { owner, apiModule } = locate(clientFile);
		const rel = path.relative(TEMPLATE_DIR, clientFile).split(path.sep).join("/");

		it(`[${rel}] client 在归属根的 routes.ts 里被创建`, () => {
			const routesFile = path.join(path.dirname(path.dirname(clientFile)), "routes.ts");
			expect(fs.existsSync(routesFile), `应存在 ${path.relative(TEMPLATE_DIR, routesFile)}`).toBe(true);

			const src = fs.readFileSync(clientFile, "utf-8");
			const factory = /export function (create\w+Client)\s*\(/.exec(src)?.[1];
			expect(factory, `${rel} 缺少 create<Module>Client 工厂`).toBeTruthy();

			const routes = fs.readFileSync(routesFile, "utf-8");
			expect(routes, `${rel} 的工厂 ${factory} 未在 routes.ts 的 onInit 里调用`)
				.toContain(`${factory}(ctx)`);
		});

		it(`[${rel}] 认领护栏指向归属模块 ${owner}`, () => {
			const src = fs.readFileSync(clientFile, "utf-8");
			if (owner === apiModule) {
				expect(src).not.toContain("MODULE_OWNER");
				return;
			}
			expect(src).toContain(`export const MODULE_OWNER = "/${owner}";`);
			expect(src).toContain("ctx.module.name !== MODULE_OWNER.slice(1)");
		});
	}
});
