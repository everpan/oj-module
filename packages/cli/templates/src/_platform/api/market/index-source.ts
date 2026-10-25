// REG-CS5 三级索引读取源（DIP，S2-1③）：把「索引字节从哪来」与「索引怎么校验」分开。
// 本模块只负责取字节——HTTP（条件请求/304）与本地目录两实现；签名校验、同代钉值校验、
// 新鲜度校验全部留在调用方 market/api.ts（fetchIndex），读写两侧不重复实现校验语义。
//
// 三级索引形态（与 ojm market build-index 落盘逐字一致）：
//   catalog.yaml        总目录：{seq, issued_at, expires_at, shards: {<片号>: <代次钉值>},
//                          solutions: [{name, shards: [<片号>...]}]}——无版本明细，提交点
//   shards/<n>.yaml     分片：{solutions: [{name, latest, versions: [<Form B 条目>]}]}——
//                          纯内容无 meta，代次由 .sig 与 catalog 钉值携带；版本条目即 manifest

import type { FetchInitFace } from "../_shared/site-facade";
import { fsFace } from "../_lifecycle/atomic";

/** 索引文件种类（REG-CS1：签名覆盖 (kind, seq)；与 ojm publish 的 IndexKind 逐字同集合） */
export type IndexKind = "catalog" | "shard";

/** 索引文件（正文 + detached 签名）。sig 缺失 → null：调用方按 index_sig_missing 拒载，不猜 */
export interface IndexFile {
	body: string
	sig: string | null
}

/**
 * 索引读取源（S2-1③ DIP）：`read` 返回 null = 拉不到（网络错 / 非 2xx / 文件不存在），
 * 拒载还是降级由调用方裁决——本模块不做任何校验决策、不抛业务错误。
 */
export interface IndexSource {
	read: (kind: IndexKind, no?: number) => Promise<IndexFile | null>
}

/** 索引相对路径（CDN 布局单点：catalog.yaml + shards/<n>.yaml；片号由调用方校验为正整数） */
export function indexPathOf(kind: IndexKind, no?: number): string {
	return kind === "catalog" ? "catalog.yaml" : `shards/${no}.yaml`;
}

/**
 * 条件请求缓存（进程/模块级，与 site-facade 的 canonicalOriginCache 同模式）：
 * url → {etag, body}。oj isolate 若按请求新建则退化为「请求内去重」，若被运行时复用则
 * 跨请求生效——两种生命周期下语义都正确：304 时服务端已确认字节未变，缓存正文即可信。
 */
const etagCache = new Map<string, { etag: string, body: string }>();

/**
 * HTTP 索引源（S2-1③/④）：ETag + If-None-Match 条件请求，304 走缓存正文不重传。
 *
 * **不再发 `cache-control: no-cache`**（旧口径）：读面新鲜度改由服务端缓存头
 * （`Cache-Control: max-age=60, stale-while-revalidate=60`，Q8：yank 最坏 120s 生效）
 * 与条件请求共同承载。索引自身仍带 expires_at（REG-CS2 硬过期即拒）与 seq 水位
 * （防回放），缓存层只决定「少传字节」，不决定「信不信」——§5.3 可用性通道的
 * 「窗口内用缓存副本」由 HTTP 缓存层（中间层 + 服务端 ETag/304）兑现，读取器不存第二份真相。
 */
export function httpIndexSource(fetch: FetchInitFace, base: string): IndexSource {
	const root = base.replace(/\/+$/, "");
	const readOne = async (rel: string): Promise<string | null> => {
		const url = `${root}/${rel}`;
		const cached = etagCache.get(url);
		let res: Awaited<ReturnType<FetchInitFace>>;
		try {
			res = await fetch(url, cached === undefined ? undefined : { headers: { "if-none-match": cached.etag } });
		}
		catch {
			return null; // 网络层失败：拉不到，拒载/降级决策归调用方
		}
		// 304：服务端认了我们的 ETag——正文未变，用缓存副本，不重传（BDD：重复拉取走 304）
		if (res.status === 304 && cached !== undefined)
			return cached.body;
		if (!res.ok)
			return null;
		const body = new TextDecoder().decode(await res.arrayBuffer());
		// 无 ETag 的响应不进缓存：没有条件请求的锚点，缓存它毫无意义
		const etag = res.headers?.get("etag") ?? res.headers?.get("ETag") ?? null;
		if (etag !== null && etag !== "")
			etagCache.set(url, { etag, body });
		return body;
	};
	return {
		read: async (kind, no) => {
			const rel = indexPathOf(kind, no);
			const [body, sig] = await Promise.all([readOne(rel), readOne(`${rel}.sig`)]);
			return body === null ? null : { body, sig };
		},
	};
}

/**
 * 本地目录索引源（S2-1③ 第二实现）：索引就在本机目录（离线消费 / 自供直读 / 测试夹具），
 * 不经 HTTP。校验语义与 HTTP 实现完全同构——调用方看不出区别，这正是 DIP 的目的。
 */
export function localIndexSource(dir: string): IndexSource {
	const root = dir.replace(/\/+$/, "");
	return {
		read: async (kind, no) => {
			const f = fsFace();
			const rel = indexPathOf(kind, no);
			let body: string;
			try {
				body = new TextDecoder().decode(await f.readFile(`${root}/${rel}`));
			}
			catch {
				return null; // 目录里没有这个索引文件
			}
			let sig: string | null = null;
			try {
				sig = new TextDecoder().decode(await f.readFile(`${root}/${rel}.sig`));
			}
			catch {
				sig = null; // 缺签名：调用方按 index_sig_missing 拒载（与 HTTP 实现同口径）
			}
			return { body, sig };
		},
	};
}
