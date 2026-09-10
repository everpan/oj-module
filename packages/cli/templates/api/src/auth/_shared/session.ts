// 会话与签发共享逻辑（移植 oj 官方 sample/src/auth/_shared/session.ts，
// 对齐 devkit 手册 §8：access=jwt.sign，refresh=不透明随机串 + KV session）。

export function nowSecs(): number {
	return Math.floor(Date.now() / 1000);
}

export function sessionKey(refreshToken: string): string {
	return `AUTH-SESSION:${crypto.sha256Hex(refreshToken)}`;
}

// 签 access + 生成 refresh 并落 session（exp = now + refresh 时长，读取侧惰性判定）。
export async function issueTokens(uid: string, roles: string[]) {
	const accessToken = await jwt.sign({ sub: uid, roles });
	const refreshToken = crypto.randomHex(32);
	await kv.set(
		sessionKey(refreshToken),
		JSON.stringify({ uid, exp: nowSecs() + jwt.refreshDuration }),
	);
	return {
		access_token: accessToken,
		refresh_token: refreshToken,
		expires_in: jwt.accessDuration,
		user: { id: uid, roles },
	};
}
