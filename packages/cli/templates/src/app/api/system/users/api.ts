import { respond } from "#/_platform/_shared/respond";
import { createUser, deleteUser, listUsers } from "#/_platform/_shared/service/domain/users";
// 管理域端点组 /api/system/users（AC1-7~10）：handler 只编排——assertSystemAdmin 守卫 → service → json。
// 保护红线在 service 层硬 enforcement：禁止操作自己、admin 不碰成员资格、最后 superadmin 兜底。
// 子端点：roles/password/forbidden 各为独立目录（wiki per-endpoint 先例）。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

const bcryptDeps = { bcryptHash: (pw: string) => bcrypt.hash(pw) };

// GET /api/system/users —— 用户列表（C1 页面数据源；无口令哈希，service 已排除）。
async function get() {
	await respond(async () => {
		await assertSystemAdmin();
		return listUsers();
	});
}
get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["id", "username", "display_name", "email", "position", "departments", "is_forbidden", "must_change", "roles"],
		properties: {
			id: { type: "number" },
			username: { type: "string" },
			display_name: { type: ["string", "null"] },
			email: { type: ["string", "null"] },
			position: { type: ["string", "null"] },
			// 所属部门（主部门在前）；未加入任何部门即空数组。带 id 供前端按部门筛选
			departments: {
				type: "array",
				items: {
					type: "object",
					required: ["id", "name", "isMain"],
					properties: {
						id: { type: "number" },
						name: { type: ["string", "null"] },
						isMain: { type: "boolean" },
					},
				},
			},
			// service 已做 Number(x)===1 布尔归一，此处是真 boolean
			is_forbidden: { type: "boolean" },
			must_change: { type: "boolean" },
			roles: { type: "array", items: { type: "string" } },
		},
	},
};

// POST /api/system/users —— 建号（B6 加固；默认 must_change=1 首登改密）。
// 必须走 respond 收口：createUser 的业务拒绝是 `fail(400, …)`，不收口会被 oj 一律抹成
// 500（实测：重名建号返回 500「username exists」，前端拿不到可展示的 400 文案）。
async function post() {
	await respond(async () => {
		await assertSystemAdmin();
		return { id: await createUser(http.body || {}, bcryptDeps) };
	});
}
post.schema = {
	body: {
		type: "object",
		required: ["username", "password"],
		properties: {
			username: { type: "string", minLength: 1 },
			password: { type: "string", minLength: 6 },
			displayName: { type: "string" },
			email: { type: "string" },
		},
	},
};
post.response = {
	type: "object",
	required: ["id"],
	properties: { id: { type: "number" } },
};

// DELETE /api/system/users?uid= —— 删号。级联清部门成员/角色/会话，最后 superadmin 拒删。
async function del() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		await deleteUser(Number(http.user?.id), Number(q.uid));
		return { ok: true };
	});
}
del.schema = {
	query: {
		type: "object",
		required: ["uid"],
		properties: { uid: { type: "number" } },
	},
};
del.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

export default { get, post, del };
