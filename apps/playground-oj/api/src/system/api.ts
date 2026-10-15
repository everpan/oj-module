// oj v0.1.64 嵌套 handler 组：组名 = 路径段（连字符组名用字符串字面量键，路由不变）。
// DDD 判据：system 模块是平台管理限界上下文，menu/role 各聚合的操作收进单文件；
// menu-item/role-item 的 del 是 DELETE 动词键（oj 约定方法名 del），不是组名。
//
// 契约（oj v0.1.72「最新方式」）：入参挂 `.schema`（params/query/body 三通道），
// 出参挂平级 `.response`（动词级优先于组级，组级沿嵌套继承）——oj 运行期据此校验入参、
// 并供 `oj openapi` 生成 openapi.json → 前端 `ojm api` 生成 __client。
// union（z.union([z.literal(0),z.literal(1)])/z.enum）用 `{type:"integer", enum:[...]}` 表达。

// ---- JSON Schema 复用块（与契约对齐；oj `.schema` 白名单子集） ----
const MENU_ITEM_SCHEMA = {
	type: "object",
	required: [
		"parentId",
		"id",
		"menuType",
		"name",
		"path",
		"component",
		"order",
		"icon",
		"currentActiveMenu",
		"iframeLink",
		"keepAlive",
		"externalLink",
		"hideInMenu",
		"ignoreAccess",
		"permission",
		"status",
		"createTime",
		"updateTime",
	],
	properties: {
		parentId: { type: "string" },
		id: { type: "number" },
		menuType: { type: "integer", enum: [0, 1, 2, 3] },
		name: { type: "string" },
		path: { type: "string" },
		component: { type: "string" },
		order: { type: "number" },
		icon: { type: "string" },
		currentActiveMenu: { type: "string" },
		iframeLink: { type: "string" },
		keepAlive: { type: "number" },
		externalLink: { type: "string" },
		hideInMenu: { type: "number" },
		ignoreAccess: { type: "number" },
		permission: { type: "string" },
		status: { type: "number" },
		createTime: { type: "number" },
		updateTime: { type: "number" },
	},
};

const ROLE_ITEM_SCHEMA = {
	type: "object",
	required: ["id", "createTime", "updateTime", "name", "code", "status", "remark"],
	properties: {
		id: { type: "number" },
		createTime: { type: "number" },
		updateTime: { type: "number" },
		name: { type: "string" },
		code: { type: "string" },
		status: { type: "integer", enum: [0, 1] },
		remark: { type: "string" },
	},
};

const ROLE_FORM_SCHEMA = {
	type: "object",
	required: ["name", "code", "status"],
	properties: {
		id: { type: "number" },
		name: { type: "string" },
		code: { type: "string" },
		status: { type: "integer", enum: [0, 1] },
		remark: { type: "string" },
		menus: { type: "array", items: { type: "number" } },
	},
};

// ---- menu 列表共享映射（menu-list 与 role-menu 原各自复制一份，收为模块级单份） ----
function toMenuItem(r: Record<string, any>): Record<string, any> {
	return {
		id: Number(r.id),
		parentId: String(r.parent_id),
		menuType: Number(r.menu_type),
		name: String(r.name),
		path: String(r.path),
		component: String(r.component),
		order: Number(r.sort),
		icon: String(r.icon),
		currentActiveMenu: String(r.current_active_menu),
		iframeLink: String(r.iframe_link),
		keepAlive: Number(r.keep_alive),
		externalLink: String(r.external_link),
		hideInMenu: Number(r.hide_in_menu),
		ignoreAccess: Number(r.ignore_access),
		permission: String(r.permission),
		status: Number(r.status),
		createTime: Number(r.create_time),
		updateTime: Number(r.update_time),
	};
}

const MENU_COLS = `id, parent_id, name, path, component, icon, sort, menu_type,
  permission, status, current_active_menu, iframe_link, keep_alive,
  external_link, hide_in_menu, ignore_access, create_time, update_time`;

// ---- menu-item 增改删 ----
// 真实化（P3-1）：menus 表 CRUD；字段全参数绑定，camel→snake。
// order 为 SQL 保留字，落库用 sort 列（MenuItemType.order 映射 sort）。
const MENU_INSERT_COLS = `parent_id, name, path, component, icon, sort, menu_type,
  permission, status, current_active_menu, iframe_link, keep_alive,
  external_link, hide_in_menu, ignore_access, create_time, update_time`;
const MENU_UPDATE_COLS = `parent_id = ?, name = ?, path = ?, component = ?, icon = ?, sort = ?,
  menu_type = ?, permission = ?, status = ?, current_active_menu = ?, iframe_link = ?,
  keep_alive = ?, external_link = ?, hide_in_menu = ?, ignore_access = ?, update_time = ?`;

