import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 回归（2026-09-10）：playground-oj 的 home/system/notification 模块经
 * bindRequest(ctx.utils.request) 拿到 scoped request 后直接发请求，但没在
 * onInit 里调用 ctx.register.apiPrefix()——运行时守卫同步抛
 * 「模块 "home" 尚未登记 API 前缀」，登录后进入布局即白屏报错。
 *
 * 这组断言守护两条规则（D11 scoped request 收敛）：
 * 1. 凡绑定 scoped request 的模块，entry.ts 必须登记 apiPrefix；
 * 2. 登记的前缀必须覆盖其 client/api.ts 发出的全部请求路径（防越界）。
 */

const OJ_APP = path.join(PROJECT_ROOT, "apps/playground-oj");
const OJ_MODULES = path.join(OJ_APP, "web/src");

interface ModuleEntry {
	name: string
	entry: string
	enabled: boolean
}

function readModuleEntries(): ModuleEntry[] {
	const config = fs.readFileSync(path.join(OJ_APP, "web.config.ts"), "utf-8");
	const re = /name:\s*["']([^"']+)["'],\s*entry:\s*["']([^"']+)["']/g;
	const entries = [...config.matchAll(re)].map(m => ({
		name: m[1]!,
		entry: m[2]!,
		enabled: true,
	}));
	expect(entries.length, "web.config.ts 应登记模块清单").toBeGreaterThan(0);
	return entries;
}

/** 模块目录下全部 client/api*.ts 的文件路径 */
function clientFiles(moduleDir: string): string[] {
	const apiDir = path.join(moduleDir, "client");
	if (!fs.existsSync(apiDir))
		return [];
	return fs.readdirSync(apiDir)
		.filter(name => /^api[\w.-]*\.ts$/.test(name))
		.map(name => path.join(apiDir, name));
}

/** 从 api.ts 提取 scoped 请求路径的首段（如 `home/line` → "home"） */
function clientPathSegments(clientPath: string): string[] {
	const src = fs.readFileSync(clientPath, "utf-8");
	const re = /\.(?:get|post|put|patch|del|delete)\(\s*`([^`$]+)`/g;
	return [...src.matchAll(re)].map(m => m[1]!.split("/")[0]!);
}

describe("playground-oj 模块 apiPrefix 登记（回归）", () => {
	for (const mod of readModuleEntries()) {
		const moduleDir = path.join(OJ_MODULES, mod.name);
		const entryPath = path.join(OJ_APP, mod.entry);
		if (!fs.existsSync(entryPath)) {
			it(`[${mod.name}] entry 存在`, () => {
				expect(fs.existsSync(entryPath), `应存在 ${mod.entry}`).toBe(true);
			});
			continue;
		}
		const entrySrc = fs.readFileSync(entryPath, "utf-8");

		// 绑定 scoped request 的模块必须登记 apiPrefix（否则运行时守卫同步抛错）
		const bindsRequest = /bindRequest\s*\(/.test(entrySrc) || /ctx\.utils\.request/.test(entrySrc);
		const registered = entrySrc.match(/register\.apiPrefix\(\s*["']([^"']+)["']/);

		it(`[${mod.name}] 绑定 scoped request 则必须登记 apiPrefix`, () => {
			if (!bindsRequest)
				return;
			expect(
				registered,
				`模块 "${mod.name}" 在 entry.ts 的 onInit 里调用了 bindRequest(ctx.utils.request)，`
				+ "但未调用 ctx.register.apiPrefix(\"<prefix>\")——运行时会在发请求时抛"
				+ "「尚未登记 API 前缀」（2026-09-10 home 回归）。",
			).toBeTruthy();
		});

		// 登记的前缀必须与 client 路径首段一致（防「请求越界」与前缀漂移）
		it(`[${mod.name}] apiPrefix 覆盖其 client 全部请求路径首段`, () => {
			if (!bindsRequest || !registered)
				return;
			const prefixSegment = registered[1]!.replace(/^\//, "").split("/")[0]!;
			const segments = clientFiles(moduleDir).flatMap(file => clientPathSegments(file));
			if (segments.length === 0)
				return;
			for (const seg of [...new Set(segments)]) {
				expect(
					seg,
					`模块 "${mod.name}" 登记前缀 ${registered[1]}，但 client 发出的请求首段为 "${seg}"——`
					+ "会触发「请求越界」守卫或打错后端路由。",
				).toBe(prefixSegment);
			}
		});
	}
});
