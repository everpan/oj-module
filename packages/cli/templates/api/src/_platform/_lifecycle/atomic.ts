// 状态文件原子写底座（D13）：state.yaml / manifests.yaml / modules.json / 任务文件
// 一切状态落盘统一走这里——同目录 tmp + rename 原子替换，读者永远见不到半截文件
// （rename 同目录即同文件系统，POSIX 语义下原子替换 inode）。
// fs 依赖从 globalThis.fs 取（平台 isolate 注入 FsApi 面；测试注入 node:fs/promises 适配），
// 签名不携带 fs 参数（DIP：依赖结构化最小面 FsFace，两实现天然兼容）。
// 写失败（writeFile/rename 抛错）时尽力清理 tmp 后原样上抛，目标旧文件不受影响。

export interface FsFace {
	writeFile: (path: string, data: Uint8Array) => Promise<void>
	readFile: (path: string) => Promise<Uint8Array>
	mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>
	remove: (path: string, opts?: { recursive?: boolean }) => Promise<void>
	rename: (oldPath: string, newPath: string) => Promise<void>
	/** 复制文件（R14 迁移前置备份：sqlite 库 copy 为 <db>.bak-<ts>）；两路径须同文件系统无需递归 */
	copyFile: (src: string, dest: string) => Promise<void>
	/** 列目录成员名（不含路径；不含 . / ..） */
	readdir: (path: string) => Promise<string[]>
}

/**
 * 随机 id：oj isolate 的 crypto 增补面（api-manual §crypto）只有 randomHex，无 Web 的 randomUUID
 * ——有 randomUUID 用之（Node 测试侧），否则 randomHex(16) 兜底（真机冒烟 P1-13 实测，附录 B-9 同源缺面）。
 */
export function randomId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string, randomHex?: (n?: number) => string } }).crypto;
	if (c?.randomUUID !== undefined)
		return c.randomUUID();
	if (c?.randomHex !== undefined)
		return c.randomHex(16);
	throw new Error("atomic: 随机数面不可用（globalThis.crypto 缺 randomUUID/randomHex）");
}

export function fsFace(): FsFace {
	const f = (globalThis as { fs?: Partial<FsFace> & { readDir?: (path: string) => Promise<AsyncIterable<{ name: string }>> } }).fs;
	if (f === undefined) {
		throw new Error("atomic: 平台 fs 面不可用（globalThis.fs 未注入），无法落盘");
	}
	if (f.copyFile !== undefined && f.readdir !== undefined) {
		return f as FsFace;
	}
	// oj fs 全局面缺 copyFile、目录列举叫 readDir 且形状是 AsyncIterable<DirEntry>（api-manual §fs）
	// ——在此单点适配到生命周期代码消费的 FsFace（P1-13 真机冒烟实测缺面，契约附录 B-9）。
	return {
		writeFile: (path, data) => f.writeFile!(path, data),
		readFile: path => f.readFile!(path),
		mkdir: (path, opts) => f.mkdir!(path, opts),
		remove: (path, opts) => f.remove!(path, opts),
		rename: (oldPath, newPath) => f.rename!(oldPath, newPath),
		// ponytail: copyFile 经字节中转（V8 常驻峰值 = 文件大小）；sqlite 备份上 GB 时须上游补原生 copy
		copyFile: f.copyFile ?? (async (src, dest) => f.writeFile!(dest, await f.readFile!(src))),
		readdir: f.readdir ?? (async (path) => {
			const names: string[] = [];
			for await (const e of await f.readDir!(path))
				names.push(e.name);
			return names;
		}),
	};
}

const encoder = new TextEncoder();

export async function atomicWriteText(path: string, content: string): Promise<void> {
	const f = fsFace();
	// tmp 与目标同目录：保证 rename 不跨文件系统；随机后缀防并发写者互踩同一 tmp
	const slash = path.lastIndexOf("/");
	const dir = slash === -1 ? "" : path.slice(0, slash);
	const base = slash === -1 ? path : path.slice(slash + 1);
	const tmp = `${dir === "" ? "" : `${dir}/`}${base}.${randomId()}.tmp`;
	if (dir !== "") {
		await f.mkdir(dir, { recursive: true });
	}
	try {
		await f.writeFile(tmp, encoder.encode(content));
		await f.rename(tmp, path);
	}
	catch (e) {
		try {
			await f.remove(tmp, { recursive: true });
		}
		catch {
			// 清理失败不掩盖原始错误
		}
		throw e;
	}
}
