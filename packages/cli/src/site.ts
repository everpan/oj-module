// 站点瘦客户端（P1-13，D6）：ojm install/enable/disable 共用的站点 HTTP 面。
// 登录（POST /api/auth/login）→ Bearer 注入 → oj 信封解包（{code,msg,data}，code=0 为成）。
// 凭据只走内存：flag（--user/--pass）> 环境变量（OJM_SITE_URL/OJM_USER/OJM_PASS），不落盘不落配置。
// 轮询对齐服务端消费面（§10.2）：GET task?id= 查询参数形态，800ms 起步指数退避、上限 5s，
// 总超时对齐 TASK_TIMEOUT_MS（30min）——超时报错退出，不悬挂。

import process from "node:process";

/** 任务记录（线形状镜像；真源 templates/src/_platform/api/_lifecycle/types.ts:65，客户端不 import 模板内部） */
export interface TaskRecord {
	/**
	 * 记录 schema 版本（P2-10 线形状镜像）：缺省（undefined）=旧记录=v1 语义照常渲染；
	 * 高于 TASK_SCHEMA_VERSION_KNOWN 的高版本 → renderOutcome 降级提示（人话 + 不误渲染成功）。
	 * 升版纪律见真源 types.ts TaskRecord.schemaVersion 注释。
	 */
	schemaVersion?: number
	id: string
	name: string
	version: string
	status: "running" | "done" | "failed" | "partial" | "needs_trust"
	stage: string | null
	progress: number
	message: string
	stages: { stage: string, ok: boolean, message: string }[]
	error?: { reason: string, retryable: boolean, hintKey?: string }
	/** needs_trust 终态：待确认发布方 key（P2-3；CLI trust confirm 展示与确认） */
	trust?: { key_id: string, public_key: string, fingerprint: string }
	appliedSeq?: number
	startedAt: number
	finishedAt?: number
}

/** 模板 serve 缺省端口（templates/config.yaml server.port: 9778；host 显式钉 127.0.0.1） */
export const DEFAULT_SITE_URL = "http://127.0.0.1:9778";

/** 本 CLI 已知的任务记录 schema 版本（P2-10；与服务端 tasks.ts TASK_SCHEMA_VERSION 手工同步，更高版本触发降级提示） */
export const TASK_SCHEMA_VERSION_KNOWN = 1;

/** 未来版本判定（P2-10 升版纪律读方侧）：undefined=旧记录=已知 v1 语义；数值高于已知版本 → 降级提示 */
export function isFutureSchema(record: TaskRecord): boolean {
	return typeof record.schemaVersion === "number" && record.schemaVersion > TASK_SCHEMA_VERSION_KNOWN;
}

export interface SiteAddressing {
	siteUrl?: string
	user?: string
	pass?: string
}

/** 站点寻址解析：flag > 环境变量 > 缺省；缺凭据即人话报错（不猜测不交互） */
export function resolveSite(opts: SiteAddressing): { base: string, user: string, pass: string } {
	const base = (opts.siteUrl ?? process.env.OJM_SITE_URL ?? DEFAULT_SITE_URL).replace(/\/+$/, "");
	const user = opts.user ?? process.env.OJM_USER ?? "";
	const pass = opts.pass ?? process.env.OJM_PASS ?? "";
	if (user === "" || pass === "")
		throw new Error(`[ojm] 缺少站点凭据：请用 --user/--pass 或环境变量 OJM_USER/OJM_PASS 提供目标站点超管账号（--site-url / OJM_SITE_URL 指定站点地址，缺省 ${DEFAULT_SITE_URL}；凭据只走内存，不落盘）`);
	return { base, user, pass };
}

/** oj 统一信封（AC-D16：{code,msg,data}，code=0 为成） */
interface OjEnvelope {
	code?: number
	msg?: string
	data?: unknown
}

/** 文本优先的信封解包（网关 502 HTML / 纯文本常态不炸），code!==0 抛人话 */
export async function unwrapEnvelope(res: { ok: boolean, status: number, text: () => Promise<string> }): Promise<unknown> {
	const text = await res.text();
	let env: OjEnvelope | null = null;
	try {
		env = JSON.parse(text) as OjEnvelope;
	}
	catch {
		// 非 JSON 错误体（常态），走下方统一报错
	}
	if (env === null || typeof env.code !== "number")
		throw new Error(`[ojm] 站点响应不可解析（HTTP ${res.status}）：${text.slice(0, 200)}`);
	if (env.code !== 0)
		throw new Error(`[ojm] 站点返回错误（code=${env.code}）：${env.msg ?? "未知错误"}`);
	return env.data;
}

export async function login(fetchFn: typeof fetch, base: string, user: string, pass: string): Promise<string> {
	const data = await unwrapEnvelope(await fetchFn(`${base}/api/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username: user, password: pass }),
	})) as { access_token?: string };
	const token = String(data?.access_token ?? "");
	if (token === "")
		throw new Error("[ojm] 登录响应缺 access_token——核对站点版本与账号");
	return token;
}

/** 携 Bearer 的 JSON 请求（GET body 缺省；POST/PUT 序列化 body） */
export async function callApi<T>(fetchFn: typeof fetch, base: string, token: string, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
	const res = await fetchFn(`${base}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	return await unwrapEnvelope(res) as T;
}

export interface PollOptions {
	/** 起步间隔 ms（缺省 800，对齐 §10.2 服务端轮询消费面） */
	interval0?: number
	/** 间隔上限 ms（缺省 5000） */
	intervalMax?: number
	/** 总等待预算 ms（缺省 30min，对齐 TASK_TIMEOUT_MS） */
	timeoutMs?: number
	/** 测试注入；缺省真睡 */
	sleep?: (ms: number) => Promise<void>
}

/** 终态判定：done/failed/partial；running 继续轮 */
function isTerminal(status: TaskRecord["status"]): boolean {
	return status !== "running";
}

/**
 * 任务轮询：800ms 起步、×2 指数退避、上限 5s；等待预算按累计睡眠计（注入 sleep 时确定可测），
 * 预算耗尽即人话报错（对齐服务端 TASK_TIMEOUT_MS 超时判 failed 的口径，R13/B9）。
 */
export async function pollTask(fetchFn: typeof fetch, base: string, token: string, taskId: string, opts: PollOptions = {}): Promise<TaskRecord> {
	const interval0 = opts.interval0 ?? 800;
	const intervalMax = opts.intervalMax ?? 5000;
	const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
	const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
	let interval = interval0;
	let waited = 0;
	for (;;) {
		const record = await callApi<TaskRecord>(fetchFn, base, token, "GET", `/api/_platform/market/task?id=${encodeURIComponent(taskId)}`);
		if (isTerminal(record.status))
			return record;
		if (waited + interval > timeoutMs)
			throw new Error(`[ojm] 安装任务轮询超时（已等待 ${Math.round(waited / 1000)}s 未达终态，对齐服务端 ${Math.round(timeoutMs / 60000)} 分钟预算）——请到站点任务页查看详情`);
		await sleep(interval);
		waited += interval;
		interval = Math.min(interval * 2, intervalMax);
	}
}
