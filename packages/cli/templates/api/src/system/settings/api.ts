import { respond } from "../../_platform/_shared/respond";
import { listSettings, updateSetting } from "../../_platform/_shared/service/domain/settings";
// /api/system/settings —— 系统设置（PRD §4.3）：GET 按组列出（secret 掩码），PUT 写值（写审计）。
import { assertSystemAdmin } from "../../_platform/_shared/service/infra/access";

const settingItemSchema = {
	type: "object",
	required: ["key", "module", "group", "type", "value", "default_value", "label_key", "options", "secret", "update_time"],
	properties: {
		key: { type: "string" },
		module: { type: "string" },
		group: { type: "string" },
		type: { type: "string" },
		// secret 项读取面恒为 "***"
		value: { type: ["string", "null"] },
		default_value: { type: ["string", "null"] },
		label_key: { type: ["string", "null"] },
		options: { type: ["string", "null"] },
		secret: { type: "boolean" },
		update_time: { type: "number" },
	},
} as const;

async function get() {
	await respond(async () => {
		await assertSystemAdmin();
		return listSettings();
	});
}
get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["group", "items"],
		properties: {
			group: { type: "string" },
			items: { type: "array", items: settingItemSchema },
		},
	},
};

async function put() {
	await respond(async () => {
		await assertSystemAdmin();
		const body = http.body || {};
		return updateSetting(Number(http.user?.id), String(body.key ?? ""), String(body.value ?? ""));
	});
}
put.schema = {
	body: {
		type: "object",
		required: ["key", "value"],
		properties: {
			key: { type: "string", minLength: 1 },
			value: { type: "string" },
		},
	},
};

export default { get, put };