function insertParams(b: Record<string, any>, now: number): unknown[] {
	return [
		Number(b.parentId ?? 0),
		String(b.name),
		String(b.path),
		String(b.component),
		String(b.icon),
		Number(b.order ?? 0),
		Number(b.menuType ?? 0),
		String(b.permission ?? ""),
		Number(b.status ?? 1),
		String(b.currentActiveMenu ?? ""),
		String(b.iframeLink ?? ""),
		Number(b.keepAlive ?? 0),
		String(b.externalLink ?? ""),
		Number(b.hideInMenu ?? 0),
		Number(b.ignoreAccess ?? 0),
		now,
		now,
	];
}

const menuItem = {
	async post() {
		const b = http.body ?? {};
		const now = Date.now();
		try {
			const ins = await db.query(
				`INSERT INTO menus (${MENU_INSERT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
				insertParams(b, now),
			);
			json.ok(String(ins[0].id));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},

	async put() {
		const b = http.body ?? {};
		const now = Date.now();
		try {
			const up = [
				Number(b.parentId ?? 0),
				String(b.name),
				String(b.path),
				String(b.component),
				String(b.icon),
				Number(b.order ?? 0),
				Number(b.menuType ?? 0),
				String(b.permission ?? ""),
				Number(b.status ?? 1),
				String(b.currentActiveMenu ?? ""),
				String(b.iframeLink ?? ""),
				Number(b.keepAlive ?? 0),
				String(b.externalLink ?? ""),
				Number(b.hideInMenu ?? 0),
				Number(b.ignoreAccess ?? 0),
				now,
				Number(b.id),
			];
			await db.exec(`UPDATE menus SET ${MENU_UPDATE_COLS} WHERE id = ?`, up);
			json.ok(String(b.id));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},

	async del() {
		const id = Number(http.body);
		try {
			await db.exec("DELETE FROM role_menu WHERE menu_id = ?", [id]);
			await db.exec("DELETE FROM menus WHERE id = ?", [id]);
			json.ok(String(id));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

// ---- role-item 增改删 ----
// 真实化（P3-1）：roles 表 CRUD；绑定菜单落到 role_menu（role 列存角色 CODE，
// 与 seed 及 get-async-routes 的 JOIN 口径一致）。
async function bindMenus(roleCode: string, menus: unknown): Promise<void> {
	await db.exec("DELETE FROM role_menu WHERE role = ?", [roleCode]);
	if (Array.isArray(menus)) {
		for (const mid of menus) {
			await db.exec(
				"INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES (?, ?)",
				[roleCode, Number(mid)],
			);
		}
	}
}

const roleItem = {
	async post() {
		const b = http.body ?? {};
		const now = Date.now();
		try {
			const ins = await db.query(
				`INSERT INTO roles (name, code, status, remark, create_time, update_time)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
				[String(b.name), String(b.code), Number(b.status), String(b.remark ?? ""), now, now],
			);
			const id = Number(ins[0].id);
			await bindMenus(String(b.code), b.menus);
			json.ok({
				id,
				name: String(b.name),
				code: String(b.code),
				status: Number(b.status),
				remark: String(b.remark ?? ""),
				menus: Array.isArray(b.menus) ? b.menus.map((m: unknown) => Number(m)) : [],
			});
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},

	async put() {
		const b = http.body ?? {};
		const id = Number(b.id);
		const now = Date.now();
		try {
			await db.exec(
				"UPDATE roles SET name = ?, code = ?, status = ?, remark = ?, update_time = ? WHERE id = ?",
				[String(b.name), String(b.code), Number(b.status), String(b.remark ?? ""), now, id],
			);
			await bindMenus(String(b.code), b.menus);
			json.ok({
				id,
				name: String(b.name),
				code: String(b.code),
				status: Number(b.status),
				remark: String(b.remark ?? ""),
				menus: Array.isArray(b.menus) ? b.menus.map((m: unknown) => Number(m)) : [],
			});
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},

	async del() {
		const id = Number(http.body);
		try {
			const rows = await db.query("SELECT code FROM roles WHERE id = ?", [id]);
			if (rows.length) {
				await db.exec("DELETE FROM role_menu WHERE role = ?", [String(rows[0].code)]);
				await db.exec("DELETE FROM roles WHERE id = ?", [id]);
			}
			json.ok(id);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

// 菜单增改删契约（body/menu 同形；del 仅收 id 数字；三者 data 均为资源 id 串）。
// oj v0.1.72 起出参走平级 .response（.schema 只放 body）。
menuItem.post.schema = { body: MENU_ITEM_SCHEMA };
menuItem.put.schema = { body: MENU_ITEM_SCHEMA };
menuItem.del.schema = { body: { type: "number" } };
menuItem.post.response = { type: "string" };
menuItem.put.response = { type: "string" };
menuItem.del.response = { type: "string" };

// 角色增改删契约（body/menu 同形；del 仅收 id 数字；data 与 body 同形）。
roleItem.post.schema = { body: ROLE_FORM_SCHEMA };
roleItem.put.schema = { body: ROLE_FORM_SCHEMA };
roleItem.del.schema = { body: { type: "number" } };
roleItem.post.response = ROLE_FORM_SCHEMA;
roleItem.put.response = ROLE_FORM_SCHEMA;
roleItem.del.response = { type: "number" };

const menuByRoleId = {
	// GET /api/system/menu-by-role-id —— 按角色 id 查绑定的菜单 id 列表。
	// role_menu.role 存角色 CODE，故先由角色 id 取 code 再查 menu_id。
	async get() {
		const id = Number(http.query.id);
		try {
			const roles = await db.query("SELECT code FROM roles WHERE id = ?", [id]);
			if (!roles.length) {
				json.ok([]);
				return;
			}
			const code = String(roles[0].code);
			const rows = await db.query("SELECT menu_id FROM role_menu WHERE role = ?", [code]);
			json.ok(rows.map(r => Number(r.menu_id)));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

menuByRoleId.get.schema = {
	query: {
		type: "object",
		required: ["id"],
		properties: { id: { type: "number" } },
	},
};

menuByRoleId.get.response = { type: "array", items: { type: "number" } };

const menuList = {
	// GET /api/system/menu-list —— 菜单列表（信封分页）。
	async get() {
		try {
			const rows = await db.query(`SELECT ${MENU_COLS} FROM menus ORDER BY sort ASC`, []);
			const list = rows.map(toMenuItem);
			json.ok({ list, total: list.length, current: 1 });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

menuList.get.response = {
	type: "object",
	required: ["list", "total"],
	properties: {
		list: { type: "array", items: MENU_ITEM_SCHEMA },
		total: { type: "number" },
		current: { type: "number" },
	},
};

const roleList = {
	// GET /api/system/role-list —— 角色列表（分页 + 过滤）。Bearer 守卫保护。
	async get() {
		const name = http.query.name;
		const code = http.query.code;
		const statusRaw = http.query.status;

		const current = Math.max(1, Number(http.query.current ?? 1));
		const pageSize = Math.max(1, Number(http.query.pageSize ?? 10));

		const where: string[] = [];
		const params: unknown[] = [];
		if (name) {
			where.push("name LIKE ?");
			params.push(`%${name}%`);
		}
		if (code) {
			where.push("code LIKE ?");
			params.push(`%${code}%`);
		}
		if (statusRaw !== undefined && statusRaw !== "") {
			where.push("status = ?");
			params.push(Number(statusRaw));
		}
		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

		try {
			const totalRows = await db.query(`SELECT COUNT(*) AS c FROM roles ${whereSql}`, params);
			const total = Number(totalRows[0]?.c ?? 0);

			const offset = (current - 1) * pageSize;
			const rows = await db.query(
				`SELECT id, name, code, status, remark, create_time, update_time
         FROM roles ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
				[...params, pageSize, offset],
			);

			const list = rows.map(r => ({
				id: Number(r.id),
				name: String(r.name),
				code: String(r.code),
				status: Number(r.status),
				remark: String(r.remark),
				createTime: Number(r.create_time),
				updateTime: Number(r.update_time),
			}));

			json.ok({ list, total, pageSize, current });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

roleList.get.schema = {
	query: {
		type: "object",
		properties: {
			name: { type: "string" },
			code: { type: "string" },
			status: { type: "integer", enum: [0, 1] },
			current: { type: "number" },
			pageSize: { type: "number" },
		},
	},
};

roleList.get.response = {
	type: "object",
	required: ["list", "total", "pageSize", "current"],
	properties: {
		list: { type: "array", items: ROLE_ITEM_SCHEMA },
		total: { type: "number" },
		pageSize: { type: "number" },
		current: { type: "number" },
	},
};

const roleMenu = {
	// GET /api/system/role-menu —— 菜单权限列表（扁平，前端转树）。
	async get() {
		try {
			const rows = await db.query(`SELECT ${MENU_COLS} FROM menus ORDER BY sort ASC`, []);
			json.ok(rows.map(toMenuItem));
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

roleMenu.get.response = { type: "array", items: MENU_ITEM_SCHEMA };

export default {
	"menu-by-role-id": menuByRoleId,
	"menu-item": menuItem,
	"menu-list": menuList,
	"role-item": roleItem,
	"role-list": roleList,
	"role-menu": roleMenu,
};
