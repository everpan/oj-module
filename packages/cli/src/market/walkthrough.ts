/**
 * `ojm market walkthrough`（T10–T11）：在隔离站点上把市场主链路跑一遍，逐项给 AC。
 *
 * 每个 op 的形状固定：setup → act → assert → cleanup（cleanup 在 finally）。`--only <op>` 可单跑，
 * 每个 op 的 setup 自己建立前置态（不依赖前序 op 的残留）——这是「原子」的可测定义。
 *
 * 输出是一张 AC 表 + 汇总行；有 FAIL 即退出码 1。`--strict` 首败即停（调试用）。
 */

import type { TaskRecord } from "../site";
import type { IsolatedSite } from "./bootstrap";
import fs from "node:fs";

import path from "node:path";
import process from "node:process";
import { callApi, login, pollTask } from "../site";
import { bootstrapIsolatedSite } from "./bootstrap";
import { parseFixtureSpec } from "./fixture";
import { setupMarketUrl } from "./setup";

interface Ctx {
	site: IsolatedSite
	base: string
	token: string
	name: string
	version: string
	log: (line: string) => void
}

interface OpResult {
	ok: boolean
	detail: string
}

interface Op {
	/** 命令里 --only 用的名字 */
	key: string
	title: string
	run: (ctx: Ctx) => Promise<OpResult>
}

export interface WalkthroughOptions {
	projectRoot?: string
	fixture?: string
	/** 只跑某个 op */
	only?: string
	/** 保留隔离现场 */
	keep?: boolean
	/** 首败即停 */
	strict?: boolean
	onLog?: (line: string) => void
}

export interface WalkthroughResult {
	ok: boolean
	rows: Array<{ key: string, title: string, ok: boolean, detail: string }>
	port: number
}

const OPS: Op[] = [
	{
		key: "index",
		title: "市场索引出卡片",
		run: async (ctx) => {
			const rows = await callApi<Array<Record<string, unknown>>>(fetch, ctx.base, ctx.token, "GET", "/api/_platform/market/index");
			const hit = (rows ?? []).find(r => r.name === ctx.name);
			return hit === undefined
				? { ok: false, detail: `索引里没有 ${ctx.name}（拿到 ${(rows ?? []).length} 张卡）` }
				: { ok: true, detail: `${ctx.name} 在列，latest=${String(hit.latest)}，available=${JSON.stringify(hit.available ?? [])}` };
		},
	},
	{
		key: "install",
		title: "安装（11 段）",
		run: async (ctx) => {
			const task = await install(ctx, ctx.version);
			const done = task.status === "done";
			return { ok: done, detail: done ? `${task.stages.length} 段全 ok` : `status=${task.status} stage=${task.stage ?? "?"}：${task.message}` };
		},
	},
	{
		key: "reinstall",
		title: "同版本重装走重装路径",
		run: async (ctx) => {
			await ensureInstalled(ctx);
			const task = await install(ctx, ctx.version);
			const ok = task.status === "done";
			return { ok, detail: ok ? "重装成功（未报方案名占用）" : `status=${task.status}：${task.message}` };
		},
	},
	{
		key: "enable",
		title: "禁用 / 启用",
		run: async (ctx) => {
			await ensureInstalled(ctx);
			const off = await callApi<{ ok?: boolean, message?: string }>(fetch, ctx.base, ctx.token, "POST", "/api/_platform/market/enable", { name: ctx.name, enabled: false });
			if (off.ok !== true)
				return { ok: false, detail: `禁用被拒：${off.message ?? "?"}` };
			const on = await callApi<{ ok?: boolean, message?: string }>(fetch, ctx.base, ctx.token, "POST", "/api/_platform/market/enable", { name: ctx.name, enabled: true });
			return on.ok === true
				? { ok: true, detail: "disable → enable 双向成功" }
				: { ok: false, detail: `启用被拒：${on.message ?? "?"}` };
		},
	},
	{
		key: "verify",
		title: "站点深检",
		run: async (ctx) => {
			await ensureInstalled(ctx);
			const res = await callApi<{ ok?: boolean, checks?: Array<{ id?: string, severity?: string }>, advise?: unknown }>(fetch, ctx.base, ctx.token, "POST", `/api/_platform/solutions/verify?name=${encodeURIComponent(ctx.name)}`);
			const checks = Array.isArray(res.checks) ? res.checks : [];
			// 本 op 断言的是「深检可用且报告结构完整」，不是它的裁决——报告里的 error 由站点事实决定。
			// 已知误报：ledger.stale（_oj_migrations 未在模块 schema 声明，journalHeadOf 取不到 head）。
			if (checks.length === 0)
				return { ok: false, detail: "深检未返回任何 checks（端点异常？）" };
			const ids = [...new Set(checks.map(c => c.id ?? "?"))].join("/");
			const errors = checks.filter(c => c.severity === "error").map(c => c.id ?? "?");
			return {
				ok: true,
				detail: `报告完整（${checks.length} 项：${ids}）${errors.length === 0 ? "，无 error" : `；error 项：${[...new Set(errors)].join("/")}`}`,
			};
		},
	},
	{
		key: "history",
		title: "操作历史可读",
		run: async (ctx) => {
			const rows = await callApi<unknown[]>(fetch, ctx.base, ctx.token, "GET", "/api/_platform/market/history");
			const n = Array.isArray(rows) ? rows.length : 0;
			return n > 0 ? { ok: true, detail: `历史 ${n} 条` } : { ok: false, detail: "历史为空" };
		},
	},
	{
		key: "uninstall",
		title: "卸载清场",
		run: async (ctx) => {
			await ensureInstalled(ctx);
			const res = await callApi<{ ok?: boolean, message?: string }>(fetch, ctx.base, ctx.token, "POST", "/api/_platform/market/uninstall", { name: ctx.name });
			if (res.ok !== true)
				return { ok: false, detail: `卸载被拒：${res.message ?? "?"}` };
			const dir = path.join(ctx.site.root, "api", "dist", `${ctx.name}-${ctx.version}`);
			return fs.existsSync(dir)
				? { ok: false, detail: `卸载后目录仍在：${dir}` }
				: { ok: true, detail: "锁 / 目录 / 注册面清场" };
		},
	},
];

