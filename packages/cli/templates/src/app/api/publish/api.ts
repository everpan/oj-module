// 发布凭证端点族：/api/publish/credential/*
//
// 职责边界（ISP）：本文件只做「门禁 + 入参收口 + 一次原子读写」；
// 身份推导在 _shared/identity.ts（纯函数，无 IO），凭证换身份 = 一条条件 UPDATE 抢所有权。
//
// 三个门径的差别是刻意的：
//   · 申请 / 列表 / 撤销：登录态（currentAccess 已含「伪造租户头即查无此人」的拦截）
//   · 兑换：**匿名**。凭证自身就是持有型证明——CLI 可能没有账号密码，
//     这是它唯一需要的能力。抗穷举靠 256 位随机 + IP 维度限速，不靠登录态。
//
// 为什么是工厂（createPublishApi）而不是裸 handler：随机数与时钟必须可注入，
// 否则「过期」这类用例只能靠 sleep，「并发双花」也无法稳定构造。
// 与 market/api.ts 的 createMarketApi(marketEnv()) 同一形态。
import { respond } from "#/_platform/_shared/respond";
import { currentAccess } from "#/_platform/_shared/service/infra/access";
import { pagedFactory } from "#/_platform/_shared/service/infra/query";
import { rateLimit } from "#/_platform/_shared/service/infra/rate";
import { assertKeyId, assertProduct, CREDENTIAL_TTL_SECS, deriveKeyId } from "./_shared/identity";

/** 兑换失败的唯一文案：不区分「不存在 / 已兑换 / 已过期 / 已撤销」，避免探测，且给出下一步 */
const EXCHANGE_INVALID = "发布凭证无效或已失效（可能已兑换、已过期或已撤销）。请到「发布管理」页重新申请";

/** 单 IP 兑换尝试上限（每 10 分钟）；256 位随机下正常用户远用不到，超限只可能是扫 */
const EXCHANGE_RATE_LIMIT = 20;
const EXCHANGE_RATE_WINDOW_MS = 10 * 60 * 1000;

export interface PublishDeps {
	/** 秒级时钟 */
	now: () => number
	randomHex: (bytes: number) => string
	sha256Hex: (input: string) => string
}

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

/** 客户端 IP：反代场景读 x-forwarded-for 首段（与 login-throttle 同口径） */
function clientIp(): string {
	const headers = (http.headers ?? {}) as Record<string, string>;
	return String(headers["x-forwarded-for"] ?? headers["x-real-ip"] ?? "unknown").split(",")[0].trim();
}

/** 运行时依赖：oj isolate 的 crypto 增补面（无 randomUUID/sha256 时需要显式报缺，不静默降级） */
export function runtimePublishDeps(): PublishDeps {
	return {
		now: () => Math.floor(Date.now() / 1000),
		randomHex: (n) => {
			const c = (globalThis as unknown as { crypto?: { randomHex?: (bytes: number) => string } }).crypto;
			if (typeof c?.randomHex !== "function")
				throw new Error("publish: 运行时缺少 crypto.randomHex，无法签发凭证");
			return String(c.randomHex(n));
		},
		sha256Hex: (input) => {
			const c = (globalThis as unknown as { crypto?: { sha256Hex?: (s: string) => string } }).crypto;
			if (typeof c?.sha256Hex !== "function")
				throw new Error("publish: 运行时缺少 crypto.sha256Hex，无法签发凭证");
			return String(c.sha256Hex(input));
		},
	};
}

interface Actor {
	uid: number
	username: string
	displayName: string | null
	tenant: string
	superadmin: boolean
}

interface CredentialRow {
	id: number
	product: string
	key_id: string
	username: string
	display_name: string | null
	owner_tenant: string
	token_hint: string
	expires_at: number
	used: number
	used_at: number | null
	revoked: number
	created_at: number
}

/** 状态由服务端判定（前端各自推导必然分叉） */
function statusOf(row: CredentialRow, now: number): "active" | "used" | "revoked" | "expired" {
	if (Number(row.used) === 1)
		return "used";
	if (Number(row.revoked) === 1)
		return "revoked";
	if (Number(row.expires_at) <= now)
		return "expired";
	return "active";
}

