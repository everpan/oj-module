import type { Session, TokenBundle } from "./session";
// LDAP 登录领域服务（D1/AC1-12/PRD §4.5）：wiki 九步流程移植 + 本仓 D14/B5 语境。
// gateway（axis("ldap") 面）与 session（签发出口）均注入——axis 是 oj 运行时全局，Node 侧无此面。
// 错误两态红线：上游网络/协议错 → 502；凭据拒（0 条/多条/bind false）→ 401；未启用/缺配 → 400。
// 禁号 → 403（AC1-12：bind 成功也拒签发；LDAP 先查号的枚举面为 D14 已接受项）。
import { esc, firstAttr } from "./ldap";

export interface LdapEntry { dn: string, attrs: Record<string, string[]> }
export interface LdapGateway {
	search: (base: string, opts: { filter: string, attrs: string[] }) => Promise<LdapEntry[]>
	bind: (dn: string, password: string) => Promise<boolean>
}

/** 运行时网关：oj axis("ldap") 全局（libldap.dylib 插件，PRD §4.5 可行性结论）。 */
export function runtimeLdapGateway(): LdapGateway {
	const axisLdap = (globalThis as any).axis("ldap");
	return {
		search: (base, opts) => axisLdap.search(base, opts),
		bind: (dn, password) => axisLdap.bind(dn, password),
	};
}

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

async function setting(key: string): Promise<string> {
	const rows = await db.query("select value from sys_setting where key = ?", [key]) as Array<{ value: string | null }>;
	return rows[0]?.value == null ? "" : String(rows[0].value);
}

export function createLdapLogin(session: Pick<Session, "issueExternal">, gateway: LdapGateway) {
	/** 九步：enabled 闸 → 非空校验 → base_dn → 映射缺省 → search(esc) → bind → JIT → 禁号 → 签发。 */
	return async function ldapLogin(rawUsername: unknown, rawPassword: unknown): Promise<TokenBundle> {
		if ((await setting("ldap.enabled")) !== "1")
			fail(400, "LDAP 未启用");
		const username = String(rawUsername ?? "").trim();
		const password = String(rawPassword ?? "");
		if (!username || !password)
			fail(400, "username/password required");
		const base = await setting("ldap_base_dn");
		if (!base)
			fail(400, "ldap_base_dn 未配置");
		const uidAttr = (await setting("ldap_uid_attr")) || "uid";
		const emailAttr = (await setting("ldap_email_attr")) || "mail";
		let entries: LdapEntry[];
		try {
			entries = await gateway.search(base, { filter: `(${uidAttr}=${esc(username)})`, attrs: [uidAttr, emailAttr] });
		}
		catch {
			fail(502, "ldap upstream failed");
		}
		if (!Array.isArray(entries) || entries.length !== 1)
			fail(401, "invalid credentials"); // 0 条不存在、多条不猜
		let ok = false;
		try {
			ok = await gateway.bind(entries[0].dn, password);
		}
		catch {
			fail(502, "ldap upstream failed");
		}
		if (!ok)
			fail(401, "invalid credentials"); // LDAP 拒凭据是正常返回 false（不抛）
		// JIT find-or-create：键 "ldap:<uid>"，占位 hash "!ldap" 恒 verify false（低信任来源不接管本地号）；
		// must_change=0——外来号无本地旧口令，悬挂期唯一可用写端（改密）必失败 = 号 brick（设计 §9.4）
		const localName = `ldap:${username}`;
		let rows = await db.query("select id, is_forbidden from users where username = ?", [localName]) as Array<{ id: number, is_forbidden: number }>;
		if (!rows.length) {
			try {
				await db.exec(
					"insert into users (username, password_hash, source, email, must_change, is_forbidden) values (?, '!ldap', 'ldap', ?, 0, 0)",
					[localName, firstAttr(entries[0].attrs, emailAttr) || null],
				);
			}
			catch (e) {
				// 唯一约束兜底（预查与插入间的竞态，同 createUser 模式）：撞 username → 回查复用；其余照抛
				if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e)))
					throw e;
			}
			rows = await db.query("select id, is_forbidden from users where username = ?", [localName]) as Array<{ id: number, is_forbidden: number }>;
		}
		if (Number(rows[0].is_forbidden) === 1)
			fail(403, "account disabled");
		return session.issueExternal(Number(rows[0].id));
	};
}
