import { respond } from "#/_platform/_shared/respond";
// GET /api/system/oplog?action=&username=&module=&page=&limit= —— 操作日志查询（AC1-29；D13 admin 可查）。
// POST /api/system/oplog —— 操作日志写入（C3；登录态即可，解决方案模块记录自身操作）。
import { assertSystemAdmin, currentAccess } from "#/_platform/_shared/service/infra/access";
import { recordOp } from "#/_platform/_shared/service/infra/audit";
import { searchOplog } from "#/_platform/_shared/service/infra/oplog";

async function get() {
	await respond(async () => {
		await assertSystemAdmin();
		return searchOplog(http.query as Record<string, unknown>);
	});
}
get.schema = {
	query: {
		type: "object",
		properties: {
			action: { type: "string" },
			// username 包含匹配（子串，service 走 contains），非精确
			username: { type: "string" },
			module: { type: "string" },
			// 页码（1 起）；service 的 pageArgs 非法回落 1
			page: { type: "number", minimum: 1 },
			// 每页条数 1~200（schema 兜住；service 的 pageArgs 再钳一次）
			limit: { type: "number", minimum: 1, maximum: 200 },
		},
	},
};
get.response = {
	type: "object",
	required: ["list", "total", "truncated"],
	properties: {
		list: {
			type: "array",
			items: {
				type: "object",
				required: ["id", "create_time", "user_id", "username", "action", "module", "version", "target", "detail", "level"],
				properties: {
					id: { type: "number" },
					create_time: { type: "number" },
					user_id: { type: "number" },
					username: { type: "string" },
					action: { type: "string" },
					module: { type: "string" },
					version: { type: ["string", "null"] },
					target: { type: ["string", "null"] },
					detail: { type: ["string", "null"] },
					level: { type: "number" },
				},
			},
		},
		total: { type: "number" },
		truncated: { type: "boolean" },
	},
};

// POST /api/system/oplog —— 写操作日志（C3）。登录态即可（审计写入面向当前用户，非仅管理员）；
// module 由调用方自身模块名传入（脱敏红线：detail 不得含口令/密钥/token）。
async function post() {
	await respond(async () => {
		await currentAccess();
		const body = (http.body || {}) as Record<string, unknown>;
		const action = String(body.action ?? "");
		const module = String(body.module ?? "");
		if (!action || !module)
			throw Object.assign(new Error("action and module are required"), { status: 400 });
		await recordOp({
			action,
			module,
			version: body.version == null ? undefined : String(body.version),
			target: body.target == null ? undefined : String(body.target),
			detail: body.detail,
			level: typeof body.level === "number" ? body.level : undefined,
		});
		return { ok: true as const };
	});
}
post.schema = {
	body: {
		type: "object",
		required: ["action", "module"],
		properties: {
			action: { type: "string", minLength: 1 },
			module: { type: "string", minLength: 1 },
			version: { type: "string" },
			target: { type: "string" },
			level: { type: "number" },
		},
	},
};
post.response = {
	type: "object",
	required: ["ok"],
	properties: { ok: { type: "boolean" } },
};

export default { get, post };
