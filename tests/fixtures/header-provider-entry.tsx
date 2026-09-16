import { defineModule } from "#src/index";

const definition = defineModule({
	name: "header-provider-fixture",
	description: "header provider 集成测试夹具",
	version: "1.0.0",
	routes: [],
	lifecycle: {
		async onInit(ctx) {
			ctx.register.headerProvider(() => ({ "X-TENANT-ID": "fixture-tenant" }));
		},
	},
});

export default definition;
