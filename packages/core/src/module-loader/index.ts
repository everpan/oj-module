import type { AppRouteRecordRaw } from "../router/types";
import type {
	Manifest,
	ManifestModuleEntry,
	ModuleContext,
	ModuleDefinition,
	ModuleInstance,
	ModuleRequest,
} from "../types";

import {
	emitRoutesReady,
	getRouteAuthz,
	isDev,
} from "../host";
import { registerLayout, unregisterLayouts } from "../layout/layout-registry";
import { mergeModuleI18nResources } from "../locales";
import { registerModuleMenu, unregisterModuleMenus } from "../menu";
import {
	registerAuthProvider,
	registerHeaderProvider,
	registerNotificationsApiProvider,
	registerSystemApiProvider,
	registerUploadApiProvider,
	unregisterApiProviders,
	unregisterAuthProvider,
	unregisterHeaderProvider,
} from "../providers/registry";
import { createScopedRequest } from "../request/scoped";
import { addRouteIdByPath } from "../router/utils/add-route-id-by-path";
import { resolveRouteLayouts } from "../router/utils/resolve-layout";
import { getAllRoutePaths, getKeepAliveExcludes } from "./keep-alive";
import { satisfiesSemver } from "./semver";
import { registerSlot, removeModuleSlots } from "./slots";

/**
 * 模块加载引擎（v1 module-loader 直蒸，PRD §4 三处事件化）：
 * ① access store 写入 → emitRoutesReady；② useUserStore → authz 钩子；
 * ③ import.meta.env.DEV → isDev 旗标。均由宿主 bootstrap 注入。
 */

const modules = new Map<string, ModuleInstance>();
const registeredStores = new Map<string, unknown>();
const registeredApiPrefixes = new Map<string, string[]>(); // 一模块可多前缀，登记序即数组序

/** 宿主注入底层 request 实现（core 零请求栈依赖）；bootstrap 时调用 */
let underlyingRequest: ModuleRequest | undefined;
export function setUnderlyingRequest(request: ModuleRequest): void {
	underlyingRequest = request;
}

/** i18next 实例桥（收敛契约 §5.3）：宿主注入 plane 工作实例，禁默认单例（A25） */
let i18nBridge: { addResourceBundle: (lng: string, ns: string, resources: unknown) => void };
export function setI18nBridge(instance: typeof i18nBridge): void {
	i18nBridge = instance;
}

function createModuleContext(definition: ModuleDefinition): ModuleContext {
	return {
		module: { name: definition.name, version: definition.version },
		utils: {
			request: createScopedRequest(
				definition.name,
				() => registeredApiPrefixes.get(definition.name),
				underlyingRequest as ModuleRequest,
			),
		},
		register: {
			store: (name, store) => {
				registeredStores.set(name, store);
			},
			// 追加而非覆盖（一模块多个生成 client）；同前缀重复登记去重
			apiPrefix: (prefix) => {
				const prefixes = registeredApiPrefixes.get(definition.name) ?? [];
				if (!prefixes.includes(prefix))
					prefixes.push(prefix);
				registeredApiPrefixes.set(definition.name, prefixes);
			},
			authProvider: provider => registerAuthProvider(definition.name, provider),
			headerProvider: provider => registerHeaderProvider(definition.name, provider),
			systemApi: provider => registerSystemApiProvider(definition.name, provider),
			notificationsApi: provider => registerNotificationsApiProvider(definition.name, provider),
			uploadApi: provider => registerUploadApiProvider(definition.name, provider),
			layout: (name, component) => registerLayout(definition.name, name, component),
			menu: items => registerModuleMenu(definition.name, items),
		},
		registerSlot: (slotName, node) => registerSlot(definition.name, slotName, node),
	};
}

async function loadModuleEntry(entry: ManifestModuleEntry): Promise<ModuleDefinition | null> {
	try {
		const modImport = await import(/* @vite-ignore */ entry.entry);
		const mod: ModuleDefinition = modImport.default;
		if (mod.name !== entry.name) {
			console.error(`[module-loader] Name mismatch: manifest=${entry.name}, actual=${mod.name}`);
			return null;
		}
		return mod;
	}
	catch (error) {
		console.error(`[module-loader] Failed to load module "${entry.name}":`, error);
		return null;
	}
}

