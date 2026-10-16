import { respond } from "../../../_platform/_shared/respond";
// PUT /api/system/users/password?uid= —— 管理员重置口令（must_change=1 + 级联吊销 refresh）。
import { assertSystemAdmin } from "../../../_platform/_shared/service/access";
import { changePasswordByAdmin } from "../../../_platform/_shared/service/users";

export default {
	async put() {
		await respond(async () => {
			await assertSystemAdmin();
			const q = http.query as Record<string, unknown>;
			return changePasswordByAdmin(Number(http.user?.id), Number(q.uid), String(http.body?.password ?? ""), { bcryptHash: (pw: string) => bcrypt.hash(pw) });
		});
	},
};
