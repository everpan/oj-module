/**
 * 构建产物级 e2e：按 importmap 语义加载「已构建」的宿主 antd 资产并渲染，
 * 直接复现原始崩溃点（ConfigProvider → ProviderChildren → IconContext.Provider）。
 *
 * 若共享依赖的「父包透传」假设把 `@ant-design/icons/es/components/Context`
 * 错映射成 icons 命名空间（default 为整个命名空间而非 IconContext），
 * 则 `IconContext.Provider` 为 undefined，createElement 会抛
 * "Cannot read properties of undefined (reading 'Provider')"——本脚本会失败退出。
 *
 * 运行：node tests/e2e/verify-shell-iconcontext.mjs
 * （依赖 tests/e2e/shell-importmap-loader.mjs 做 importmap 重定向）
 */

// 本文件由 `node` 直接执行的 e2e 脚本（非被导入模块）：顶层 await 与 process
// 全局均为合法用法，关闭对应规则以免 pre-commit lint 误报阻断提交。
/* eslint-disable antfu/no-top-level-await, node/prefer-global/process */
import { register } from "node:module";

register("./shell-importmap-loader.mjs", import.meta.url);

// ---- happy-dom 全局（antd 渲染所需）----
const { Window } = await import("happy-dom");
const win = new Window({ url: "http://localhost/" });
globalThis.window = win;
globalThis.document = win.document;
// Node 25 起 globalThis.navigator 为只读，直接赋值会抛；用 defineProperty 兜底
try {
	globalThis.navigator = win.navigator;
}
catch {
	Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true, writable: true });
}
for (const k of [
	"HTMLElement",
	"Element",
	"Node",
	"Event",
	"CustomEvent",
	"DocumentFragment",
	"getComputedStyle",
	"MutationObserver",
	"location",
	"history",
	"localStorage",
	"CSSStyleSheet",
	"DOMParser",
	"Text",
	"SVGElement",
]) {
	if (win[k] !== undefined)
		globalThis[k] = win[k];
}
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
};
globalThis.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
win.matchMedia = win.matchMedia || (q => ({
	matches: false,
	media: q,
	onchange: null,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// ---- 按 importmap 加载已构建资产（单一 React 实例）----
const ReactNs = await import("react");
const React = ReactNs.default ?? ReactNs;
const { createRoot } = await import("react-dom/client");
const antd = await import("antd");

const { ConfigProvider, Card, Tag } = antd;
if (!ConfigProvider || !Card || !Tag)
	throw new Error(`antd 资产缺少导出：ConfigProvider=${!!ConfigProvider} Card=${!!Card} Tag=${!!Tag}`);

const container = document.createElement("div");
document.body.appendChild(container);
const root = createRoot(container);

// 关键：渲染 ConfigProvider 会触发 ProviderChildren 使用 IconContext.Provider
root.render(
	React.createElement(
		ConfigProvider,
		null,
		React.createElement(Card, { title: "demo" }, React.createElement(Tag, { color: "success" }, "ok")),
	),
);

await new Promise(r => setTimeout(r, 300));

const html = container.innerHTML;
if (!html || !html.includes("ok"))
	throw new Error(`渲染未产出预期内容：container.innerHTML=${html}`);

// IconContext 修复的硬验证：直接加载该深路径资产，其 default 必须是 React Context
const ctxMod = await import("@ant-design/icons/es/components/Context");
const IconContext = ctxMod.default ?? ctxMod.IconContext;
if (!IconContext || typeof IconContext.Provider !== "object" || typeof IconContext.Consumer !== "object")
	throw new Error("IconContext 资产未导出有效的 React Context（default 应为 IconContext）");

// 图标子路径 default 的硬验证：antd 内部用默认导入引用图标
// （`import CloseOutlined from "@ant-design/icons/es/icons/CloseOutlined"`）。
// 若该深路径被错映射到父包 icons.js，default 会退化成通用 `<Icon />` 壳，
// 渲染出空的 `<span class="anticon">`——正是 tabbar 关闭 × 丢失的表现。
// 故这里按 importmap 语义加载并渲染，必须产出真实 <svg>（回归守卫）。
const closeMod = await import("@ant-design/icons/es/icons/CloseOutlined");
const CloseOutlined = closeMod.default;
const iconBox = document.createElement("div");
document.body.appendChild(iconBox);
createRoot(iconBox).render(React.createElement(CloseOutlined));
await new Promise(r => setTimeout(r, 100));
if (!iconBox.querySelector("svg"))
	throw new Error(`图标子路径 default 未渲染出 svg（default 应指向具名图标组件）：${iconBox.innerHTML}`);
if (!iconBox.querySelector(".anticon-close"))
	throw new Error(`CloseOutlined 缺少 .anticon-close 类（default 可能落到了通用 Icon 壳）：${iconBox.innerHTML}`);

console.warn("E2E PASS · shell antd 资产可加载，ConfigProvider/Card/Tag 渲染正常，IconContext / 图标子路径 default 修复有效");
process.exit(0);
