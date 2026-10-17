// bundle 级 manifest.yaml 契约校验（P1-11，`ojm build --bundle` 构建期执行点）。
// 规则真源：docs/prd/solution/202610171254-lifecycle-manifest-contract.md §2/§4（C2-01~33 构建列）；
// 期望真源：src/lifecycle/__tests__/fixtures/（fixture-valid 零违规 / fixture-invalid 七码齐报）。
// 双端一致：本实现与 isolate 侧 preflight（templates/api/.../steps/preflight.ts）共享同一组夹具，
// 正则与规则**逐字一致**（§4.1 矩阵构建列 vs 安装列的执行点差异见各规则注释）——
// 改任一端正则前必须先改契约文档对应条款，再同步两端与夹具（契约 §0 唯一真源纪律）。
// 实现纪律（契约 §0）：收集全部违规后统一报出，不首条即停——否则夹具断言集被截断。

import { parse } from "yaml";

/** bundle 级 manifest（动态校验对象；字段口径见契约 §2） */
export type BundleManifest = Record<string, unknown>;

// 单行书写：eslint indent-binary-ops 与 no-mixed-spaces-and-tabs 对 tab 续行互斥，拆行必撞规则
export type ParseResult = { ok: true, manifest: BundleManifest } | { ok: false, error: string };

// ── 契约 §2/§4 正则与清单（与 preflight.ts 逐字对应；改动须先改契约再同步双端与夹具）──

/** C2-01：name 白名单 */
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

/** §4.2 保留名清单（C2-01/13/14 共用；market 经 R9 恢复保留） */
const RESERVED_NAMES = new Set(["_platform", "system", "auth", "market", "framework", "health", "plugins", "_system"]);

/** C2-02 字符集：[0-9A-Za-z.-]（禁 +——oj validate_version 拒装，附录 B-1；禁 _——契约收紧） */
const VERSION_CHARS_RE = /^[0-9A-Z.-]+$/i;

/** §2.2 范围算子语法（peer 四字段/api.deps 值共用） */
const RANGE_RE = /^(>=|<=|[><^=])?([0-9A-Z.-]+)$/i;

/** C2-26①：anonymous 相对路径语法（无前导斜杠、无通配符；首字符 [a-z0-9] 使 _system/_platform 天然禁入） */
const ANONYMOUS_RE = /^[a-z0-9][a-z0-9\-_.]*(?:\/[a-z0-9][a-z0-9\-_.]*)*$/;

/** C2-17：路由 path 语法（首段首字符为字母；无参数段/通配符/尾斜杠） */
const ROUTE_PATH_RE = /^\/[a-z][a-z0-9\-_]*(?:\/[a-z0-9\-_]+)*$/;

/** C2-26③：登录语义端点禁令（R8/S1 纵深防御；契约 (?i) 正则逐字） */
const LOGIN_ENDPOINT_RE = /(?:^|\/)(?:[\w.-]*-)?(?:login|logout|token|session|signin|signup|auth)(?:\/|$)/i;

/** C2-17：D4 三值（PRD §5.2 settings/personal 两值废弃） */
const ROUTE_CATEGORIES = new Set(["main", "admin", "hidden"]);

/** C2-24：设置项类型枚举 */
const SETTING_TYPES = new Set(["string", "bool", "int", "float", "enum", "text"]);

/** C2-28：web.integrity 形态 */
const INTEGRITY_RE = /^sha384-[A-Za-z0-9+/]{64}$/;

/** 契约 §1：顶层键白名单——未列出的一律拒绝（防拼写漂移静默失效） */
const TOP_LEVEL_KEYS = new Set([
	"name",
	"version",
	"title",
	"summary",
	"description",
	"icon",
	"author",
	"license",
	"homepage",
	"keywords",
	"changelog",
	"peerRuntime",
	"peerOj",
	"peerFramework",
	"peerPlatform",
	"api",
	"web",
	"permissions",
	"roles",
	"routes",
	"settings",
	"health",
	"archive",
]);

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** i18n key 命名空间正则（C2-25 语法层）：`<name>:<ns>.<rest>` */
function nameKeyRe(name: string, ns: string): RegExp {
	return new RegExp(`^${escapeRe(name)}:${ns}\\.[a-zA-Z0-9_.-]+$`);
}

