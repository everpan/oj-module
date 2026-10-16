// 会话与签发领域服务（设计 §3.1 + D14 + AC1-12/13/27）。
// deps 注入：crypto/jwt/bcrypt 是 oj 运行时全局，Node 测试侧 crypto 只读不可 stub（设计 §9.1），
// 随机/哈希/签名/口令原语全部经构造注入，默认实现回落运行时全局（runtimeDeps）。
// B4：access JWT 仅载 sub（roles 走登录响应/资料接口，不进 claims）。
// B3：refresh = 不透明随机串 + DB 存 SHA-256 哈希（sys_refresh_token，迁移 0008）；
//     轮换作旧 + 滑动窗口（绝对 TTL 封顶 min(旧 exp, now+30d)）；reuse 检测全族吊销 + 审计。
import { invalidateUser } from "../../_platform/_shared/service/access";
import { recordOp } from "../../_platform/_shared/service/audit";

export interface SessionDeps {
	randomHex: (bytes: number) => string
	sha256Hex: (s: string) => string
	signAccess: (sub: string) => string | Promise<string>
	accessTtlSecs: number
	refreshTtlSecs: number
	bcryptHash: (pw: string) => Promise<string>
	bcryptVerify: (pw: string, hash: string) => Promise<boolean>
	now?: () => number
}

/** 默认实现：回落 oj 运行时全局（jwt.sign 仅收 {sub}——B4 roles 不进 claims 的语法级保证）。 */
export function runtimeDeps(): SessionDeps {
	const g = globalThis as any;
	return {
		randomHex: (n: number) => g.crypto.randomHex(n),
		sha256Hex: (s: string) => g.crypto.sha256Hex(s),
		signAccess: (sub: string) => g.jwt.sign({ sub }),
		accessTtlSecs: g.jwt.accessDuration,
		refreshTtlSecs: g.jwt.refreshDuration,
		bcryptHash: (pw: string) => g.bcrypt.hash(pw),
		bcryptVerify: (pw: string, h: string) => g.bcrypt.verify(pw, h),
	};
}

export interface SessionUser {
	id: number
	username: string
	display_name: string | null
	avatar_base64: string | null
	must_change: boolean
	roles: string[]
}

export interface TokenBundle {
	access_token: string
	refresh_token: string
	expires_in: number
	/** AC1-27：must_change 悬挂期签发的限权标记（改密成功才换发正式 token） */
	restricted: boolean
	user: SessionUser
}

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

