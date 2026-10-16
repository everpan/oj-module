// 系统设置（PRD §4.3）+ 登录方式发现（C5/D2）。
// secret 项读取掩码（***）；market.* 安全项写操作须 superadmin 操作者（D11 边界在 service 按 actor 角色查）。
import { recordOp } from "./audit";

export interface SettingItem {
	key: string
	module: string
	group: string
	type: string
	/** secret 项恒为 "***"（读取面掩码） */
	value: string | null
	default_value: string | null
	label_key: string | null
	options: string | null
	secret: boolean
	update_time: number
}

export interface SettingGroup {
	group: string
	items: SettingItem[]
}

/** 安全敏感组：写操作须 superadmin（D11：不建模为权限点，物理判断）。 */
const SUPER_ONLY_GROUPS = new Set(["security"]);

export async function listSettings(): Promise<SettingGroup[]> {
	const rows = await db.query("select * from sys_setting order by \"group\", key") as Array<Record<string, unknown>>;
	const groups = new Map<string, SettingItem[]>();
	for (const r of rows) {
		const item: SettingItem = {
			key: String(r.key),
			module: String(r.module),
			group: String(r.group),
			type: String(r.type),
			value: Number(r.secret) === 1 ? "***" : (r.value == null ? null : String(r.value)),
			default_value: r.default_value == null ? null : String(r.default_value),
			label_key: r.label_key == null ? null : String(r.label_key),
			options: r.options == null ? null : String(r.options),
			secret: Number(r.secret) === 1,
			update_time: Number(r.update_time),
		};
		(groups.get(item.group) ?? groups.set(item.group, []).get(item.group))!.push(item);
	}
	return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

export async function updateSetting(actorId: number, key: string, value: string): Promise<void> {
	const rows = await db.query("select * from sys_setting where key = ?", [key]) as Array<Record<string, unknown>>;
	if (!rows.length)
		throw Object.assign(new Error(`setting not found: ${key}`), { status: 404 });
	const row = rows[0];
	if (SUPER_ONLY_GROUPS.has(String(row.group))) {
		const actorRoles = await db.query("select role_name from sys_user_role where user_id = ?", [actorId]) as Array<{ role_name: string }>;
		if (!actorRoles.some(r => r.role_name === "superadmin"))
			throw Object.assign(new Error("security settings require superadmin"), { status: 403 });
	}
	await db.exec("update sys_setting set value = ?, update_time = ? where key = ?", [String(value ?? ""), Date.now(), key]);
	await recordOp({ action: "setting.update", module: String(row.module), target: key });
}

/** C5/D2：登录方式发现的数据源——local 恒在，ldap/sso 由设置项开关。 */
export async function listLoginMethods(): Promise<{ methods: string[] }> {
	const rows = await db.query("select key, value from sys_setting where key in ('ldap.enabled', 'sso.enabled')") as Array<{ key: string, value: string | null }>;
	const enabled = (k: string) => rows.find(r => r.key === k)?.value === "1";
	return { methods: ["local", ...(enabled("ldap.enabled") ? ["ldap" as const] : []), ...(enabled("sso.enabled") ? ["sso" as const] : [])] };
}
