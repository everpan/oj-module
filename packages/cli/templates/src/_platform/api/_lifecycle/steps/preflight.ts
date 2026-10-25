// 安装预检（P1-5，R7/R8/R9/R24）：十阶段安装状态机的 stage 1——manifest.yaml 契约安全预检。
// 规则真源：docs/prd/solution/202610171254-lifecycle-manifest-contract.md §2/§4（C2-01~33 安装列）；
// 期望真源：packages/cli/src/lifecycle/__tests__/fixtures/（fixture-valid 零违规 / fixture-invalid 七码齐报）。
// 实现纪律（契约 §0）：收集全部违规后统一报出，不首条即停——否则夹具断言集被截断。
// 纯校验段：只读 ctx（state 仅 read），不写盘不写库；占用检测真源 = state.solutions 键（已装方案名）。
// 双端 DRY 于夹具而非运行时：本实现与 Node 侧 validateContract（P1-11）由同一组夹具钉住一致性。

import type { InstallContext } from "../types";
import { compareVersions } from "../semver";

/**
 * 安装上下文（P1-10 收敛进 types.ts 单源；本模块 re-export 保持既有 `from "./preflight"` 引用面不变）。
 */
export type { InstallContext };

/** 阶段结果（各安装段通用形状，本段 stage 恒为 "preflight"；P1-10 收敛时提升为可判别联合） */
export interface StageResult {
	stage: "preflight"
	ok: boolean
	message: string
	retryable?: boolean
	/** 终止态错误码（安装器据此置 task.error.reason）；保留名命中恒 reserved_name */
	code?: string
}

interface Violation {
	clause: string
	detail: string
	/** 终止态错误码（安装器据此置 task.error.reason）；保留名命中恒 reserved_name */
	code?: string
}

// ── 契约 §2/§4 正则与清单（与契约现行文本逐字对应，改动须先改契约再同步夹具与双端实现）──

/** C2-01：name 白名单 */
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

/** §4.2 保留名清单（C2-01/13/14 共用；market 经 R9 恢复保留）。REG-CS7 扩项：oj/ojm/registry 一并保留 */
const RESERVED_NAMES = new Set(["_platform", "system", "auth", "market", "framework", "health", "plugins", "_system", "oj", "ojm", "registry"]);

/** 保留名替代建议（REG-CS7：给可落地的 kebab-case 候选，而非只说「非法」；两候选恒非保留名） */
function reservedNameSuggestions(name: string): [string, string] {
	return [`${name}-app`, `meta-${name}`];
}

/** C2-02 字符集：[0-9A-Za-z.-]（禁 +——oj validate_version 拒装，附录 B-1；禁 _——契约收紧） */
const VERSION_CHARS_RE = /^[0-9A-Z.-]+$/i;

/** §2.2 范围算子语法（peerRuntime/api.deps 值共用）；P1 语义实现集 = 精确（裸/=）、>=、^ */
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

/** C2-02 语义检查：字符集 + 无连续点 + 首尾非点 + 主版本段为数字（字母仅限 - 后的 prerelease）。返回违规描述，合法返回 null */
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

/** §2.2 范围算子语法检查（仅语法，不判满足性）。返回违规描述，合法返回 null */
function rangeProblem(range: string): string | null {
	const m = RANGE_RE.exec(range);
	if (m === null) {
		return "不符合范围算子语法 ^(>=|<=|>|<|^|=)?<version>（version 遵守 C2-02）";
	}
	return versionProblem(m[2]);
}

/** §2.2 P1 语义集求值：精确（裸/=）、>=、^（标准 semver caret，0.x 下 minor 必须相等） */
function rangeSatisfies(host: string, op: string | undefined, base: string): boolean {
	const c = compareVersions(host, base);
	if (op === undefined || op === "=") {
		return c === 0;
	}
	if (op === ">=") {
		return c >= 0;
	}
	// ^：标准 semver caret（见 caretSatisfies）——0.x 口径：^0.1.0 仅匹配 0.1.*，^0.2.0 不兼容 0.1.x
	return caretSatisfies(host, base);
}

