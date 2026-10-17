// 夹具路由占位（对应 manifest api.anonymous 条目 demo-solution/ping）。
// 形态示例：不参与构建、不引用 oj isolate 全局（json/http/exec）。
const ping = {
	async get() {
		return { pong: true, module: "demo-solution" };
	},
};

export default ping;