/** C2-02 语义检查（与 preflight.versionProblem 逐字一致）。返回违规描述，合法返回 null */
function versionProblem(s: string): string | null {
	if (!VERSION_CHARS_RE.test(s)) {
		return "含非法字符（允许 [0-9A-Za-z.-]；+ 被 oj validate_version 拒装（附录 B-1）、_ 为契约收紧排除）";
	}
	if (s.startsWith(".") || s.endsWith(".")) {
		return "首尾不得为点";
	}
	if (s.includes("..")) {
		return "不得含连续点";
	}
	const hyphen = s.indexOf("-");
	const core = hyphen === -1 ? s : s.slice(0, hyphen);
	if (!/^\d+(?:\.\d+)*$/.test(core)) {
		return `主版本段「${core}」必须为数字段（如 1.0.0）；字母仅可用于 - 之后的 prerelease 标识`;
	}
	if (hyphen !== -1) {
		const pre = s.slice(hyphen + 1);
		if (pre === "" || pre.startsWith(".") || pre.endsWith(".") || pre.includes("..")) {
			return "prerelease 标识不得为空或含空段";
		}
	}
	return null;
}

/** §2.2 范围算子语法 + P1 语义集（精确/=、>=、^；</<=/> 构建期即拒，§2.2「暂不支持的范围算子」） */
function rangeProblem(range: string): string | null {
	const m = RANGE_RE.exec(range);
	if (m === null) {
		return "不符合范围算子语法 ^(>=|<=|>|<|^|=)?<version>（version 遵守 C2-02）";
	}
	const p = versionProblem(m[2]);
	if (p !== null)
		return p;
	if (m[1] === "<" || m[1] === "<=" || m[1] === ">") {
		return `使用了暂不支持的范围算子「${m[1]}」（P1 语义集 = 精确/=、>=、^；「<」「<=」构建期即拒）`;
	}
	return null;
}

/** 单条违规格式：编号在人话前，bundle 构建失败时逐条列出 */
function v(clause: string, detail: string): string {
	return `【${clause}】${detail}`;
}

/**
 * 解析 bundle 级 manifest.yaml 文本。
 * 语法错误/顶层非映射 → ok:false + 可读错误（不抛异常，调用方统一决定 fail-fast 形态）。
 */
export function parseManifest(text: string): ParseResult {
	let doc: unknown;
	try {
		doc = parse(text);
	}
	catch (e) {
		return { ok: false, error: `manifest.yaml 不是合法 YAML：${e instanceof Error ? e.message : String(e)}` };
	}
	if (!isObj(doc)) {
		return { ok: false, error: `manifest.yaml 顶层必须是键值映射（实为 ${doc === null ? "null" : Array.isArray(doc) ? "数组" : typeof doc}）` };
	}
	return { ok: true, manifest: doc };
}

/**
 * 契约构建列全量校验（§4.1 矩阵「构建期」列的 manifest 内在规则）。
 * 返回违规串列表（【编号】人话），空数组 = 通过；文件面规则（tables 对照 schema.yaml、
 * locales 齐备、tgz 布局核对）分别在 checkTablesAgainstSchema / checkLocalesComplete / bundle.ts。
 */
