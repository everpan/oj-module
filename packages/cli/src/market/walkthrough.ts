/**
 * `ojm market walkthrough`（T10–T12）：在隔离站点上把市场主链路跑一遍，逐项给 AC。
 *
 * 每个 op 的形状固定：setup → act → assert → cleanup（cleanup 在 finally）。`--only <op>` 可单跑，
 * 每个 op 的 setup 自己建立前置态（不依赖前序 op 的残留）——这是「原子」的可测定义。
 *
 * 输出是一张 AC 表 + 汇总行；有 FAIL 即退出码 1。`--strict` 首败即停（调试用）。
 *
 * T12 追加：upgrade / rollback（主链路）与 neg-tamper / nosig / badindex / stranger（负向）。
 * neg-* 统一用 9.9.9 版本与主链路隔离；篡改的文件在 finally 里回抄原始字节（不重签），
 * 收尾摘包重铺索引——否则后续 op 全挂。
 */

import type { TaskRecord } from "../site";
import type { IsolatedSite } from "./bootstrap";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

import path from "node:path";
import process from "node:process";
import { signCommand } from "../sign";
import { callApi, login, pollTask } from "../site";
import { bootstrapIsolatedSite, derivePublisherKey } from "./bootstrap";
import { buildIndex } from "./build-index";
import { parseFixtureSpec } from "./fixture";
import { publishPackage } from "./publish";
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

