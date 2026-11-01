// 租户管理员：给每个企业租户（tenant_id = corp_id）配一个**本租户内**的管理员账号。
//
// 为什么必须有这一层：
//   企业租户是企微登录时才由 `ensureTenant()` 隐式具象化的，里面只有 JIT 建出来的
//   `wecom:<userid>` 员工号，**一个管理员都没有**——于是没人能进 /system/departments
//   做组织架构同步、也没人能在该租户内授权。平台 superadmin 虽然在 /system/wecom
//   上看得到所有企业，但管不了租户内的组织/成员/角色（详见下面「越权」一段）。
//
// 为什么是 `admin` 而不是 `superadmin`：
//   `superadmin` 在本系统是**跨租户**的框架级角色——/system/wecom 每个端点都过
//   `assertSuperAdmin()`，而它列出的 listApps() 是**所有企业**的档案。只要某租户里
//   有人握着 superadmin，他带自己租户的头访问该页就能看到别家企业的档案，属跨租户
//   越权。所以：superadmin = 平台级、只留在 default 租户（运维纪律）；
//   admin = 租户级、每租户一个（本文件负责开的就是这个）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 【db.asSystem 例外说明 —— 全仓唯一，不得复制】
//
// 本文件是全代码库**唯一**使用 `db.asSystem()` 的地方。
//
// 为什么必须用它：superadmin 的请求自带 `default` 租户头，而 `db.asTenant` 是
// 「请求级、只能设一次，且要求当时还没有租户」。也就是说平台侧**没有任何正常通道**
// 能往企业租户里写 users / sys_user_role。而「给新租户配管理员」是平台开通动作，
// 不是业务写——正是逃生通道的用途（global.d.ts 原文："use db.asSystem() for system tasks"）。
//
// 框架红线：同一段注释紧接着写「业务 handler 不得使用」。所以这里是**有意识且被审计
// 的单一例外**，代价与边界必须写清楚：
//   · 范围：只在本文件，只服务「开通 / 重设租户管理员」这一件事；
//   · 写操作必须显式带上 tenant_id 条件（asSystem 绕过自动注入，漏了就是跨租户脏写）；
//   · 每个入口都在 admin/api.ts 走 recordOp 留痕（开通 level 2、改密 level 4）；
//   · **不得在本文件之外任何地方复制 db.asSystem()**。
// ─────────────────────────────────────────────────────────────────────────────

/** 租户管理员的固定账号名（每租户各一个，互不冲突——users 唯一键含 tenant_id） */
export const TENANT_ADMIN_USERNAME = "admin";
/** 授予的角色：租户级日常管理（组织/成员/角色/同步），**不是**跨租户的 superadmin */
const TENANT_ADMIN_ROLE = "admin";

export interface TenantAdminState {
	/** 租户（= 企业 ID） */
	corpId: string
	/** 管理员账号名 */
	username: string
	/** 该租户是否已有一个握着 admin 角色的账号 */
	exists: boolean
	/** 是否处于「须改密」状态（开通后恒为 true，直到本人改过一次） */
	mustChange: boolean
}

/**
 * 随机初始口令：**任何人都不知道**（bcrypt 单向，也不落库、不打日志）。
 *
 * 这不是缺陷而是设计：开通时不需要有人知道口令；平台侧要接管时走
 * `setTenantAdminPassword()` **自己设一个已知的**——他输入的那个他本来就知道，
 * 于是「口令需要被传递」这个问题被消掉了，全系统没有任何口令以可逆形式静态存储。
 */
function randomPassword(): string {
	// randomHex 产出 [0-9a-f]，长度 20 > 口令最小长度 6，且数字字母混合
	return crypto.randomHex(10);
}

/** 跨租户读：指定租户下的管理员行（asSystem 例外，见文件头） */
async function adminRow(tenantId: string): Promise<{ id: number, must_change: number } | null> {
	const rows = await db.asSystem().table("users")
		.select(["id", "must_change"])
		.where({
			and: [
				{ field: "tenant_id", op: "eq", value: tenantId },
				{ field: "username", op: "eq", value: TENANT_ADMIN_USERNAME },
			],
		})
		.all() as Array<{ id: number, must_change: number | null }>;
	if (!rows.length)
		return null;
	return { id: Number(rows[0]!.id), must_change: Number(rows[0]!.must_change ?? 0) };
}

/** 跨租户读：该用户在本租户是否握着 admin 角色（账号存在 ≠ 有角色，可能被收回过） */
async function hasAdminRole(tenantId: string, uid: number): Promise<boolean> {
	const roles = await db.asSystem().table("sys_user_role")
		.select(["role_name"])
		.where({
			and: [
				{ field: "tenant_id", op: "eq", value: tenantId },
				{ field: "user_id", op: "eq", value: uid },
			],
		})
		.all() as Array<{ role_name: string }>;
	return roles.some(r => String(r.role_name) === TENANT_ADMIN_ROLE);
}

