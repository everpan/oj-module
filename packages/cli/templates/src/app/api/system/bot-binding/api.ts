import { respond } from "#/_platform/_shared/respond";
import {
	deleteBinding,
	listBindings,
	setBinding,
} from "#/_platform/_shared/service/domain/bot";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
// /api/system/bot-binding —— 员工绑定（provider + external_sub ↔ 本系统 users.id）
// 单条 upsert / 列表 / 删除。CSV 批量导入见 ./import，导出见 ./export。
// 安全敏感：绑定决定「机器人能以哪个员工的身份行事」，一律 assertSuperAdmin。

const bindingItemSchema = {
	type: "object",
	required: ["provider", "external_sub", "user_id", "last_used_at", "created_by", "created_at"],
	properties: {
		provider: { type: "string" },
		external_sub: { type: "string" },
		user_id: { type: "string" },
		last_used_at: { type: "number" },
		created_by: { type: "string" },
		created_at: { type: "number" },
	},
} as const;

async function get() {
	await respond(async () => {
		await assertSuperAdmin();
		return listBindings();
	});
}
get.response = { type: "array", items: bindingItemSchema };

async function post() {
	await respond(async () => {
		await assertSuperAdmin();
		const b = (http.body || {}) as Record<string, unknown>;
		return setBinding(
			String(b.provider ?? "").trim(),
			String(b.external_sub ?? "").trim(),
			String(b.user_id ?? "").trim(),
			String(http.user?.id ?? ""),
		);
	});
}
post.schema = {
	body: {
		type: "object",
		required: ["provider", "external_sub", "user_id"],
		properties: {
			provider: { type: "string", minLength: 1 },
			external_sub: { type: "string", minLength: 1 },
			user_id: { type: "string", minLength: 1 },
		},
	},
};
post.response = {
	type: "object",
	required: ["op"],
	properties: { op: { type: "string", enum: ["insert", "update"] } },
};

// DELETE /api/system/bot-binding?provider=&external_sub= —— 删单条绑定。
async function del() {
	await respond(async () => {
		await assertSuperAdmin();
		const q = http.query as Record<string, unknown>;
		return deleteBinding(String(q.provider ?? ""), String(q.external_sub ?? ""));
	});
}
del.schema = {
	query: {
		type: "object",
		required: ["provider", "external_sub"],
		properties: {
			provider: { type: "string", minLength: 1 },
			external_sub: { type: "string", minLength: 1 },
		},
	},
};
del.response = {
	type: "object",
	required: ["deleted"],
	properties: { deleted: { type: "number" } },
};

export default { get, post, del };