export function createSession(deps: SessionDeps = runtimeDeps()) {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
	const hashOf = (token: string) => deps.sha256Hex(token);

	async function profileOf(uid: number): Promise<SessionUser> {
		const rows = await db.query(
			"select id, username, display_name, avatar_base64, must_change from users where id = ?",
			[uid],
		) as Array<Record<string, unknown>>;
		if (!rows[0])
			fail(404, "user not found");
		const roleRows = await db.query("select role_name from sys_user_role where user_id = ?", [uid]) as Array<{ role_name: string }>;
		return {
			id: uid,
			username: String(rows[0].username),
			display_name: rows[0].display_name == null ? null : String(rows[0].display_name),
			avatar_base64: rows[0].avatar_base64 == null ? null : String(rows[0].avatar_base64),
			must_change: Number(rows[0].must_change) === 1,
			roles: roleRows.map(r => r.role_name),
		};
	}

	async function issueFor(uid: number): Promise<TokenBundle> {
		const user = await profileOf(uid);
		const refreshToken = deps.randomHex(32);
		await db.exec(
			"insert into sys_refresh_token (token_hash, user_id, expires_at, revoked, created_at) values (?, ?, ?, 0, ?)",
			[hashOf(refreshToken), uid, now() + deps.refreshTtlSecs, now()],
		);
		return {
			access_token: await deps.signAccess(String(uid)),
			refresh_token: refreshToken,
			expires_in: deps.accessTtlSecs,
			restricted: user.must_change,
			user,
		};
	}

	/** 吊销联动（§3.1）：禁用/重置口令/改密 → 删该用户全部 refresh 记录。 */
	async function revokeAll(uid: number): Promise<void> {
		await db.exec("delete from sys_refresh_token where user_id = ?", [uid]);
	}

	return {
		/** B1+D14：本地登录——先验口令后查禁用；号不存在/口令错/禁用统一 401（不泄露账号状态）。 */
		async localLogin(username: string, password: string): Promise<TokenBundle> {
			const rows = await db.query("select id, password_hash, is_forbidden from users where username = ?", [String(username ?? "")]) as Array<Record<string, unknown>>;
			const row = rows[0];
			if (!row || !(await deps.bcryptVerify(String(password ?? ""), String(row.password_hash))))
				fail(401, "invalid credentials");
			if (Number(row.is_forbidden) === 1)
				fail(401, "invalid credentials");
			return issueFor(Number(row.id));
		},

		/** B3：刷新——轮换作旧；reuse 检测（已吊销串二次出现）全族吊销 + 审计。 */
		async refresh(token: string): Promise<TokenBundle> {
			const rows = await db.query("select * from sys_refresh_token where token_hash = ?", [hashOf(String(token ?? ""))]) as Array<Record<string, unknown>>;
			const row = rows[0];
			if (!row)
				fail(401, "invalid or expired refresh token");
			const uid = Number(row.user_id);
			if (Number(row.revoked) === 1) {
				await revokeAll(uid);
				await recordOp({ action: "auth.refresh.reuse", module: "framework", target: `user:${uid}`, level: 4 });
				fail(401, "invalid or expired refresh token");
			}
			if (Number(row.expires_at) <= now())
				fail(401, "invalid or expired refresh token");
			await db.exec("update sys_refresh_token set revoked = 1 where token_hash = ?", [row.token_hash]);
			// 滑动窗口 + 绝对 30d 封顶（§3.1「绝对 TTL + 滑动」）
			const newExp = Math.min(Number(row.expires_at), now() + deps.refreshTtlSecs);
			const refreshToken = deps.randomHex(32);
			await db.exec(
				"insert into sys_refresh_token (token_hash, user_id, expires_at, revoked, created_at) values (?, ?, ?, 0, ?)",
				[hashOf(refreshToken), uid, newExp, now()],
			);
			const user = await profileOf(uid);
			return {
				access_token: await deps.signAccess(String(uid)),
				refresh_token: refreshToken,
				expires_in: deps.accessTtlSecs,
				restricted: user.must_change,
				user,
			};
		},

		/** AC1-27：自助改密——本人 + 旧口令校验；改密清 must_change、级联删 refresh、换发正式 token。 */
		async changePassword(uid: number, oldPassword: string, newPassword: string): Promise<TokenBundle> {
			const rows = await db.query("select password_hash from users where id = ?", [uid]) as Array<{ password_hash: string }>;
			if (!rows[0])
				fail(404, "user not found");
			if (!(await deps.bcryptVerify(String(oldPassword ?? ""), String(rows[0].password_hash))))
				fail(401, "invalid credentials");
			if (!newPassword || String(newPassword).length < 6)
				fail(400, "password too short (min 6)");
			const hash = await deps.bcryptHash(String(newPassword));
			await db.tx(async (t) => {
				await t.exec("update users set password_hash = ?, must_change = 0 where id = ?", [hash, uid]);
				await t.exec("delete from sys_refresh_token where user_id = ?", [uid]);
			});
			invalidateUser(uid);
			return issueFor(uid);
		},

		revokeAll,

		/** D1：外部登录（LDAP/未来 SSO）签发出口——JIT/禁号由登录链先行处理（D14：LDAP 先查号）。 */
		async issueExternal(uid: number): Promise<TokenBundle> {
			return issueFor(uid);
		},
	};
}

export type Session = ReturnType<typeof createSession>;
