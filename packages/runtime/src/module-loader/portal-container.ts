/**
 * P4b / Q7：壳持有的 portal 挂载点。
 *
 * 模块弹层（antd Modal/Dropdown/Popover、预构建渲染器浮层）过去 portal 到
 * document.body，与壳的 antd 弹层（overlay z-index=150）互盖。此处由壳提供
 * 唯一固定挂载点，经 ctx.register.portalContainer() 暴露；模块只负责把节点
 * portal 进来，不再自建 body 容器。
 *
 * 为什么用「稳定节点 + 布局挂载时接入」而不是让 layout 现取 ref：
 * 模块生命周期（loadAll）早于布局挂载。若 getter 现取 ref，模块在
 * beforeInit/onInit 里拿到的是 null。稳定节点保证任意时刻调用都返回同一节点。
 *
 * 对其他方案模块零影响：纯追加能力。不调用本 API 的模块 DOM 行为逐字节不变；
 * 卸载清理走 React createPortal 语义（组件卸载即摘除），不做全局清空——
 * 全局清空才会误删其他模块 portal 进来的节点。
 */

const PORTAL_CONTAINER_ATTR = "data-oj-portal";

/** 模块弹层独立栈基段：> 壳 overlay(150)，远 < View Transition(999999999) */
export const MODULE_PORTAL_Z_INDEX = 200;

let container: HTMLDivElement | null = null;

function getOrCreateContainer(): HTMLDivElement {
	if (container)
		return container;
	const el = document.createElement("div");
	el.setAttribute(PORTAL_CONTAINER_ATTR, "");
	Object.assign(el.style, {
		position: "fixed",
		inset: "0",
		zIndex: String(MODULE_PORTAL_Z_INDEX),
		// 全屏挂载层不能吞掉其下方壳内容的点击；子节点单独恢复命中
		pointerEvents: "none",
	});
	const pointerStyle = document.createElement("style");
	pointerStyle.setAttribute("data-oj-portal-style", "");
	pointerStyle.textContent = `[${PORTAL_CONTAINER_ATTR}] > * { pointer-events: auto; }`;
	el.appendChild(pointerStyle);
	container = el;
	return el;
}

/** 壳暴露给模块的稳定挂载点：同名模块任意时刻、任意次数调用恒返回同一节点 */
export function getPortalContainer(): HTMLElement {
	return getOrCreateContainer();
}

/**
 * container layout 挂载/卸载时调用：把挂载点接入宿主 DOM / 从中摘除。
 * 返回幂等的卸载函数，重复调用安全。
 */
export function mountPortalContainer(host: HTMLElement): () => void {
	const el = getOrCreateContainer();
	if (el.parentNode !== host)
		host.appendChild(el);
	return () => {
		if (el.parentNode === host)
			host.removeChild(el);
	};
}

/** 诊断/测试用：挂载点是否已接入页面 */
export function isPortalContainerMounted(): boolean {
	return Boolean(container?.isConnected);
}
