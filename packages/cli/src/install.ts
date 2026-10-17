import type { TaskRecord } from "./site";
// ojm install（P1-13，D6）：方案包安装瘦客户端。目标两种形态：
//   · 本地 tgz 路径（<name>-<version>.tgz 文件名推导身份，--name/--version 可覆盖）→ file 源 multipart 上传；
//   · name[@version] → cdn 源（站点侧 Form B 索引解析，安装器不拼 URL——市场侧职责，api.ts 同纪律）。
// 流程：登录 → POST /api/_platform/market/install → 轮询 task?id= 至终态 → 渲染。
// 终态渲染（契约附录 A 同表取用，R28/DRY）：失败/partial 打 error.reason + retryable 标注 +
// hintKey 对应双语指引（--locale zh-CN|en-US，缺省 zh-CN；文案真源为契约附录 A 表）。
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { callApi, login, pollTask, resolveSite, unwrapEnvelope } from "./site";

export type Locale = "zh-CN" | "en-US";

/** 契约附录 A 十阶段指引（zh/en 双语列；文案单一来源 = 契约附录 A 表，此处为渲染镜像） */
const STAGE_HINTS: Record<string, { zh: string, en: string }> = {
	preflight: { zh: "请修正方案清单或释放占用的名称与前缀后重新安装", en: "Fix the manifest or release the occupied name and prefix, then install again" },
	downloading: { zh: "请检查网络与市场地址（框架设置 → 市场源），稍后重试", en: "Check the network and market URL (Framework settings → Market source), then retry" },
	verifying: { zh: "分发包可能损坏，请重试下载；持续失败请联系发布方", en: "The archive may be corrupted; retry the download, or contact the publisher if it persists" },
	extracting: { zh: "安装已终止且零落盘；若反复出现，请勿使用该分发包并联系发布方", en: "Installation aborted with nothing written; if it repeats, do not use this archive and contact the publisher" },
	migrating: { zh: "数据已保留原状，请修复后重试；必要时回退到上一版本", en: "Data is left intact; fix the issue and retry, or roll back to the previous version if needed" },
	lock_commit: { zh: "存在并发构建或安装，请稍后重试", en: "A concurrent build or install is in progress; retry later" },
	registering: { zh: "请重试；多次失败请检查站点数据库状态", en: "Retry; if it keeps failing, check the site database state" },
	deploying_web: { zh: "请重试；方案已部分生效，若持续失败请禁用该方案", en: "Retry; the solution is partially live — disable it if the failure persists" },
	reloading: { zh: "站点仍在使用旧配置服务，请稍后重试或联系运维", en: "The site still serves the old config; retry later or contact ops" },
	smoke: { zh: "方案已部分生效，请按详情排查；可先禁用该方案恢复原状", en: "The solution is partially live; inspect the details, or disable it to restore the previous state" },
};

/** retryable 全局两值（契约附录 A：全 stage 共用） */
const RETRYABLE_LABELS: Record<Locale, { yes: string, no: string }> = {
	"zh-CN": { yes: "本次失败可重试", no: "本次失败不可自动重试" },
	"en-US": { yes: "This failure is retryable", no: "This failure is not retryable" },
};

function normalizeLocale(locale?: string): Locale {
	return locale === "en-US" || locale === "en" ? "en-US" : "zh-CN";
}

/**
 * 终态渲染（纯函数，人话多行文本）：done 单行；failed/partial = 标题 + 原因 + 指引 + 重试标注
 * （hintKey 随标注行附上，便于对照契约附录 A）。
 */
export function renderOutcome(record: TaskRecord, locale?: string): string {
	const lang = normalizeLocale(locale);
	if (record.status === "done") {
		return lang === "en-US"
			? `[ojm] Install complete: ${record.name} ${record.version}`
			: `[ojm] 安装完成：${record.name} ${record.version}`;
	}
	const retryable = RETRYABLE_LABELS[lang][record.error?.retryable ? "yes" : "no"];
	const stage = record.error?.hintKey?.replace(/^lifecycle\.stage\./, "").replace(/\.hint$/, "") ?? record.stage ?? "";
	const en = lang === "en-US";
	const hint = STAGE_HINTS[stage]?.[en ? "en" : "zh"] ?? (en ? "Inspect the task details on the site for more information" : "请到站点任务详情页查看更多信息");
	const head = record.status === "partial"
		? (lang === "en-US"
			? `[ojm] Install partially applied (stage: ${stage}) — the solution is partly live, see hint below`
			: `[ojm] 安装部分生效（stage：${stage}）——方案已部分上线，详见下方指引`)
		: (lang === "en-US"
			? `[ojm] Install failed (stage: ${stage})`
			: `[ojm] 安装失败（stage：${stage}）`);
	return [
		head,
		lang === "en-US" ? `Reason: ${record.error?.reason ?? record.message}` : `原因：${record.error?.reason ?? record.message}`,
		lang === "en-US" ? `Hint: ${hint}` : `指引：${hint}`,
		`${retryable}（${record.error?.hintKey ?? `lifecycle.stage.${stage}.hint`}）`,
	].join("\n");
}

