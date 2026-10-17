// 夹具 entry 占位：真实工程经 defineModule（@oj-module/runtime）声明，形态对齐
// apps/playground-oj/web/src/<module>/entry.ts。夹具仅承载结构与 i18n key 断言，
// 不参与构建与类型检查（不 import 外部模块）。
const entry = {
	name: "demo-solution",
	description: "manifest.yaml 契约全字段合法夹具",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [
		{
			path: "/demo-solution",
			handle: { layout: "container", order: 200, title: "demo-solution:menu.main" },
			children: [
				{
					path: "report",
					handle: { title: "demo-solution:menu.report", hideInMenu: true },
				},
			],
		},
	],
};

export default entry;