export function createPublishApi(deps: PublishDeps) {
	/** 当前操作者：身份来自 token，租户与用户名来自**当前租户下**的 users 行（伪造头即查无此行） */
	async function actor(): Promise<Actor> {
		const snap = await currentAccess();
		const uid = Number(http.user?.id);
		const rows = await db.table("users")
			.select(["username", "display_name", "tenant_id"])
			.where({ field: "id", op: "eq", value: uid })
			.all() as Array<Record<string, unknown>>;
		const row = rows[0];
		if (!row)
			fail(403, "forbidden");
		return {
			uid,
			username: String(row.username),
			displayName: row.display_name == null ? null : String(row.display_name),
			tenant: String(row.tenant_id ?? "default"),
			superadmin: snap.roles.includes("superadmin"),
		};
	}

	// ── GET /api/publish/credential —— 列表（本人；superadmin 可看全部并按租户筛）────────
	const get = async () => {
		await respond(async () => {
			const me = await actor();
			const q = (http.query ?? {}) as Record<string, unknown>;
			const tenantFilter = me.superadmin && q.tenant ? String(q.tenant) : undefined;

			// 共享表：构造器不会注入租户谓词，隔离条件必须显式写
			const mk = () => {
				const b = db.table("publish_credential")
					.whereIf(tenantFilter, { field: "owner_tenant", op: "eq", value: tenantFilter });
				if (me.superadmin)
					return b;
				return b.where({ field: "owner_tenant", op: "eq", value: me.tenant })
					.where({ field: "uid", op: "eq", value: me.uid });
			};

			const r = await pagedFactory<CredentialRow>(mk, { page: q.page, size: q.limit });
			const now = deps.now();
			return {
				list: r.list.map(row => ({
					id: Number(row.id),
					product: row.product,
					key_id: row.key_id,
					username: row.username,
					display_name: row.display_name,
					token_hint: row.token_hint,
					status: statusOf(row, now),
					expires_at: Number(row.expires_at),
					used_at: row.used_at == null ? null : Number(row.used_at),
					created_at: Number(row.created_at),
					// 归属租户只对超管有意义
					owner_tenant: me.superadmin ? row.owner_tenant : undefined,
				})),
				total: r.total,
			};
		});
	};
	get.schema = {
		query: {
			type: "object",
			properties: {
				page: { type: "number", minimum: 1 },
				limit: { type: "number", minimum: 1, maximum: 200 },
				tenant: { type: "string" },
			},
		},
	};
	get.response = {
		type: "object",
		required: ["list", "total"],
		properties: {
			list: {
				type: "array",
				items: {
					type: "object",
					required: ["id", "product", "key_id", "username", "token_hint", "status", "expires_at", "created_at"],
					properties: {
						id: { type: "number" },
						product: { type: "string" },
						key_id: { type: "string" },
						username: { type: "string" },
						display_name: { type: ["string", "null"] },
						token_hint: { type: "string" },
						status: { type: "string", enum: ["active", "used", "revoked", "expired"] },
						expires_at: { type: "number" },
						used_at: { type: ["number", "null"] },
						created_at: { type: "number" },
						owner_tenant: { type: "string" },
					},
				},
			},
			total: { type: "number" },
		},
	};

	// ── POST /api/publish/credential —— 申请（填产品名 → 一次性拿到凭证 + 已定身份）─────
	const post = async () => {
		await respond(async () => {
			const body = (http.body ?? {}) as Record<string, unknown>;
			const product = assertProduct(body.product);
			const me = await actor();
			const keyId = assertKeyId(deriveKeyId({ product, username: me.username, uid: me.uid }));

			// 撞号：同一 key_id 已被别人占用 → 拒绝。同一人重复申请是允许的
			// （密钥长期有效，换机重建属正常操作），故只拦 uid 不同。
			const dup = await db.table("publish_credential")
				.select(["uid"])
				.where({ field: "key_id", op: "eq", value: keyId })
				.limit(1)
				.all() as Array<Record<string, unknown>>;
			if (dup.length > 0 && Number(dup[0].uid) !== me.uid)
				fail(409, `发布身份 ${keyId} 已被其他用户占用，请换一个产品名`);

			const token = deps.randomHex(32);
			const now = deps.now();
			const expiresAt = now + CREDENTIAL_TTL_SECS;
			await db.table("publish_credential").insert({
				token_hash: deps.sha256Hex(token),
				token_hint: token.slice(0, 8),
				uid: me.uid,
				username: me.username,
				display_name: me.displayName,
				product,
				key_id: keyId,
				owner_tenant: me.tenant,
				expires_at: expiresAt,
				used: 0,
				revoked: 0,
				created_at: now,
				created_ip: clientIp(),
			}).run();

			// 明文只在这里出现一次；库里只有 sha256
			return { token, key_id: keyId, product, token_hint: token.slice(0, 8), expires_at: expiresAt };
		});
	};
	post.schema = {
		body: {
			type: "object",
			required: ["product"],
			properties: { product: { type: "string" } },
		},
	};
	post.response = {
		type: "object",
		required: ["token", "key_id", "product", "expires_at"],
		properties: {
			token: { type: "string" },
			key_id: { type: "string" },
			product: { type: "string" },
			token_hint: { type: "string" },
			expires_at: { type: "number" },
		},
	};

	// ── POST /api/publish/credential/revoke —— 撤销（本人或超管；已兑换的不可撤销）──────
	const revoke = async () => {
		await respond(async () => {
			const body = (http.body ?? {}) as Record<string, unknown>;
			const id = Number(body.id);
			if (!Number.isInteger(id) || id <= 0)
				fail(400, "id 必须是正整数");
			const me = await actor();

			const rows = await db.table("publish_credential")
				.select(["id", "uid", "owner_tenant", "used", "revoked"])
				.where({ field: "id", op: "eq", value: id })
				.all() as Array<Record<string, unknown>>;
			const row = rows[0];
			// 越权与不存在同一句话：不给探测者区分「存在但不属于你」的材料
			if (!row || (!me.superadmin && (Number(row.uid) !== me.uid || String(row.owner_tenant) !== me.tenant)))
				fail(404, "凭证不存在");

			if (Number(row.used) === 1)
				fail(400, "该凭证已兑换成发布身份，不能撤销（发布身份长期有效；如需停用请移除对应信任公钥）");
			if (Number(row.revoked) === 1)
				return { ok: true };

			await db.table("publish_credential").update({ revoked: 1 }).where({ field: "id", op: "eq", value: id }).run();
			return { ok: true };
		});
	};
	revoke.schema = {
		body: { type: "object", required: ["id"], properties: { id: { type: "number" } } },
	};
	revoke.response = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };

	// ── POST /api/publish/credential/exchange —— 兑换（匿名；一次性，原子抢所有权）──────
	const exchange = async () => {
		await respond(async () => {
			// 抗穷举：单 IP 每 10 分钟最多 20 次尝试
			await rateLimit(`publish-exchange:ip:${clientIp()}`, EXCHANGE_RATE_LIMIT, EXCHANGE_RATE_WINDOW_MS);

			const body = (http.body ?? {}) as Record<string, unknown>;
			const token = String(body.token ?? "").trim();
			// 形状先挡：64 位 hex 以外的输入连查库都不必
			if (!/^[0-9a-f]{64}$/i.test(token))
				fail(400, EXCHANGE_INVALID);

			const hash = deps.sha256Hex(token);
			const now = deps.now();
			// 一条语句完成「判有效 + 抢所有权」：并发双花只可能有一个 changes=1
			const changed = Number(await db.table("publish_credential")
				.update({ used: 1, used_at: now })
				.where({
					and: [
						{ field: "token_hash", op: "eq", value: hash },
						{ field: "used", op: "eq", value: 0 },
						{ field: "revoked", op: "eq", value: 0 },
						{ field: "expires_at", op: "gt", value: now },
					],
				})
				.run());
			if (changed !== 1)
				fail(400, EXCHANGE_INVALID);

			const rows = await db.table("publish_credential")
				.select(["key_id", "product", "username", "display_name"])
				.where({ field: "token_hash", op: "eq", value: hash })
				.all() as Array<Record<string, unknown>>;
			const row = rows[0];
			if (!row)
				fail(400, EXCHANGE_INVALID);
			return {
				key_id: String(row.key_id),
				product: String(row.product),
				username: String(row.username),
				display_name: row.display_name == null ? null : String(row.display_name),
			};
		});
	};
	exchange.schema = {
		body: { type: "object", required: ["token"], properties: { token: { type: "string" } } },
	};
	exchange.response = {
		type: "object",
		required: ["key_id", "product", "username"],
		properties: {
			key_id: { type: "string" },
			product: { type: "string" },
			username: { type: "string" },
			display_name: { type: ["string", "null"] },
		},
	};

	return {
		credential: { get, post, revoke: { post: revoke }, exchange: { post: exchange } },
	};
}

export default createPublishApi(runtimePublishDeps());
