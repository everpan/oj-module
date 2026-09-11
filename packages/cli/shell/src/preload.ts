/**
 * L2 完整性（设计文档 §4.7）预载清单计算。
 *
 * 独立于 host.tsx 入口（零 react/antd 依赖）：host.tsx 消费其结果做 DOM
 * 注入，测试直接消费纯函数——避免为测试把整个入口（及其传递依赖）拉进
 * 根 tsc 编译图。
 */

/** modules.json 中的 chunk 条目（cli ChunkEntry 的宿主侧结构子集） */
export interface HostChunk {
	url: string
	integrity: string
	lazy: boolean
}

/** modules.json 中的模块条目（cli BuiltModule 的宿主侧结构子集） */
export interface HostModule {
	name?: string
	entry?: string
	enabled?: boolean
	dependencies?: string[]
	peerRuntime?: string
	css?: string[]
	chunks?: HostChunk[]
}

/**
 * 待预载的 chunk 列表——仅非 lazy chunk 携带 sha384 integrity 进入；
 * lazy chunk 按需加载，不受 L2 档位保护（D7）。
 */
export function collectPreloads(modules: HostModule[]): { href: string, integrity: string }[] {
	const seen = new Set<string>();
	const preloads: { href: string, integrity: string }[] = [];
	for (const mod of modules) {
		for (const chunk of mod.chunks ?? []) {
			if (chunk.lazy || seen.has(chunk.url))
				continue;
			seen.add(chunk.url);
			preloads.push({ href: chunk.url, integrity: chunk.integrity });
		}
	}
	return preloads;
}
