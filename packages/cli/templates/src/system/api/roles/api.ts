import { respond } from "#/_platform/_shared/respond";
import { createRole, deleteRole, listRoles } from "#/_platform/_shared/service/domain/roles";
// 管理域端点 /api/system/roles（设计文档 D207：/api/system/* = 管理域，assertSystemAdmin 判权）。
// handler 层只编排：守卫 → service → json 信封；name 走 query（wiki 先例：静态段 + http.query）。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

async function guard(): Promise<void> {
	await assertSystemAdmin();
}

// GET /api/system/roles —— 角色列表（含持有计数与绑定，C2 页面数据源）。
async function get() {
	await respond(async () => {
		await guard();
		return listRoles();
	});
}
get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["name", "module", "title", "description", "builtin", "deprecated", "holders", "permissions"],
		properties: {
			name: { type: "string" },
			module: { type: "string" },
			title: { type: ["string", "null"] },
			description: { type: ["string", "null"] },
			builtin: { type: "boolean" },
			deprecated: { type: "boolean" },
			holders: { type: "number" },
			permissions: { type: "array", items: { type: "string" } },
		},
	},
};

// POST /api/system/roles —— 建角色（AC1-16：custom.<slug> 机器名 + 勾选绑定）。
async function post() {
	await respond(async () => {
		await guard();
		return createRole(http.body || {});
	});
}
post.schema = {
	body: {
		type: "object",
		required: ["name", "title"],
		properties: {
			name: { type: "string", pattern: "^custom\\.[a-z0-9][a-z0-9-]*$" },
			title: { type: "string", minLength: 1 },
			permissions: { type: "array", items: { type: "string" } },
		},
	},
};
post.response = {
	type: "object",
	required: ["name", "module"],
	properties: { name: { type: "string" }, module: { type: "string" } },
};

// DELETE /api/system/roles?name=xxx —— 删角色（AC1-20 占用禁删，409 带 holders）。
async function del() {
	await respond(async () => {
		await guard();
		return deleteRole(String((http.query as Record<string, unknown>).name ?? ""));
	});
}
del.schema = {
	query: {
		type: "object",
		required: ["name"],
		properties: { name: { type: "string", minLength: 1 } },
	},
};

export default { get, post, del };