function topologicalSort(entries: ManifestModuleEntry[], definitions: Map<string, ModuleDefinition>): ManifestModuleEntry[] {
	const sorted: ManifestModuleEntry[] = [];
	const visited = new Set<string>();
	const visiting = new Set<string>();

	function visit(entry: ManifestModuleEntry) {
		const name = entry.name;
		if (visited.has(name))
			return;
		if (visiting.has(name)) {
			console.warn(`[module-loader] Circular dependency detected for "${name}"`);
			return;
		}
		visiting.add(name);

		const deps = definitions.get(name)?.config?.dependencies ?? [];
		for (const dep of deps) {
			const depEntry = entries.find(e => e.name === dep);
			if (depEntry)
				visit(depEntry);
			else
				console.warn(`[module-loader] Dependency "${dep}" not found for "${name}"`);
		}

		visiting.delete(name);
		visited.add(name);
		sorted.push(entry);
	}

	for (const entry of entries) {
		visit(entry);
	}

	return sorted;
}

export async function loadAll(manifest: Manifest): Promise<ModuleInstance[]> {
	if (!underlyingRequest || !i18nBridge) {
		throw new Error(
			"[module-loader] 宿主未完成 bootstrap 注入：请先调用 "
			+ "setUnderlyingRequest(request) 与 setI18nBridge(i18n) 再 loadAll。",
		);
	}
	const enabledEntries = manifest.modules.filter(m => m.enabled !== false);

	if (isDev()) {
		console.warn(`[module-loader] Loading ${enabledEntries.length} modules from manifest...`);
	}

	// Phase 1: 并行加载 entry chunk；peerRuntime 不兼容 → 显式失败，禁止静默成功
	const loadResults = await Promise.all(
		enabledEntries.map(async (entry) => {
			const definition = await loadModuleEntry(entry);
			return { entry, definition };
		}),
	);

	const definitions = new Map<string, ModuleDefinition>();
	const validEntries: ManifestModuleEntry[] = [];

	for (const { entry, definition } of loadResults) {
		if (definition) {
			const peerRuntime = definition.peerRuntime ?? entry.peerRuntime;
			if (manifest.runtimeVersion && peerRuntime && !satisfiesSemver(manifest.runtimeVersion, peerRuntime)) {
				console.error(
					`[module-loader] 模块 "${entry.name}" 与宿主 runtime 版本不兼容：`
					+ `期望 ${peerRuntime}，实际 ${manifest.runtimeVersion}。已跳过加载。`,
				);
				modules.set(entry.name, {
					definition,
					status: "error",
					error: new Error(
						`模块 "${entry.name}" peerRuntime 不兼容：期望 ${peerRuntime}，实际 ${manifest.runtimeVersion}`,
					),
				});
				continue;
			}
			definitions.set(entry.name, definition);
			validEntries.push(entry);
			modules.set(entry.name, { definition, status: "loaded" });
		}
		else {
			modules.set(entry.name, {
				definition: { name: entry.name, description: "", version: "0.0.0", routes: [] },
				status: "error",
				error: new Error("Failed to load module entry"),
			});
		}
	}

	// 依赖缺失 → missing-deps，跳过生命周期与路由注册（禁止半加载）
	for (let i = validEntries.length - 1; i >= 0; i--) {
		const entry = validEntries[i]!;
		const definition = definitions.get(entry.name)!;
		const deps = definition.config?.dependencies ?? entry.dependencies ?? [];
		const missing = deps.filter(dep => !definitions.has(dep));
		if (missing.length > 0) {
			console.error(
				`[module-loader] 模块 "${entry.name}" 依赖缺失：${missing.join(", ")} 未加载。`
				+ "已跳过该模块（不执行生命周期、不注册路由）。",
			);
			modules.set(entry.name, {
				definition,
				status: "missing-deps",
				error: new Error(`模块 "${entry.name}" 依赖缺失：${missing.join(", ")}`),
			});
			validEntries.splice(i, 1);
			definitions.delete(entry.name);
		}
	}

	// Phase 2: 拓扑排序
	const sortedEntries = topologicalSort(validEntries, definitions);

	// Phase 3: 按序执行生命周期（beforeInit → onInit → i18n 合并；onActivate
	// 不在 loadAll 调用面——激活语义归宿主/壳显式触发，R0-3 实测）
	for (const entry of sortedEntries) {
		const definition = definitions.get(entry.name)!;
		const ctx = createModuleContext(definition);

		try {
			if (definition.lifecycle?.beforeInit) {
				await definition.lifecycle.beforeInit(ctx);
			}
			if (definition.lifecycle?.onInit) {
				await definition.lifecycle.onInit(ctx);
			}
			await mergeModuleI18nResources(i18nBridge, definition);
			if (isDev()) {
				console.warn(`[module-loader] ✓ ${definition.name}@${definition.version} loaded`);
			}
		}
		catch (error) {
			console.error(`[module-loader] Lifecycle error for "${entry.name}":`, error);
			modules.set(entry.name, {
				definition,
				status: "error",
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}

	// 模块受信 bundle（v1 语义）：路由就绪即发布事件（①），宿主订阅后写自己的 access store
	const moduleRoutes = getRoutes();
	if (moduleRoutes.length > 0) {
		emitRoutesReady(moduleRoutes);
	}

	return Array.from(modules.values());
}

export function getModules(): ModuleInstance[] {
	return Array.from(modules.values());
}

export function getModule(name: string): ModuleInstance | undefined {
	return modules.get(name);
}

export function getRoutes(): AppRouteRecordRaw[] {
	// requiredRoles/requiredPermissions 前置过滤：无角色的用户拿不到路由本身（菜单同源）；身份 = authz 钩子（②）
	const { roles, permissions = [] } = getRouteAuthz();
	const routes: AppRouteRecordRaw[] = [];
	for (const instance of modules.values()) {
		if (instance.status !== "loaded" && instance.status !== "active")
			continue;
		const requiredRoles = instance.definition.config?.requiredRoles;
		if (requiredRoles?.length && !requiredRoles.some(role => roles.includes(role)))
			continue;
		const requiredPermissions = instance.definition.config?.requiredPermissions;
		if (requiredPermissions?.length && !requiredPermissions.every(perm => permissions.includes(perm)))
			continue;
		if (instance.definition.routes.length > 0) {
			routes.push(...resolveRouteLayouts(instance.definition.routes));
		}
	}
	// 菜单选中态依赖 match.id（=path），出口统一补 id；重复调用幂等
	return addRouteIdByPath(routes);
}

export function getRegisteredStore<T = unknown>(name: string): T | undefined {
	return registeredStores.get(name) as T | undefined;
}

export function getRegisteredApiPrefix(moduleName: string): string | undefined {
	return registeredApiPrefixes.get(moduleName)?.[0];
}

/** 卸载：onDestroy → 清插槽/菜单/ provider/布局 → 移除实例；其余模块不受影响 */
export async function unloadModule(name: string): Promise<void> {
	const instance = modules.get(name);
	if (instance) {
		const ctx = createModuleContext(instance.definition);
		if (instance.definition.lifecycle?.onDestroy) {
			await instance.definition.lifecycle.onDestroy(ctx);
		}
	}
	removeModuleSlots(name);
	unregisterModuleMenus(name);
	unregisterAuthProvider(name);
	unregisterHeaderProvider(name);
	unregisterApiProviders(name);
	unregisterLayouts(name);
	modules.delete(name);
}

function loadedDefinitions(): ModuleDefinition[] {
	return Array.from(modules.values())
		.filter(instance => instance.status === "loaded" || instance.status === "active")
		.map(instance => instance.definition);
}

/** KeepAlive exclude key：`handle.keepAlive === false` 的路径集合 */
export function getKeepAliveExcludeKeys(): string[] {
	return getKeepAliveExcludes(loadedDefinitions());
}

/** 全部路由 key：关闭多 tab 时整体排除 */
export function getAllRoutePathKeys(): string[] {
	return getAllRoutePaths(loadedDefinitions());
}
