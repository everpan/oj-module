/**
 * /system/users 行级操作门禁：只有 superadmin 能改 superadmin 账号。
 *
 * 与后端 `domain/users.ts::assertCanManageTarget` 同一条红线（只有 superadmin 能改
 * superadmin 的口令/状态/资料/角色）。前端这层只为「不给会 403 的按钮」——灰色可点却不
 * 生效比报错更糟——真正的防线在服务端：admin 直打接口同样会被 403 挡住。
 *
 * 单独成文件是为了可测：vitest 跑在 node 环境，没有 jsdom，整页 render 不了。
 */
export const PLATFORM_ROLE = "superadmin";

/**
 * @param myRoles 当前登录者的角色
 * @param targetRoles 行上用户的角色
 * @returns 是否允许对目标账号执行管理操作（改密/启停/改资料/成员资格）
 */
export function canManageUser(myRoles: readonly string[], targetRoles: readonly string[]): boolean {
	if (!targetRoles.includes(PLATFORM_ROLE))
		return true;
	return myRoles.includes(PLATFORM_ROLE);
}
