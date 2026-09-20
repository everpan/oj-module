import type {
	AuthProvider,
	HeaderProvider,
	NotificationsApiProvider,
	SystemApiProvider,
	UploadApiProvider,
} from "./types";

/**
 * 模块作用域 provider 注册表（v1 api/auth/header-provider 收拢）：
 * 先到先得、重复登记警告忽略、按 moduleName 卸载清理。刻意不用响应式
 * store——provider 只在 action/守卫/beforeRequest 中被读，无订阅需求。
 */
interface Registration<T> {
	moduleName: string
	provider: T
}

function createRegistry<T>(kind: string) {
	let current: Registration<T> | undefined;
	return {
		register(moduleName: string, provider: T): void {
			if (current) {
				console.warn(
					`[${kind}] 重复的 provider 忽略：已由模块 "${current.moduleName}" 提供，`
					+ `忽略 "${moduleName}"（先到先得）。`,
				);
				return;
			}
			current = { moduleName, provider };
		},
		get(): T | undefined {
			return current?.provider;
		},
		unregister(moduleName: string): void {
			if (current?.moduleName === moduleName)
				current = undefined;
		},
	};
}

const auth = createRegistry<AuthProvider>("auth");
const header = createRegistry<HeaderProvider>("header");
const systemApi = createRegistry<SystemApiProvider>("api");
const notificationsApi = createRegistry<NotificationsApiProvider>("api");
const uploadApi = createRegistry<UploadApiProvider>("api");

export function registerAuthProvider(moduleName: string, provider: AuthProvider): void {
	auth.register(moduleName, provider);
}
export function getAuthProvider(): AuthProvider | undefined {
	return auth.get();
}
export function unregisterAuthProvider(moduleName: string): void {
	auth.unregister(moduleName);
}

export function registerHeaderProvider(moduleName: string, provider: HeaderProvider): void {
	header.register(moduleName, provider);
}
export function currentHeaderProvider(): HeaderProvider | undefined {
	return header.get();
}
export function unregisterHeaderProvider(moduleName: string): void {
	header.unregister(moduleName);
}

export function registerSystemApiProvider(moduleName: string, provider: SystemApiProvider): void {
	systemApi.register(moduleName, provider);
}
export function getSystemApiProvider(): SystemApiProvider | undefined {
	return systemApi.get();
}

export function registerNotificationsApiProvider(moduleName: string, provider: NotificationsApiProvider): void {
	notificationsApi.register(moduleName, provider);
}
export function getNotificationsApiProvider(): NotificationsApiProvider | undefined {
	return notificationsApi.get();
}

export function registerUploadApiProvider(moduleName: string, provider: UploadApiProvider): void {
	uploadApi.register(moduleName, provider);
}
export function getUploadApiProvider(): UploadApiProvider | undefined {
	return uploadApi.get();
}

/** 卸载模块时复位其登记的全部 API provider（系统/通知/上传） */
export function unregisterApiProviders(moduleName: string): void {
	systemApi.unregister(moduleName);
	notificationsApi.unregister(moduleName);
	uploadApi.unregister(moduleName);
}
