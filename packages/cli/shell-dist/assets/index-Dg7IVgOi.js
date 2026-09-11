import { StyleProvider } from "@ant-design/cssinjs";
import { AntdApp, LayoutEffects, getRoutes, loadAll, setupI18n, useAuthStore, usePreferences, useUserStore } from "@oj-module/runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, theme } from "antd";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region \0vite/modulepreload-polyfill.js
(function polyfill() {
	const relList = document.createElement("link").relList;
	if (relList && relList.supports && relList.supports("modulepreload")) return;
	for (const link of document.querySelectorAll("link[rel=\"modulepreload\"]")) processPreload(link);
	new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type !== "childList") continue;
			for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
		}
	}).observe(document, {
		childList: true,
		subtree: true
	});
	function getFetchOpts(link) {
		const fetchOpts = {};
		if (link.integrity) fetchOpts.integrity = link.integrity;
		if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
		if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
		else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
		else fetchOpts.credentials = "same-origin";
		return fetchOpts;
	}
	function processPreload(link) {
		if (link.ep) return;
		link.ep = true;
		const fetchOpts = getFetchOpts(link);
		fetch(link.href, fetchOpts);
	}
})();
//#endregion
//#region shell/src/manifest.ts
/**
* P7.7：modules.json（cli BuiltModule[]）→ loader Manifest 的字段透传。
*
* 评审 F1/F2：此前裁剪成 {name, entry}，导致 enabled 过滤（US-9 下线）
* 与 peerRuntime 校验（US-5）双双失效。清单字段必须原样透传——
* loader 侧已有 enabled/peerRuntime/dependencies 的全部消费逻辑。
*/
function toLoaderManifest(list, runtimeVersion) {
	return {
		runtimeVersion,
		modules: list.map((m) => ({
			name: m.name ?? "",
			entry: m.entry ?? "",
			enabled: m.enabled,
			dependencies: m.dependencies,
			peerRuntime: m.peerRuntime
		}))
	};
}
/** 从 shell dist 的 versions.json 提取 runtime 版本（P7.6 宿主侧真源） */
function extractRuntimeVersion(versions) {
	return versions?.["@oj-module/runtime"];
}
//#endregion
//#region shell/src/preload.ts
/**
* 待预载的 chunk 列表——仅非 lazy chunk 携带 sha384 integrity 进入；
* lazy chunk 按需加载，不受 L2 档位保护（D7）。
*/
function collectPreloads(modules) {
	const seen = /* @__PURE__ */ new Set();
	const preloads = [];
	for (const mod of modules) for (const chunk of mod.chunks ?? []) {
		if (chunk.lazy || seen.has(chunk.url)) continue;
		seen.add(chunk.url);
		preloads.push({
			href: chunk.url,
			integrity: chunk.integrity
		});
	}
	return preloads;
}
//#endregion
//#region shell/src/trust.ts
/**
* P6.1 / D10 信任根：moduleOrigins 白名单（设计文档 §4.8）。
*
* 清单与产物分目录分发布凭据是部署约束（仅 CI 可写清单目录）；
* 代码侧的对应防线是：模块资源 URL 的 origin 必须命中本白名单，
* 同源相对路径视为可信。来源未登记的模块在 loadAll 之前拒绝——
* 否则清单里出现一条恶意 entry，L2 完整性无从校验（攻击者可连同
* integrity 一起改）。
*/
/** 模块资源允许的 origin 白名单；宿主换 CDN 时在此登记后重新构建 shell */
var TRUSTED_ORIGINS = ["https://modules.cdn.example.com"];
/**
* 判定单个资源 URL 是否可信：同源相对路径或命中白名单。
*
* P7.1 修复：不得以「不含 ://」判同源——协议相对 URL（//host/x）、
* 反斜杠（https:\\host\x，WHATWG 解析为跨源）、data:/blob:（违反 C6）
* 均不含 "://"。一律经 new URL 归一化后比对 origin。
*/
function isTrustedUrl(url) {
	if (!url) return true;
	const base = typeof location === "undefined" ? "http://shell.local" : location.origin;
	try {
		const resolved = new URL(url, base);
		if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return false;
		if (resolved.origin === new URL(base).origin) return true;
		return TRUSTED_ORIGINS.includes(resolved.origin);
	} catch {
		return false;
	}
}
/**
* 校验清单中全部资源 URL（entry / css / chunks[].url）。
* 任一越界即抛错并给出人话定位（模块名 + 越界 URL + 修复指引）。
*/
function assertTrustedModules(modules) {
	const offenders = [];
	for (const mod of modules) {
		const urls = [
			mod.entry ?? "",
			...mod.css ?? [],
			...(mod.chunks ?? []).map((c) => c.url)
		];
		for (const url of urls) if (!isTrustedUrl(url)) offenders.push(`${mod.name ?? "(unnamed)"}: ${url}`);
	}
	if (offenders.length > 0) throw new Error(`[shell] 模块来源未登记（moduleOrigins 白名单拒绝）：
${offenders.join("\n")}\n修复建议：该来源不在宿主内置白名单中。若是合法 CDN，请在 packages/cli/shell/src/trust.ts 的 TRUSTED_ORIGINS 登记后重新构建宿主。`);
}
//#endregion
//#region shell/src/host.tsx
var queryClient = new QueryClient();
var DEMO_USER = {
	id: "1",
	avatar: "https://avatars.githubusercontent.com/u/47056890",
	username: "Admin",
	email: "",
	phoneNumber: "",
	description: "manager",
	roles: ["admin"]
};
useUserStore.setState(DEMO_USER);
/**
* 登录/登出都会经 auth store reset() 清空 user store；宿主链无 AuthGuard
* 重新拉取 userInfo，播种丢失后头部用户名/角色恒为空。这里在 token 变化
* 时重播种演示用户（模块路由的重登记由 access store reset() 快照机制负责）。
*/
useAuthStore.subscribe((state, prev) => {
	if (state.token !== prev.token) useUserStore.setState(DEMO_USER);
});
var i18nReady = false;
function ensureI18n() {
	if (!i18nReady) {
		setupI18n();
		i18nReady = true;
	}
}
function Boot() {
	const [router, setRouter] = useState(null);
	const [error, setError] = useState(null);
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				ensureI18n();
				const base = "/";
				const [res, versionsRes] = await Promise.all([fetch(`${base}modules.json`), fetch(`${base}versions.json`).catch(() => null)]);
				if (!res.ok) throw new Error(`modules.json 加载失败：HTTP ${res.status}`);
				const list = await res.json();
				const runtimeVersion = versionsRes?.ok ? extractRuntimeVersion(await versionsRes.json()) : void 0;
				if (!runtimeVersion) console.warn("[shell] 未获取到宿主 runtime 版本（versions.json 缺失），peerRuntime 校验跳过");
				assertTrustedModules(list);
				for (const mod of list) {
					if (mod.enabled === false) continue;
					for (const href of mod.css ?? []) if (!document.querySelector(`link[href="${href}"]`)) {
						const link = document.createElement("link");
						link.rel = "stylesheet";
						link.href = href;
						const firstStyle = document.head.querySelector("link[rel=\"stylesheet\"], style");
						if (firstStyle) document.head.insertBefore(link, firstStyle);
						else document.head.appendChild(link);
					}
				}
				for (const { href, integrity } of collectPreloads(list)) {
					if (document.querySelector(`link[rel="modulepreload"][href="${href}"]`)) continue;
					const link = document.createElement("link");
					link.rel = "modulepreload";
					link.href = href;
					link.integrity = integrity;
					link.crossOrigin = "anonymous";
					document.head.appendChild(link);
				}
				const manifest = toLoaderManifest(list, runtimeVersion);
				await loadAll(manifest);
				if (cancelled) return;
				setRouter(createBrowserRouter([{
					path: "/",
					element: /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(LayoutEffects, {}), /* @__PURE__ */ jsx(Outlet, {})] }),
					children: [{
						index: true,
						element: /* @__PURE__ */ jsx(Navigate, {
							to: getRoutes()[0]?.path ?? "/",
							replace: true
						})
					}, ...getRoutes()]
				}]));
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);
	if (error) return /* @__PURE__ */ jsxs("div", {
		style: { padding: 24 },
		children: ["模块加载失败：", error]
	});
	if (!router) return /* @__PURE__ */ jsx("div", {
		style: { padding: 24 },
		children: "宿主初始化中…"
	});
	return /* @__PURE__ */ jsx(RouterProvider, { router });
}
/**
* 主题边界：ConfigProvider 响应 preferences 的暗黑/主色/圆角，与 App 链
* app.tsx 的 theme 计算同源同值（customAntd* 主题均为空对象，无需复制）。
* 此前硬编码 defaultAlgorithm——切暗黑后侧栏（tailwind dark: 类）变暗而
* antd 组件仍亮色，顶栏图标白色融进白底「消失」——playground 全量模块
* 暗黑对比（docs/prd/202609010056-playground-full-modules-plan.md）暴露。
*
* AntdApp 必须来自 @oj-module/runtime 而非 antd：runtime 版在 antd App
* 之上做两件事（设计 202609112121-shell-dark-css-vars-design）——
* ① 把 token 同步为 :root 的 `--oo-*` 变量（tailwind 语义色工具类的唯一
*   来源，缺则暗黑模式 footer 等透明露白）；② StaticAntd 挂载
*   window.$message/$modal/$notification。
*/
function HostProviders() {
	const { isDark, themeColorPrimary, themeRadius, sideCollapsedWidth } = usePreferences();
	return /* @__PURE__ */ jsx(StyleProvider, {
		layer: true,
		hashPriority: "high",
		children: /* @__PURE__ */ jsx(ConfigProvider, {
			theme: {
				cssVar: {},
				hashed: false,
				algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
				token: {
					borderRadius: themeRadius,
					colorPrimary: themeColorPrimary
				},
				components: { Menu: {
					darkItemBg: "#141414",
					itemBg: "#fff",
					collapsedWidth: sideCollapsedWidth
				} }
			},
			children: /* @__PURE__ */ jsx(AntdApp, { children: /* @__PURE__ */ jsx(QueryClientProvider, {
				client: queryClient,
				children: /* @__PURE__ */ jsx(Boot, {})
			}) })
		})
	});
}
var rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(/* @__PURE__ */ jsx(HostProviders, {}));
//#endregion