export function validateContract(m: unknown): string[] {
	const v0: string[] = [];
	if (!isObj(m)) {
		return [v("C2", `manifest 不是键值对象（实为 ${m === null ? "null" : Array.isArray(m) ? "数组" : typeof m}），无法校验`)];
	}
	// 身份兜底：name/version 缺失/非字符串时，以占位串派生后续命名空间正则（衍生违规允许，内在违规照报）
	const name = typeof m.name === "string" ? m.name : "";
	const version = typeof m.version === "string" ? m.version : "";

	// ── §1 顶层键白名单 ──
	for (const k of Object.keys(m)) {
		if (!TOP_LEVEL_KEYS.has(k)) {
			v0.push(v("§1", `未知顶层键「${k}」（未列出的顶层键一律拒绝，防拼写漂移静默失效；白名单见契约 §1）`));
		}
	}

	// ── C2-01 name：白名单 + 保留名 ──
	if (typeof m.name !== "string" || !NAME_RE.test(m.name)) {
		v0.push(v("C2-01", `name「${String(m.name)}」不匹配 ^[a-z][a-z0-9-]{0,63}$（小写字母开头，仅小写字母/数字/连字符）`));
	}
	if (RESERVED_NAMES.has(name)) {
		v0.push(v("C2-01", `name「${name}」是保留名（§4.2：_platform/system/auth/market/framework/health/plugins/_system），禁用于方案（R9）`));
	}

	// ── C2-02 version：字符集 + oj 相容排除 ──
	if (typeof m.version !== "string") {
		v0.push(v("C2-02", "version 必须是字符串"));
	}
	else {
		const p = versionProblem(m.version);
		if (p !== null)
			v0.push(v("C2-02", `version「${m.version}」${p}`));
	}

	// ── C2-03~08 身份可选字段 + changelog（构建列全量；安装列仅 summary 非空）──
	if (m.title !== undefined && (typeof m.title !== "string" || m.title.length > 100)) {
		v0.push(v("C2-03", `title「${String(m.title)}」必须是字符串且 ≤100 字符（缺省 = name）`));
	}
	const summary = m.summary;
	if (typeof summary !== "string" || summary.trim() === "" || summary.length > 200 || summary.includes("\n")) {
		v0.push(v("C2-04", "summary 必须是 1..200 字符的单行非空字符串（安装器取其写入模块 manifest 的 desc）"));
	}
	if (m.description !== undefined && (typeof m.description !== "string" || m.description.length > 2000)) {
		v0.push(v("C2-05", "description 必须是字符串且 ≤2000 字符"));
	}
	if (m.icon !== undefined && (typeof m.icon !== "string" || m.icon.length > 500 || !/^(?:https?:\/\/|\/)/.test(m.icon))) {
		v0.push(v("C2-06", `icon「${String(m.icon)}」必须是字符串（≤500，^https?:// 或 / 开头的绝对路径）`));
	}
	if (m.author !== undefined && typeof m.author !== "string") {
		v0.push(v("C2-07", "author 必须是字符串"));
	}
	if (m.license !== undefined && (typeof m.license !== "string" || !/^[A-Z0-9.\-+ ]{1,64}$/i.test(m.license))) {
		v0.push(v("C2-07", `license「${String(m.license)}」必须匹配 ^[A-Za-z0-9.\\-+ ]{1,64}$（SPDX 简化式）`));
	}
	if (m.homepage !== undefined && (typeof m.homepage !== "string" || !/^https?:\/\//.test(m.homepage))) {
		v0.push(v("C2-07", `homepage「${String(m.homepage)}」必须以 http(s):// 开头`));
	}
	if (m.keywords !== undefined) {
		const ks = m.keywords;
		if (!Array.isArray(ks) || ks.length > 10 || !ks.every(x => typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x))) {
			v0.push(v("C2-07", "keywords 每项必须匹配 ^[a-z0-9-]{1,32}$ 且总数 ≤10"));
		}
	}
	const changelog = m.changelog;
	if (typeof changelog === "string") {
		if (changelog.trim() === "" || changelog.length > 2000)
			v0.push(v("C2-08", "changelog 字符串形态必须非空且 ≤2000 字符"));
	}
	else if (Array.isArray(changelog)) {
		if (changelog.length > 50 || !changelog.every(x => typeof x === "string" && x.trim() !== "" && x.length <= 500))
			v0.push(v("C2-08", "changelog 数组形态必须 ≤50 条且每条非空 ≤500 字符"));
	}
	else {
		v0.push(v("C2-08", "changelog 必填（R27 市场卡片版本对比）：非空字符串或字符串数组"));
	}

	// ── C2-09/10/11 peer 四字段：范围算子语法（P1 语义集；peerRuntime 安装期另对宿主强制比对）──
	for (const [key, clause] of [["peerRuntime", "C2-09"], ["peerOj", "C2-10"], ["peerFramework", "C2-10"], ["peerPlatform", "C2-11"]] as const) {
		const val = m[key];
		if (val === undefined)
			continue;
		if (typeof val !== "string" || rangeProblem(val) !== null) {
			v0.push(v(clause, `${key}「${String(val)}」不符合范围算子语法 ^(>=|<=|>|<|^|=)?<version>（version 遵守 C2-02；P1 语义集 = 精确/=、>=、^）`));
		}
	}

	// ── api 段（C2-12/12a/12b/13/26）──
	let apiSeg = name;
	if (m.api !== undefined) {
		const api = m.api;
		if (!isObj(api)) {
			v0.push(v("C2-12", "api 段必须是键值对象"));
		}
		else {
			if (api.module !== undefined && api.module !== name) {
				v0.push(v("C2-12", `api.module「${String(api.module)}」必须等于 name「${name}」`));
			}
			if (api.prefix !== undefined) {
				const p = api.prefix;
				if (typeof p !== "string" || !/^\/api\/[a-z][a-z0-9-]{0,63}$/.test(p)) {
					v0.push(v("C2-13", `api.prefix「${String(p)}」必须匹配 ^/api/[a-z][a-z0-9-]{0,63}$（缺省 /api/<name>）`));
				}
				else {
					apiSeg = p.slice("/api/".length);
					if (RESERVED_NAMES.has(apiSeg)) {
						v0.push(v("C2-13", `api.prefix 模块段「${apiSeg}」是保留名（§4.2），禁用`));
					}
				}
			}
			if (api.tables !== undefined) {
				const t = api.tables;
				if (!Array.isArray(t) || !t.every(x => typeof x === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(x))) {
					v0.push(v("C2-12a", "api.tables 每项必须匹配 ^[a-z][a-z0-9_]{0,63}$ 的字符串（与 api/src/<name>/schema.yaml 表集逐一相等另行对照）"));
				}
			}
			if (api.deps !== undefined) {
				if (!isObj(api.deps)) {
					v0.push(v("C2-12b", "api.deps 必须是键值对象"));
				}
				else {
					for (const [k, val] of Object.entries(api.deps)) {
						if (k !== "_platform" && !NAME_RE.test(k)) {
							v0.push(v("C2-12b", `api.deps 键「${k}」必须匹配 C2-01 name 语法或为 _platform`));
						}
						if (typeof val !== "string" || rangeProblem(val) !== null) {
							v0.push(v("C2-12b", `api.deps["${k}"] 值「${String(val)}」不符合范围算子语法（§2.2；P1 语义集 = 精确/=、>=、^）`));
						}
					}
				}
			}
			// C2-26：anonymous ①语法 ②段内收敛（R8）③登录端点禁令 ④唯一
			if (api.anonymous !== undefined) {
				const list = api.anonymous;
				if (!Array.isArray(list) || !list.every(x => typeof x === "string")) {
					v0.push(v("C2-26", "api.anonymous 必须是字符串数组"));
				}
				else {
					const seen = new Set<string>();
					for (const a of list) {
						if (!ANONYMOUS_RE.test(a)) {
							v0.push(v("C2-26", `anonymous「${a}」不匹配相对路径语法 ^[a-z0-9][a-z0-9\\-_.]*(/[a-z0-9][a-z0-9\\-_.]*)*$（无前导斜杠/通配符；_system/_platform 段禁入）`));
							continue;
						}
						if (a.split("/")[0] !== apiSeg) {
							v0.push(v("C2-26", `anonymous「${a}」越段：首段必须 = 本方案段「${apiSeg}」（R8 段内收敛；_system/_platform 等保留段因此禁入）`));
						}
						if (LOGIN_ENDPOINT_RE.test(a)) {
							v0.push(v("C2-26", `anonymous「${a}」命中登录语义端点禁令（R8/S1 纵深防御：login/logout/token/session/signin/signup/auth）`));
						}
						if (seen.has(a)) {
							v0.push(v("C2-26", `anonymous「${a}」在本 manifest 内重复`));
						}
						seen.add(a);
					}
				}
			}
		}
	}

	// ── web 段（C2-14/27/28；integrity 重算比对属安装 deployWeb→smoke 段）──
	if (m.web !== undefined) {
		const web = m.web;
		if (!isObj(web)) {
			v0.push(v("C2-27", "web 段必须是键值对象"));
		}
		else {
			if (web.route_prefix !== undefined) {
				const rp = web.route_prefix;
				if (typeof rp !== "string" || !/^\/[a-z][a-z0-9-]{0,63}$/.test(rp)) {
					v0.push(v("C2-14", `web.route_prefix「${String(rp)}」必须匹配 ^/[a-z][a-z0-9-]{0,63}$（缺省 /<name>）`));
				}
				else if (RESERVED_NAMES.has(rp.slice(1))) {
					v0.push(v("C2-14", `web.route_prefix 首段「${rp.slice(1)}」是保留名（§4.2），禁用`));
				}
			}
			const base = `modules/${escapeRe(name)}/${escapeRe(version)}/[a-z0-9._/-]+`;
			if (typeof web.entry !== "string" || !new RegExp(`^${base}\\.js$`).test(web.entry)) {
				v0.push(v("C2-27", `web.entry「${String(web.entry)}」必须匹配 ^modules/${name}/${version}/…\\.js$（web 段存在时必填；版本段必须 === version；POSIX 分隔符）`));
			}
			if (web.css !== undefined) {
				const css = web.css;
				if (!Array.isArray(css) || !css.every(x => typeof x === "string" && new RegExp(`^${base}\\.css$`).test(x))) {
					v0.push(v("C2-27", `web.css 每项必须匹配 ^modules/${name}/${version}/…\\.css$（版本段 === version）`));
				}
			}
			if (web.integrity !== undefined && (typeof web.integrity !== "string" || !INTEGRITY_RE.test(web.integrity))) {
				v0.push(v("C2-28", `web.integrity「${String(web.integrity)}」必须匹配 ^sha384-[A-Za-z0-9+/]{64}$（构建器对 entry 产物计算写入；安装器重算比对，不一致拒装）`));
			}
		}
	}

	// ── C2-15 permissions：code 强制 <name>. 前缀 + title_key 必填 + 唯一 ──
	const permCodes = new Set<string>();
	if (m.permissions !== undefined) {
		const list = m.permissions;
		if (!Array.isArray(list)) {
			v0.push(v("C2-15", "permissions 必须是数组"));
		}
		else {
			const seen = new Set<string>();
			const codeRe = new RegExp(`^${escapeRe(name)}\\.[a-z0-9_]+(\\.[a-z0-9_]+)*$`);
			for (const p of list) {
				if (!isObj(p)) {
					v0.push(v("C2-15", "permissions 每项必须是键值对象"));
					continue;
				}
				const code = p.code;
				if (typeof code !== "string" || !codeRe.test(code)) {
					v0.push(v("C2-15", `permission code「${String(code)}」必须匹配 ^${name}\\.[a-z0-9_]+(\\.[a-z0-9_]+)*$（强制 <name>. 前缀）`));
				}
				const tk = p.title_key;
				if (typeof tk !== "string" || !nameKeyRe(name, "perm").test(tk)) {
					v0.push(v("C2-15", `permission「${String(code)}」title_key 必填且须匹配 ${name}:perm.*（i18n 命名空间）`));
				}
				if (typeof code === "string") {
					if (seen.has(code))
						v0.push(v("C2-15", `permission code「${code}」在本 manifest 内重复`));
					seen.add(code);
					permCodes.add(code);
				}
			}
		}
	}

	// ── C2-16 roles：<name>.<role> + title_key + permissions ⊆ permissions[].code（悬空双端拒绝）──
	if (m.roles !== undefined) {
		const list = m.roles;
		if (!Array.isArray(list)) {
			v0.push(v("C2-16", "roles 必须是数组"));
		}
		else {
			const seen = new Set<string>();
			const nameRe = new RegExp(`^${escapeRe(name)}\\.[a-z0-9-]{1,64}$`);
			for (const r of list) {
				if (!isObj(r)) {
					v0.push(v("C2-16", "roles 每项必须是键值对象"));
					continue;
				}
				const rn = r.name;
				if (typeof rn !== "string" || !nameRe.test(rn)) {
					v0.push(v("C2-16", `role name「${String(rn)}」必须匹配 ${name}.<role>（写入 sys_role.module=${name}）`));
				}
				const tk = r.title_key;
				if (typeof tk !== "string" || !nameKeyRe(name, "role").test(tk)) {
					v0.push(v("C2-16", `role「${String(rn)}」title_key 必填且须匹配 ${name}:role.*（i18n 命名空间）`));
				}
				const perms = r.permissions;
				if (!Array.isArray(perms) || !perms.every(x => typeof x === "string")) {
					v0.push(v("C2-16", `role「${String(rn)}」permissions 必须是字符串数组`));
				}
				else {
					for (const code of perms) {
						if (!permCodes.has(code)) {
							v0.push(v("C2-16", `role「${String(rn)}」引用了未声明的权限「${code}」（悬空引用：须先在 permissions[].code 声明）`));
						}
					}
				}
				if (typeof rn === "string") {
					if (seen.has(rn))
						v0.push(v("C2-16", `role name「${rn}」在本 manifest 内重复`));
					seen.add(rn);
				}
			}
		}
	}

	// ── C2-17~21 routes：三值/path/order/title_key/required_permission ──
	const routePaths: string[] = [];
	if (m.routes !== undefined) {
		const list = m.routes;
		if (!Array.isArray(list)) {
			v0.push(v("C2-17", "routes 必须是数组"));
		}
		else {
			const seen = new Set<string>();
			for (const r of list) {
				if (!isObj(r)) {
					v0.push(v("C2-17", "routes 每项必须是键值对象"));
					continue;
				}
				const cat = r.category;
				if (typeof cat !== "string" || !ROUTE_CATEGORIES.has(cat)) {
					v0.push(v("C2-17", `route「${String(r.path)}」category「${String(cat)}」必须是 main|admin|hidden（D4 三值；settings/personal 已废弃）`));
				}
				const path = r.path;
				if (typeof path !== "string" || !ROUTE_PATH_RE.test(path)) {
					v0.push(v("C2-17", `route path「${String(path)}」必须匹配 ^/[a-z][a-z0-9\\-_]*(/[a-z0-9\\-_]+)*$（首段首字符字母；无参数段/通配符/尾斜杠）`));
				}
				else {
					if (seen.has(path))
						v0.push(v("C2-17", `route path「${path}」在本 manifest 内重复`));
					seen.add(path);
					routePaths.push(path);
				}
				if (!Number.isInteger(r.order)) {
					v0.push(v("C2-17", `route「${String(path)}」order 必填整数（建议 ≥200，框架保留 <200 间隔带——越带仅构建期警告不阻断）`));
				}
				const tk = r.title_key;
				if (cat === "main" || cat === "admin") {
					if (typeof tk !== "string" || !nameKeyRe(name, "menu").test(tk)) {
						v0.push(v("C2-17", `route「${String(path)}」（${String(cat)}）title_key 必填且须匹配 ${name}:menu.*`));
					}
				}
				else if (tk !== undefined && (typeof tk !== "string" || !nameKeyRe(name, "menu").test(tk))) {
					v0.push(v("C2-25", `route「${String(path)}」（hidden）title_key 可省略，给出则须匹配 ${name}:menu.*`));
				}
				// C2-21：required_permission ∈ permissions[].code（R22：仅供后端深检比对，前端不下发）
				const rp = r.required_permission;
				if (rp !== undefined && (typeof rp !== "string" || !permCodes.has(rp))) {
					v0.push(v("C2-21", `route「${String(path)}」required_permission「${String(rp)}」未在 permissions[].code 声明（悬空引用）`));
				}
			}
		}
	}

	// ── C2-22~24 settings：组标识/label_key/items 非空 + 键所有权（R24）+ 类型枚举/enum options ──
	if (m.settings !== undefined) {
		const s = m.settings;
		if (!isObj(s) || !Array.isArray(s.groups)) {
			v0.push(v("C2-22", "settings.groups 必须是数组"));
		}
		else {
			const seenGroups = new Set<string>();
			const seenKeys = new Set<string>();
			const groupRe = /^[a-z][a-z0-9-]{0,63}$/;
			const keyRe = new RegExp(`^${escapeRe(name)}\\.[a-z0-9_-]+(\\.[a-z0-9_-]+)+$`);
			for (const g of s.groups) {
				if (!isObj(g)) {
					v0.push(v("C2-22", "settings.groups 每项必须是键值对象"));
					continue;
				}
				const gn = g.group;
				if (typeof gn !== "string" || !groupRe.test(gn)) {
					v0.push(v("C2-22", `设置组标识「${String(gn)}」必须匹配 ^[a-z][a-z0-9-]{0,63}$`));
				}
				else if (seenGroups.has(gn)) {
					v0.push(v("C2-22", `设置组「${gn}」在本 manifest 内重复（组标识 = sys_setting.group 值）`));
				}
				else {
					seenGroups.add(gn);
				}
				const glk = g.label_key;
				if (typeof glk !== "string" || !nameKeyRe(name, "settings.group").test(glk)) {
					v0.push(v("C2-22", `设置组「${String(gn)}」label_key 必填且须匹配 ${name}:settings.group.*（系统设置页组标题）`));
				}
				if (!Array.isArray(g.items) || g.items.length === 0) {
					v0.push(v("C2-22", `设置组「${String(gn)}」items 必须是非空数组`));
					continue;
				}
				for (const item of g.items) {
					if (!isObj(item)) {
						v0.push(v("C2-23", `设置组「${String(gn)}」items 每项必须是键值对象`));
						continue;
					}
					// C2-23（R24 键所有权）：moduleOf(key) === name——正则强制 <name>. 前缀即首段所有权
					const key = item.key;
					if (typeof key !== "string" || !keyRe.test(key)) {
						v0.push(v("C2-23", `设置键「${String(key)}」必须匹配 ^${name}\\.[a-z0-9_-]+(\\.[a-z0-9_-]+)+$（键所有权：moduleOf(key) === ${name}，R24）`));
					}
					else if (seenKeys.has(key)) {
						v0.push(v("C2-23", `设置键「${key}」在本 manifest 内重复`));
					}
					else {
						seenKeys.add(key);
					}
					const type = item.type;
					if (typeof type !== "string" || !SETTING_TYPES.has(type)) {
						v0.push(v("C2-24", `设置项「${String(key)}」type「${String(type)}」必须是 string|bool|int|float|enum|text`));
					}
					else if (type === "enum") {
						const opts = item.options;
						if (!Array.isArray(opts) || opts.length < 1 || !opts.every(x => typeof x === "string")) {
							v0.push(v("C2-24", `设置项「${String(key)}」type=enum 时 options 必填（string[] ≥1 项）`));
						}
					}
					if (item.default !== undefined && typeof item.default !== "string") {
						v0.push(v("C2-24", `设置项「${String(key)}」default 必须是字符串（值恒以字符串存 sys_setting.value）`));
					}
					if (item.secret !== undefined && typeof item.secret !== "boolean") {
						v0.push(v("C2-24", `设置项「${String(key)}」secret 必须是布尔（缺省 false；true 读取面掩码 ***）`));
					}
					const ilk = item.label_key;
					if (ilk !== undefined && (typeof ilk !== "string" || !nameKeyRe(name, "settings").test(ilk))) {
						v0.push(v("C2-24", `设置项「${String(key)}」label_key 须匹配 ${name}:settings.*`));
					}
				}
			}
		}
	}

	// ── C2-33 health：path 语法 + 存在于 routes[]（本方案路由或其子路径）──
	if (m.health !== undefined) {
		const h = m.health;
		if (typeof h !== "string" || !ROUTE_PATH_RE.test(h)) {
			v0.push(v("C2-33", `health「${String(h)}」必须匹配路由 path 语法 ^/[a-z][a-z0-9\\-_]*(/[a-z0-9\\-_]+)*$`));
		}
		else if (!routePaths.some(p => h === p || h.startsWith(`${p}/`))) {
			v0.push(v("C2-33", `health「${h}」必须是本方案路由或其子路径（routes[] 中存在 r 使 health === r.path 或以 r.path + "/" 开头）`));
		}
	}

	// ── C2-29 archive Form A：可整体省略或仅含 file；禁 sha256/size/signature（附录 B-2 自引用悖论）──
	if (m.archive !== undefined) {
		const a = m.archive;
		if (!isObj(a)) {
			v0.push(v("C2-29", "archive 必须是键值对象（Form A：tgz 内占位仅 file；Form B 由 publish 填充于 CDN manifests.yaml）"));
		}
		else {
			for (const banned of ["sha256", "size", "signature"]) {
				if (a[banned] !== undefined) {
					v0.push(v("C2-29", `archive.${banned} 在 tgz 内禁止携带（Form A 对 tgz 自身摘要不可自洽，附录 B-2；由 P3 publish 填充于 Form B）`));
				}
			}
			for (const k of Object.keys(a)) {
				if (k !== "file") {
					v0.push(v("C2-29", `archive 未知键「${k}」（Form A 仅允许 file）`));
				}
			}
			if (a.file !== undefined && (typeof a.file !== "string" || a.file !== `${name}-${version}.tgz`)) {
				v0.push(v("C2-29", `archive.file「${String(a.file)}」必须为 <name>-<version>.tgz（即 ${name}-${version}.tgz）`));
			}
		}
	}

	return v0;
}

