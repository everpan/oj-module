import type { ModuleDefinition } from "../types";

/** 通用语言模块映射类型（v1 locales/helper 直蒸；导出供 i18nResources 声明生成引用） */
export interface LanguageModule<T> {
	[key: string]: T | any
}

/** 语言文件集合参数类型 */
export type LanguageFileMap = Record<string, LanguageModule<LanguageFileMap>>;

/** 文件路径映射 → 按文件名聚合的语言包（纯函数；v1 的 import.meta.glob 属宿主构建面） */
export function organizeLanguageFiles(files: LanguageFileMap) {
	const result: LanguageModule<LanguageFileMap> = {};

	for (const key in files) {
		const data = files[key];
		const fileArr = key?.split("/");
		const fileName = fileArr[fileArr?.length - 1];
		if (!fileName)
			continue;
		const name = fileName.split(".json")[0];
		if (name)
			result[name] = data;
	}

	return result;
}

/**
 * 模块 i18n 资源合并（v1 mergeI18nResources 蒸馏 + **实例收敛**，compat 设计
 * §5.3）：i18next 实例由调用方显式传入（禁默认单例——「最后 init 者赢」绑定险），
 * namespace = 模块名，资源全量挂 translation 键下由宿主 i18n 管线决定。
 */
export async function mergeModuleI18nResources(
	i18n: { addResourceBundle: (lng: string, ns: string, resources: unknown) => void },
	definition: ModuleDefinition,
): Promise<void> {
	if (!definition.i18n)
		return;

	for (const [locale, loader] of Object.entries(definition.i18n)) {
		const resources = await loader();
		i18n.addResourceBundle(locale, definition.name, (resources as { default?: unknown }).default ?? resources);
	}
}
