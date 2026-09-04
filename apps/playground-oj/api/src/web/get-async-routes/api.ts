// GET /api/web/get-async-routes —— 后端动态路由（Bearer 守卫保护）。
// demo 返回空数组：模块路由由 modules/src 静态注入；需要后端路由时按
// 宿主 RouteObject 形状返回。
export default {
	get() {
		json.ok([]);
	},
};
