import type { Manifest } from "@oj-module/runtime";
import type { HostModule } from "./preload";
import { withSiteBase } from "./site-urls";

/**
 * 把 modules.json 里的站内绝对 URL 补上部署 base（子路径部署，2026-10-21）。
 *
 * modules.json 是**构建期**产物（`ojm build`），URL 与站点挂载前缀无关
 * （恒为 `/modules/...`）；真实前缀只有运行期才知道（`window.__OJ_BASE__`）。
 * 因此在宿主拿到清单后立刻归一，后续所有消费者（信任根校验、CSS 注入、
 * modulepreload、loader entry）看到的都是最终 URL——只此一处，漏改即 404 白屏。
 *
 * 绝对域（CDN 模块）原样保留，见 `web.config.ts` 的 `baseUrl`。
 */
export function resolveModuleUrls(list: HostModule[], base: string): HostModule[] {
	return list.map(m => ({
		...m,
		entry: m.entry === undefined ? m.entry : withSiteBase(m.entry, base),
		css: m.css?.map(href => withSiteBase(href, base)),
		chunks: m.chunks?.map(chunk => ({ ...chunk, url: withSiteBase(chunk.url, base) })),
	}));
}

/**
 * P7.7：modules.json（cli BuiltModule[]）→ loader Manifest 的字段透传。
 *
 * 评审 F1/F2：此前裁剪成 {name, entry}，导致 enabled 过滤（US-9 下线）
 * 与 peerRuntime 校验（US-5）双双失效。清单字段必须原样透传——
 * loader 侧已有 enabled/peerRuntime/dependencies 的全部消费逻辑。
 */
export function toLoaderManifest(list: HostModule[], runtimeVersion?: string): Manifest {
	return {
		runtimeVersion,
		modules: list.map(m => ({
			name: m.name ?? "",
			entry: m.entry ?? "",
			enabled: m.enabled,
			dependencies: m.dependencies,
			peerRuntime: m.peerRuntime,
		})),
	};
}

/** 从 shell dist 的 versions.json 提取 runtime 版本（P7.6 宿主侧真源） */
export function extractRuntimeVersion(versions: Record<string, string> | null | undefined): string | undefined {
	return versions?.["@oj-module/runtime"];
}
