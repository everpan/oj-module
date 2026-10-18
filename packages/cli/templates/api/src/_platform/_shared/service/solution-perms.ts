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
		const existing = await db.query("select name from sys_role where name = ?", [role.name]) as unknown[];
		// upsert：行存在只覆盖元数据（title），name/builtin 不动（AC2-2 元数据覆盖）
		if (existing.length) {
			await db.exec("update sys_role set title = ? where name = ?", [role.title, role.name]);
		}
		else {
			await db.exec("insert into sys_role (name, module, title, builtin) values (?, ?, ?, 0)", [role.name, m.module, role.title]);
			// 声明绑定只在角色创建时写一次（角色级 insert-if-absent，AC1-15 红线）：
			// 升级/重装对已存在角色永不补写声明绑定——管理员撤过的绑定不复活；
			// 新版本给既有角色新增权限点时，由管理员显式勾选（insert-if-absent 的取舍边界，§9.5）。
			for (const code of role.permissions ?? []) {
				const bound = await db.query("select role_name from sys_role_permission where role_name = ? and permission_code = ?", [role.name, code]) as unknown[];
				if (!bound.length)
					await db.exec("insert into sys_role_permission (role_name, permission_code) values (?, ?)", [role.name, code]);
			}
		}
	}

	// 权限点行独立于角色创建：声明里的新 code 一律 upsert 插入（AC2-1「新增声明 → upsert 插入新行」——
	// 含既有角色新增权限点的场景；绑定是否自动挂上由上面的角色级规则决定）
	for (const code of declaredPerms) {
		const p = await db.query("select code from sys_permission where code = ?", [code]) as unknown[];
		if (!p.length)
			await db.exec("insert into sys_permission (code, module) values (?, ?)", [code, m.module]);
	}

	// 声明消失 → 行保留标 deprecated（AC2-3/4）：行与绑定全留，判决不突变；
	// 重命名的旧 code 走同一条规则（视为删除+新增），deprecated 清单交给安装器告警。
	const oldPerms = await db.query("select code from sys_permission where module = ? and deprecated = 0", [m.module]) as Array<{ code: string }>;
	for (const r of oldPerms) {
		if (!declaredPerms.has(String(r.code))) {
			await db.exec("update sys_permission set deprecated = 1 where code = ?", [r.code]);
			deprecated.push(String(r.code));
		}
	}
	const oldRoles = await db.query("select name from sys_role where module = ? and builtin = 0 and deprecated = 0", [m.module]) as Array<{ name: string }>;
	for (const r of oldRoles) {
		if (!declaredRoles.has(String(r.name))) {
			await db.exec("update sys_role set deprecated = 1 where name = ?", [r.name]);
			deprecated.push(String(r.name));
		}
	}
	return { deprecated };
}

/** 事务/非事务统一的 db 面（P3-3：可传入 db.tx 的事务句柄以纳入单一事务） */
interface DbLike {
	query: (sql: string, params?: unknown[]) => Promise<unknown>
	exec: (sql: string, params?: unknown[]) => Promise<unknown>
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
	const roles = await d.query("select name from sys_role where module = ?", [module]) as Array<{ name: string }>;
	for (const r of roles) {
		await d.exec("delete from sys_role_permission where role_name = ?", [r.name]);
		await d.exec("delete from sys_user_role where role_name = ?", [r.name]);
	}
	await d.exec("delete from sys_role where module = ?", [module]);
	// module 名是 slug（[a-z0-9_-]），LIKE 前缀匹配的转义纪律同 query.ts（ESCAPE '!' 三方言同义）
	const prefix = `${module.replace(/[!%_]/g, c => `!${c}`)}.%`;
	await d.exec("delete from sys_role_permission where permission_code like ? escape '!'", [prefix]);
	await d.exec("delete from sys_permission where module = ?", [module]);
}