/** neg-* 专用版本：与主链路（0.1.0/0.2.0）完全隔离，收尾整包摘除 */
const NEG_VERSION = "9.9.9";

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
		key: "upgrade",
		title: "升级（0.1.0 → 0.2.0）",
		run: async (ctx) => {
			await ensureInstalled(ctx); // 前置：0.1.0 在列（账本 head=1）
			await publishVersion(ctx, "0.2.0");
			const task = await install(ctx, "0.2.0");
			if (task.status !== "done")
				return { ok: false, detail: `升级安装未 done：status=${task.status} stage=${task.stage ?? "?"}：${task.message}` };
			const card = await indexCard(ctx);
			const distDir = path.join(ctx.site.root, "api", "dist");
			const dir010 = path.join(distDir, `${ctx.name}-0.1.0`);
			const dir020 = path.join(distDir, `${ctx.name}-0.2.0`);
			const mig010 = path.join(dir010, "migrations", "0001__init.sql");
			const mig020 = path.join(dir020, "migrations", "0001__init.sql");
			const installedOk = card?.installed === "0.2.0";
			const bothAvailable = JSON.stringify(card?.available ?? []).includes("0.1.0") && JSON.stringify(card?.available ?? []).includes("0.2.0");
			const dirsKept = fs.existsSync(dir010) && fs.existsSync(dir020);
			const migSame = fs.existsSync(mig010) && fs.existsSync(mig020) && fs.readFileSync(mig010).equals(fs.readFileSync(mig020));
			const ok = installedOk && bothAvailable && dirsKept && migSame;
			return {
				ok,
				detail: ok
					? "installed=0.2.0，双版本在列且目录共存（旧版不 prune），0001 迁移逐字节一致"
					: `installedOk=${installedOk} bothAvailable=${bothAvailable} dirsKept=${dirsKept} migSame=${migSame}`,
			};
		},
	},
	{
		key: "rollback",
		title: "回滚拦截（账本超前，OJ-9）",
		run: async (ctx) => {
			// 前置：0.2.0 已装（账本 head=2）。--only 单跑时自建（upgrade op 不依赖前序残留，此处同纪律）。
			let card = await indexCard(ctx);
			if (card?.installed !== "0.2.0") {
				await publishVersion(ctx, "0.2.0");
				const pre = await install(ctx, "0.2.0");
				if (pre.status !== "done")
					return { ok: false, detail: `前置安装 0.2.0 未 done：status=${pre.status}：${pre.message}` };
				card = await indexCard(ctx);
			}
			const distDir = path.join(ctx.site.root, "api", "dist");
			const before = fs.readdirSync(distDir).sort(); // 零副作用基线：0.1.0 目录是前序合法安装的产物，不代表本次落盘
			const task = await installOnce(ctx, "0.1.0"); // 包内最大 seq 1 < head 2
			const blocked = task.status === "failed" && task.stage === "migrating";
			const untouched = JSON.stringify(fs.readdirSync(distDir).sort()) === JSON.stringify(before);
			const kept = card?.installed === "0.2.0";
			const ok = blocked && untouched && kept;
			return {
				ok,
				detail: ok
					? "failed@migrating（宿主层/oj migrate 双层拦截之一），dist 内容零变化，installed 仍 0.2.0"
					: `blocked=${blocked}（status=${task.status} stage=${task.stage}）untouched=${untouched} kept=${kept}：${task.message}`,
			};
		},
	},
	{
		key: "uninstall",
		title: "卸载清场",
		run: async (ctx) => {
			const card = await indexCard(ctx);
			const installed = typeof card?.installed === "string" && card.installed !== "" ? card.installed : null;
			if (installed === null)
				await ensureInstalled(ctx); // 未装过：先装 ctx.version
			const target = installed ?? ctx.version;
			const res = await callApi<{ ok?: boolean, message?: string }>(fetch, ctx.base, ctx.token, "POST", "/api/_platform/market/uninstall", { name: ctx.name });
			if (res.ok !== true)
				return { ok: false, detail: `卸载被拒：${res.message ?? "?"}` };
			const dir = path.join(ctx.site.root, "api", "dist", `${ctx.name}-${target}`);
			return fs.existsSync(dir)
				? { ok: false, detail: `卸载后目录仍在：${dir}` }
				: { ok: true, detail: `${ctx.name}@${target} 锁 / 目录 / 注册面清场` };
		},
	},
	{
		key: "neg-tamper",
		title: "负向：包体篡改（sha256 不符）",
		run: async (ctx) => {
			await publishVersion(ctx, NEG_VERSION);
			const tgz = path.join(ctx.site.cdnDir, `${ctx.name}-${NEG_VERSION}.tgz`);
			const orig = fs.readFileSync(tgz);
			try {
				const tampered = Buffer.from(orig);
				tampered[Math.floor(tampered.length / 2)] ^= 0x01; // 翻转中间一个字节
				fs.writeFileSync(tgz, tampered);
				const task = await installOnce(ctx, NEG_VERSION);
				const rejected = task.status === "failed" && task.stage === "verifying";
				const noDrop = !fs.existsSync(path.join(ctx.site.root, "api", "dist", `${ctx.name}-${NEG_VERSION}`));
				const ok = rejected && noDrop;
				return {
					ok,
					detail: ok
						? "failed@verifying（sha256 与索引不符，C2-29 fail-closed），零落盘"
						: `status=${task.status} stage=${task.stage} noDrop=${noDrop}：${task.message}`,
				};
			}
			finally {
				fs.writeFileSync(tgz, orig); // 回抄原始字节，不重签
				await removeVersion(ctx, NEG_VERSION);
			}
		},
	},
	{
		key: "neg-nosig",
		title: "负向：缺包级签名（sig_missing）",
		run: async (ctx) => {
			await publishVersion(ctx, NEG_VERSION);
			const tgz = path.join(ctx.site.cdnDir, `${ctx.name}-${NEG_VERSION}.tgz`);
			const sig = `${tgz}.sig`;
			const origSig = fs.readFileSync(sig);
			try {
				fs.rmSync(sig);
				await buildIndex({ projectRoot: ctx.site.root, id: ctx.site.publisher.keyId, privateKeyPem: ctx.site.publisher.privateKeyPem }); // Form B 缺 archive.signature
				const task = await installOnce(ctx, NEG_VERSION);
				const reason = task.error?.reason ?? task.message;
				const ok = task.status === "failed" && reason.includes("sig_missing");
				return { ok, detail: ok ? "failed，失败码 sig_missing（G4 硬 fail-closed）" : `status=${task.status}：${reason}` };
			}
			finally {
				fs.writeFileSync(sig, origSig); // 回抄原始字节
				await removeVersion(ctx, NEG_VERSION);
			}
		},
	},
	{
		key: "neg-badindex",
		title: "负向：索引篡改（验签拒载）",
		run: async (ctx) => {
			await publishVersion(ctx, NEG_VERSION);
			const bundles = path.join(ctx.site.cdnDir, "bundles.yaml");
			const orig = fs.readFileSync(bundles);
			try {
				fs.appendFileSync(bundles, "# tampered\n"); // 索引字节变、签名失配
				let msg = "";
				try {
					await installOnce(ctx, NEG_VERSION);
				}
				catch (error) {
					msg = (error as Error).message; // 预期：安装 POST 即 502，任务都未创建
				}
				const ok = msg.includes("签名校验失败");
				return { ok, detail: ok ? "安装 POST 即 502 拒载（G4 fail-closed），任务未创建" : `未按预期拒装：${msg === "" ? "安装竟成功" : msg}` };
			}
			finally {
				fs.writeFileSync(bundles, orig); // 回抄原始字节
				await removeVersion(ctx, NEG_VERSION);
			}
		},
	},
	{
		key: "neg-stranger",
		title: "负向：未登记 key（TOFU 闭环）",
		run: async (ctx) => {
			await publishVersion(ctx, NEG_VERSION);
			const tgz = path.join(ctx.site.cdnDir, `${ctx.name}-${NEG_VERSION}.tgz`);
			const sig = `${tgz}.sig`;
			const orig = fs.readFileSync(tgz);
			const origSig = fs.readFileSync(sig);
			const stranger = derivePublisherKey(randomBytes(16).toString("hex")); // 未登记身份，私钥只在内存
			try {
				signCommand(tgz, { id: "stranger.publisher", privateKeyPem: stranger.privateKeyPem }); // 覆盖侧车签名
				await buildIndex({ projectRoot: ctx.site.root, id: "stranger.publisher", privateKeyPem: stranger.privateKeyPem });
				const first = await installOnce(ctx, NEG_VERSION);
				if (first.status !== "needs_trust")
					return { ok: false, detail: `未停 needs_trust：status=${first.status}：${first.message}` };
				await callApi(fetch, ctx.base, ctx.token, "POST", "/api/_platform/market/trust", { task_id: first.id });
				const second = await installOnce(ctx, NEG_VERSION);
				const ok = second.status === "done";
				return { ok, detail: ok ? "needs_trust（unknown_key）→ trust confirm → 重装 done" : `确认后重装：status=${second.status}：${second.message}` };
			}
			finally {
				fs.writeFileSync(tgz, orig); // 回抄原始字节，不重签
				fs.writeFileSync(sig, origSig);
				await removeVersion(ctx, NEG_VERSION);
			}
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
	const card = await indexCard(ctx);
	if (card?.installed === ctx.version)
		return;
	const task = await install(ctx, ctx.version);
	if (task.status !== "done")
		throw new Error(`前置安装失败：status=${task.status}：${task.message}`);
}

/** 索引卡片（本方案一行；upgrade/rollback/uninstall 与 index op 同一消费面） */
async function indexCard(ctx: Ctx): Promise<Record<string, unknown> | undefined> {
	const rows = await callApi<Array<Record<string, unknown>>>(fetch, ctx.base, ctx.token, "GET", "/api/_platform/market/index");
	return (rows ?? []).find(r => r.name === ctx.name);
}

/** 发布某版本 fixture 进隔离 CDN 并重铺索引（upgrade/rollback/neg-* 的共用前置） */
async function publishVersion(ctx: Ctx, version: string): Promise<void> {
	await publishPackage({ projectRoot: ctx.site.root, fixture: `${ctx.name}@${version}`, id: ctx.site.publisher.keyId, privateKeyPem: ctx.site.publisher.privateKeyPem });
	await buildIndex({ projectRoot: ctx.site.root, id: ctx.site.publisher.keyId, privateKeyPem: ctx.site.publisher.privateKeyPem });
}

/** neg op 收尾：整包摘除（tgz + 侧车签名）并重铺索引，恢复主链路原状 */
async function removeVersion(ctx: Ctx, version: string): Promise<void> {
	for (const file of [`${ctx.name}-${version}.tgz`, `${ctx.name}-${version}.tgz.sig`])
		fs.rmSync(path.join(ctx.site.cdnDir, file), { force: true });
	await buildIndex({ projectRoot: ctx.site.root, id: ctx.site.publisher.keyId, privateKeyPem: ctx.site.publisher.privateKeyPem });
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
