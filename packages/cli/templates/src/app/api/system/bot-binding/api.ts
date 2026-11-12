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
		provider: { type: "string", description: "外部渠道标识（企微固定 wecom）。" },
		external_sub: { type: "string", description: "外部渠道内的成员标识；企微为成员账号（如 E001827）。" },
		user_id: { type: "string", description: "映射到的本系统用户 id（users.id）。" },
		last_used_at: { type: "number", description: "最近一次换签使用时间（epoch 秒，0=从未使用）。" },
		created_by: { type: "string", description: "创建人用户 id。" },
		created_at: { type: "number", description: "创建时间（epoch 秒）。" },
	},
} as const;

async function get() {
	await respond(async () => {
		await assertSuperAdmin();
		return listBindings();
	});
}
get.schema = {
	description: "列出本租户全部员工绑定（provider + external_sub → 本系统 user_id）。绑定决定机器人能以哪个员工身份行事，仅 superadmin 可读；用于核对「谁能被机器人代表」。",
};
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
	description: "新增或更新一条员工绑定（按 provider+external_sub upsert）。机器人 tools/call 时用企微注入的 X-WeCom-User-Id 匹配 external_sub 换签；未绑定返回 40310。",
	body: {
		type: "object",
		required: ["provider", "external_sub", "user_id"],
		properties: {
			provider: { type: "string", minLength: 1, description: "外部渠道标识，企微固定传 wecom。" },
			external_sub: { type: "string", minLength: 1, description: "外部成员标识；企微为成员账号，须与 X-WeCom-User-Id 完全一致。" },
			user_id: { type: "string", minLength: 1, description: "映射到的本系统用户 id（users.id，数字的字符串形式）。" },
		},
	},
};
post.response = {
	type: "object",
	required: ["op"],
	properties: { op: { type: "string", enum: ["insert", "update"], description: "insert=新建绑定；update=覆盖已有绑定的 user_id。" } },
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
	description: "删除一条员工绑定（provider+external_sub）。删除后该成员再调 tools/call 会返回 40310 未绑定；行不存在返回 404。",
	query: {
		type: "object",
		required: ["provider", "external_sub"],
		properties: {
			provider: { type: "string", minLength: 1, description: "外部渠道标识（企微固定 wecom）。" },
			external_sub: { type: "string", minLength: 1, description: "要解绑的外部成员标识（企微成员账号）。" },
		},
	},
};
del.response = {
	type: "object",
	required: ["deleted"],
	properties: { deleted: { type: "number", description: "删除行数（1=已解绑）。" } },
};

export default { get, post, del };
