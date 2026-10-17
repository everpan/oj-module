// 夹具 entry 占位（负例）：结构对齐 fixture-valid，仅承载 manifest 违规断言所需最小形态。
const entry = {
	name: "Demo",
	description: "契约非法夹具（预检负例真源）",
	version: "1.0.0+build.5",
	routes: [
		{
			path: "/demo",
			handle: { layout: "container", order: 30, title: "demo:menu.demo" },
		},
	],
};

export default entry;
