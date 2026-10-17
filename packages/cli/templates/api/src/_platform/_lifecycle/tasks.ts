// 任务注册表（P1-10，R13/B9/R31）：.install-tasks/<id>.json 任务状态文件——oj 进程内单写者
// （安装器），800ms 轮询消费面（市场页/CLI）。治理三件套：保留最近 10 条（超出删最旧，按
// startedAt 序）；running 超 30min 无进展判 failed（启动/对账时点 sweep——持有者崩溃自愈）；
// message 落盘前脱敏（URL query / Bearer / JWT / token= 形态；sha256 诊断摘要不脱——verify
// 失败的期望/实得摘要非秘密，脱掉即失去可诊断性）。写入一律经 atomicWriteText（D13 同款）。

import type { TaskRecord } from "./types";
import { atomicWriteText, fsFace } from "./atomic";

/** 任务文件保留条数（超出删最旧） */
export const TASK_KEEP = 10;

/** running 超时阈值：>30min 无进展判 failed（与 .lock stale 阈值同款口径） */
export const TASK_TIMEOUT_MS = 30 * 60_000;

/**
 * message 脱敏（落盘前）：URL query 整段、Bearer 授权头、JWT 三段形态、token/secret/password
 * 等敏感参数赋值——四类 token 形态字符串。sha256/sha384 摘要不脱（公开产物的诊断摘要非秘密）。
 */
export function redact(message: string): string {
	return message
		.replace(/\?[^"'\s)\]}]*/g, "?…")
		.replace(/Bearer\s+\S+/gi, "Bearer …")
		.replace(/eyJ[\w-]+(?:\.[\w-]+)+/g, "…")
		.replace(/\b(token|secret|password|passwd|pwd|api_?key|signature)\s*[=:]\s*[^\s"',;)]+/gi, "$1=…");
}

/** 写任务文件：脱敏 → 原子写 → 治理（保留最近 TASK_KEEP 条，删最旧；本次写入豁免） */
export async function writeTask(taskDir: string, record: TaskRecord): Promise<void> {
	const clean: TaskRecord = {
		...record,
		message: redact(record.message),
		stages: record.stages.map(s => ({ ...s, message: redact(s.message) })),
		...(record.error === undefined ? {} : { error: { ...record.error, reason: redact(record.error.reason) } }),
	};
	await atomicWriteText(`${taskDir}/${record.id}.json`, `${JSON.stringify(clean, null, 2)}\n`);
	const all = (await readTasks(taskDir))
		.filter(t => t.id !== record.id)
		.sort((a, b) => a.startedAt - b.startedAt);
	const stale = all.slice(0, Math.max(0, all.length + 1 - TASK_KEEP));
	for (const t of stale) {
		try {
			await fsFace().remove(`${taskDir}/${t.id}.json`);
		}
		catch {
			// 单条清理失败不影响主流程（下次写入再收敛）
		}
	}
}

/** 读全部任务文件（损坏条目跳过不炸；目录不存在视同空表） */
export async function readTasks(taskDir: string): Promise<TaskRecord[]> {
	let names: string[];
	try {
		names = await fsFace().readdir(taskDir);
	}
	catch {
		return [];
	}
	const out: TaskRecord[] = [];
	for (const name of names.filter(n => n.endsWith(".json"))) {
		try {
			out.push(JSON.parse(new TextDecoder().decode(await fsFace().readFile(`${taskDir}/${name}`))) as TaskRecord);
		}
		catch {
			// 单文件损坏跳过：任务面可观测性优先，不为坏文件阻塞对账/轮询
		}
	}
	return out;
}

/** 单条查询（轮询消费面 getTask）；id 不在白名单（lock/state 键同款字符集，Finding B 防穿越）、缺失或损坏返回 null */
export async function getTask(taskDir: string, id: string): Promise<TaskRecord | null> {
	if (!/^[\w.-]+$/.test(id)) {
		return null;
	}
	try {
		return JSON.parse(new TextDecoder().decode(await fsFace().readFile(`${taskDir}/${id}.json`))) as TaskRecord;
	}
	catch {
		return null;
	}
}

/**
 * 超时清扫（启动/对账时点调用）：running 且 startedAt 超 TASK_TIMEOUT_MS 判 failed
 * （retryable——重跑即可续装），finishedAt 补齐。返回被改判的记录。
 */
export async function sweepTimedOut(taskDir: string, now: number = Date.now()): Promise<TaskRecord[]> {
	const flipped: TaskRecord[] = [];
	for (const t of await readTasks(taskDir)) {
		if (t.status !== "running" || now - t.startedAt <= TASK_TIMEOUT_MS) {
			continue;
		}
		const fixed: TaskRecord = {
			...t,
			status: "failed",
			finishedAt: now,
			error: { reason: `安装任务超时（超过 ${Math.round(TASK_TIMEOUT_MS / 60000)} 分钟无进展，持有者疑似崩溃）——R13/B9/R31 启动/对账判 failed；锁前失败可重跑，锁后失败请先对账（reconcile）`, retryable: true },
		};
		await writeTask(taskDir, fixed);
		flipped.push(fixed);
	}
	return flipped;
}
