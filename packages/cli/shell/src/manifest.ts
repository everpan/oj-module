import type { Manifest } from "@react-antd-module/runtime";
import type { HostModule } from "./preload";

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
	return versions?.["@react-antd-module/runtime"];
}
