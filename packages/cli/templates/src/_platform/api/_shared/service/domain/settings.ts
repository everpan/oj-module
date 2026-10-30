// 系统设置（PRD §4.3）+ 登录方式发现（C5/D2）。
// secret 项读取掩码（***）；market.* 安全项写操作须 superadmin 操作者（D11 边界在 service 按 actor 角色查）。
import { recordOp } from "../infra/audit";

export interface SettingItem {
	key: string
	module: string
	group: string
	type: string
	/** secret 项恒为 "***"（读取面掩码） */
	value: string | null
	default_value: string | null
	label_key: string | null
	/** 组标题 key（C2-22 组级 label_key 落库值，P2-15③；同组各行一致，组面取首个非空） */
	group_label_key: string | null
	options: string | null
	secret: boolean
	update_time: number
}

export interface SettingGroup {
	group: string
	/** 组标题 key（组面收敛：同组任一行非空即用——P2-15③ DB 组标题回填消费面） */
	label_key: string | null
	items: SettingItem[]
}

/** 安全敏感组：写操作须 superadmin（D11：不建模为权限点，物理判断）。 */
const SUPER_ONLY_GROUPS = new Set(["security"]);

export async function listSettings(): Promise<SettingGroup[]> {
	const rows = await db.table("sys_setting").select(["key", "module", "group", "type", "value", "default_value", "label_key", "group_label_key", "options", "secret", "update_time"]).orderBy([{ field: "group" }, { field: "key" }]).all() as Array<Record<string, unknown>>;
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
			group_label_key: r.group_label_key == null ? null : String(r.group_label_key),
			options: r.options == null ? null : String(r.options),
			secret: Number(r.secret) === 1,
			update_time: Number(r.update_time),
		};
		(groups.get(item.group) ?? groups.set(item.group, []).get(item.group))!.push(item);
	}
	return [...groups.entries()].map(([group, items]) => ({
		group,
		label_key: items.find(x => x.group_label_key !== null)?.group_label_key ?? null,
		items,
	}));
}

export async function updateSetting(actorId: number, key: string, value: string): Promise<void> {
	const rows = await db.table("sys_setting").select(["key", "module", "group", "type", "value", "default_value", "label_key", "group_label_key", "options", "secret", "update_time"]).where({ field: "key", op: "eq", value: key }).all() as Array<Record<string, unknown>>;
	if (!rows.length)
		throw Object.assign(new Error(`setting not found: ${key}`), { status: 404 });
	const row = rows[0];
	if (SUPER_ONLY_GROUPS.has(String(row.group))) {
		const actorRoles = await db.table("sys_user_role").select(["role_name"]).where({ field: "user_id", op: "eq", value: actorId }).all() as Array<{ role_name: string }>;
		if (!actorRoles.some(r => r.role_name === "superadmin"))
			throw Object.assign(new Error("security settings require superadmin"), { status: 403 });
	}
	await db.table("sys_setting").update({ value: String(value ?? ""), update_time: Date.now() }).where({ field: "key", op: "eq", value: key }).run();
	await recordOp({ action: "setting.update", module: String(row.module), target: key });
}

/** C5/D2：登录方式发现的数据源——local 恒在，ldap/sso/wecom 由设置项开关。 */
export async function listLoginMethods(): Promise<{ methods: string[] }> {
	const rows = await db.table("sys_setting").select(["key", "value"]).where({ field: "key", op: "in", value: ["ldap.enabled", "sso.enabled", "wecom.enabled"] }).all() as Array<{ key: string, value: string | null }>;
	const enabled = (k: string) => rows.find(r => r.key === k)?.value === "1";
	// wecom 的凭据在部署常量（config vars），这里只报开关：开关开了但凭据没配，
	// 点进企微登录会拿到 400「企业微信未配置」——比登录页凭空少一个 tab 更容易排查。
	return { methods: ["local", ...(enabled("ldap.enabled") ? ["ldap" as const] : []), ...(enabled("sso.enabled") ? ["sso" as const] : []), ...(enabled("wecom.enabled") ? ["wecom" as const] : [])] };
}
