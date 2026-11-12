import { respond } from "#/_platform/_shared/respond";
import { changePasswordByAdmin } from "#/_platform/_shared/service/domain/users";
// PUT /api/system/users/password?uid= —— 管理员重置口令（must_change=1 + 级联吊销 refresh）。
import { assertSystemAdmin } from "#/_platform/_shared/service/infra/access";

async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const q = http.query as Record<string, unknown>;
		return changePasswordByAdmin(Number(http.user?.id), Number(q.uid), String(http.body?.password ?? ""), { bcryptHash: (pw: string) => bcrypt.hash(pw) });
	});
}
put.schema = {
	description: "管理员重置用户口令：置 must_change=1 并级联吊销该用户 refresh token（强制其重新登录改密）。仅系统管理员。",
	query: {
		type: "object",
		required: ["uid"],
		properties: { uid: { type: "number" } },
	},
	body: {
		type: "object",
		required: ["password"],
		properties: { password: { type: "string", minLength: 6 } },
	},
};

// 出参无业务载荷（service 返回 void → data 为 null）
put.response = { type: "null" };

export default { put };
