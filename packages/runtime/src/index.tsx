// import { StrictMode } from "react";
import type { Manifest } from "#src/module-loader/types";
import { createRoot } from "react-dom/client";
import { TanstackQuery } from "#src/components/tanstack-query";
import { setupI18n } from "#src/locales";
import { getRoutes, loadAll } from "#src/module-loader";

import { setupLoading } from "#src/plugins/loading";
import { rootRoute, router } from "#src/router";
import { baseRoutes } from "#src/router/routes";
import { resolveLoginRoute } from "#src/router/utils/resolve-login-route";

import App from "./app";
import "./styles/index.css";

/**
 * @zh 模块加载失败的兜底错误页（P5.8/B7）：原实现在路由守卫里静默
 * catch（仅 DEV console.warn），生产环境一旦清单拉取失败，路由/菜单
 * 会悄悄缺失且无任何提示。这里给出人话原因 + 修复建议 + 文档链接。
 * @en Fatal error page for module loading failures (P5.8/B7): the old
 * guard silently swallowed errors (DEV-only console.warn), so a manifest
 * failure in production silently dropped routes/menus.
 */
function renderModuleLoadError(error: unknown) {
	const rootElement = document.getElementById("root");
	if (!rootElement)
		return;
	const reason = error instanceof Error ? error.message : String(error);
	document.title = "应用启动失败";
	createRoot(rootElement).render(
		<div
			style={{
				maxWidth: 720,
				margin: "15vh auto",
				padding: "0 24px",
				fontFamily: "sans-serif",
			}}
		>
			<h1 style={{ fontSize: 20, marginBottom: 16 }}>应用启动失败：模块加载失败</h1>
			<p>
				<strong>原因：</strong>
				{reason}
			</p>
			<p>
				<strong>修复建议：</strong>
				请依次检查：① module-manifest.json 是否存在且可访问；
				② 模块 entry 资源 URL 是否正确（部署路径 / CDN / 跨域配置）；
				③ 模块声明的依赖模块是否已部署。修正后刷新页面重试。
			</p>
			<p>
				更多说明见文档：
				<code>docs/archive/prd/module-development-guide.md</code>
			</p>
		</div>,
	);
}

async function setupApp() {
	/**
	 * @zh 初始化国际化，必须放在第一位，loading 中引用了国际化
	 * @en Initialize internationalization, must be placed first. Loading refer to internationalization
	 */
	setupI18n();

	// App Loading
	setupLoading();

	try {
		/**
		 * @zh 模块在应用启动时统一加载（P5.5/O5）：路由守卫只消费 getRoutes()，
		 * 不再每次鉴权都动态 import 清单——router 域与模块清单彻底解耦。
		 * P7.15 / 评审 P5：生产环境改为运行时 fetch module-manifest.json（由
		 * scripts/build-modules.ts 产出，指向构建产物 entry.js），不再把
		 * 开发态源码路径（/modules/<name>/entry.ts）打进 bundle。
		 * 命名避开 public/manifest.json（PWA 清单）——同名会被 vite build
		 * 的 public 拷贝覆盖，fetch 拿到 PWA 内容导致启动失败。
		 * @en Modules load once at bootstrap (P5.5/O5): the auth guard only
		 * consumes getRoutes() and never imports the manifest itself.
		 */
		let manifest: Manifest;
		if (import.meta.env.DEV) {
			manifest = (await import("#manifest.json")).default;
		}
		else {
			const res = await fetch(`${import.meta.env.BASE_URL}module-manifest.json`);
			if (!res.ok)
				throw new Error(`module-manifest.json 加载失败：HTTP ${res.status}`);
			manifest = await res.json();
			if (!Array.isArray(manifest.modules))
				throw new Error("module-manifest.json 内容非法：缺少 modules 数组（是否被 PWA manifest 等同名文件覆盖？）");
			// 生产清单的 entry 为相对产物路径（modules/<name>/<version>/entry.js），
			// 部署子路径（base）在此补齐；绝对 URL（CDN）原样保留
			for (const mod of manifest.modules) {
				if (!/^(?:https?:)?\/\//.test(mod.entry))
					mod.entry = `${import.meta.env.BASE_URL}${mod.entry}`;
			}
		}
		await loadAll(manifest);

		/**
		 * login 模块化（P3）：存在外部 login 模块路由时，剔除内置兜底
		 * 并把获胜的 login 路由补装进 router——须在首次 render 前完成，
		 * 否则直接落地 /login 会先匹配内置页（或剔除后的 404）。
		 */
		resolveLoginRoute(baseRoutes, getRoutes(), router, rootRoute);
	}
	catch (error) {
		renderModuleLoadError(error);
		return;
	}

	const rootElement = document.getElementById("root");
	if (!rootElement)
		return;
	const root = createRoot(
		rootElement,
	);

	root.render(
		// <StrictMode>
		<TanstackQuery>
			<App />
		</TanstackQuery>,
		// </StrictMode>,
	);
}

setupApp();
