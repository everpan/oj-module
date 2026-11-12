// GET /api/web/get-async-routes —— 后端动态路由（Bearer 守卫保护）。
// demo 返回空数组：模块路由由 web/src 静态注入；需要后端路由时按
// 宿主 RouteObject 形状返回。
const handler = {
	get() {
		json.ok([]);
	},
};

// 出参：宿主 RouteObject 形状的数组（demo 恒空数组；页面路由由前端静态注入）
handler.get.schema = {
	description: "后端动态路由清单（宿主 RouteObject 形状）。本模板恒返回空数组——页面路由由前端静态注入；需要后端路由时按该形状返回。无入参。",
};

handler.get.response = {
	type: "array",
	items: {
		type: "object",
		properties: {
			path: { type: "string" },
			component: { type: "string" },
			children: { type: "array", items: { type: "object" } },
		},
	},
};

export default handler;
