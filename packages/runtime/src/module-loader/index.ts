import type { AppRouteRecordRaw } from "#src/router/types";
import type { AuthProvider } from "#src/store/auth-provider";
import type {
	Manifest,
	ManifestModuleEntry,
	ModuleContext,
	ModuleDefinition,
	ModuleInstance,
} from "./types";

import i18next from "i18next";

import { addRouteIdByPath } from "#src/router/utils/add-route-id-by-path";
import { resolveRouteLayouts } from "#src/router/utils/resolve-layout";
import { useAccessStore } from "#src/store/access";
import {
	registerNotificationsApiProvider,
	registerSystemApiProvider,
	registerUploadApiProvider,
	unregisterApiProviders,
} from "#src/store/api-provider";
import { registerAuthProvider, unregisterAuthProvider } from "#src/store/auth-provider";
import { useUserStore } from "#src/store/user";
import { createScopedRequest } from "#src/utils/request/scoped";
import { getAllRoutePaths, getKeepAliveExcludes } from "./keep-alive";
import { satisfiesSemver } from "./semver";
import { registerSlot, removeModuleSlots } from "./slots";

const modules = new Map<string, ModuleInstance>();
const registeredStores = new Map<string, unknown>();
const registeredApiPrefixes = new Map<string, string>();

function createModuleContext(definition: ModuleDefinition): ModuleContext {
	return {
		module: {
			name: definition.name,
			version: definition.version,
		},
		utils: {
			// P6.3 / D11：模块拿到的是按其登记 apiPrefix 收敛的 scoped client，
			// 而非全局 request——越界请求在客户端即被拒绝
			request: createScopedRequest(
				definition.name,
				() => registeredApiPrefixes.get(definition.name),
			),
		},
		register: {
			store: (name: string, store: unknown) => {
				registeredStores.set(name, store);
			},
			apiPrefix: (prefix: string) => {
				registeredApiPrefixes.set(definition.name, prefix);
			},
			// P5：接管登录链路；闭包 definition.name，模块拿不到别人的名字，
			// 模块卸载时由 unloadModule 经 unregisterAuthProvider 自动注销
			authProvider: (provider: AuthProvider) => {
				registerAuthProvider(definition.name, provider);
			},
			// D9：接管系统/通知/上传 API；闭包 definition.name，模块卸载时
			// 由 unloadModule 经 unregisterApiProviders 自动注销（命名隔离）
			systemApi: (provider) => {
				registerSystemApiProvider(definition.name, provider);
			},
			notificationsApi: (provider) => {
				registerNotificationsApiProvider(definition.name, provider);
			},
			uploadApi: (provider) => {
				registerUploadApiProvider(definition.name, provider);
			},
		},
		registerSlot: (slotName: string, node: React.ReactNode) => {
			registerSlot(definition.name, slotName, node);
		},
	};
}

