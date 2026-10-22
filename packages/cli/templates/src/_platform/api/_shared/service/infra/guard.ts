// 判权领域核心（DDD 领域服务）：四级链的纯函数决策——IO（DB 加载/缓存失效）在应用层
// （阶段 A3），本层不感知，天然可测。decideAccess 的输入即 AC1-1~6 的判定矩阵。
//
// 通过条件任一命中：
//   1. 持 superadmin        → 通过一切 code
//   2. 持 admin             → 通过一切 code
//   3. 持 <code 首段>.admin → 通过该模块全部 code（零配置推导）
//   4. 持角色的绑定精确命中 code（含 deprecated——判权不过滤，设计文档 §5）

/** code 首段 = 模块名（推导锚定 manifest.name 而非 api.prefix，设计文档 §4A.1 细则 1）。 */
export function moduleOf(code: string): string {
	const i = code.indexOf(".");
	return i === -1 ? code : code.slice(0, i);
}

export interface AccessInput {
	/** 用户持有角色（sys_user_role 权威源的投影） */
	roles: string[]
	/** 角色 → 已绑定权限点（sys_role_permission 投影；deprecated 不过滤） */
	bindings: Record<string, string[]>
}

export function decideAccess(input: AccessInput, code: string): boolean {
	const { roles, bindings } = input;
	if (roles.includes("superadmin") || roles.includes("admin"))
		return true;
	if (roles.includes(`${moduleOf(code)}.admin`))
		return true;
	return roles.some(r => (bindings[r] ?? []).includes(code));
}
