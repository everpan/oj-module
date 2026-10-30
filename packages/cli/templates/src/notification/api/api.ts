// oj v0.1.64 嵌套 handler 组：组名 = 路径段（路由不变）。del 是 oj 保留动词键
// （动词键下不允许挂子组），del/ 保留独立目录——唯一例外。
// DDD 判据：notifications 表 = 一致性边界 = 一个聚合，读/已读/清空/推送/删除都是
// 该聚合上的操作；发射三端点是薄 HTTP 壳，真逻辑在 ./_shared/notify。
//
// 契约（oj v0.1.72「最新方式」）：入参挂 `.schema`（params/query/body 三通道），
// 出参挂平级 `.response`（动词级优先于组级，组级沿嵌套继承）——oj 运行期据此校验入参、
// 并供 `oj openapi` 生成 openapi.json → 前端 `ojm api` 生成 __client。
// `.schema` 是 JSON Schema 严格子集（关键字白名单），union 用类型数组表达（见 userId）。
import { isSelfTenant } from "#/_platform/_shared/service/infra/access";
import { clearNotices, markAllRead, markRead, noticesFor, pushBroadcastNotice, pushNotice } from "./_shared/notify";

const notifications = {
	// GET /api/notification/notifications —— 通知列表（按人真实通知）。
	// 合并：广播(LEFT JOIN 回执算 is_read) UNION 按人(WHERE user_id = ?)，命名空间 id。
	// Bearer 守卫保护。直接复用 _shared/notify 原语 noticesFor 保证与发射端单一数据路径。
	async get() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		if (!(await isSelfTenant())) {
			json.fail(403, "forbidden");
			return;
		}
		try {
			json.ok(await noticesFor(uid));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
	// POST /api/notification/notifications/read —— 单条通知已读。
	// body.id 为命名空间串 "u:<id>"（按人）/"b:<id>"（广播）；按人项校验归属，非本人 403。
	"read": {
		async post() {
			const uid = http.user?.id;
			if (!uid) {
				json.fail(401, "unauthorized");
				return;
			}
			if (!(await isSelfTenant())) {
				json.fail(403, "forbidden");
				return;
			}
			const body = (http.body ?? {}) as { id?: unknown };
			const id = String(body.id ?? "");
			if (!id) {
				json.fail(400, "id is required");
				return;
			}
			try {
				const ok = await markRead(id, uid);
				if (!ok) {
					json.fail(403, "forbidden");
					return;
				}
				json.ok(null);
			}
			catch (e) {
				json.fail(500, String(e));
			}
		},
	},
	// POST /api/notification/notifications/read-all —— 全部通知已读（按当前用户）。
	"read-all": {
		async post() {
			const uid = http.user?.id;
			if (!uid) {
				json.fail(401, "unauthorized");
				return;
			}
			if (!(await isSelfTenant())) {
				json.fail(403, "forbidden");
				return;
			}
			try {
				await markAllRead(uid);
				json.ok(null);
			}
			catch (e) {
				json.fail(500, String(e));
			}
		},
	},
	// POST /api/notification/notifications/clear —— 清空通知（按当前用户）。
	// 删按人项 + 广播逐条落「对我隐藏」标记（共享行不可物理删，他人不受影响）。
	"clear": {
		async post() {
			const uid = http.user?.id;
			if (!uid) {
				json.fail(401, "unauthorized");
				return;
			}
			if (!(await isSelfTenant())) {
				json.fail(403, "forbidden");
				return;
			}
			try {
				await clearNotices(uid);
				json.ok(null);
			}
			catch (e) {
				json.fail(500, String(e));
			}
		},
	},
};

// 通知列表出参（data payload）：命名空间 id + 按人/广播 scope + 已读态 + 分类。
// oj v0.1.72 起出参走平级 .response（.schema 只放 body 等入参）。
notifications.get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["id", "scope", "avatar", "date", "message", "title"],
		properties: {
			id: { type: "string" },
			scope: { type: "string", enum: ["user", "broadcast"] },
			avatar: { type: "string" },
			date: { type: "string" },
			isRead: { type: "boolean" },
			message: { type: "string" },
			title: { type: "string" },
			link: { type: ["string", "null"] },
			category: { type: "string", enum: ["notice", "pm", "mention"] },
		},
	},
};

// POST /api/notification/notifications/read —— body 仅需 id。
notifications.read.post.schema = {
	body: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "string" } },
	},
};

// POST /api/notification/push —— 给指定用户推一条按人通知（发射原语 HTTP 入口）。
// 真正逻辑在 _shared/notify.pushNotice（任一后端模块也可直接 import 调用，无需走 HTTP）。
// Bearer 守卫保护；收件人过滤是发送方责任（原语不做业务判断）。
// userId 类型数组 ["string","number"] 表达 z.union（oj 白名单不支持 union 关键字，
// 用类型数组表达；handler 内 String() 归一，缺省回落当前用户）。
const push = {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		if (!(await isSelfTenant())) {
			json.fail(403, "forbidden");
			return;
		}
		const b = (http.body ?? {}) as {
			userId?: unknown
			title?: unknown
			message?: unknown
			link?: unknown
			avatar?: unknown
			category?: unknown
		};
		const target = b.userId ?? uid;
		if (!b.title || !b.message) {
			json.fail(400, "title and message are required");
			return;
		}
		try {
			const id = await pushNotice({
				userId: target as string | number,
				title: String(b.title),
				message: String(b.message),
				link: b.link != null ? String(b.link) : undefined,
				avatar: b.avatar != null ? String(b.avatar) : undefined,
				category: b.category as never,
			});
			json.ok({ id });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

push.post.schema = {
	body: {
		type: "object",
		required: ["title", "message"],
		properties: {
			userId: { type: ["string", "number"] },
			title: { type: "string" },
			message: { type: "string" },
			link: { type: "string" },
			avatar: { type: "string" },
			category: { type: "string", enum: ["notice", "pm", "mention"] },
		},
	},
};

// POST /api/notification/push-broadcast —— 广播一条通知（全员可见，一行存储）。
// 真正逻辑在 _shared/notify.pushBroadcastNotice。Bearer 守卫保护。
const broadcast = {
	async post() {
		const uid = http.user?.id;
		if (!uid) {
			json.fail(401, "unauthorized");
			return;
		}
		if (!(await isSelfTenant())) {
			json.fail(403, "forbidden");
			return;
		}
		const b = (http.body ?? {}) as {
			title?: unknown
			message?: unknown
			link?: unknown
			avatar?: unknown
			category?: unknown
		};
		if (!b.title || !b.message) {
			json.fail(400, "title and message are required");
			return;
		}
		try {
			const id = await pushBroadcastNotice({
				title: String(b.title),
				message: String(b.message),
				link: b.link != null ? String(b.link) : undefined,
				avatar: b.avatar != null ? String(b.avatar) : undefined,
				category: b.category as never,
			});
			json.ok({ id });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

broadcast.post.schema = {
	body: {
		type: "object",
		required: ["title", "message"],
		properties: {
			title: { type: "string" },
			message: { type: "string" },
			link: { type: "string" },
			avatar: { type: "string" },
			category: { type: "string", enum: ["notice", "pm", "mention"] },
		},
	},
};

export default { notifications, push, "push-broadcast": broadcast };