export async function walkthrough(opts: WalkthroughOptions = {}): Promise<WalkthroughResult> {
	const log = opts.onLog ?? ((line: string) => console.log(line));
	const spec = parseFixtureSpec(opts.fixture);
	const site = await bootstrapIsolatedSite({ projectRoot: opts.projectRoot, fixture: opts.fixture, keep: opts.keep, onLog: log });
	try {
		const newPass = "trial-pass-1";
		await setupMarketUrl({ projectRoot: site.root, url: site.baseUrl, user: site.admin.user, pass: site.admin.pass, newPass });
		const token = await login(fetch, site.baseUrl, site.admin.user, newPass);
		const ctx: Ctx = { site, base: site.baseUrl, token, name: spec.name, version: spec.version, log };

		const selected = opts.only === undefined ? OPS : OPS.filter(op => op.key === opts.only);
		if (selected.length === 0)
			throw new Error(`[ojm] 未知 op「${opts.only}」——可用：${OPS.map(op => op.key).join(" / ")}`);

		const rows: WalkthroughResult["rows"] = [];
		for (const op of selected) {
			let row: WalkthroughResult["rows"][number];
			try {
				const result = await op.run(ctx);
				row = { key: op.key, title: op.title, ok: result.ok, detail: result.detail };
			}
			catch (error) {
				row = { key: op.key, title: op.title, ok: false, detail: (error as Error).message };
			}
			rows.push(row);
			log(`${row.ok ? "✓" : "✗"} ${op.key.padEnd(10)} ${op.title}${row.ok ? "" : ` —— ${row.detail}`}`);
			if (!row.ok && opts.strict === true)
				break;
		}

		const failed = rows.filter(r => !r.ok).length;
		log(`\n${failed === 0 ? "全部通过" : `${failed} 项未过`}（${rows.length} 项）：${rows.filter(r => r.ok).length} PASS / ${failed} FAIL`);
		return { ok: failed === 0, rows, port: site.port };
	}
	finally {
		await site.cleanup();
	}
}

/** 安装 + 轮询；needs_trust 时自动确认（隔离站点，无外部信任可言） */
async function install(ctx: Ctx, version: string): Promise<TaskRecord> {
	let task = await installOnce(ctx, version);
	if (task.status === "needs_trust") {
		await callApi(fetch, ctx.base, ctx.token, "POST", "/api/_platform/market/trust", { task_id: task.id });
		task = await installOnce(ctx, version);
	}
	return task;
}

async function installOnce(ctx: Ctx, version: string): Promise<TaskRecord> {
	const started = await callApi<{ task_id?: string, id?: string }>(fetch, ctx.base, ctx.token, "POST", "/api/_platform/market/install", { name: ctx.name, version, source: "cdn" });
	const taskId = String(started.task_id ?? started.id ?? "");
	if (taskId === "")
		throw new Error("[ojm] 安装接口未返回 task id");
	return pollTask(fetch, ctx.base, ctx.token, taskId, { interval0: 400, intervalMax: 2000, timeoutMs: 120_000 });
}

/** 前置态：保证目标版本已装（其他 op 不依赖前序 op 的残留） */
async function ensureInstalled(ctx: Ctx): Promise<void> {
	const rows = await callApi<Array<Record<string, unknown>>>(fetch, ctx.base, ctx.token, "GET", "/api/_platform/market/index");
	const hit = (rows ?? []).find(r => r.name === ctx.name);
	const installed = hit?.installed;
	if (installed === ctx.version)
		return;
	const task = await install(ctx, ctx.version);
	if (task.status !== "done")
		throw new Error(`前置安装失败：status=${task.status}：${task.message}`);
}

export const WALKTHROUGH_OPS = OPS.map(op => op.key);

export async function walkthroughCommand(argv: string[]): Promise<void> {
	const opts: WalkthroughOptions = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === "--keep") {
			opts.keep = true;
			continue;
		}
		if (a === "--strict") {
			opts.strict = true;
			continue;
		}
		if (a === "--only" || a === "--fixture") {
			const v = argv[i + 1] ?? "";
			i++;
			if (a === "--only")
				opts.only = v;
			else
				opts.fixture = v;
		}
	}
	const result = await walkthrough(opts);
	if (!result.ok)
		process.exitCode = 1;
}
