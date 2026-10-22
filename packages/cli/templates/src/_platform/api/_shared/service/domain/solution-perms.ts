// 解决方案权限声明的升级/卸载规则出口（设计 §5「减法唯一出口 = 卸载」；AC2-1~6 / AC1-14/15）。
// 安装器本体属 PRD M5；本出口即 M5 之前钉死规则的承载面——安装器唯一要遵守的纪律：
// 安装 = upsertSolutionPerms（只做加法 + 元数据覆盖 + 声明消失标 deprecated），
// 卸载 = uninstallSolution（双维度级联清理）；除此之外不得直写 sys_role/sys_permission 两表。
// deprecated 双向过滤红线（§5）：判权链不过滤 deprecated（本文件不做任何判权过滤），
// 管理 UI 过滤——管理面在 roles service（listPermissions 带标记，前端标灰）。
export interface SolutionRoleDecl {
	/** 完整角色名（含 `<module>.` 前缀，AC1-11 由安装器侧前缀校验） */
	name: string
	title: string
	/** 声明绑定：insert-if-absent 写入，管理员调整永不被覆写（AC1-15） */
	permissions?: string[]
}

export interface SolutionManifest {
	module: string
	roles: SolutionRoleDecl[]
}

export interface UpsertResult {
	/** 本次被标 deprecated 的 code/name 清单——安装器据此强告警「N 个权限点需重新分配」（AC2-4） */
	deprecated: string[]
}

export async function upsertSolutionPerms(m: SolutionManifest): Promise<UpsertResult> {
	const deprecated: string[] = [];
	const declaredRoles = new Set(m.roles.map(r => r.name));
	const declaredPerms = new Set(m.roles.flatMap(r => r.permissions ?? []));

	for (const role of m.roles) {
		const existing = await db.table("sys_role").select(["name"]).where({ field: "name", op: "eq", value: role.name }).all() as unknown[];
		// upsert：行存在只覆盖元数据（title），name/builtin 不动（AC2-2 元数据覆盖）
		if (existing.length) {
			await db.table("sys_role").update({ title: role.title }).where({ field: "name", op: "eq", value: role.name }).run();
		}
		else {
			await db.table("sys_role").insert({ name: role.name, module: m.module, title: role.title, builtin: 0 }).run();
			// 声明绑定只在角色创建时写一次（角色级 insert-if-absent，AC1-15 红线）：
			// 升级/重装对已存在角色永不补写声明绑定——管理员撤过的绑定不复活；
			// 新版本给既有角色新增权限点时，由管理员显式勾选（insert-if-absent 的取舍边界，§9.5）。
			for (const code of role.permissions ?? []) {
				const bound = await db.table("sys_role_permission").select(["role_name"]).where({ field: "role_name", op: "eq", value: role.name }).where({ field: "permission_code", op: "eq", value: code }).all() as unknown[];
				if (!bound.length)
					await db.table("sys_role_permission").insert({ role_name: role.name, permission_code: code }).run();
			}
		}
	}

	// 权限点行独立于角色创建：声明里的新 code 一律 upsert 插入（AC2-1「新增声明 → upsert 插入新行」——
	// 含既有角色新增权限点的场景；绑定是否自动挂上由上面的角色级规则决定）
	for (const code of declaredPerms) {
		const p = await db.table("sys_permission").select(["code"]).where({ field: "code", op: "eq", value: code }).all() as unknown[];
		if (!p.length)
			await db.table("sys_permission").insert({ code, module: m.module }).run();
	}

	// 声明消失 → 行保留标 deprecated（AC2-3/4）：行与绑定全留，判决不突变；
	// 重命名的旧 code 走同一条规则（视为删除+新增），deprecated 清单交给安装器告警。
	const oldPerms = await db.table("sys_permission").select(["code"]).where({ field: "module", op: "eq", value: m.module }).where({ field: "deprecated", op: "eq", value: 0 }).all() as Array<{ code: string }>;
	for (const r of oldPerms) {
		if (!declaredPerms.has(String(r.code))) {
			await db.table("sys_permission").update({ deprecated: 1 }).where({ field: "code", op: "eq", value: r.code }).run();
			deprecated.push(String(r.code));
		}
	}
	const oldRoles = await db.table("sys_role").select(["name"]).where({ field: "module", op: "eq", value: m.module }).where({ field: "builtin", op: "eq", value: 0 }).where({ field: "deprecated", op: "eq", value: 0 }).all() as Array<{ name: string }>;
	for (const r of oldRoles) {
		if (!declaredRoles.has(String(r.name))) {
			await db.table("sys_role").update({ deprecated: 1 }).where({ field: "name", op: "eq", value: r.name }).run();
			deprecated.push(String(r.name));
		}
	}
	return { deprecated };
}

/**
 * 事务/非事务统一的 db 面（P3-3：可传入 db.tx 的事务句柄以纳入单一事务）。
 *  只收 table——全构造器化后（v0.1.81 startswith 补齐最后缺口）本出口不再走裸 SQL，
 *  契约随实现收窄：tx 句柄（{table}）与全局 db 均可传入。
 */
interface DbLike {
	table: DBInstance["table"]
}

/**
 * 卸载级联清理（AC2-6，唯一减法出口）——双维度：
 * ① 该 module 的角色行 + 这些角色的全部绑定 + 用户成员资格；
 * ② permission_code 属该 module 的绑定（含 custom 角色上的）+ 权限点行——
 *   漏维度②会让 custom 角色残留绑定在重装时静默复活旧授权。custom 角色本体保留（空绑定）。
 * AC2-7：业务表不属本出口，运维手工处理（Q4）。
 * P3-3：可传入事务句柄 `d`（db.tx 的 t），使级联纳入卸载的单一 DB 事务；缺省回落全局 db（兼容既有调用面）。
 */
export async function uninstallSolution(module: string, d: DbLike = db): Promise<void> {
	const roles = await d.table("sys_role").select(["name"]).where({ field: "module", op: "eq", value: module }).all() as Array<{ name: string }>;
	for (const r of roles) {
		await d.table("sys_role_permission").where({ field: "role_name", op: "eq", value: r.name }).delete().run();
		await d.table("sys_user_role").where({ field: "role_name", op: "eq", value: r.name }).delete().run();
	}
	await d.table("sys_role").where({ field: "module", op: "eq", value: module }).delete().run();
	// startswith（v0.1.81）：语义化前缀匹配（⇒ `v%`），引擎自动转义 %/_/!——
	// 替代旧「手工 escape 拼接 + 裸 SQL like ? escape '!'」（三方言 ESCAPE 同义纪律见 query.ts）
	await d.table("sys_role_permission").where({ field: "permission_code", op: "startswith", value: `${module}.` }).delete().run();
	await d.table("sys_permission").where({ field: "module", op: "eq", value: module }).delete().run();
}
