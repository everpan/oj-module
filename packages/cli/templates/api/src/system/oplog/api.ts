import { respond } from "../../_platform/_shared/respond";
// GET /api/system/oplog?action=&username=&module=&limit= —— 操作日志查询（AC1-29；D13 admin 可查）。
import { assertSystemAdmin } from "../../_platform/_shared/service/access";
import { searchOplog } from "../../_platform/_shared/service/oplog";

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
			// username 前缀匹配（service likePattern），非精确
			username: { type: "string" },
			module: { type: "string" },
			// 分页大小，service paged 钳 200
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

export default { get };