/** 取版本核心段 [major, minor, patch]（缺段补 0；prerelease 截断不参与比对）。非法返回 null。 */
function coreParts(v: string): [number, number, number] | null {
	const core = v.split("-")[0];
	if (!/^\d+(?:\.\d+)*$/.test(core)) {
		return null;
	}
	const parts = core.split(".").map(Number);
	while (parts.length < 3) {
		parts.push(0);
	}
	return [parts[0], parts[1], parts[2]];
}

/**
 * semver caret 求值（P2-9 钉 0.x 口径）：
 * - ^x.y.z（x>0）：x 同主版本且 ≥ 基线（即 x.*.*）
 * - ^0.y.z（y>0）：主版本 0 且 minor == y 且 ≥ 基线（即 0.y.*）
 * - ^0.0.z：仅 0.0.z 本身（prerelease 截断，不参与比对）
 */
function caretSatisfies(host: string, base: string): boolean {
	const h = coreParts(host);
	const b = coreParts(base);
	if (h === null || b === null) {
		return false;
	}
	const [hm, hi, hp] = h;
	const [bm, bi, bp] = b;
	if (bm > 0) {
		return hm === bm && (hi > bi || (hi === bi && hp >= bp));
	}
	if (bi > 0) {
		return hm === 0 && hi === bi && hp >= bp;
	}
	// 0.0.z
	return hm === 0 && hi === 0 && hp === bp;
}

/**
 * 升版反噬（红队 F4）的专属迁移提示：`host 0.2.x` + 声明 `^0.1.x`。
 *
 * 0.x 的 caret 语义是「minor 必须相等」（见 caretSatisfies），所以平台小版本一升，
 * 所有声明 `^0.1.0` 的存量包**同时**装不上。这不是包写错了，是升级带来的兼容断点——
 * 笼统回「不满足 peerPlatform」会把发布方引向「升方案版本」「改代码」两个错方向，
 * 真正要改的只有这一行 range。
 *
 * 只对 0.x 给建议：`^1.0.0` 在 2.0.0 宿主上不满足是标准的语义化版本预期，没有迁移可言。
 */
function caretUpgradeAdvice(host: string, op: string | undefined, base: string): string | null {
	if (op !== "^")
		return null;
	const h = coreParts(host);
	const b = coreParts(base);
	if (h === null || b === null)
		return null;
	if (h[0] !== 0 || b[0] !== 0 || h[1] <= b[1])
		return null;
	return `这是平台小版本升级带来的兼容断点（0.x 下 ^ 只匹配同 minor：^${coreOf(base)} 等价于 ${coreOf(base).split(".")[0]}.${b[1]}.*），不是本方案的问题。请把 peerPlatform 改成「>=${coreOf(base)}」后重新打包——这一条要改的是声明，不是代码`;
}

/** 版本核心段文本（`0.1.0-rc.1` → `0.1.0`；cit：提示文案里只出现核心段，别把 prerelease 带进去） */
function coreOf(v: string): string {
	const [major, minor, patch] = coreParts(v) ?? [0, 0, 0];
	return `${major}.${minor}.${patch}`;
}