async function loadModuleEntry(entry: ManifestModuleEntry): Promise<ModuleDefinition | null> {
	try {
		const modImport = await import(/* @vite-ignore */ entry.entry);
		const mod: ModuleDefinition = modImport.default;

		if (mod.name !== entry.name) {
			console.error(
				`[module-loader] Name mismatch: manifest=${entry.name}, actual=${mod.name}`,
			);
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

		const definition = definitions.get(name);
		const deps = definition?.config?.dependencies ?? [];
		for (const dep of deps) {
			const depEntry = entries.find(e => e.name === dep);
			if (depEntry) {
				visit(depEntry);
			}
			else {
				console.warn(`[module-loader] Dependency "${dep}" not found for "${name}"`);
			}
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

async function mergeI18nResources(definition: ModuleDefinition) {
	if (!definition.i18n)
		return;

	for (const [locale, loader] of Object.entries(definition.i18n)) {
		const resources = await loader();
		i18next.addResourceBundle(locale, definition.name, resources.default || resources);
	}
}

export async function loadAll(manifest: Manifest): Promise<ModuleInstance[]> {
	const enabledEntries = manifest.modules.filter(m => m.enabled !== false);

	if (import.meta.env.DEV) {
		console.warn(`[module-loader] Loading ${enabledEntries.length} modules from manifest...`);
	}

	// Phase 1: 并行加载所有 entry chunk
	const loadResults = await Promise.all(
		enabledEntries.map(async (entry) => {
			const definition = await loadModuleEntry(entry);
			return { entry, definition };
		}),
	);

	// 收集成功加载的定义
	const definitions = new Map<string, ModuleDefinition>();
	const validEntries: ManifestModuleEntry[] = [];

	for (const { entry, definition } of loadResults) {
		if (definition) {
			// P7.6 / US-5 / D12：peerRuntime 与宿主 runtime 版本不兼容 →
			// 显式失败（含模块名/期望/实际），禁止静默成功
			const peerRuntime = definition.peerRuntime ?? entry.peerRuntime;
			if (manifest.runtimeVersion && peerRuntime && !satisfiesSemver(manifest.runtimeVersion, peerRuntime)) {
				console.error(
					`[module-loader] 模块 "${entry.name}" 与宿主 runtime 版本不兼容：`
					+ `期望 ${peerRuntime}，实际 ${manifest.runtimeVersion}。已跳过加载。`
					+ "修复建议：升级宿主 runtime 或按兼容范围重新构建该模块（US-5）。",
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
			modules.set(entry.name, {
				definition,
				status: "loaded",
			});
		}
		else {
			modules.set(entry.name, {
				definition: { name: entry.name, description: "", version: "0.0.0", routes: [] },
				status: "error",
				error: new Error("Failed to load module entry"),
			});
		}
	}

	// P7.8 / US-9：依赖缺失（未声明在清单或加载失败）→ 标 missing-deps 并跳过
	// 生命周期与路由注册，不得半加载；提示包含缺失的依赖名
	for (let i = validEntries.length - 1; i >= 0; i--) {
		const entry = validEntries[i]!;
		const definition = definitions.get(entry.name)!;
		const deps = definition.config?.dependencies ?? entry.dependencies ?? [];
		const missing = deps.filter(dep => !definitions.has(dep));
		if (missing.length > 0) {
			console.error(
				`[module-loader] 模块 "${entry.name}" 依赖缺失：${missing.join(", ")} 未加载。`
				+ "已跳过该模块（不执行生命周期、不注册路由）。修复建议：先部署依赖模块，或在清单中移除该依赖（US-9）。",
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

	// Phase 3: 按序执行生命周期
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

			await mergeI18nResources(definition);

			if (import.meta.env.DEV) {
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

	/**
	 * 模块路由与宿主用户体系解耦（模块独立运行方案）：模块经清单信任校验后
	 * 即注册进 access store，使菜单/路由表在「无后端鉴权」场景（playground /
	 * ram dev）下立即可用，无需等待后端 userInfo。模块是受信 bundle（P5.5/O5），
	 * 默认可访问。对完整应用：模块路由由「加载完成」前置到注册，不再依赖登录
	 * 后才注入；生产自身路由仍由 AuthGuard 走原鉴权流程，不受影响。
	 */
	const moduleRoutes = getRoutes();
	if (moduleRoutes.length > 0) {
		useAccessStore.getState().setAccessStore(moduleRoutes);
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
	// P5.9 / B16：模块级 requiredRoles 在路由注入前过滤——
	// 无角色的用户拿不到路由本身（菜单同源），而非渲染后 403
	// P7.12：requiredPermissions 同样前置过滤（须全部满足），两者可叠加
	const { roles, permissions = [] } = useUserStore.getState();
	const routes: AppRouteRecordRaw[] = [];
	for (const instance of modules.values()) {
		// error / missing-deps（P7.8）等一切非就绪状态都不产出路由
		if (instance.status !== "loaded" && instance.status !== "active")
			continue;
		const requiredRoles = instance.definition.config?.requiredRoles;
		if (requiredRoles?.length && !requiredRoles.some(role => roles.includes(role)))
			continue;
		const requiredPermissions = instance.definition.config?.requiredPermissions;
		if (requiredPermissions?.length && !requiredPermissions.every(perm => permissions.includes(perm)))
			continue;
		if (instance.definition.routes.length > 0) {
			// P2.7：布局不再由模块自行 import，按 handle.layout 在出口统一包裹
			routes.push(...resolveRouteLayouts(instance.definition.routes));
		}
	}
	// 菜单选中态依赖 useMatches 的 match.id（=path）。在出口统一补 id，
	// host.tsx 等不经 auth-guard 的链路也能拿到（此前仅 auth-guard 补，
	// 导致 ram dev 下菜单无高亮）；auth-guard 重复调用是幂等的。
	return addRouteIdByPath(routes);
}

export function getRegisteredStore<T = unknown>(name: string): T | undefined {
	return registeredStores.get(name) as T | undefined;
}

export function getRegisteredApiPrefix(moduleName: string): string | undefined {
	return registeredApiPrefixes.get(moduleName);
}

/**
 * 卸载模块：执行 onDestroy 生命周期 → 清理其布局插槽（US-8）→ 移除实例。
 * 供运维下线单个模块使用，其余模块不受影响。
 */
export async function unloadModule(name: string): Promise<void> {
	const instance = modules.get(name);
	if (instance) {
		const ctx = createModuleContext(instance.definition);
		if (instance.definition.lifecycle?.onDestroy) {
			await instance.definition.lifecycle.onDestroy(ctx);
		}
	}
	removeModuleSlots(name);
	unregisterAuthProvider(name);
	unregisterApiProviders(name);
	modules.delete(name);
}

/**
 * 当前已就绪（loaded/active）模块的全部定义，供 keep-alive 聚合使用。
 */
function loadedDefinitions(): ModuleDefinition[] {
	return Array.from(modules.values())
		.filter(instance => instance.status === "loaded" || instance.status === "active")
		.map(instance => instance.definition);
}

/**
 * KeepAlive exclude key：各模块路由中 `handle.keepAlive === false` 的路径集合。
 * 由 module-loader 汇总，不再依赖 access store 的 flatRouteList（B13）。
 */
export function getKeepAliveExcludeKeys(): string[] {
	return getKeepAliveExcludes(loadedDefinitions());
}

/** 全部路由 key：关闭多 tab 时整体排除，仅保留切换动画 */
export function getAllRoutePathKeys(): string[] {
	return getAllRoutePaths(loadedDefinitions());
}
