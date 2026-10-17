// 注册步骤（P1-8，十阶段 stage registering；D10 唯一出口）：安装器各 stage 之外任何人不得
// 直写 sys_role/sys_permission/sys_setting/sys_solution_route 四类行——RBAC 经
// upsertSolutionPerms 出口（AC2-1~6 原样消费，勿改其语义），设置/路由在本文件内收敛。
// 语义纪律（镜像 solution-perms）：只做加法 + 元数据覆盖 + 声明消失行保留标 deprecated
// （判决不突变，清单汇入返回值供安装器强告警 AC2-4）；设置项存在只覆定义列、管理员改过的
// value 永不复活（AC1-15 同纪律）。本行拥有的行（路由/设置）upsert 时复位 deprecated=0——
// 重声明行必须回到 queryRegistered 快照，否则 P1-9 冒烟对账假阴（solution-perms 出口未复位
// 是其既有语义，本文件不越界代改）。DB 级路由占用检查承接 P1-5 备案③（pre-DB 阶段无真源）。
// db 为 isolate 全局（同模板 service 层，无需 import；测试由夹具装 globalThis.db）。

import type { SolutionManifest } from "../../_shared/service/solution-perms";
import { auditOp } from "../../_shared/service/audit";
import { upsertSolutionPerms } from "../../_shared/service/solution-perms";

export interface RouteDecl {
	path: string
	/** D4 三值（settings/personal 已废弃） */
	category: "main" | "admin" | "hidden"
	order: number
	title_key?: string
	required_permission?: string
}

export interface SettingDecl {
	key: string
	group: string
	type: string
	/** 首装初值；缺省落 default_value */
	value?: string
	default_value?: string | null
	label_key?: string | null
	/** enum 选项（契约 C2-24 string[] 的序列化产物） */
	options?: string | null
	secret?: boolean
}

export interface SolutionDecl extends SolutionManifest {
	/** 版本上下文（审计 OpEntry.version；manifest 切片可缺省） */
	version?: string
	settings?: SettingDecl[]
	routes?: RouteDecl[]
}

/** 阶段结果（各安装段通用形状，本段 stage 恒为 "registering"） */
export interface StageResult {
	stage: "registering"
	ok: boolean
	message: string
	retryable?: boolean
}

export interface RegisterResult extends StageResult {
	/** 本次被标 deprecated 的 code/name/key/path 清单（AC2-4 安装器强告警数据源） */
	deprecated: string[]
}

/** 归一化快照（P1-9 冒烟对账消费；全排序、过滤 deprecated 行、零行全空返回 null） */
export interface SolutionSnapshot {
	module: string
	routes: string[]
	settings: string[]
	roles: string[]
	permissions: string[]
}

/** 首段提取（/wiki/docs → wiki）——占用判定粒度：前缀段冲突即整段首段比较（P1-5 备案③） */
function firstSeg(path: string): string {
	return path.split("/")[1] ?? "";
}

/**
 * DB 级路由占用检查：返回已被其他 module 占用首段的声明路径清单。
 * 框架保留段判断不做（那是 preflight 的活，C2-13/14）；deprecated 行仍算占用（行保留即占位，
 * 让位须走卸载），自占排除（module ≠ 自己）。
 */
export async function checkOccupancy(module: string, routePaths: string[]): Promise<string[]> {
	const rows = await db.query("select path from sys_solution_route where module != ?", [module]) as Array<{ path: string }>;
	const taken = new Set(rows.map(r => firstSeg(String(r.path))));
	return routePaths.filter(p => taken.has(firstSeg(p)));
}

/** 声明消失 → 行保留标 deprecated=1（镜像 solution-perms AC2-3/4），返回被标 key/path 清单 */
async function deprecateGone(table: "sys_setting" | "sys_solution_route", col: "key" | "path", module: string, declared: Set<string>): Promise<string[]> {
	const old = await db.query(`select ${col} from ${table} where module = ? and deprecated = 0`, [module]) as Array<Record<string, unknown>>;
	const gone: string[] = [];
	for (const r of old) {
		const k = String(r[col]);
		if (!declared.has(k)) {
			await db.exec(`update ${table} set deprecated = 1 where ${col} = ?`, [k]);
			gone.push(k);
		}
	}
	return gone;
}

/**
 * 注册一次完成（设计 §4 清单 #2/#3/#4）：占用预检 → RBAC 出口 → 设置 upsert → 路由 upsert
 * → 声明消失标 deprecated → 审计。失败 StageResult{ok:false}：占用拒装零写入（retryable=false，
 * 须改声明重打包）；DB 异常 retryable=true（附录 A registering）。
 */