/** 收集 manifest 引用的全部 i18n key（C2-25 locales 齐备检查的引用面；bundle.ts 以此判定 locales 文件是否必查） */
export function referencedI18nKeys(m: BundleManifest): string[] {
	const keys: string[] = [];
	const push = (x: unknown) => {
		if (typeof x === "string")
			keys.push(x);
	};
	for (const r of Array.isArray(m.routes) ? m.routes : []) {
		if (isObj(r))
			push(r.title_key);
	}
	for (const p of Array.isArray(m.permissions) ? m.permissions : []) {
		if (isObj(p))
			push(p.title_key);
	}
	for (const r of Array.isArray(m.roles) ? m.roles : []) {
		if (isObj(r))
			push(r.title_key);
	}
	if (isObj(m.settings) && Array.isArray(m.settings.groups)) {
		for (const g of m.settings.groups) {
			if (!isObj(g))
				continue;
			push(g.label_key);
			for (const item of Array.isArray(g.items) ? g.items : []) {
				if (isObj(item))
					push(item.label_key);
			}
		}
	}
	return keys;
}

/** 嵌套对象按点路径取值；嵌套未命中回退顶层扁平键（i18next 两态） */
function lookupKey(obj: Record<string, unknown>, nsKey: string): unknown {
	let cur: unknown = obj;
	for (const seg of nsKey.split(".")) {
		if (!isObj(cur))
			return undefined;
		cur = cur[seg];
	}
	return cur !== undefined ? cur : obj[nsKey];
}