export async function preflight(ctx: InstallContext): Promise<StageResult> {
	const v: Violation[] = [];
	const m = ctx.manifest;
	if (!isObj(m)) {
		return report([{ clause: "C2", detail: `manifest 不是键值对象（实为 ${m === null ? "null" : Array.isArray(m) ? "数组" : typeof m}），无法预检` }]);
	}

	// 身份兜底：manifest 字段缺失/非字符串时退回 ctx 身份（占用/命名空间规则仍可继续，违规照报）
	const name = typeof m.name === "string" ? m.name : ctx.name;
	const version = typeof m.version === "string" ? m.version : ctx.version;
	const installed = ctx.state.read().solutions;
	const occupier = (key: string): string | undefined => {
		const e = installed[key];
		return e === undefined ? undefined : `${key}@${e.version}`;
	};

	// ── C2-01 身份 name：白名单 + 保留名（§4.2，market 经 R9 恢复保留）──
	if (typeof m.name !== "string" || !NAME_RE.test(m.name)) {
		v.push({ clause: "C2-01", detail: `name「${String(m.name)}」不匹配 ^[a-z][a-z0-9-]{0,63}$（小写字母开头，仅小写字母/数字/连字符）` });
	}
	if (RESERVED_NAMES.has(name)) {
		const [a1, a2] = reservedNameSuggestions(name);
		v.push({ clause: "C2-01", code: "reserved_name", detail: `name「${name}」为保留名（§4.2：${[...RESERVED_NAMES].join("/")}），禁用于方案（R9）；替代名建议：${a1} / ${a2}` });
	}

	// ── C2-02 version：字符集 + oj 相容排除 ──
	if (typeof m.version !== "string") {
		v.push({ clause: "C2-02", detail: "version 必须是字符串" });
	}
	else {
		const p = versionProblem(m.version);
		if (p !== null) {
			v.push({ clause: "C2-02", detail: `version「${m.version}」${p}` });
		}
	}

	// ── C2-04 summary 非空（安装列仅此一项；安装器将其写入模块 manifest 的 desc）──
	if (typeof m.summary !== "string" || m.summary.trim() === "") {
		v.push({ clause: "C2-04", detail: "summary 必须是非空字符串（安装器取其写入模块 manifest 的 desc）" });
	}

	// ── 占用检测（C2-13/14 安装列）：方案名已被已装方案占用 → 拒装并报占用者 ──
	// （同名命中且 ctx.reinstall = 安装器升级/重装路径放行，AC-P1-3；缺省拒装保持 P1-5 钉面）
	const nameOcc = occupier(name);
	if (nameOcc !== undefined && ctx.reinstall !== true) {
		v.push({ clause: "C2-13/14", detail: `方案名已被已装方案「${nameOcc}」占用（同站方案名唯一；升级/重装经安装器 runInstall 路径，AC-P1-3）` });
	}

	// ── C2-09 peerRuntime：对宿主 versions.json 的 runtime 版本强制比对（安装预检强制）──
	if (m.peerRuntime !== undefined) {
		const range = typeof m.peerRuntime === "string" ? m.peerRuntime : "";
		const parsed = RANGE_RE.exec(range);
		if (parsed === null || versionProblem(parsed[2]) !== null) {
			v.push({ clause: "C2-09", detail: `peerRuntime「${String(m.peerRuntime)}」不符合范围算子语法 ^(>=|<=|>|<|^|=)?<version>（version 遵守 C2-02）` });
		}
		else if (parsed[1] === "<" || parsed[1] === "<=" || parsed[1] === ">") {
			v.push({ clause: "C2-09", detail: `peerRuntime「${range}」使用了暂不支持的范围算子（P1 语义集 = 精确/=、>=、^）` });
		}
		else {
			const host = ctx.hostVersions?.["@oj-module/runtime"];
			if (host === undefined) {
				v.push({ clause: "C2-09", detail: `无法读取宿主 runtime 版本（versions.json 缺失或无 @oj-module/runtime 键），peerRuntime「${range}」强制比对失败（fail-closed）` });
			}
			else if (!rangeSatisfies(host, parsed[1], parsed[2])) {
				v.push({ clause: "C2-09", detail: `宿主 runtime 版本 ${host} 不满足 peerRuntime 声明「${range}」（需升级宿主）` });
			}
		}
	}

	// ── C2-11 peerPlatform：对宿主平台编排面 API_VERSION 强制比对（P2-9 起安装预检强制，R23；与 peerRuntime 同算子集）──
	if (m.peerPlatform !== undefined) {
		const range = typeof m.peerPlatform === "string" ? m.peerPlatform : "";
		const parsed = RANGE_RE.exec(range);
		if (parsed === null || versionProblem(parsed[2]) !== null) {
			v.push({ clause: "C2-11", detail: `peerPlatform「${String(m.peerPlatform)}」不符合范围算子语法 ^(>=|<=|>|<|^|=)?<version>（version 遵守 C2-02）` });
		}
		else if (parsed[1] === "<" || parsed[1] === "<=" || parsed[1] === ">") {
			v.push({ clause: "C2-11", detail: `peerPlatform「${range}」使用了暂不支持的范围算子（P1 语义集 = 精确/=、>=、^）` });
		}
		else {
			const host = ctx.hostApiVersion;
			if (host === undefined) {
				v.push({ clause: "C2-11", detail: `无法读取宿主平台 API 版本（GET /api/_platform/market/meta 不可用或本仓 API_VERSION 未注入），peerPlatform「${range}」强制比对失败（fail-closed）` });
			}
			else if (!rangeSatisfies(host, parsed[1], parsed[2])) {
				const advice = caretUpgradeAdvice(host, parsed[1], parsed[2]);
				v.push({
					clause: "C2-11",
					detail: advice === null
						? `宿主平台 API 版本 ${host} 不满足 peerPlatform 声明「${range}」（需升级宿主平台模块）`
						: `宿主平台 API 版本 ${host} 不满足 peerPlatform 声明「${range}」。${advice}`,
				});
			}
		}
	}

	// ── api 段（C2-12/12a/12b/13/26）──
	// C2-26② 段内收敛的「本方案段」：api.prefix 缺省 = name
	let apiSeg = name;
	const api = m.api;
	if (api !== undefined) {
		if (!isObj(api)) {
			v.push({ clause: "C2-12", detail: "api 段必须是键值对象" });
		}
		else {
			// C2-12：api.module 存在时必须 === name
			if (api.module !== undefined && api.module !== name) {
				v.push({ clause: "C2-12", detail: `api.module「${String(api.module)}」必须等于 name「${name}」` });
			}
			// C2-13：prefix 语法 + 保留名 + 占用检测（报占用者）
			if (api.prefix !== undefined) {
				const p = api.prefix;
				if (typeof p !== "string" || !/^\/api\/[a-z][a-z0-9-]{0,63}$/.test(p)) {
					v.push({ clause: "C2-13", detail: `api.prefix「${String(p)}」必须匹配 ^/api/[a-z][a-z0-9-]{0,63}$` });
				}
				else {
					apiSeg = p.slice("/api/".length);
					if (RESERVED_NAMES.has(apiSeg)) {
						const [a1, a2] = reservedNameSuggestions(apiSeg);
						v.push({ clause: "C2-13", code: "reserved_name", detail: `api.prefix 模块段「${apiSeg}」为保留名（§4.2：${[...RESERVED_NAMES].join("/")}），禁用；替代名建议：${a1} / ${a2}` });
					}
					if (apiSeg !== name) {
						const occ = occupier(apiSeg);
						if (occ !== undefined) {
							v.push({ clause: "C2-13", detail: `api.prefix 模块段「${apiSeg}」已被已装方案「${occ}」占用` });
						}
					}
				}
			}
			// C2-12a：tables 语法（与 schema.yaml 的表集对照属构建期/oj 冗余校验，非本段）
			if (api.tables !== undefined) {
				const t = api.tables;
				if (!Array.isArray(t) || !t.every(x => typeof x === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(x))) {
					v.push({ clause: "C2-12a", detail: "api.tables 每项必须匹配 ^[a-z][a-z0-9_]{0,63}$ 的字符串" });
				}
			}
			// C2-12b：deps 键 = C2-01 语法或 _platform；值 = 范围算子语法（存在性由 oj serve S004 兜底）
			if (api.deps !== undefined) {
				if (!isObj(api.deps)) {
					v.push({ clause: "C2-12b", detail: "api.deps 必须是键值对象" });
				}
				else {
					for (const [k, val] of Object.entries(api.deps)) {
						if (k !== "_platform" && !NAME_RE.test(k)) {
							v.push({ clause: "C2-12b", detail: `api.deps 键「${k}」必须匹配 C2-01 name 语法或为 _platform` });
						}
						if (typeof val !== "string" || rangeProblem(val) !== null) {
							v.push({ clause: "C2-12b", detail: `api.deps["${k}"] 值「${String(val)}」不符合范围算子语法（§2.2）` });
						}
					}
				}
			}
			// C2-26：anonymous 语法①/段内收敛②（R8，_system/_platform 等保留段天然禁入）/登录端点禁令③/唯一④
			if (api.anonymous !== undefined) {
				const list = api.anonymous;
				if (!Array.isArray(list) || !list.every(x => typeof x === "string")) {
					v.push({ clause: "C2-26", detail: "api.anonymous 必须是字符串数组" });
				}
				else {
					const seen = new Set<string>();
					for (const a of list) {
						if (!ANONYMOUS_RE.test(a)) {
							v.push({ clause: "C2-26", detail: `anonymous「${a}」不匹配相对路径语法 ^[a-z0-9][a-z0-9\\-_.]*(/[a-z0-9][a-z0-9\\-_.]*)*$（无前导斜杠/通配符；_system/_platform 段禁入）` });
							continue;
						}
						if (a.split("/")[0] !== apiSeg) {
							v.push({ clause: "C2-26", detail: `anonymous「${a}」越段：首段必须 = 本方案段「${apiSeg}」（R8 段内收敛；_system/_platform 等保留段因此禁入）` });
						}
						if (LOGIN_ENDPOINT_RE.test(a)) {
							v.push({ clause: "C2-26", detail: `anonymous「${a}」命中登录语义端点禁令（R8/S1 纵深防御：login/logout/token/session/signin/signup/auth）` });
						}
						if (seen.has(a)) {
							v.push({ clause: "C2-26", detail: `anonymous「${a}」在本 manifest 内重复` });
						}
						seen.add(a);
					}
				}
			}
		}
	}

	// ── web 段（C2-27 语法；integrity 重算比对属 deployWeb→smoke 段，不在本段）──
	const web = m.web;
	if (web !== undefined) {
		if (!isObj(web)) {
			v.push({ clause: "C2-27", detail: "web 段必须是键值对象" });
		}
		else {
			// C2-14：route_prefix 语法 + 首段保留名 + 占用检测（缺省 = /<name>，合法免检）
			if (web.route_prefix !== undefined) {
				const rp = web.route_prefix;
				if (typeof rp !== "string" || !/^\/[a-z][a-z0-9-]{0,63}$/.test(rp)) {
					v.push({ clause: "C2-14", detail: `web.route_prefix「${String(rp)}」必须匹配 ^/[a-z][a-z0-9-]{0,63}$` });
				}
				else {
					const seg = rp.slice(1);
					if (RESERVED_NAMES.has(seg)) {
						const [a1, a2] = reservedNameSuggestions(seg);
						v.push({ clause: "C2-14", code: "reserved_name", detail: `web.route_prefix 首段「${seg}」为保留名（§4.2：${[...RESERVED_NAMES].join("/")}），禁用；替代名建议：${a1} / ${a2}` });
					}
					if (seg !== name) {
						const occ = occupier(seg);
						if (occ !== undefined) {
							v.push({ clause: "C2-14", detail: `web.route_prefix 首段「${seg}」已被已装方案「${occ}」占用` });
						}
					}
				}
			}
			const base = `modules/${escapeRe(name)}/${escapeRe(version)}/[a-z0-9._/-]+`;
			if (typeof web.entry !== "string" || !new RegExp(`^${base}\\.js$`).test(web.entry)) {
				v.push({ clause: "C2-27", detail: `web.entry「${String(web.entry)}」必须匹配 ^modules/${name}/${version}/…\\.js$（web 段存在时必填；版本段必须 === version；POSIX 分隔符）` });
			}
			if (web.css !== undefined) {
				const css = web.css;
				if (!Array.isArray(css) || !css.every(x => typeof x === "string" && new RegExp(`^${base}\\.css$`).test(x))) {
					v.push({ clause: "C2-27", detail: `web.css 每项必须匹配 ^modules/${name}/${version}/…\\.css$（版本段 === version）` });
				}
			}
		}
	}

	// ── C2-15 permissions：code 强制 <name>. 前缀（framework./system./market. 保留空间不可达）+ title_key 必填 + 唯一 ──
	const permCodes = new Set<string>();
	if (m.permissions !== undefined) {
		const list = m.permissions;
		if (!Array.isArray(list)) {
			v.push({ clause: "C2-15", detail: "permissions 必须是数组" });
		}
		else {
			const seen = new Set<string>();
			const codeRe = new RegExp(`^${escapeRe(name)}\\.[a-z0-9_]+(\\.[a-z0-9_]+)*$`);
			for (const p of list) {
				if (!isObj(p)) {
					v.push({ clause: "C2-15", detail: "permissions 每项必须是键值对象" });
					continue;
				}
				const code = p.code;
				if (typeof code !== "string" || !codeRe.test(code)) {
					v.push({ clause: "C2-15", detail: `permission code「${String(code)}」必须匹配 ^${name}\\.[a-z0-9_]+(\\.[a-z0-9_]+)*$（强制 <name>. 前缀）` });
				}
				const tk = p.title_key;
				if (typeof tk !== "string" || !nameKeyRe(name, "perm").test(tk)) {
					v.push({ clause: "C2-15", detail: `permission「${String(code)}」title_key 必填且须匹配 ${name}:perm.*（i18n 命名空间）` });
				}
				if (typeof code === "string") {
					if (seen.has(code)) {
						v.push({ clause: "C2-15", detail: `permission code「${code}」在本 manifest 内重复` });
					}
					seen.add(code);
					permCodes.add(code);
				}
			}
		}
	}

	// ── C2-16 roles：name <name>.<role> + title_key 必填 + permissions ⊆ permissions[].code（悬空双端拒绝）+ 唯一 ──
	if (m.roles !== undefined) {
		const list = m.roles;
		if (!Array.isArray(list)) {
			v.push({ clause: "C2-16", detail: "roles 必须是数组" });
		}
		else {
			const seen = new Set<string>();
			const nameRe = new RegExp(`^${escapeRe(name)}\\.[a-z0-9-]{1,64}$`);
			for (const r of list) {
				if (!isObj(r)) {
					v.push({ clause: "C2-16", detail: "roles 每项必须是键值对象" });
					continue;
				}
				const rn = r.name;
				if (typeof rn !== "string" || !nameRe.test(rn)) {
					v.push({ clause: "C2-16", detail: `role name「${String(rn)}」必须匹配 ${name}.<role>（写入 sys_role.module=${name}）` });
				}
				const tk = r.title_key;
				if (typeof tk !== "string" || !nameKeyRe(name, "role").test(tk)) {
					v.push({ clause: "C2-16", detail: `role「${String(rn)}」title_key 必填且须匹配 ${name}:role.*（i18n 命名空间）` });
				}
				const perms = r.permissions;
				if (!Array.isArray(perms) || !perms.every(x => typeof x === "string")) {
					v.push({ clause: "C2-16", detail: `role「${String(rn)}」permissions 必须是字符串数组` });
				}
				else {
					for (const code of perms) {
						if (!permCodes.has(code)) {
							v.push({ clause: "C2-16", detail: `role「${String(rn)}」引用了未声明的权限「${code}」（悬空引用：须先在 permissions[].code 声明）` });
						}
					}
				}
				if (typeof rn === "string") {
					if (seen.has(rn)) {
						v.push({ clause: "C2-16", detail: `role name「${rn}」在本 manifest 内重复` });
					}
					seen.add(rn);
				}
			}
		}
	}

	// ── C2-17~21 routes：category 三值 + path 语法/唯一 + order 必填 + title_key + required_permission ∈ permissions ──
	const routePaths: string[] = [];
	if (m.routes !== undefined) {
		const list = m.routes;
		if (!Array.isArray(list)) {
			v.push({ clause: "C2-17", detail: "routes 必须是数组" });
		}
		else {
			const seen = new Set<string>();
			for (const r of list) {
				if (!isObj(r)) {
					v.push({ clause: "C2-17", detail: "routes 每项必须是键值对象" });
					continue;
				}
				const cat = r.category;
				if (typeof cat !== "string" || !ROUTE_CATEGORIES.has(cat)) {
					v.push({ clause: "C2-17", detail: `route「${String(r.path)}」category「${String(cat)}」必须是 main|admin|hidden（D4 三值；settings/personal 已废弃）` });
				}
				const path = r.path;
				if (typeof path !== "string" || !ROUTE_PATH_RE.test(path)) {
					v.push({ clause: "C2-17", detail: `route path「${String(path)}」必须匹配 ^/[a-z][a-z0-9\\-_]*(/[a-z0-9\\-_]+)*$（首段首字符字母；无参数段/通配符/尾斜杠）` });
				}
				else {
					if (seen.has(path)) {
						v.push({ clause: "C2-17", detail: `route path「${path}」在本 manifest 内重复` });
					}
					seen.add(path);
					routePaths.push(path);
				}
				if (!Number.isInteger(r.order)) {
					v.push({ clause: "C2-17", detail: `route「${String(path)}」order 必填整数（建议 ≥200，框架保留 <200 间隔带）` });
				}
				const tk = r.title_key;
				if (cat === "main" || cat === "admin") {
					if (typeof tk !== "string" || !nameKeyRe(name, "menu").test(tk)) {
						v.push({ clause: "C2-17", detail: `route「${String(path)}」（${String(cat)}）title_key 必填且须匹配 ${name}:menu.*` });
					}
				}
				else if (tk !== undefined && (typeof tk !== "string" || !nameKeyRe(name, "menu").test(tk))) {
					v.push({ clause: "C2-25", detail: `route「${String(path)}」（hidden）title_key 可省略，给出则须匹配 ${name}:menu.*` });
				}
				// C2-21：required_permission ∈ permissions[].code（R22：仅供后端深检比对，前端不下发）
				const rp = r.required_permission;
				if (rp !== undefined && (typeof rp !== "string" || !permCodes.has(rp))) {
					v.push({ clause: "C2-21", detail: `route「${String(path)}」required_permission「${String(rp)}」未在 permissions[].code 声明（悬空引用）` });
				}
			}
		}
	}

	// ── C2-22~24 settings：组标识/label_key/items 非空 + 键所有权（R24）+ 类型枚举/enum options ──
	if (m.settings !== undefined) {
		const s = m.settings;
		if (!isObj(s) || !Array.isArray(s.groups)) {
			v.push({ clause: "C2-22", detail: "settings.groups 必须是数组" });
		}
		else {
			const seenGroups = new Set<string>();
			const seenKeys = new Set<string>();
			const groupRe = /^[a-z][a-z0-9-]{0,63}$/;
			const keyRe = new RegExp(`^${escapeRe(name)}\\.[a-z0-9_-]+(\\.[a-z0-9_-]+)+$`);
			for (const g of s.groups) {
				if (!isObj(g)) {
					v.push({ clause: "C2-22", detail: "settings.groups 每项必须是键值对象" });
					continue;
				}
				const gn = g.group;
				if (typeof gn !== "string" || !groupRe.test(gn)) {
					v.push({ clause: "C2-22", detail: `设置组标识「${String(gn)}」必须匹配 ^[a-z][a-z0-9-]{0,63}$` });
				}
				else if (seenGroups.has(gn)) {
					v.push({ clause: "C2-22", detail: `设置组「${gn}」在本 manifest 内重复（组标识 = sys_setting.group 值）` });
				}
				else {
					seenGroups.add(gn);
				}
				// C2-22：组 label_key 必填，指向 <name>:settings.group.*
				const glk = g.label_key;
				if (typeof glk !== "string" || !nameKeyRe(name, "settings.group").test(glk)) {
					v.push({ clause: "C2-22", detail: `设置组「${String(gn)}」label_key 必填且须匹配 ${name}:settings.group.*（系统设置页组标题）` });
				}
				if (!Array.isArray(g.items) || g.items.length === 0) {
					v.push({ clause: "C2-22", detail: `设置组「${String(gn)}」items 必须是非空数组` });
					continue;
				}
				for (const item of g.items) {
					if (!isObj(item)) {
						v.push({ clause: "C2-23", detail: `设置组「${String(gn)}」items 每项必须是键值对象` });
						continue;
					}
					// C2-23（R24 键所有权）：moduleOf(key) === name——正则强制 <name>. 前缀即首段所有权，
					// framework.*/system.*/market.* 等越空间污染由此拒绝；键写入 sys_setting.key
					const key = item.key;
					if (typeof key !== "string" || !keyRe.test(key)) {
						v.push({ clause: "C2-23", detail: `设置键「${String(key)}」必须匹配 ^${name}\\.[a-z0-9_-]+(\\.[a-z0-9_-]+)+$（键所有权：moduleOf(key) === ${name}，R24）` });
					}
					else if (seenKeys.has(key)) {
						v.push({ clause: "C2-23", detail: `设置键「${key}」在本 manifest 内重复` });
					}
					else {
						seenKeys.add(key);
					}
					const type = item.type;
					if (typeof type !== "string" || !SETTING_TYPES.has(type)) {
						v.push({ clause: "C2-24", detail: `设置项「${String(key)}」type「${String(type)}」必须是 string|bool|int|float|enum|text` });
					}
					else if (type === "enum") {
						const opts = item.options;
						if (!Array.isArray(opts) || opts.length < 1 || !opts.every(x => typeof x === "string")) {
							v.push({ clause: "C2-24", detail: `设置项「${String(key)}」type=enum 时 options 必填（string[] ≥1 项）` });
						}
					}
					const ilk = item.label_key;
					if (ilk !== undefined && (typeof ilk !== "string" || !nameKeyRe(name, "settings").test(ilk))) {
						v.push({ clause: "C2-24", detail: `设置项「${String(key)}」label_key 须匹配 ${name}:settings.*` });
					}
				}
			}
		}
	}

	// ── C2-33 health：值 = C2-17 path 语法 + 存在 r ∈ routes 使值 === r.path 或以 r.path + "/" 开头 ──
	if (m.health !== undefined) {
		const h = m.health;
		if (typeof h !== "string" || !ROUTE_PATH_RE.test(h)) {
			v.push({ clause: "C2-33", detail: `health「${String(h)}」必须匹配路由 path 语法 ^/[a-z][a-z0-9\\-_]*(/[a-z0-9\\-_]+)*$` });
		}
		else if (!routePaths.some(p => h === p || h.startsWith(`${p}/`))) {
			v.push({ clause: "C2-33", detail: `health「${h}」必须是本方案路由或其子路径（routes[] 中存在 r 使 health === r.path 或以 r.path + "/" 开头）` });
		}
	}

	return report(v);
}

/** 收集全部违规后统一报出（契约 §0 实现纪律）；失败一律 retryable=false（附录 A preflight 行） */
function report(v: Violation[]): StageResult {
	if (v.length === 0) {
		return { stage: "preflight", ok: true, message: "预检通过：manifest 满足 C2 契约（身份/兼容/占用/匿名/RBAC/路由/设置/health 安全预检全部通过）" };
	}
	// 保留名命中（reserved_name）优先作为终止态错误码（红队 F5：撞保留名是确定性拒绝，非可重试）
	const coded = v.find(x => x.code !== undefined);
	return {
		stage: "preflight",
		ok: false,
		retryable: false,
		code: coded?.code,
		message: `预检未通过（${v.length} 项违规，全量列出）：\n${v.map(x => `- 【${x.clause}】${x.detail}`).join("\n")}`,
	};
}
