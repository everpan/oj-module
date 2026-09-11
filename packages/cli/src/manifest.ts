/**
 * 多团队清单合并（设计文档 R12，P5.4）。
 *
 * 各团队各出一份 modules.json，宿主部署时合并。同名模块 = 两个团队
 * 对同一路由/菜单的竞争声明，必须**显式拒绝**而非静默覆盖——
 * 静默覆盖意味着其中一方的模块凭空消失且无人知晓。
 */

/** 单份清单的模块条目（modules.json 的 BuiltModule 子集） */
export interface ManifestModule {
	name: string
	entry: string
	[key: string]: unknown
}

/** 待合并的单份清单 */
export interface ManifestSource {
	/** 来源标识（文件路径或团队名），用于冲突报错定位 */
	source: string
	modules: ManifestModule[]
}

/** 合并多份清单；同名模块（含同一份清单内部重复）直接抛错 */
export function mergeModuleManifests(sources: ManifestSource[]): ManifestModule[] {
	const merged: ManifestModule[] = [];
	const seen = new Map<string, string>();

	for (const { source, modules } of sources) {
		for (const mod of modules) {
			const owner = seen.get(mod.name);
			if (owner) {
				throw new Error(
					`[ojm] 清单合并失败：模块 "${mod.name}" 在 ${owner} 与 ${source} 中重复声明。\n`
					+ "同名模块只能存在一份，请合并或更名后重新发布。",
				);
			}
			seen.set(mod.name, source);
			merged.push(mod);
		}
	}
	return merged;
}
