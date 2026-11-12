import { respond } from "#/_platform/_shared/respond";
import { updateUserProfile } from "#/_platform/_shared/service/domain/users";
// PUT /api/system/users/profile?uid= —— 改资料（显示名 / 邮箱 / 职务）。
//
// 用户名**不在可改之列**：它是外部身份的主键（`wecom:<userid>` 这类），改名会让下一次
// 登录认错人（B6 命名空间抢占，见 RESERVED_USERNAME_PREFIX）。启停走 users/forbidden、
// 改密走 users/password——那两者带「级联删 refresh」的副作用，不混进通用改资料。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		const b = (http.body || {}) as { displayName?: string | null, email?: string | null, position?: string | null };
		await updateUserProfile(Number(http.user?.id), Number(q.uid), {
			displayName: b.displayName,
			email: b.email,
			position: b.position,
		});
		return { ok: true };
	});
}
put.schema = {
	description: "修改用户资料（显示名 / 邮箱 / 职务）。用户名不在可改之列——它是外部身份的主键（如 wecom:<userid>），改名会让下次登录认错人。启停走 users/forbidden、改密走 users/password。仅系统管理员。",
	query: {
		type: "object",
		required: ["uid"],
		properties: { uid: { type: "number" } },
	},
	body: {
		type: "object",
		properties: {
			displayName: { type: ["string", "null"], description: "显示名；传 null 表示清空。" },
			email: { type: ["string", "null"], description: "邮箱；传 null 表示清空。" },
			position: { type: ["string", "null"], description: "职务；传 null 表示清空。" },
		},
	},
};
put.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

export default { put };