export type InstallTarget = { kind: "file", path: string, name: string | null, version: string | null } | { kind: "cdn", name: string, version: string | null };

/** 目标解析：.tgz 路径 → file 源（<name>-<version>.tgz 文件名推导身份）；否则 name[@version] → cdn 源 */
export function parseTarget(target: string): InstallTarget {
	if (target.endsWith(".tgz")) {
		const stem = path.basename(target).replace(/\.tgz$/i, "");
		// 文件名推导：<name>-<version>（版本 = 尾段点分数字开头，ojm build --bundle 产物命名）
		const m = /^(.+)-(\d[\w.]*)$/.exec(stem);
		return { kind: "file", path: target, name: m?.[1] ?? null, version: m?.[2] ?? null };
	}
	const at = target.indexOf("@");
	const name = at === -1 ? target : target.slice(0, at);
	const version = at === -1 ? null : target.slice(at + 1);
	if (name.trim() === "")
		throw new Error(`[ojm] 非法安装目标：「${target}」（用法：ojm install <file.tgz | name[@version]>）`);
	return { kind: "cdn", name: name.trim(), version };
}

export interface InstallOptions {
	url?: string
	user?: string
	pass?: string
	/** file 源身份覆盖（文件名不可解析时的显式出口）；cdn 源同名冲突时报错提示二选一 */
	name?: string
	/** 显式版本（覆盖文件名/目标推导） */
	version?: string
	/** 终态文案语言（缺省 zh-CN） */
	locale?: string
	/** 测试注入；缺省 globalThis.fetch */
	fetchFn?: typeof fetch
	/** 测试注入；缺省真睡 */
	sleep?: (ms: number) => Promise<void>
}

/**
 * 安装命令体：解析目标 → 登录 → POST install（file=multipart / cdn=JSON）→ 轮询至终态 →
 * 渲染人话。失败/partial 打印全文后置 process.exitCode = 1（不抛——多行渲染已输出，栈是噪音），
 * 返回终态记录供调用方（真机冒烟）断言。
 */
export async function installCommand(target: string, opts: InstallOptions = {}): Promise<TaskRecord> {
	const fetchFn = opts.fetchFn ?? globalThis.fetch;
	const parsed = parseTarget(target);
	const { base, user, pass } = resolveSite(opts);
	const token = await login(fetchFn, base, user, pass);

	let response: { task_id: string };
	if (parsed.kind === "file") {
		const name = opts.name ?? parsed.name;
		if (name === null)
			throw new Error(`[ojm] 无法从文件名推导方案名：${target}——请用 --name <name>（及 --version <version>）显式指定`);
		const version = opts.version ?? parsed.version;
		const bytes = new Uint8Array(fs.readFileSync(parsed.path));
		const form = new FormData();
		form.append("name", name);
		if (version !== null)
			form.append("version", version);
		form.append("source", "file");
		form.append("file", new Blob([bytes], { type: "application/gzip" }), path.basename(parsed.path));
		const res = await fetchFn(`${base}/api/_platform/market/install`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
			body: form,
		});
		response = await unwrapInstall(res);
	}
	else {
		if (opts.name !== undefined && opts.name !== parsed.name)
			throw new Error(`[ojm] --name「${opts.name}」与目标「${parsed.name}」不一致——请二选一`);
		response = await callApi<{ task_id: string }>(fetchFn, base, token, "POST", "/api/_platform/market/install", {
			name: parsed.name,
			version: opts.version ?? parsed.version,
			source: "cdn",
		});
	}

	const record = await pollTask(fetchFn, base, token, response.task_id, { sleep: opts.sleep });
	console.log(renderOutcome(record, opts.locale));
	if (record.status !== "done")
		process.exitCode = 1;
	return record;
}

/** file 源响应解包：复用站点信封语义，额外校验 task_id 在场（防编排面版本错配静默空转） */
async function unwrapInstall(res: { ok: boolean, status: number, text: () => Promise<string> }): Promise<{ task_id: string }> {
	const data = await unwrapEnvelope(res) as { task_id?: string };
	const taskId = String(data?.task_id ?? "");
	if (taskId === "")
		throw new Error("[ojm] install 响应缺 task_id——核对站点平台编排面版本（peerPlatform 预检）");
	return { task_id: taskId };
}
