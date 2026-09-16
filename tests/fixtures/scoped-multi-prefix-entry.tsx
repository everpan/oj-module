import { defineModule } from "#src/index";

/**
 * 一模块多 apiPrefix 夹具（2026-09-17 回归）：一个模块里有两个生成 client
 * （/auth + /users），各自在 onInit 登记一次。登记若退化成「后者覆盖前者」，
 * 先登记的那个 client 请求会被守卫以「请求越界」拒绝。
 * 与 scoped-request-entry 同构：只判 guard 是否放行，放行后的真实网络失败
 * 与 guard 无关。
 */
const GUARD_MARK = "请求越界";

const definition = defineModule({
	name: "scoped-multi",
	description: "一模块多 apiPrefix 集成测试夹具",
	version: "1.0.0",
	routes: [],
	lifecycle: {
		async onInit(ctx) {
			ctx.register.apiPrefix("/auth");
			ctx.register.apiPrefix("/users");

			const result = {
				authPassed: false,
				usersPassed: false,
				otherBlocked: false,
			};

			try {
				await ctx.utils.request("/auth/login");
				result.authPassed = true;
			}
			catch (error) {
				result.authPassed = !String(error).includes(GUARD_MARK);
			}

			try {
				await ctx.utils.request("/users/list");
				result.usersPassed = true;
			}
			catch (error) {
				result.usersPassed = !String(error).includes(GUARD_MARK);
			}

			try {
				await ctx.utils.request("/other/x");
			}
			catch (error) {
				result.otherBlocked = String(error).includes(GUARD_MARK);
			}

			ctx.register.store("scoped-multi-result", result);
		},
	},
});

export default definition;
