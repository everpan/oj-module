import type { AppRouteRecordRaw } from "../router/types";
import type { NotificationsApiProvider, SystemApiProvider, UploadApiProvider } from "../store/api-provider";
import type { AuthProvider } from "../store/auth-provider";
/** 模块上下文 — 主框架向模块注入的能力 */
export interface ModuleContext {
    /** 当前模块的元信息 */
    module: {
        name: string;
        version: string;
    };
    /** 主框架工具 */
    utils: {
        request: typeof import("../utils/request/index").request;
    };
    /** 模块注册器 */
    register: {
        /** 注册额外的 Zustand store */
        store: (name: string, store: unknown) => void;
        /** 注册 API 路由前缀 */
        apiPrefix: (prefix: string) => void;
        /** 接管登录/登出/用户信息（P5）；先到先得，模块卸载时自动注销 */
        authProvider: (provider: AuthProvider) => void;
        /** 接管系统角色/菜单类 API（D9）；先到先得，模块卸载时自动注销 */
        systemApi: (provider: SystemApiProvider) => void;
        /** 接管通知拉取 API（D9）；先到先得，模块卸载时自动注销 */
        notificationsApi: (provider: NotificationsApiProvider) => void;
        /** 接管头像/附件上传端点（D9）；先到先得，模块卸载时自动注销 */
        uploadApi: (provider: UploadApiProvider) => void;
    };
    /** 注册布局插槽节点（US-8 L2），卸载模块时自动清理 */
    registerSlot: (slotName: string, node: React.ReactNode) => void;
}
/** 模块配置 */
export interface ModuleConfig {
    /** 模块级别要求的角色，用户须满足其一才能激活此模块 */
    requiredRoles?: string[];
    /** 模块级别要求的权限码，用户须全部满足才能激活此模块 */
    requiredPermissions?: string[];
    /** 依赖的其他模块 name 列表，须在 beforeInit 之前完成加载 */
    dependencies?: string[];
}
/** 生命周期钩子 */
export interface ModuleLifecycle {
    beforeInit?: (ctx: ModuleContext) => Promise<void>;
    onInit?: (ctx: ModuleContext) => Promise<void>;
    onActivate?: (ctx: ModuleContext) => Promise<void>;
    onDeactivate?: (ctx: ModuleContext) => Promise<void>;
    onDestroy?: (ctx: ModuleContext) => Promise<void>;
}
/** i18n 资源声明 */
export interface ModuleI18n {
    [locale: string]: () => Promise<Record<string, unknown>>;
}
/** 模块定义 — entry.ts 的导出类型 */
export interface ModuleDefinition {
    name: string;
    description: string;
    version: string;
    routes: AppRouteRecordRaw[];
    lifecycle?: ModuleLifecycle;
    i18n?: ModuleI18n;
    config?: ModuleConfig;
    /** 兼容的宿主 runtime 版本（semver 范围），宿主加载前校验，不兼容则拒绝加载并显式报错 */
    peerRuntime?: string;
}
/** 运行时模块实例 */
export interface ModuleInstance {
    definition: ModuleDefinition;
    /** missing-deps：声明的依赖模块缺失或加载失败，本模块未执行生命周期（US-9 禁止半加载） */
    status: "pending" | "loading" | "loaded" | "active" | "error" | "missing-deps";
    error?: Error;
}
/** manifest.json 中的模块条目 */
export interface ManifestModuleEntry {
    /** 模块名称，需与 entry.ts 中 name 一致 */
    name: string;
    /** 模块资源路径（本地相对路径或远程 URL） */
    entry: string;
    /** 是否启用 */
    enabled?: boolean;
    /** 依赖的其他模块 name 列表（清单层冗余声明，供运维观测） */
    dependencies?: string[];
    /** 兼容的宿主 runtime 版本（semver 范围），P7.6 起在加载后即刻校验 */
    peerRuntime?: string;
}
/** manifest.json 格式 */
export interface Manifest {
    modules: ManifestModuleEntry[];
    /** 宿主 runtime 实际版本（shell 侧取自 versions.json）；提供即启用 peerRuntime 校验（US-5） */
    runtimeVersion?: string;
}
