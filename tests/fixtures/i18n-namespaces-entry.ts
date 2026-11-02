import { defineModule } from "#src/index";

/**
 * 多命名空间 i18n 夹具：一个模块（单 entry）同时登记自身命名空间与两个附加命名空间。
 *
 * 对应多根聚合模块的场景：一个 entry 承载多个业务域，各域沿用原命名空间，
 * `t("system:menu.users")` / `useTranslation("system")` 不必改写。
 */
export default defineModule({
	name: "i18n-ns-fixture",
	description: "多命名空间 i18n 回归夹具",
	version: "1.0.0",
	routes: [{ path: "/i18n-ns", handle: { title: "i18n-ns-fixture:menu.main", layout: "container" } }],
	i18n: {
		"zh-CN": async () => ({ menu: { main: "聚合模块" } }),
	},
	i18nNamespaces: {
		"system": {
			"zh-CN": async () => ({ menu: { system: "系统管理" } }),
		},
		"personal-center": {
			"zh-CN": async () => ({ menu: { profile: "我的资料" } }),
		},
	},
});