/**
 * C2-25 locales 齐备（构建期缺 key fail-fast；安装期不重复校验文件内容）。
 * 入参为两份 locale 文件文本（fs 在调用方）；任何被引用 key 缺失/非字符串值即违规。
 */
export function checkLocalesComplete(m: unknown, zhText: string, enText: string): string[] {
	if (!isObj(m))
		return [v("C2-25", "manifest 不是键值对象，无法核对 locales 引用")];
	const locales: [string, Record<string, unknown> | null][] = [["zh-CN", parseJson(zhText)], ["en-US", parseJson(enText)]];
	const out: string[] = [];
	for (const key of referencedI18nKeys(m)) {
		const nsKey = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
		for (const [lang, tree] of locales) {
			if (tree === null) {
				out.push(v("C2-25", `${lang} locale 不是合法 JSON 对象，无法核对引用 key`));
				continue;
			}
			const val = lookupKey(tree, nsKey);
			if (typeof val !== "string" || val === "") {
				out.push(v("C2-25", `${lang} 缺少 manifest 引用的 key「${key}」（双语齐备，D4；构建期 fail-fast）`));
			}
		}
	}
	return out;
}

/**
 * C2-12a api.tables 与 `api/src/<name>/schema.yaml` 表集逐一相等（oj 冗余校验同源，不一致 fail-fast）。
 * 入参为 schema.yaml 文本（fs 在调用方）。
 */