export async function registerSolution(decl: SolutionDecl): Promise<RegisterResult> {
	const routes = decl.routes ?? [];
	const settings = decl.settings ?? [];
	try {
		// 占用预检（brief：registerSolution 开头先跑）：非空 → 拒注册零写入
		const occupied = await checkOccupancy(decl.module, routes.map(r => r.path));
		if (occupied.length > 0) {
			return {
				stage: "registering",
				ok: false,
				retryable: false,
				deprecated: [],
				message: `注册失败：路由首段已被其他方案占用（${occupied.join("、")}）——同站路由首段唯一，需调整声明后重新打包`,
			};
		}

		// RBAC（唯一出口）：upsert + 声明消失标 deprecated，deprecated 清单原样汇入
		const perms = await upsertSolutionPerms({ module: decl.module, roles: decl.roles });

		// 设置项 upsert：存在只覆定义列（value/update 语义 = 管理员改过的值不复活，AC1-15），
		// 不存在插 default_value（首装 value）
		for (const s of settings) {
			const exists = await db.query("select key from sys_setting where key = ?", [s.key]) as unknown[];
			if (exists.length) {
				await db.exec(
					"update sys_setting set module = ?, \"group\" = ?, type = ?, default_value = ?, label_key = ?, options = ?, secret = ?, deprecated = 0, update_time = ? where key = ?",
					[decl.module, s.group, s.type, s.default_value ?? null, s.label_key ?? null, s.options ?? null, s.secret ? 1 : 0, Date.now(), s.key],
				);
			}
			else {
				await db.exec(
					"insert into sys_setting (key, module, \"group\", type, value, default_value, label_key, options, secret, update_time, deprecated) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
					[s.key, decl.module, s.group, s.type, s.value ?? s.default_value ?? null, s.default_value ?? null, s.label_key ?? null, s.options ?? null, s.secret ? 1 : 0, Date.now()],
				);
			}
		}
		const settingDeps = await deprecateGone("sys_setting", "key", decl.module, new Set(settings.map(s => s.key)));

		// 路由逐行 upsert：同 path 覆元数据；声明行复位 deprecated=0（重声明回到快照）
		for (const r of routes) {
			const exists = await db.query("select path from sys_solution_route where path = ?", [r.path]) as unknown[];
			if (exists.length) {
				await db.exec(
					"update sys_solution_route set module = ?, category = ?, \"order\" = ?, title_key = ?, required_permission = ?, deprecated = 0 where path = ?",
					[decl.module, r.category, r.order, r.title_key ?? null, r.required_permission ?? null, r.path],
				);
			}
			else {
				await db.exec(
					"insert into sys_solution_route (path, module, category, \"order\", title_key, required_permission, deprecated, enabled) values (?, ?, ?, ?, ?, ?, 0, 1)",
					[r.path, decl.module, r.category, r.order, r.title_key ?? null, r.required_permission ?? null],
				);
			}
		}
		const routeDeps = await deprecateGone("sys_solution_route", "path", decl.module, new Set(routes.map(r => r.path)));

		const deprecated = [...perms.deprecated, ...settingDeps, ...routeDeps];
		auditOp({
			action: "solution.register",
			module: decl.module,
			version: decl.version,
			target: decl.module,
			detail: { routes: routes.length, settings: settings.length, deprecated },
		});
		return {
			stage: "registering",
			ok: true,
			message: `注册完成：${decl.roles.length} 个角色、${settings.length} 个设置项、${routes.length} 条路由${deprecated.length > 0 ? `；${deprecated.length} 项声明消失已标 deprecated（需关注：${deprecated.join("、")}）` : ""}`,
			deprecated,
		};
	}
	catch (e) {
		return { stage: "registering", ok: false, retryable: true, deprecated: [], message: `注册失败：${String(e)}（附录 A registering）` };
	}
}

export async function queryRegistered(name: string): Promise<SolutionSnapshot | null> {
	const routes = (await db.query("select path from sys_solution_route where module = ? and deprecated = 0", [name]) as Array<{ path: string }>).map(r => String(r.path)).sort();
	const settings = (await db.query("select key from sys_setting where module = ? and deprecated = 0", [name]) as Array<{ key: string }>).map(r => String(r.key)).sort();
	const roles = (await db.query("select name from sys_role where module = ? and deprecated = 0", [name]) as Array<{ name: string }>).map(r => String(r.name)).sort();
	const permissions = (await db.query("select code from sys_permission where module = ? and deprecated = 0", [name]) as Array<{ code: string }>).map(r => String(r.code)).sort();
	if (routes.length + settings.length + roles.length + permissions.length === 0) {
		return null;
	}
	return { module: name, routes, settings, roles, permissions };
}
