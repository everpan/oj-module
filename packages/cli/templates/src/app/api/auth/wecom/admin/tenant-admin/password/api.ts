import { respond } from "#/_platform/_shared/respond";
// POST /api/auth/wecom/admin/tenant-admin/password —— 重设某企业的租户管理员口令。
//
// 权限：仅 superadmin（跨租户的平台级动作）。
//
// 为什么做成「superadmin 自己输入新口令」而不是「系统生成后回显」：
//   口令只以 bcrypt 落库，**没有任何可逆存储**，所以系统无法回显一个已存在的口令。
//   让 superadmin 自己输入，他知道这个值 → 直接告知租户管理员即可。代价为零，
//   收益是全系统不存在静态可读的口令副本。
//
// 副作用（都是必需的）：
//   · must_change = 1 —— 管理员首次登录必须改掉这个临时口令；
//   · 级联删 refresh —— 改密后旧会话立即失效，避免旧 token 继续可用。
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
import { recordOp } from "#/_platform/_shared/service/infra/audit";
import { setTenantAdminPassword } from "../../../../_shared/wecom/tenant-admin";

async function post() {
	await respond(async () => {
		await assertSuperAdmin();
		const body = (http.body ?? {}) as { corpId?: unknown, password?: unknown };
		const corpId = String(body.corpId ?? "").trim();
		const password = String(body.password ?? "");
		if (!corpId)
			throw Object.assign(new Error("缺少企业代码"), { status: 400 });
		// 与 users/password 同下限（6 位）：太短的口令在交接环节泄露风险更高
		if (password.length < 6)
			throw Object.assign(new Error("口令至少 6 位"), { status: 400 });

		const state = await setTenantAdminPassword(corpId, password);
		await recordOp({
			action: "wecom.admin.tenant_admin_password",
			module: "auth",
			target: corpId,
			// 不记口令本身（连脱敏都不记）：审计只要能回答「谁在何时给哪个企业重设过」
			detail: { username: state.username },
			// 重设他人管理员口令＝接管该租户的最高权限，按安全事件留痕
			level: 4,
		});
		return state;
	});
}

post.schema = {
	description: "为指定企业（corpId）开通租户管理员或重置其口令。开通后 must_change=true，本人首次登录必须改密。",
	body: {
		type: "object",
		required: ["corpId", "password"],
		properties: {
			corpId: { type: "string", minLength: 1, description: "企业 corpId。" },
			password: { type: "string", minLength: 6, description: "初始口令，至少 6 位。" },
		},
	},
};

post.response = {
	type: "object",
	required: ["corpId", "username", "exists", "mustChange"],
	properties: {
		corpId: { type: "string" },
		username: { type: "string" },
		exists: { type: "boolean" },
		mustChange: { type: "boolean" },
	},
};

export default { post };
