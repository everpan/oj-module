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

export function fsFace(): FsFace {
	const f = (globalThis as { fs?: FsFace }).fs;
	if (f === undefined) {
		throw new Error("atomic: 平台 fs 面不可用（globalThis.fs 未注入），无法落盘");
	}
	return f;
}

const encoder = new TextEncoder();

export async function atomicWriteText(path: string, content: string): Promise<void> {
	const f = fsFace();
	// tmp 与目标同目录：保证 rename 不跨文件系统；随机后缀防并发写者互踩同一 tmp
	const slash = path.lastIndexOf("/");
	const dir = slash === -1 ? "" : path.slice(0, slash);
	const base = slash === -1 ? path : path.slice(slash + 1);
	const tmp = `${dir === "" ? "" : `${dir}/`}${base}.${crypto.randomUUID()}.tmp`;
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
