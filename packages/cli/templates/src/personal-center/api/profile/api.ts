import { RESERVED_USERNAME_PREFIX } from "#/_platform/_shared/service/domain/users";
// POST /api/personal-center/profile —— 保存「我的资料」（个人中心表单入库端点）。
// 只允许改本人行（http.user.id 权威，不接受 body 传 id）；username 全局唯一，
// 重名 400；avatar 走 upload 端点（multipart），不在此通道。
import { isSelfTenant } from "#/_platform/_shared/service/infra/access";

const handler = {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		if (!(await isSelfTenant())) {
			json.fail(403, "forbidden");
			return;
		}
		const b = (http.body ?? {}) as {
			username?: unknown
			email?: unknown
			phoneNumber?: unknown
			description?: unknown
		};
		const patch: Record<string, string> = {};
		if (b.username != null && String(b.username).trim() !== "") {
			const username = String(b.username).trim();
			// 与建号同红线（B6）：自助改名不能抢占 ldap:/sso:/wecom: 命名空间——
			// 否则该外部成员首次登录时 ensureXXXUser 按用户名查到的是**别人那一行**，直接签发别人的 uid。
			if (RESERVED_USERNAME_PREFIX.test(username)) {
				json.fail(400, "username prefix reserved for external identity sources");
				return;
			}
			const dup = await db.table("users").select(["id"]).where({ field: "username", op: "eq", value: username }).all();
			if (dup.some(r => Number(r.id) !== Number(uid))) {
				json.fail(400, "username already taken");
				return;
			}
			patch.username = username;
		}
		if (b.email != null)
			patch.email = String(b.email);
		if (b.phoneNumber != null)
			patch.phone_number = String(b.phoneNumber);
		if (b.description != null)
			patch.description = String(b.description);
		if (Object.keys(patch).length === 0) {
			json.fail(400, "nothing to update");
			return;
		}
		try {
			await db.table("users").update(patch).where({ field: "id", op: "eq", value: Number(uid) }).run();
			json.ok(null);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

// 入参：四字段均可选（部分保存允许），类型即字符串。
handler.post.schema = {
	body: {
		type: "object",
		properties: {
			username: { type: "string" },
			email: { type: "string" },
			phoneNumber: { type: "string" },
			description: { type: "string" },
		},
	},
};

// 出参：无业务载荷（前端保存后经 user-info 重拉刷新 store）。
handler.post.response = { type: "null" };

export default handler;
