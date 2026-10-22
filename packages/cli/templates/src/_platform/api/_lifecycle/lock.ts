// oj 原生扁平锁 manifests.yaml（D12）+ 安装器任务互斥锁 .install-tasks/.lock（R17/R31）。
// 锁格式严格 = `name: version` 字符串表（嵌套结构/额外键会解析失败拒启——禁加字段，S1-1.2/S1-3）；
// 写 = 全量重写经 atomicWriteText，改写前备份原锁至 <lock>.bak（恢复 = 回拷 .bak，用例钉住）；
// 写后读回校验重试收敛（S1-3 实测：oj build 的 load→save 窗口会吞并发外部写——不能假设 oj
// 尊重安装器锁，oj 锁本体无互斥是 S1 实测结论，互斥是安装器自己的纪律）。
// 任务互斥 = mkdir EEXIST 语义（O_CREAT|O_EXCL 的 POSIX 等价原语）：.lock 目录存在即占用；
// owner.json 落持有者与时间戳，超时（默认 30min，R13 同款阈值）判 stale 可接管（持有者崩溃自愈）。

import { atomicWriteText, fsFace, isMissingPath, randomId } from "./atomic";

/** 解析扁平锁文本为 {name: version} 表。任何非 `name: version` 行都算坏锁（fail-closed，不猜）。 */
export function parseLock(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [i, line] of text.split("\n").entries()) {
		if (line.trim() === "") {
			continue;
		}
		const m = /^([\w.-]+): "?([\w.-]+)"?$/.exec(line);
		if (m === null) {
			throw new Error(`lock: manifests.yaml 第 ${i + 1} 行不是合法扁平锁条目（name: version）：「${line}」`);
		}
		out[m[1]] = m[2];
	}
	return out;
}

/** 序列化为 oj 原生扁平形态：键序排序、`name: version` 逐行（name/version 字符集均 yaml 安全可裸写） */
export function serializeLock(entries: Record<string, string>): string {
	const keys = Object.keys(entries).sort();
	return keys.length === 0 ? "" : `${keys.map(k => `${k}: ${entries[k]}`).join("\n")}\n`;
}

/** 读锁：文件缺失视同空表（首装）；坏锁（解析失败）原样上抛由调用方给可读报错。 */
export async function readLock(lockPath: string): Promise<Record<string, string>> {
	try {
		return parseLock(new TextDecoder().decode(await fsFace().readFile(lockPath)));
	}
	catch (e) {
		if (isMissingPath(e)) {
			return {};
		}
		throw e;
	}
}

/**
 * 全量重写锁（D12）：改写前备份原锁至 <lock>.bak（原锁不存在则无备份可做）；拒绝空锁
 * （空锁拒启，S1-1.2 实测 oj exit 1）——摘除最后一个条目必须被拒绝，站点至少保留一个已锁模块。
 */
export async function writeLock(lockPath: string, entries: Record<string, string>): Promise<void> {
	if (Object.keys(entries).length === 0) {
		throw new Error("lock: 拒绝写入空锁（空锁拒启，S1-1.2）——站点至少保留一个已锁模块");
	}
	const f = fsFace();
	try {
		await f.readFile(lockPath);
		await f.copyFile(lockPath, `${lockPath}.bak`);
	}
	catch (e) {
		if (!isMissingPath(e)) {
			throw e;
		}
	}
	await atomicWriteText(lockPath, serializeLock(entries));
}

export interface LockCommitResult {
	ok: boolean
	message: string
}

/**
 * upsert 单条目并读回校验（S1-3 读回收敛）：读最新 → upsert → .bak → 原子写 → 读回，条目被
 * 并发写者吞掉则重试（默认 3 次），仍失败给附录 A lock_commit 语义（retryable：存在并发构建或安装）。
 */
export async function commitLockEntry(lockPath: string, name: string, version: string, retries = 3): Promise<LockCommitResult> {
	for (let i = 1; i <= retries; i++) {
		const entries = await readLock(lockPath);
		entries[name] = version;
		await writeLock(lockPath, entries);
		const back = await readLock(lockPath);
		if (back[name] === version) {
			return { ok: true, message: `manifests.yaml upsert ${name}: ${version}（写后读回校验通过）` };
		}
	}
	return {
		ok: false,
		message: `生效切换失败：锁写后读回 ${retries} 次均不符（条目 ${name} 被并发写者吞写，S1-3）——附录 A lock_commit：存在并发构建或安装，请稍后重试`,
	};
}

export interface TaskLock {
	release: () => Promise<void>
}

/** stale 阈值：与任务超时判 failed 同款 30min（R13/B9/R31 口径一致） */
export const LOCK_STALE_MS = 30 * 60_000;

export interface TaskLockOptions {
	/** 占用判定过期阈值（默认 30min；持有者崩溃后可接管） */
	staleMs?: number
	now?: number
}

/**
 * 取安装任务互斥锁（R17/R31）：.lock 目录 mkdir EEXIST 为原子闸；owner.json 记持有者与时间戳。
 * 并发第二取锁抛 busy；持有者崩溃后 owner 时间戳超 staleMs 可接管（stale takeover）。
 * owner.json 缺失/不可读（mkdir 与写 owner 之间的崩溃窗口）无法证明 stale，按占用拒绝——
 * 窗口极窄且可人工清除（删 .lock 目录），不给并发误判留口。
 */
export async function acquireTaskLock(taskDir: string, opts: TaskLockOptions = {}): Promise<TaskLock> {
	const f = fsFace();
	const dir = `${taskDir}/.lock`;
	await f.mkdir(taskDir, { recursive: true });
	const now = opts.now ?? Date.now();
	const staleMs = opts.staleMs ?? LOCK_STALE_MS;
	let owner: { holder?: string, acquiredAt?: number } | undefined;
	try {
		owner = JSON.parse(new TextDecoder().decode(await f.readFile(`${dir}/owner.json`)));
	}
	catch {
		// 无 owner.json：目录裸建或不存在——不可证明 stale，走 mkdir 闸判定
	}
	if (typeof owner?.acquiredAt === "number") {
		if (now - owner.acquiredAt < staleMs) {
			throw new Error(`install busy：已有安装任务持锁（${dir}，holder ${owner.holder ?? "?"}）——R17/R31 互斥；持有者崩溃后约 ${Math.round(staleMs / 60000)} 分钟可接管`);
		}
		await f.remove(dir, { recursive: true }); // stale 接管
	}
	try {
		await f.mkdir(dir);
	}
	catch {
		throw new Error(`install busy：已有安装任务持锁（${dir}）——R17/R31 互斥`);
	}
	await f.writeFile(`${dir}/owner.json`, new TextEncoder().encode(JSON.stringify({ holder: randomId(), acquiredAt: now })));
	return {
		async release(): Promise<void> {
			// 释放失败不掩盖主流程结果（.lock 残留由 stale 接管自愈）
			try {
				await f.remove(dir, { recursive: true });
			}
			catch {
				// ponytail: 单持有者纪律，不校验 owner 归属；多写者场景需先验 holder 再删
			}
		},
	};
}
