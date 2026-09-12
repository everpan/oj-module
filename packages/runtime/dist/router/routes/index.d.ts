import type { AppRouteRecordRaw, RouteFileModule } from "../types";
export declare const externalRouteFiles: RouteFileModule;
export declare const staticRouteFiles: RouteFileModule;
/**
 * 外部路由 1. 不进行权限校验， 2. 不会触发请求，例如用户信息接口
 * @example "privacy-policy", "terms-of-service" 等
 */
export declare const externalRoutes: AppRouteRecordRaw[];
/** 静态路由 */
export declare const staticRoutes: AppRouteRecordRaw[];
/**
 * 基本路由列表，由核心路由、外部路由组成，会一直存在系统中
 */
declare const baseRoutes: ({
    handle: {
        order: number;
        title: import("#node_modules/@types/react").ReactNode;
        icon?: import("#node_modules/@types/react").ReactNode;
        roles?: string[];
        permissions?: string[];
        keepAlive?: boolean;
        layout?: "container" | "parent" | "fullscreen" | "none" | (string & {});
        login?: boolean;
        internal?: boolean;
        hideInMenu?: boolean;
        iframeLink?: string;
        externalLink?: string;
        ignoreAccess?: boolean;
        currentActiveMenu?: string;
        backstage?: boolean;
    };
    redirect?: string;
    caseSensitive?: boolean | undefined;
    path?: string | undefined;
    middleware?: import("react-router").MiddlewareFunction[] | undefined;
    loader?: (import("react-router").LoaderFunction | boolean) | undefined;
    action?: (import("react-router").ActionFunction | boolean) | undefined;
    hasErrorBoundary?: boolean | undefined;
    shouldRevalidate?: import("react-router").ShouldRevalidateFunction | undefined;
    lazy?: ({
        middleware?: (() => Promise<import("react-router").MiddlewareFunction<unknown>[] | null | undefined>) | undefined;
        loader?: (() => Promise<boolean | import("react-router").LoaderFunction<any> | null | undefined>) | undefined;
        action?: (() => Promise<boolean | import("react-router").ActionFunction<any> | null | undefined>) | undefined;
        hasErrorBoundary?: (() => Promise<boolean | null | undefined>) | undefined;
        shouldRevalidate?: (() => Promise<import("react-router").ShouldRevalidateFunction | null | undefined>) | undefined;
        handle?: (() => Promise<any>) | undefined;
        Component?: (() => Promise<import("#node_modules/@types/react").ComponentType<{}> | null | undefined>) | undefined;
        element?: (() => Promise<import("#node_modules/@types/react").ReactNode>) | undefined;
        ErrorBoundary?: (() => Promise<import("#node_modules/@types/react").ComponentType<{}> | null | undefined>) | undefined;
        errorElement?: (() => Promise<import("#node_modules/@types/react").ReactNode>) | undefined;
        HydrateFallback?: (() => Promise<import("#node_modules/@types/react").ComponentType<{}> | null | undefined>) | undefined;
        hydrateFallbackElement?: (() => Promise<import("#node_modules/@types/react").ReactNode>) | undefined;
    } | import("react-router").LazyRouteFunction<import("react-router").BaseRouteObject>) | undefined;
    Component?: (React.ComponentType | null) | undefined;
    element?: import("#node_modules/@types/react").ReactNode;
    ErrorBoundary?: (React.ComponentType | null) | undefined;
    errorElement?: import("#node_modules/@types/react").ReactNode;
    HydrateFallback?: (React.ComponentType | null) | undefined;
    hydrateFallbackElement?: import("#node_modules/@types/react").ReactNode;
    children?: undefined | undefined;
    index: true;
} | {
    handle: {
        order: number;
        title: import("#node_modules/@types/react").ReactNode;
        icon?: import("#node_modules/@types/react").ReactNode;
        roles?: string[];
        permissions?: string[];
        keepAlive?: boolean;
        layout?: "container" | "parent" | "fullscreen" | "none" | (string & {});
        login?: boolean;
        internal?: boolean;
        hideInMenu?: boolean;
        iframeLink?: string;
        externalLink?: string;
        ignoreAccess?: boolean;
        currentActiveMenu?: string;
        backstage?: boolean;
    };
    redirect?: string;
    children?: AppRouteRecordRaw[];
    caseSensitive?: boolean | undefined;
    path?: string | undefined;
    middleware?: import("react-router").MiddlewareFunction[] | undefined;
    loader?: (import("react-router").LoaderFunction | boolean) | undefined;
    action?: (import("react-router").ActionFunction | boolean) | undefined;
    hasErrorBoundary?: boolean | undefined;
    shouldRevalidate?: import("react-router").ShouldRevalidateFunction | undefined;
    lazy?: ({
        middleware?: (() => Promise<import("react-router").MiddlewareFunction<unknown>[] | null | undefined>) | undefined;
        loader?: (() => Promise<boolean | import("react-router").LoaderFunction<any> | null | undefined>) | undefined;
        action?: (() => Promise<boolean | import("react-router").ActionFunction<any> | null | undefined>) | undefined;
        hasErrorBoundary?: (() => Promise<boolean | null | undefined>) | undefined;
        shouldRevalidate?: (() => Promise<import("react-router").ShouldRevalidateFunction | null | undefined>) | undefined;
        handle?: (() => Promise<any>) | undefined;
        Component?: (() => Promise<import("#node_modules/@types/react").ComponentType<{}> | null | undefined>) | undefined;
        element?: (() => Promise<import("#node_modules/@types/react").ReactNode>) | undefined;
        ErrorBoundary?: (() => Promise<import("#node_modules/@types/react").ComponentType<{}> | null | undefined>) | undefined;
        errorElement?: (() => Promise<import("#node_modules/@types/react").ReactNode>) | undefined;
        HydrateFallback?: (() => Promise<import("#node_modules/@types/react").ComponentType<{}> | null | undefined>) | undefined;
        hydrateFallbackElement?: (() => Promise<import("#node_modules/@types/react").ReactNode>) | undefined;
    } | import("react-router").LazyRouteFunction<import("react-router").BaseRouteObject>) | undefined;
    Component?: (React.ComponentType | null) | undefined;
    element?: import("#node_modules/@types/react").ReactNode;
    ErrorBoundary?: (React.ComponentType | null) | undefined;
    errorElement?: import("#node_modules/@types/react").ReactNode;
    HydrateFallback?: (React.ComponentType | null) | undefined;
    hydrateFallbackElement?: import("#node_modules/@types/react").ReactNode;
    index?: false | undefined;
})[];
/** 权限路由列表（静态路由，模块路由由 module-loader 动态提供） */
declare const accessRoutes: AppRouteRecordRaw[];
/**
 * 路由白名单 1. 不进行权限校验， 2. 不会触发请求，例如用户信息接口
 * @example "privacy-policy", "terms-of-service" 等
 */
declare const whiteRouteNames: (string | undefined)[];
export { accessRoutes, baseRoutes, whiteRouteNames, };
