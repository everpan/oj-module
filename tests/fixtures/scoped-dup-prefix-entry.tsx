import { defineModule } from "#src/index";

/**
 * 同前缀重复登记夹具：模块重入/HMR 会对同一 client 再登记一次前缀，
 * 登记集合须去重——否则守卫报错里会拼出「/dup、/dup」。
 *
 * 报错文案由 `prefixes.join("、")` 拼出，因此「越界报错消息」就是
 * 登记集合的可观测快照：用它断言去重。
 */
const definition = defineModule({
	name: "scoped-dup",
	description: "同前缀重复登记去重夹具",
	version: "1.0.0",
	routes: [],
	lifecycle: {
		async onInit(ctx) {
			ctx.register.apiPrefix("/dup");
			ctx.register.apiPrefix("/dup");

			let message = "";
			try {
				await ctx.utils.request("/nope/x");
			}
			catch (error) {
				message = String(error);
			}
			ctx.register.store("scoped-dup-result", { message });
		},
	},
});

export default definition;
