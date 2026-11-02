import { respond } from "#/_platform/_shared/respond";
// GET /api/auth/wecom/admin/tenant-admin?corpId= —— 查某企业的租户管理员状态。
//
// 权限：仅 superadmin。这是**跨租户**的平台级视图（查的是别家企业的管理员有没有开通），
// 与同目录其它端点一致。只读，不存在也不建——建号由开通流程与 password 端点负责。
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
import { tenantAdminState } from "../../../_shared/wecom/tenant-admin";

async function get() {
	await respond(async () => {
		await assertSuperAdmin();
		const corpId = String(((http.query ?? {}) as Record<string, unknown>).corpId ?? "").trim();
		if (!corpId)
			throw Object.assign(new Error("缺少企业代码"), { status: 400 });
		return tenantAdminState(corpId);
	});
}

get.schema = {
	query: {
		type: "object",
		required: ["corpId"],
		properties: { corpId: { type: "string", minLength: 1 } },
	},
};

get.response = {
	type: "object",
	required: ["corpId", "username", "exists", "mustChange"],
	properties: {
		corpId: { type: "string" },
		// 固定账号名：每租户各一个（users 唯一键含 tenant_id，互不影响）
		username: { type: "string" },
		// 该租户是否已有一个握着 admin 角色的账号
		exists: { type: "boolean" },
		// 是否须改密（开通后恒 true，直到本人改过一次）
		mustChange: { type: "boolean" },
	},
};

export default { get };
