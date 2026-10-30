import { createElement } from "react";
import { defineModule } from "#src/index";

/**
 * 多根路由夹具（需求一 0.2.44）：一个模块出口数组 length > 1。
 *
 * 两种声明风格各一组根，覆盖 getHostRoutes 的两条分支：
 *   · `crm` / `wiki`：相对声明（模块要求的可移植写法，挂载点由安装时的 prefix 决定）；
 *   · `/ops`：绝对路径（框架内建模组写法，路径本身即权威，不得被 prefix 改写）。
 *
 * Component 收组件而非元素，故就地给零参组件（与其他 p7-* 夹具同写法）。
 */
const definition = defineModule({
	name: "multi-root-fixture",
	description: "多根树命名空间回归夹具",
	version: "1.0.0",
	routes: [
		{
			path: "crm",
			handle: { title: "multi-root:menu.crm", layout: "container", order: 200 },
			children: [
				{ index: true, Component: () => createElement("div", null, "multi-root-crm"), handle: { title: "multi-root:menu.crm" } },
			],
		},
		{
			path: "wiki",
			handle: { title: "multi-root:menu.wiki", layout: "container", order: 210 },
			children: [
				{ index: true, Component: () => createElement("div", null, "multi-root-wiki"), handle: { title: "multi-root:menu.wiki" } },
			],
		},
		{
			path: "/ops",
			handle: { title: "multi-root:menu.ops", layout: "container", order: 220 },
			children: [
				{ index: true, Component: () => createElement("div", null, "multi-root-ops"), handle: { title: "multi-root:menu.ops" } },
			],
		},
	],
});

export default definition;