export function checkTablesAgainstSchema(m: unknown, schemaYamlText: string): string[] {
	if (!isObj(m) || !isObj(m.api) || m.api.tables === undefined)
		return [];
	const declared = m.api.tables;
	if (!Array.isArray(declared))
		return []; // 语法违规归 validateContract（C2-12a 语法列），此处只对照表集
	let schemaTables: unknown;
	try {
		const doc = parse(schemaYamlText);
		schemaTables = isObj(doc) ? doc.tables : undefined;
	}
	catch {
		return [v("C2-12a", "schema.yaml 不是合法 YAML，无法对照 api.tables 表集")];
	}
	if (!isObj(schemaTables)) {
		return [v("C2-12a", "schema.yaml 缺 tables 映射，无法对照 api.tables 表集（oj 冗余校验同源）")];
	}
	const schemaKeys = new Set(Object.keys(schemaTables));
	const declaredKeys = new Set(declared.filter(x => typeof x === "string"));
	const out: string[] = [];
	const missingInSchema = [...declaredKeys].filter(k => !schemaKeys.has(k));
	const undeclaredInManifest = [...schemaKeys].filter(k => !declaredKeys.has(k));
	if (missingInSchema.length > 0) {
		out.push(v("C2-12a", `api.tables 声明了 schema.yaml 不存在的表：${missingInSchema.join("、")}（表集须逐一相等，oj 冗余校验同源）`));
	}
	if (undeclaredInManifest.length > 0) {
		out.push(v("C2-12a", `schema.yaml 存在 api.tables 未声明的表：${undeclaredInManifest.join("、")}（表集须逐一相等，oj 冗余校验同源）`));
	}
	return out;
}

function parseJson(text: string): Record<string, unknown> | null {
	try {
		const p = JSON.parse(text);
		return isObj(p) ? p : null;
	}
	catch {
		return null;
	}
}
