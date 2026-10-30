import { createElement } from "react";
import { defineModule } from "#src/index";

/**
 * 宿主建表回归夹具（getHostRoutes）：复刻 oj-wiki 的单根形态——
 * 根 /wiki 挂普通子项与 category:"admin" 子项（admin/contacts）。
 *
 * 路由 Component 收组件而非元素，故就地给零参组件（与其他 p7-* 夹具同写法；
 * 不在顶层留组件绑定，免得触发 react-refresh/only-export-components）。
 */
const definition = defineModule({
	name: "host-routes-fixture",
	description: "getHostRoutes admin 重写测试夹具",
	version: "1.0.0",
	routes: [
		{
			path: "wiki",
			handle: { title: "wiki:menu.main", layout: "container", order: 201 },
			children: [
				{
					path: "collections",
					handle: { title: "wiki:menu.collections", order: 210 },
					children: [{ index: true, Component: () => createElement("div", null, "host-routes"), handle: { title: "wiki:menu.collections" } }],
				},
				{
					path: "admin",
					handle: { title: "wiki:menu.admin", layout: "container", category: "admin", order: 220 },
					children: [
						{ index: true, Component: () => createElement("div", null, "host-routes"), handle: { title: "wiki:admin.contacts.title" } },
						{ path: "contacts", Component: () => createElement("div", null, "host-routes"), handle: { title: "wiki:admin.contacts.title" } },
					],
				},
			],
		},
	],
});

export default definition;
