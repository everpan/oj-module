// 管理域端点组 /api/system/users（AC1-7~10）：handler 只编排——assertSystemAdmin 守卫 → service → json。
// 保护红线在 service 层硬 enforcement：禁止操作自己、admin 不碰成员资格、最后 superadmin 兜底。
// 子端点：roles/password/forbidden 各为独立目录（wiki per-endpoint 先例）。
import { assertSystemAdmin } from "../../../_platform/_shared/service/access";
import { createUser, listUsers } from "../../../_platform/_shared/service/users";

const bcryptDeps = { bcryptHash: (pw: string) => bcrypt.hash(pw) };

export default {
	// GET /api/system/users —— 用户列表（C1 页面数据源；无口令哈希，service 已排除）。
	async get() {
		await assertSystemAdmin();
		json.ok(await listUsers());
	},
	// POST /api/system/users —— 建号（B6 加固；默认 must_change=1 首登改密）。
	async post() {
		await assertSystemAdmin();
		json.ok({ id: await createUser(http.body || {}, bcryptDeps) });
	},
};
