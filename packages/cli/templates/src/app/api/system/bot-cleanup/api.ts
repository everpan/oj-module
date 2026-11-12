import { respond } from "#/_platform/_shared/respond";
import { cleanupTenantBotResources } from "#/_platform/_shared/service/domain/bot";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
// POST /api/system/bot-cleanup —— 租户级资源回收（卸载机器人接入 / 租户重置时使用）。
// 一次清空 oj_svc_token + oj_bot_binding + oj_obo_audit 三张表的**当前租户**数据，返回各表行数。
// 判权 assertSuperAdmin（与 bot-binding / obo-audit 同口径——本操作删的正是这两张安全敏感表；
// 租户边界另由 sql_guard 注入，绝不自报 tenant）；
// body 必须显式 confirm=true —— 幂等但不可逆，防误触。
// 为何不做成方案卸载钩子：_platform 卸载纪律「只删代码/锁/路由/权限，不删业务数据」
// （_lifecycle/uninstall.ts:36-38），清数据只能走显式运营操作。
// 已知边界（见 cleanupTenantBotResources 注释）：受托 token 是无状态 10min JWT，无法单条吊销。

async function post() {
	await respond(async () => {
		await assertSuperAdmin();
		return cleanupTenantBotResources();
	});
}
post.schema = {
	description: "【危险·不可逆】清空当前租户的机器人接入数据：服务凭据（oj_svc_token）、员工绑定（oj_bot_binding）、换签审计（oj_obo_audit）三张表的本租户全部行，返回各表删除行数。用于卸载机器人接入或租户重置。仅 superadmin 可调用；租户边界由服务端注入，无法跨租户。body 必须显式传 {\"confirm\":true}，缺省或 false 一律 400。重复调用安全（第二次返回全 0）。注意：已签发的 10 分钟受托 token 是无状态 JWT，删除行无法即时吊销，最多需等其自然过期。",
	body: {
		type: "object",
		required: ["confirm"],
		properties: {
			// 恒 true：空 body / false 一律 400，防误触（schema enum 单一值）。
			confirm: { type: "boolean", enum: [true], description: "恒传 true 表示确认清空（防误触）。" },
		},
	},
};
post.response = {
	type: "object",
	required: ["svc_tokens", "bindings", "audit_rows"],
	properties: {
		svc_tokens: { type: "number", description: "删除的服务凭据行数。" },
		bindings: { type: "number", description: "删除的员工绑定行数。" },
		audit_rows: { type: "number", description: "删除的换签审计行数。" },
	},
};

export default { post };