/** 查看某租户的管理员状态（幂等、只读；不存在不建） */
export async function tenantAdminState(tenantId: string): Promise<TenantAdminState> {
	const row = await adminRow(tenantId);
	if (!row)
		return { corpId: tenantId, username: TENANT_ADMIN_USERNAME, exists: false, mustChange: false };
	return {
		corpId: tenantId,
		username: TENANT_ADMIN_USERNAME,
		exists: await hasAdminRole(tenantId, row.id),
		mustChange: row.must_change === 1,
	};
}

/**
 * 开通租户管理员（幂等）：没有就建，有就只确认角色还在。
 *
 * 只做两件事：建 `admin` 账号（随机口令 + 强制改密）、授予本租户的 `admin` 角色。
 * 重复调用安全——这正是「验证并接入可以反复点」的前提。
 */
export async function ensureTenantAdmin(tenantId: string): Promise<{ created: boolean }> {
	let row = await adminRow(tenantId);

	if (!row) {
		// 与 ensureWecomUser 同形状：只填业务关心的列，其余走列默认值
		await db.asSystem().table("users").insert({
			tenant_id: tenantId,
			username: TENANT_ADMIN_USERNAME,
			display_name: "租户管理员",
			password_hash: await bcrypt.hash(randomPassword()),
			avatar_base64: "",
			source: "local",
			must_change: 1,
			is_forbidden: 0,
			activated: 1,
		}).run();
		// 回查拿 id：预查与插入之间有竞态（并发开通），回查是唯一可靠的取 id 方式
		row = await adminRow(tenantId);
	}
	if (!row)
		throw Object.assign(new Error("租户管理员建档失败"), { status: 500 });

	if (!await hasAdminRole(tenantId, row.id)) {
		await db.asSystem().table("sys_user_role").insert({
			user_id: row.id,
			role_name: TENANT_ADMIN_ROLE,
			tenant_id: tenantId,
		}).run();
		return { created: true };
	}
	return { created: false };
}

/**
 * 开通租户管理员（**尽力而为**）：开不通只告警，绝不打断调用方。
 *
 * 为什么调用方不能因为它失败：
 *   · create_auth 有约 1 秒响应窗口（超时企业管理员看到「应用安装失败」），而 bcrypt
 *     是 CPU 密集操作，不该让它有机会拖垮回调；
 *   · connectCorp 走到这里时档案**已经落库**，抛错只会让界面显示「接入失败」而实际已接入。
 *
 * 补开通道：superadmin 随时可走「重设租户管理员口令」入口，该入口内部会先
 * `ensureTenantAdmin()`，所以一次开通失败不会留下没有管理员的死租户。
 */
export async function provisionTenantAdmin(tenantId: string): Promise<void> {
	try {
		const r = await ensureTenantAdmin(tenantId);
		log.info("wecom tenant admin provisioned", "corpId", tenantId, "created", r.created);
	}
	catch (e) {
		log.warn("wecom tenant admin provision skipped", "corpId", tenantId, "reason", (e as Error).message);
	}
}

/**
 * 重设租户管理员口令（平台 superadmin 专用入口）。
 *
 * 口令**不存储**：superadmin 自己输入新口令 → 他知道 → 告知租户管理员。
 * 落库的只有 bcrypt，且置 must_change=1（首次登录必须改），并级联吊销该用户的
 * refresh token，避免旧会话继续有效。
 */
export async function setTenantAdminPassword(tenantId: string, password: string): Promise<TenantAdminState> {
	// 先确保账号与角色都在：允许「还没人登录过」的租户被平台直接接管
	await ensureTenantAdmin(tenantId);
	const row = await adminRow(tenantId);
	if (!row)
		throw Object.assign(new Error("租户管理员建档失败"), { status: 500 });

	await db.asSystem().table("users")
		.update({ password_hash: await bcrypt.hash(password), must_change: 1 })
		.where({
			and: [
				{ field: "tenant_id", op: "eq", value: tenantId },
				{ field: "username", op: "eq", value: TENANT_ADMIN_USERNAME },
			],
		})
		.run();

	// 改密后旧会话必须失效。跨租户删 refresh 走带 tenant_id 条件的裸 SQL
	// （先例见 store.ts::revokeTenantSessions：守卫是 check-on-miss，带了租户条件即放行）
	await db.exec("DELETE FROM sys_refresh_token WHERE tenant_id = ? AND user_id = ?", [tenantId, row.id]);

	return await tenantAdminState(tenantId);
}
