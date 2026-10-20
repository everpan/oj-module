/**
 * `ojm market trial`（T9）：在一次性隔离站点里跑完整安装，验证「这个包能不能装」。
 *
 * 为什么需要它：开发态装不了自己（见 devkit 教学文档 §2），而真站点装了要清场、且首次会污染
 * 信任库。trial 给你一个「别人家的站点」：随机端口 + 一次性 DB + 一次性发布方密钥 + 隔离
 * CDN，跑完即毁（--keep 保留现场）。
 *
 * 复用纪律：站点生命周期全在 `bootstrap.ts`，站点调用四件套全在 `site.ts`——本文件只编排，
 * 不重写登录/轮询/取证。
 */

import type { TaskRecord } from "../site";

import process from "node:process";
import { callApi, login, pollTask } from "../site";
import { bootstrapIsolatedSite } from "./bootstrap";
import { parseFixtureSpec } from "./fixture";
import { setupMarketUrl } from "./setup";

export interface TrialOptions {
	/** 源工程（提供 bin/oj 与 cli 模板）；缺省 process.cwd() */
	projectRoot?: string
	/** 待试装的方案；缺省 demo-solution@0.1.0 */
	fixture?: string
	/** 保留隔离现场（排查用） */
	keep?: boolean
	/** 首败即停（默认也停——单次试装没有后续步骤可续） */
	strict?: boolean
	onLog?: (line: string) => void
}

export interface TrialResult {
	ok: boolean
	/** 隔离站点端口（keep 时供人工访问） */
	port: number
	root: string
	stages: TaskRecord["stages"]
	message: string
}

export async function trialInstall(opts: TrialOptions = {}): Promise<TrialResult> {
	const log = opts.onLog ?? ((line: string) => console.log(line));
	const spec = parseFixtureSpec(opts.fixture);
	log(`[ojm] 试装 ${spec.name}@${spec.version}（隔离站点，跑完即毁）`);

	const site = await bootstrapIsolatedSite({
		projectRoot: opts.projectRoot,
		fixture: opts.fixture,
		keep: opts.keep,
		onLog: log,
	});

	try {
		// 1) 打开市场地址：隔离库是全新 seed，首登必然处于改密悬挂期 → setup 顺带完成改密
		const newPass = "trial-pass-1";
		await setupMarketUrl({
			projectRoot: site.root,
			url: site.baseUrl,
			user: site.admin.user,
			pass: site.admin.pass,
			newPass,
		});

		const token = await login(fetch, site.baseUrl, site.admin.user, newPass);

		// 2) 首次安装：预期停在 needs_trust（发布方是本次临时生成的身份）
		let task = await installOnce(site.baseUrl, token, spec.name, spec.version);
		if (task.status === "needs_trust") {
			const fingerprint = task.trust?.fingerprint ?? "";
			log(`[ojm] 待信任发布方 ${task.trust?.key_id ?? "?"}，指纹 ${fingerprint.slice(0, 16)}…（隔离站点，自动确认）`);
			await callApi(fetch, site.baseUrl, token, "POST", "/api/_platform/market/trust", { task_id: task.id });
			task = await installOnce(site.baseUrl, token, spec.name, spec.version);
		}

		const ok = task.status === "done";
		log(ok
			? `[ojm] 试装通过：${spec.name}@${spec.version} 在隔离站点装成（${task.stages.length} 段全 ok）`
			: `[ojm] 试装失败：status=${task.status} stage=${task.stage ?? "?"}——${task.message}`);
		return { ok, port: site.port, root: site.root, stages: task.stages, message: task.message };
	}
	finally {
		await site.cleanup();
	}
}

/** 一次安装 + 轮询到终态 */
async function installOnce(base: string, token: string, name: string, version: string): Promise<TaskRecord> {
	// 站点返回 {task_id}（安装同步跑完后回填）；mock 兼容 id 形态
	const started = await callApi<{ task_id?: string, id?: string }>(fetch, base, token, "POST", "/api/_platform/market/install", {
		name,
		version,
		source: "cdn",
	});
	const taskId = String(started.task_id ?? started.id ?? "");
	if (taskId === "")
		throw new Error("[ojm] 安装接口未返回 task id——站点版本与 ojm 不匹配？");
	return pollTask(fetch, base, token, taskId, { interval0: 500, intervalMax: 2000, timeoutMs: 120_000 });
}

/** 进程入口：`ojm market trial [--fixture name@ver] [--keep]` */
export async function trialCommand(argv: string[]): Promise<void> {
	const opts: TrialOptions = {};
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
		if (a === "--fixture") {
			opts.fixture = argv[i + 1] ?? "";
			i++;
		}
	}
	const result = await trialInstall(opts);
	if (!result.ok)
		process.exitCode = 1;
}
