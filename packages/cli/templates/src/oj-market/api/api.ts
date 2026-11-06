// 编排端点 + 市场目录（P1-12，R9/ISP；v4 §四：市场域 api 自 _platform 迁入本模块）：/api/oj-market/*
// 端点族同文件嵌套 handler 组（oj v0.1.64 组形态，notification/api.ts 同款；组名 = 路径段）。
// 门（R9）：install/task/index 全 assertSuperAdmin 独占（市场页是「市场即样例」的第一方特权
// 例外，R29；权限码不构成门）；meta 登录即可（peerPlatform 预检先于判权）。
// 职责边界（ISP）：端点只做 门禁 + 目录解析（安装器不拼 URL，installer.ts 同纪律）+
// InstallRequest 组装；任务生命周期/失败三分/终态审计全归 runInstall 状态机（P1-10），端点不重复编排。
// 目录真源 = market_release 表（DB 目录化 v4；签名索引机制整建制退役）——install 解析/index
// 卡片/releases 历史全部直读 DB 合成 Form B 形状，包字节仍从 CDN 基址静态拉。
// CDN 基址：sys_setting `framework.market_cdn_url`（PRD §5.3，缺省空 = 市场不可用，可读错误不崩）。
// 站点路径缺省（marketEnv）：oj serve release 布局生产口径（P1-16 接线 B3/B4）——共享根 = serve
// 挂载根 dist（锁 dist/manifests.yaml、版本目录 dist/<name>-<ver>/、versions.json 同根），
// 暂存/任务/sidecar 留 dist 外（R13 不与装配树冲突）；全字段可注入覆盖（测试 stub 同款）。
// file 源上传形态：照 personal-center/upload/api.ts 先例（http.files 双路径，大文件走 blob）；
// 上传包先过 R1 三步范式（list→validate→extract）取出 manifest.yaml 供 preflight——
// 未校验不解包，zip-slip 在信任边界外被拒。
import type { FetchFace } from "#/_platform/_lifecycle/steps/download";
import type { ExecFace } from "#/_platform/_lifecycle/steps/extract";
import type { ReloadFace } from "#/_platform/_lifecycle/steps/reload";
import type { FetchInitFace } from "#/_platform/_shared/site-facade";
import { atomicWriteText, fsFace } from "#/_platform/_lifecycle/atomic";
import { recordHistory } from "#/_platform/_lifecycle/history";
import { latestAppliedSeqOf, reconcile, runInstall, setEnabled } from "#/_platform/_lifecycle/installer";
import { manifestOfUpload as sharedManifestOfUpload } from "#/_platform/_lifecycle/manifest-of-upload";
import { compareVersions } from "#/_platform/_lifecycle/semver";
import { sha384B64 } from "#/_platform/_lifecycle/sha384";
import { createStateStore } from "#/_platform/_lifecycle/state";
import { getTask, readTasks } from "#/_platform/_lifecycle/tasks";
import { createTrustStore } from "#/_platform/_lifecycle/trust";
import { computeUninstallImpact, runUninstall } from "#/_platform/_lifecycle/uninstall";
import { respond } from "#/_platform/_shared/respond";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
import { pageArgs } from "#/_platform/_shared/service/infra/query";
import { journalHeadOf, readCanonicalOrigin, readSiteVar, siteOrigin, withSiteOrigin } from "#/_platform/_shared/site-facade";
import { backfillReleases } from "./backfill";
import { BOOTSTRAP_KEY, seedBootstrapKey } from "./bootstrap";
import { authenticateSignedKey, verifyCanonicalSig } from "./cdn/signed-auth";

// 站点编排面共享真源落 _shared/site-facade（P2-16 真机构建钉出：api.ts 是路由入口不可被模块内
// import）；此处 re-export 保持既有引用面（market-api.spec / 历史 import 路径）不变。
export { journalHeadOf, siteOrigin, withSiteOrigin };
export type { FetchInitFace };

/** 平台编排面版本（镜像 _platform/manifest.yaml version；peerPlatform 预检口径，manifest 升版须同步） */
const API_VERSION = "0.1.0";

/** 目录协议版本（v4 §三：api_version 给契约演进留逃生门；跨站消费侧据此判可解析性） */
const CATALOG_API_VERSION = "v1";

export interface MarketEnv {
	/** 共享根（manifests.yaml 所在目录 = 版本目录父级，D3 单 mount 形态） */
	sharedRoot: string
	/** 暂存目录（.staging） */
	staging: string
	/** 任务状态目录（.install-tasks） */
	taskDir: string
	/** sidecar 状态文件（.solutions/state.yaml） */
	statePath: string
	/** 宿主信任库（.solutions/trusted-keys.yaml；P2-2；U6/P3-1 起移出 modules/ 安装子树，落 deploy 根，仅 _platform 特权经 platform.trusted_paths 可写） */
	trustPath: string
	/** sqlite 库文件路径（R14 备份源；模板 config.yaml `sqlite://db.sqlite` → 站点根 db.sqlite） */
	dbPath: string
	/** 站点 web 模块目录（站点产物根下的 modules/） */
	siteModulesDir: string
	/** 站点 modules.json 路径（与 siteModulesDir 同属站点产物根） */
	modulesJsonPath: string
	/** API 前缀（smoke 探针 URL 前缀） */
	apiPrefix: string
	/** 站点 config.yaml 路径（reloading 段 anonymous_paths 接线落盘处；缺省 config.yaml） */
	configPath?: string
	/** canonical origin（REG-CS6：相对 URL 补全用，取自 config.yaml vars.canonical_origin，绝不读请求头 Host） */
	canonicalOrigin?: string
	/** CDN 基址（缺省读 sys_setting `framework.market_cdn_url`；测试注入） */
	cdnBase?: () => Promise<string | null>
	/** cdn/ 字节仓库目录（上传端点与回填命令共用；缺省 "cdn"） */
	cdnDir?: string
	/** 注入面（DIP）：缺省回落 isolate 全局 fetch / exec.run / server.reloadConfig / 本地 sha384（过渡实现） */
	fetch?: FetchFace
	exec?: ExecFace
	reload?: ReloadFace
	sha384B64?: (data: Uint8Array) => string
	/** sha256 摘要面（verifying 段；缺省回落运行时全局，同 verify.ts） */
	sha256Hex?: (data: Uint8Array) => string
	/** Ed25519 验签面（P2-3；缺省回落运行时全局 crypto.verifyEd25519，同 verify.ts；测试注入） */
	verifyEd25519?: (publicKey: string, msg: string, sigBase64: string) => boolean
	/** 第一方 bootstrap key 覆盖（P2-12 测试注入；缺省回落 bootstrap.ts 内置常量，发布时回填） */
	bootstrapKey?: { key_id: string, public_key: string } | null
	/** 迁移账本 head（缺省 null = 跳过禁降版判定，同 installer） */
	ledgerHead?: number | bigint | null
	/** 迁移账本 head 真源（P1-16 接线①：缺省读 oj journal 表 `_oj_migrations` max(version)，查询失败 → null 不猜） */
	ledgerHeadOf?: (name: string) => Promise<number | bigint | null>
	/** 当前时刻（epoch 秒；REG-CS2 索引时效判定基准，测试注入；缺省 Date.now） */
	now?: () => number
	/**
	 * 宿主 versions.json（C2-09 peerRuntime 比对真源，键 = 包名）。缺省读 `<sharedRoot>/versions.json`
	 * （ojm 宿主构建产物：与 manifests.yaml 同层，即 release 根，B-11 接线）；不可得 → undefined，
	 * manifest 声明 peerRuntime 即预检 fail-closed 拒装（C2-09 语义保持）。
	 */
	hostVersions?: Record<string, string>
	/** 本站点（registry）身份（REG-CS3 v2 防跨仓库重放）：安装验签时与 .sig.registry_id 比对 */
	registryId?: string
}

/**
 * 宿主 versions.json 布局推导（B-11）：与 manifests.yaml 同层（release 根 = `sharedRoot`），
 * 不是站点产物根——两处根在 `src/<name>/{api,web}` 布局下已分流（`dist/api` vs `dist/web`）。
 */
export function versionsJsonPathOf(releaseRoot: string): string {
	const trimmed = releaseRoot.replace(/\/+$/, "");
	return trimmed === "" ? "versions.json" : `${trimmed}/versions.json`;
}

/** 宿主 versions.json 解析（纯函数）：{packageName: version} 全字符串表；任何违约 → undefined（fail-closed 不猜） */
export function parseVersionsJson(text: string): Record<string, string> | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	}
	catch {
		return undefined;
	}
	if (!isObj(raw)) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v !== "string") {
			return undefined;
		}
		out[k] = v;
	}
	return out;
}

/** hostVersions 注入缺省：显式注入优先，否则读 `<sharedRoot>/versions.json`；不可得 → undefined（C2-09 fail-closed） */
async function hostVersionsOf(env: MarketEnv): Promise<Record<string, string> | undefined> {
	if (env.hostVersions !== undefined) {
		return env.hostVersions;
	}
	try {
		return parseVersionsJson(new TextDecoder().decode(await fsFace().readFile(versionsJsonPathOf(env.sharedRoot))));
	}
	catch {
		return undefined;
	}
}

/**
 * oj serve release 布局生产缺省（P1-16 B3/B4；全字段可覆盖）。
 *
 * 两处根在 `src/<name>/{api,web}` 布局下分流（2026-10-22 起收进工程根 dist/），
 * 且都相对 fs jail 根（= config.yaml 所在目录）：
 *   release 根 `dist/api` —— 版本目录 / manifests.yaml / versions.json / migrations（后端产物）
 *   站点根   `dist/web`   —— modules/ + modules.json（前端产物，安装器 upsert 的落点）
 * 暂存 / 任务 / 状态 / 信任库 / db 仍在 jail 根下：它们是安装器私有面，不属任何产物根。
 */
export function marketEnv(): MarketEnv {
	return {
		sharedRoot: "dist/api",
		staging: "modules/.staging",
		taskDir: "modules/.install-tasks",
		statePath: "modules/.solutions/state.yaml",
		trustPath: ".solutions/trusted-keys.yaml",
		cdnDir: "cdn",
		dbPath: "db.sqlite",
		siteModulesDir: "dist/web/modules",
		modulesJsonPath: "dist/web/modules.json",
		apiPrefix: "/api",
		configPath: "config.yaml",
		ledgerHeadOf: journalHeadOf,
	};
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 带 status 的可读失败（respond 收口成 json.fail，与 D14/B5 同一通道） */
function fail(status: number, msg: string): never {
	throw Object.assign(new Error(msg), { status });
}

/**
 * canonical origin 惰性解析（REG-CS6）：env.canonicalOrigin 若已由测试/部署注入则直接用，
 * 否则读 config.yaml `vars.canonical_origin`（异步，隔离环境只有异步读盘面）。解析失败/缺省 → undefined
 * （withSiteOrigin = 不补全、相对 URL 原样透传，fail-closed 不回落请求头）。
 */
async function resolveCanonicalOrigin(env: MarketEnv): Promise<string | undefined> {
	if (env.canonicalOrigin !== undefined) {
		return env.canonicalOrigin;
	}
	if (!env.configPath) {
		return undefined;
	}
	return (await readCanonicalOrigin(env.configPath)) ?? undefined;
}

async function fetchOf(env: MarketEnv): Promise<FetchInitFace> {
	// 相对基址（feature：/cdn = 本站点自供）按配置的 canonical origin 补全同源绝对 URL；绝对 http(s) 直通。
	// REG-CS6：绝不读请求头 Host/x-forwarded-proto——伪造 Host 不能牵引出站。无 canonical origin 则不补全
	// （相对 URL 原样透传，由下层 fetch 判不可用），fail-closed 而非回落请求头。
	const co = await resolveCanonicalOrigin(env);
	return withSiteOrigin(env.fetch ?? (globalThis as { fetch?: FetchInitFace }).fetch as FetchInitFace, co);
}

/**
 * REG-CS6：安装需 canonical origin——① 相对市场基址（`market_cdn_url=/cdn` 本站点自供）要补全为
 * 同源绝对 URL；② 冒烟探针 URL 恒为站点相对路径（`/api/<模块>/<路由>`，isolate fetch 无同源 base，
 * 相对恒 TypeError）。缺失/非法即明确报错并指向具体设置项（config.yaml `vars.canonical_origin`），
 * 绝不回落请求头 Host（伪造 Host 会牵引出站）。
 */
async function requireCanonicalOrigin(env: MarketEnv): Promise<string> {
	const co = await resolveCanonicalOrigin(env);
	if (co === undefined || siteOrigin(co) === null) {
		fail(503, "安装需要站点 canonical origin（相对市场基址「/cdn」自供需补全为同源绝对 URL，且冒烟探针 URL 恒为站点相对路径）：请在 config.yaml 配置 vars.canonical_origin（站点真实对外地址，如 https://your-site.example.com）。REG-CS6 不读请求头 Host（防伪造 Host 牵引出站），缺失即拒而非回落请求头");
	}
	return co;
}

function execOf(env: MarketEnv): ExecFace {
	const g = globalThis as { exec?: { run: ExecFace["run"] } };
	return env.exec ?? { run: (argv, opts) => g.exec!.run(argv, opts) };
}

function reloadOf(env: MarketEnv): ReloadFace {
	const g = globalThis as { server?: { reloadConfig: ReloadFace["reloadConfig"] } };
	// env 显式注入优先；其次平台 server.reloadConfig（生产 oj 提供，oj 0.1.123+ 支持 force 透传）；
	// 均缺失（dev/test 无 server）回落 no-op——等价于「不 reload」，保持卸载旧语义（reload 实际掉
	// 挂载依赖 US-1 上游 manifests 摘要驱动，未到位前回落 no-op 不阻断卸载主流程）；force 透传给宿主。
	if (env.reload !== undefined)
		return env.reload;
	if (g.server?.reloadConfig !== undefined)
		return { reloadConfig: (force?: boolean) => g.server!.reloadConfig(force) };
	return { reloadConfig: async () => ({ unchanged: true, applied: [], restart_pending: [] }) };
}

function sha384Of(env: MarketEnv): (data: Uint8Array) => string {
	// oj isolate 无 sha384 原语（0.1.78 实测）→ 纯 JS 过渡实现兜底；isolate 原语落地后可换回
	return env.sha384B64 ?? sha384B64;
}

function sha256Of(env: MarketEnv): (data: Uint8Array) => string {
	const g = globalThis as { crypto?: { sha256Hex?: (data: Uint8Array) => string } };
	return env.sha256Hex ?? ((data: Uint8Array) => g.crypto!.sha256Hex!(data));
}

/**
 * 宿主能力集（P0 §3.9 / §2.3）：从 ojInfo().build.capabilities 读取（v0.1.122 增量能力位闭集：
 * reload.assemble_modules / reload.anon_per_reload / reload.cron_survives）。注入安装上下文后，
 * preflight 据 manifest.requiresCapabilities 做写锁前门禁——宿主缺能力即 fail-closed（零痕迹）。
 * ojInfo 不可用时回落空数组（等同未上报 → 若模板声明了 requiresCapabilities 则拒装）。
 */
function capabilitiesOf(): string[] {
	try {
		const info = (globalThis as { ojInfo?: () => any }).ojInfo?.();
		const caps = info?.build?.capabilities;
		return Array.isArray(caps) ? caps : [];
	}
	catch {
		return [];
	}
}

/** CDN 基址：注入面优先，缺省读设置表（值/缺省值俱空 = 未配置；表异常视同未配置，消费端给可读错误） */
async function cdnBaseOf(env: MarketEnv): Promise<string | null> {
	if (env.cdnBase) {
		const injected = String(await env.cdnBase() ?? "").trim();
		return injected === "" ? null : injected.replace(/\/+$/, "");
	}
	try {
		const rows = await db.table("sys_setting").select(["value", "default_value"]).where({ field: "key", op: "eq", value: "framework.market_cdn_url" }).all() as Array<Record<string, unknown>>;
		const v = String(rows[0]?.value ?? rows[0]?.default_value ?? "").trim().replace(/\/+$/, "");
		return v === "" ? null : v;
	}
	catch {
		return null;
	}
}

/** 索引签名算法标识（与 ojm publish 同源：Ed25519；C2-35） */
async function operatorOf(): Promise<string | null> {
	const uid = (http as { user?: { id?: unknown } }).user?.id;
	if (uid == null) {
		return null;
	}
	try {
		const u = await db.table("users").select(["username"]).where({ field: "id", op: "eq", value: uid }).all() as Array<{ username: string }>;
		return u[0]?.username ?? null;
	}
	catch {
		return null;
	}
}

/** sys_solution_route enabled（reconcile route 一致性面；无行/查询失败 → null 不猜） */
async function routeEnabledOf(name: string): Promise<boolean | null> {
	try {
		const rows = await db.table("sys_solution_route").select(["enabled"]).where({ field: "module", op: "eq", value: name }).where({ field: "deprecated", op: "eq", value: 0 }).limit(1).all() as Array<{ enabled: unknown }>;
		if (rows.length === 0) {
			return null;
		}
		return Number(rows[0]!.enabled) === 1;
	}
	catch {
		return null;
	}
}

/**
 * 对账入口（P1-10 接线③，市场页刷新即对账时点）：锁 ↔ 账本 head 自愈 + enabled 不一致自动修复。
 * 账本 head 缺省 = oj journal 表查询（journalHeadOf），floor = 安装任务记录 appliedSeq（latestAppliedSeqOf）。
 * 自愈失败静默降级不阻断市场页（禁 console——release isolate console 抛 BadResource 会把
 * 市场页打 500，Finding A；index 可用性优先，下次刷新重试）。
 */
async function reconcileOf(env: MarketEnv): Promise<void> {
	try {
		await reconcile({
			lockPath: `${env.sharedRoot}/manifests.yaml`,
			sharedRoot: env.sharedRoot,
			taskDir: env.taskDir,
			modulesJsonPath: env.modulesJsonPath,
			state: await createStateStore(env.statePath),
			ledgerHeadOf: env.ledgerHeadOf ?? journalHeadOf,
			headFloorOf: (name, version) => latestAppliedSeqOf(env.taskDir, name, version),
			routeEnabledOf,
			trustPath: env.trustPath,
		});
	}
	catch {
		// 降级静默：对账自愈可重入（下次刷新重试），失败不外溢
	}
}

interface ResolvedBundle {
	version: string
	archiveUrl: string
	manifest: unknown
}

/**
 * DB 目录解析（v4 §四：安装解析改走 market_release 表——签名索引机制退役，目录行即 Form B
 * 条目真源；安装器不拼 URL，市场侧职责同纪律）。latest = 未 yanked 的 semver max（API 计算，
 * 非存储列）；精确版本被 yank → 409 人话（REG-CS4 语义保留）；archive 由服务端组表正名
 * （formBEntryOf 逐字 <name>-<version>.tgz，P2-11 投毒加固语义随服务端构造自然成立）。
 * 分发包 URL = CDN 基址 + file（包字节仍静态拉，不变）。
 */
async function resolveFromDb(base: string, name: string, reqVersion: string | null): Promise<ResolvedBundle> {
	const rows = await db.table("market_release")
		.select(["product", "version", "key_id", "sha256", "size", "yanked", "sig_alg", "sig_value", "sig_public_key", "sig_registry_id", "manifest"])
		.where({ field: "product", op: "eq", value: name })
		.all() as Array<Record<string, unknown>>;
	if (rows.length === 0)
		fail(404, `市场目录中无方案「${name}」——若为存量分发包，请站点 superadmin 先执行目录回填（扫描 cdn/ 存量补录 market_release）后再安装`);
	const live = rows.filter(r => Number(r.yanked) !== 1).map(r => String(r.version)).sort(compareVersions);
	const version = reqVersion ?? (live.length === 0 ? null : live[live.length - 1]!);
	if (version === null)
		fail(409, `方案「${name}」的全部版本均已被发布方下线，无法安装；已安装实例不受影响。如需继续请联系发布方`);
	const row = rows.find(r => String(r.version) === version);
	if (row === undefined)
		fail(404, `市场目录中无方案「${name}」版本「${version}」——可用版本：${live.join("、") || "（无）"}`);
	if (reqVersion !== null && Number(row.yanked) === 1)
		fail(409, `方案「${name}」版本「${version}」已被发布方下线（yank），无法安装；已安装实例不受影响。如需继续请联系发布方或改用其他版本`);
	const entry = formBEntryOf(name, row);
	const archive = isObj(entry.archive) ? entry.archive : {};
	const file = typeof archive.file === "string" ? archive.file : `${name}-${version}.tgz`;
	return { version, archiveUrl: `${base}/${file}`, manifest: entry };
}

/** 上传载荷字节（upload/api.ts 先例双路径：小文件字节在手，大文件已流式落 blob 须走 blob.get） */
async function uploadBytes(): Promise<Uint8Array | null> {
	const h = http as { files?: Array<{ key?: string }>, file?: (i: number) => Promise<Uint8Array> };
	if (!Array.isArray(h.files) || h.files.length === 0)
		return null;
	const meta = h.files[0]!;
	return meta.key ? await blob.get(meta.key) : await h.file!(0);
}

/**
 * detached 侧车 `.sig` 上传字节（P2-3，契约 §2.11；file 源签名载体——Form A 禁带 signature 的
 * 自引用悖论 B-2 由侧车消解，与 Form B 同源同语义）。files[1] 缺省 = 未随包上传签名 →
 * verify 段 sig_missing（G4 硬 fail-closed，无逃生门）。JSON 形态校验留 verify 段六码分流，
 * 此处只保「是 JSON 对象」——非 JSON 即上传错误（人话 400，不进安装器）。
 */
async function uploadSig(): Promise<Record<string, unknown> | null> {
	const h = http as { files?: Array<{ key?: string }>, file?: (i: number) => Promise<Uint8Array> };
	if (!Array.isArray(h.files) || h.files.length < 2)
		return null;
	const meta = h.files[1]!;
	const bytes = meta.key ? await blob.get(meta.key) : await h.file!(1);
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	}
	catch (e) {
		return fail(400, `签名侧车文件不是合法 JSON（${String(e)}）——.sig 应为 {alg,key_id,public_key,value,canon} 对象`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		fail(400, "签名侧车文件必须是 JSON 对象（{alg,key_id,public_key,value,canon}）");
	return parsed as Record<string, unknown>;
}

/**
 * file 源 manifest 提取：R1 三步范式 + 体积闸 + 解包扁平化 + manifest.yaml 解析——
 * 实现已上收 _lifecycle/manifest-of-upload.ts（v4：与 CDN 上传端点/回填命令共用同一抽取
 * 管线，勿各写一遍）；此处仅注入 env 参数保持既有调用面。
 */
async function manifestOfUpload(env: MarketEnv, bytes: Uint8Array, exec: ExecFace): Promise<unknown> {
	return sharedManifestOfUpload({ stagingDir: env.staging, bytes, exec });
}

/**
 * 取消安装文件握手（P3-12 端点接线，U5/P3-8 备案①落地）：oj isolate 按请求隔离，内存信号
 * 不共享——改走任务目录下标记文件 `${taskDir}/.cancel-<name>`（跨 isolate 唯一共享面 = FS）。
 * install/cancel 端点写标记（superadmin，R17 同名互斥保证按名寻址无歧义）；runInstall 的
 * cancel 闭包每次探测时若旗标未置位即发起一次异步读标记（fire-and-forget，读到位翻转旗标，
 * 下一次探测生效）——无定时器、无后台循环、无每块同步 IO。installBody 终态后清标记。
 */
function cancelMarkerPath(taskDir: string, name: string): string {
	return `${taskDir}/.cancel-${name}`;
}

/** POST install 主体：门禁后组装 InstallRequest 交 runInstall（端点不重复编排），返回任务 id 供轮询 */
async function installBody(env: MarketEnv): Promise<{ task_id: string }> {
	const body = isObj(http.body) ? http.body : {};
	const source = body.source;
	if (source !== "cdn" && source !== "file")
		fail(400, `source 必须是 "cdn" | "file"，实为「${String(source)}」`);
	const name = String(body.name ?? "").trim();
	if (name === "")
		fail(400, "name is required");
	const reqVersion = body.version == null || body.version === "" ? null : String(body.version);
	// force 透传（oj 0.1.123+ reloadConfig(force)）：body.force 或 query.force=1 任一为真即强制重装配
	const force = body.force === true || String((http as { query?: Record<string, unknown> }).query?.force ?? "") === "1";

	let manifest: unknown;
	let version: string;
	let archiveUrl: string;
	let fetch: FetchInitFace;
	if (source === "file") {
		const bytes = await uploadBytes();
		if (bytes === null)
			fail(400, "source=file 须随 multipart 上传分发包（http.files）");
		const exec = execOf(env);
		manifest = await manifestOfUpload(env, bytes, exec);
		const m = isObj(manifest) ? manifest : {};
		// 身份：body 权威、manifest 兜底；两者俱在且冲突即拒（防锁名/注册名分叉的坏装）
		const mVersion = typeof m.version === "string" ? m.version : "";
		if (reqVersion !== null && mVersion !== "" && mVersion !== reqVersion)
			fail(400, `body.version「${reqVersion}」与包内 manifest.version「${mVersion}」不一致——请核对分发包`);
		const mName = typeof m.name === "string" ? m.name : "";
		if (mName !== "" && mName !== name)
			fail(400, `body.name「${name}」与包内 manifest.name「${mName}」不一致——请核对分发包`);
		if (reqVersion === null && mVersion === "")
			fail(400, "version 不可得（body.version 与包内 manifest.version 均缺失）");
		// Form A 补摘要（C2-29 布局消费点，P1-13 真机实测——附录 B-10）：ojm build --bundle 产物的
		// 包内 manifest 是 Form A（archive 仅 file，sha256/size 由 P3 publish 填充于 Form B），而安装器
		// verify 段对 archive.sha256 fail-closed。file 源字节在手——上传时点即算摘要补成可校验清单
		// （verify 复核同批字节，R10 语义保持）；CDN 源不受影响（Form B 真源自带摘要）。
		// 正名（P2-11 索引投毒加固）：archive.file 逐字 <name>-<version>.tgz——name(C2-01)/version
		// （无路径分隔符）拼出的单文件名安全时即正名（download 段按其落盘）；否则退回常量名
		// upload.tgz（此刻尚未过预检，恶意命名不提前 400 也不给穿越面——预检稍后照拒）。
		const effectiveVersion = reqVersion ?? mVersion;
		const namedFile = /^[a-z][a-z0-9-]{0,63}$/.test(name) && /^[0-9A-Z.-]+$/i.test(effectiveVersion) && !effectiveVersion.includes("..")
			? `${name}-${effectiveVersion}.tgz`
			: "upload.tgz";
		m.archive = { file: namedFile, sha256: sha256Of(env)(bytes), size: bytes.byteLength };
		// detached 侧车签名注入（P2-3，G4 补裁）：同目录 .sig 随 multipart 第二文件上传——
		// 与 Form B archive.signature 同结构注入，verify 段统一验签（六码分流）
		const sig = await uploadSig();
		if (sig !== null) {
			m.archive = { ...(m.archive as Record<string, unknown>), signature: sig };
		}
		version = reqVersion ?? mVersion;
		archiveUrl = `${env.staging}/upload.tgz`;
		fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer });
	}
	else {
		const base = await cdnBaseOf(env);
		if (base === null)
			fail(503, "未配置市场地址（framework.market_cdn_url）——市场安装不可用，请先在系统设置配置 CDN 基址");
		// REG-CS6：安装全程（相对基址补全 + 冒烟探针）都需 canonical origin；缺失/非法即明确报错
		await requireCanonicalOrigin(env);
		const r = await resolveFromDb(base, name, reqVersion);
		manifest = r.manifest;
		version = r.version;
		archiveUrl = r.archiveUrl;
		fetch = await fetchOf(env);
	}
	// 第一方 bootstrap key 播种（P2-12，G3 双轨第一轨）：runInstall 之前——market 首装免 TOFU。
	// key 未回填（null）或信任库已初始化 → no-op（不与运维吊销对抗）
	await seedBootstrapKey(env.trustPath, env.bootstrapKey !== undefined ? env.bootstrapKey : BOOTSTRAP_KEY);
	// U5 取消安装文件握手（P3-12）：清残留标记 → cancel 闭包「未置位则发一次异步读标记，
	// 读到位翻转旗标」（isolate 无定时器/无共享内存，FS 是唯一跨请求通道）
	const markerPath = cancelMarkerPath(env.taskDir, name);
	try {
		await fsFace().remove(markerPath, { force: true });
	}
	catch {}
	let cancelled = false;
	try {
		const task = await runInstall({
			manifest,
			name,
			version,
			operator: (await operatorOf()) ?? undefined,
			state: await createStateStore(env.statePath),
			archiveUrl,
			sharedRoot: env.sharedRoot,
			staging: env.staging,
			taskDir: env.taskDir,
			dbPath: env.dbPath,
			siteModulesDir: env.siteModulesDir,
			modulesJsonPath: env.modulesJsonPath,
			apiPrefix: env.apiPrefix,
			configPath: env.configPath,
			fetch,
			exec: execOf(env),
			reload: reloadOf(env),
			sha384B64: sha384Of(env),
			sha256Hex: env.sha256Hex,
			verifyEd25519: env.verifyEd25519,
			ledgerHead: env.ledgerHeadOf ? await env.ledgerHeadOf(name) : (env.ledgerHead ?? null),
			hostVersions: await hostVersionsOf(env),
			// 宿主平台编排面 API 版本（C2-11 peerPlatform 比对真源；与 meta 端点 apiVersion、_platform/manifest.yaml 版本同源，手工同步）
			hostApiVersion: API_VERSION,
			// 宿主能力集（P0 §3.9）：ojInfo().build.capabilities，preflight 的 requiresCapabilities 门禁据此生效
			capabilities: capabilitiesOf(),
			trustPath: env.trustPath,
			force,
			registryId: env.registryId,
			cancel: () => {
				if (!cancelled) {
					void fsFace().readFile(markerPath).then(() => {
						cancelled = true;
					}).catch(() => {});
				}
				return cancelled;
			},
		});
		return { task_id: task.id };
	}
	finally {
		cancelled = true;
		try {
			await fsFace().remove(markerPath, { force: true });
		}
		catch {}
	}
}

interface IndexRow {
	name: string
	latest: string | null
	installed: string | null
	enabled: boolean | null
	upgradable: boolean
	/** CDN 版本全集（P2-11）：回滚候选不止本站已装旧版；索引缺段/畸形 → [] 降级不炸 */
	available: string[]
	/** 最新版 changelog（C2-08，R27 卡片版本对比；分片条目缺 changelog → null） */
	changelog: unknown
	/** 最新版发布方（manifest author，C2-07；分片条目缺 author → null，自报字段） */
	publisher: string | null
	/** 最新版包级签名 key_id（Form B archive.signature.key_id，经 Ed25519 验签的发布身份；缺签名 → null） */
	publisher_key: string | null
	/** 最新版许可（manifest license，C2-07 SPDX 简化式；分片条目缺/非字符串 → null） */
	license: string | null
	/** 方案简介（manifest summary，C2-04 单行 1..200；分片条目缺/非字符串 → null） */
	summary: string | null
	/** 方案详细描述（manifest description，C2-05 ≤2000；分片条目缺/非字符串 → null） */
	description: string | null
	/** 本地安装的发布方 key 状态（P2-6 sidecar；未装 → null） */
	trust_state: "trusted" | "untrusted" | "absent" | null
	/** 本地安装记录的签名 key id（sidecar archive.key_id；未装/P1 时代条目 → null） */
	key_id: string | null
	/** 最近一次安装操作人（P2-11 裁决：operator 是历史动作语义，回落 market_history 行，不在卡片现算） */
	operator: string | null
}

/**
 * 一页产品的最近一次安装操作人（批量版，minor M6：一次 op:"in" 查询替代逐产品串行——
 * 倒序下每产品首行即最新；表不存在/查询失败 → 空 Map，观测面不阻断索引，全员 null）。
 */
async function lastInstallOperatorsOf(names: string[]): Promise<Map<string, string | null>> {
	const map = new Map<string, string | null>();
	if (names.length === 0)
		return map;
	try {
		const rows = await db.table("market_history")
			.select(["solution", "operator"])
			.where({ field: "action", op: "eq", value: "install" })
			.where({ field: "solution", op: "in", value: names })
			.orderBy([{ field: "created_at", dir: "desc" }, { field: "rowid", dir: "desc" }])
			.all() as Array<{ solution: unknown, operator: unknown }>;
		for (const r of rows) {
			const name = String(r.solution);
			if (!map.has(name))
				map.set(name, typeof r.operator === "string" ? r.operator : null);
		}
	}
	catch {
		// 观测面失败不阻断索引（与单查版同口径）
	}
	return map;
}

/**
 * GET index 主体（v4 §四：DB 目录分页数据源）——market_release 行按 product 聚合 ⊕ 本地
 * sidecar state join（installed/enabled/trust_state/key_id 是站点本地语义，目录 API 不带）。
 * 行字段口径不变（展示字段不变，卡片 UI 加翻页）：latest = 未 yanked semver max（API 计算，
 * 非存储列）；changelog/publisher/summary/description/license 取 latest 版 manifest 列
 * （manifestSummaryOf JSON 解析，缺字段 → null）；publisher_key = latest 行 key_id（发布者
 * 身份单一真相）；available = 未 yanked 版本升序全集（回滚候选）。规模小 → 全量行 JS 聚合 +
 * 内存分页（catalog 同口径）；本地独有方案（DB 无行）殿后。对账即服务（P1-10 接线③）不变。
 */
async function indexBody(env: MarketEnv, q: Record<string, unknown>): Promise<{ list: IndexRow[], total: number, page: number, size: number }> {
	// 对账即服务（P1-10 接线③）：市场页刷新即对账时点——锁 ↔ 账本 head 自愈 + enabled 不一致
	// 自动修复先行（失败只记日志，不阻断索引），失败站点的市场页每次打开都在尝试自愈
	await reconcileOf(env);
	const { page, size, offset } = pageArgs({ page: q.page, size: q.size });
	const rows = await db.table("market_release")
		.select(["product", "version", "key_id", "yanked", "manifest"])
		.all() as Array<Record<string, unknown>>;
	const byProduct = new Map<string, Array<Record<string, unknown>>>();
	for (const r of rows) {
		const product = String(r.product);
		const list = byProduct.get(product) ?? [];
		list.push(r);
		byProduct.set(product, list);
	}
	const local = (await createStateStore(env.statePath)).read().solutions;
	// 本地独有（DB 无行）也列出：目录表空 ≠ 本地没装（回填前旧世界）
	for (const name of Object.keys(local)) {
		if (!byProduct.has(name))
			byProduct.set(name, []);
	}
	const names = [...byProduct.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
	const total = names.length;
	// operator 批量预取（一次 in 查询；缺产品 → null，与逐行单查口径一致）
	const operators = await lastInstallOperatorsOf(names.slice(offset, offset + size));
	const list: IndexRow[] = [];
	for (const name of names.slice(offset, offset + size)) {
		const vers = byProduct.get(name)!;
		const side = local[name];
		const live = vers.filter(r => Number(r.yanked) !== 1).map(r => String(r.version)).sort(compareVersions);
		const latest = live.length === 0 ? null : live[live.length - 1]!;
		const latestRow = latest === null ? undefined : vers.find(r => String(r.version) === latest);
		const installedRow = side === undefined ? undefined : vers.find(r => String(r.version) === side.version);
		const m = manifestSummaryOf(latestRow) ?? manifestSummaryOf(installedRow);
		list.push({
			name,
			latest,
			installed: side?.version ?? null,
			enabled: side?.enabled ?? null,
			upgradable: latest !== null && side !== undefined && compareVersions(side.version, latest) < 0,
			available: live,
			changelog: m?.changelog ?? null,
			publisher: typeof m?.author === "string" ? m.author : null,
			publisher_key: latestRow?.key_id != null ? String(latestRow.key_id) : null,
			license: typeof m?.license === "string" ? m.license : null,
			summary: typeof m?.summary === "string" ? m.summary : null,
			description: typeof m?.description === "string" ? m.description : null,
			trust_state: side?.trust_state ?? null,
			key_id: side?.archive?.key_id ?? null,
			operator: operators.get(name) ?? null,
		});
	}
	return { list, total, page, size };
}

/** 发布历史行（market_release 上传写入行；v4 §四：数据源换 DB 直读，索引 syncReleases 退役） */
interface ReleaseRow {
	id: number
	product: string
	version: string
	key_id: string | null
	sha256: string | null
	size: number | null
	published_at: number
	/** 时间来源：file = 回填扫描读 tgz mtime；upload = 上传端点接收时刻（DB 目录化后唯一真源口径） */
	published_at_source: "file" | "upload"
	yanked: number
}

// ── v4 §三：目录 JSON API（匿名可读，DB 直读合成单协议 shape）────────────────────────────
// 市场目录真源 = market_release 表（上传端点直写）；catalog 清单聚合 + detail 单包详情
// 喂同一 Form B 条目 shape（与历史 shards 条目同构），远端市场走 HTTP、本站直读 DB——
// 「单协议」指 shape 统一，非传输统一。Cache-Control: no-store（防中间代理缓存陈旧目录）。
// 错误文案卫生：匿名读端点的 message 不得含路径/SQL/内部拓扑。

/**
 * 组表 Form B 版本条目：manifest 列（上传端点抽取物）为底，archive 由服务端组表——
 *  存量 manifest 内嵌 archive.file 不可信（防旧行/直写行夹带路径穿越），逐字正名
 *  <name>-<version>.tgz（P2-11 索引投毒加固同源）；签名 key_id 以行 key_id 为准
 *  （发布者身份单一真相；加密学校验在 install verify 段用 public_key + canonical）。
 */
function formBEntryOf(product: string, row: Record<string, unknown>): Record<string, unknown> {
	const file = `${product}-${String(row.version)}.tgz`;
	let stored: Record<string, unknown> | null = null;
	if (typeof row.manifest === "string" && row.manifest !== "") {
		try {
			const parsed: unknown = JSON.parse(row.manifest);
			if (isObj(parsed))
				stored = parsed;
		}
		catch {
			stored = null; // 坏行不猜：回退最小形态（观测面降级，不整页 500）
		}
	}
	const base: Record<string, unknown> = stored ?? { name: product, version: String(row.version) };
	// archive 服务端组表（base 底展开后整体覆盖）：存量 manifest 内嵌 archive.file 是包作者
	// 自报字段不可信（可能 stale/穿越形态）——file 逐字正名 <name>-<version>.tgz（构造即校验，
	// P2-11 索引投毒加固的组表处承继）；sha256/size/签名取行列（上传端点服务端重算值）。
	const archive: Record<string, unknown> = { file };
	if (typeof row.sha256 === "string")
		archive.sha256 = row.sha256;
	if (typeof row.size === "number")
		archive.size = row.size;
	if (typeof row.sig_alg === "string" && row.sig_alg !== "")
		archive.signature = { alg: row.sig_alg, key_id: row.key_id, public_key: row.sig_public_key, value: row.sig_value, canon: "v2", registry_id: typeof row.sig_registry_id === "string" ? row.sig_registry_id : "" };
	return { ...base, name: product, version: String(row.version), yanked: Number(row.yanked) === 1, archive };
}

/** market_release 行 → manifest 摘要对象（catalog 展示字段源；NULL/坏行 → null 降级） */
function manifestSummaryOf(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
	if (row === undefined)
		return null;
	if (typeof row.manifest !== "string" || row.manifest === "")
		return null;
	try {
		const parsed: unknown = JSON.parse(row.manifest);
		return isObj(parsed) ? parsed : null;
	}
	catch {
		return null;
	}
}

/**
 * GET /market/catalog 主体：全量行内存聚合（规模小，真分页留待规模信号）+ 内存分页。
 * 清单不含 yanked 行（全 yanked 的 product 整项消失）；latest = 未 yanked 的 semver max
 * （API 计算，非存储列——index_latest_regressed 守卫随索引退役自然消失）；排序键钉死
 * published_at desc, product asc（产品级 published_at 取其版本最大值 = 最近发布时刻；
 * 键唯一确定性 ⇒ 翻页不重复不丢条目）；page/size 复用 pageArgs（非法收敛、size 钳 200、
 * 默认 20）。响应 PageResult 惯例的 page/size 回显 + truncated 截断标记，items 为协议字段名。
 */
async function catalogBody(env: Pick<MarketEnv, "registryId" | "configPath">, q: Record<string, unknown>): Promise<Record<string, unknown>> {
	const { page, size, offset } = pageArgs({ page: q.page, size: q.size });
	const rows = await db.table("market_release")
		.select(["product", "version", "key_id", "published_at", "yanked", "manifest"])
		.all() as Array<Record<string, unknown>>;
	// 聚合：product → 未 yanked 行组（清单不含 yanked 行）
	const byProduct = new Map<string, Array<Record<string, unknown>>>();
	for (const r of rows) {
		if (Number(r.yanked) === 1)
			continue;
		const list = byProduct.get(String(r.product)) ?? [];
		list.push(r);
		byProduct.set(String(r.product), list);
	}
	const items = [...byProduct.entries()].map(([product, list]) => {
		const bySemver = [...list].sort((a, b) => compareVersions(String(a.version), String(b.version)));
		const latestRow = bySemver[bySemver.length - 1]!;
		const summary = manifestSummaryOf(latestRow);
		return {
			product,
			latest: String(latestRow.version),
			publisher: typeof latestRow.key_id === "string" ? latestRow.key_id : null,
			versions_count: list.length,
			...(typeof summary?.summary === "string" ? { summary: summary.summary } : {}),
			_at: Math.max(...list.map(r => Number(r.published_at))),
		};
	});
	items.sort((a, b) => (b._at - a._at) || (a.product < b.product ? -1 : a.product > b.product ? 1 : 0));
	const total = items.length;
	const slice = items.slice(offset, offset + size).map(({ _at: _ignoredAt, ...item }) => {
		void _ignoredAt;
		return item;
	});
	(json as { header: (k: string, v: string) => void }).header("Cache-Control", "no-store");
	// registry_id（签名推送 canonical 首段 = 站点身份）随目录暴露——CLI 推送前发现面；
	// 解析口径与上传/yank 端点验面同源（注入优先，回落 config vars.registry_id）
	const registryId = env.registryId ?? await readSiteVar(env.configPath ?? "config.yaml", "registry_id");
	return { api_version: CATALOG_API_VERSION, registry_id: registryId, page, size, total, truncated: offset + slice.length < total, items: slice };
}

/**
 * GET /market/catalog/detail 主体：按 name 取全版本（详情**保留 yanked 条目**——安装侧
 * 「精确版本拒装 409 人话」依赖条目可见 + yanked 标记；清单摘除/详情保留分离保全两侧
 * 语义）。versions semver 降序；latest = 未 yanked semver max（全 yanked → null）；
 * ?version= 精确过滤（无匹配 → 空数组，200；404 只对未知 name）。
 */
async function detailBody(q: Record<string, unknown>): Promise<Record<string, unknown>> {
	const name = String(q.name ?? "").trim();
	if (name === "")
		fail(400, "name is required");
	const rows = await db.table("market_release")
		.select(["product", "version", "key_id", "sha256", "size", "yanked", "sig_alg", "sig_value", "sig_public_key", "sig_registry_id", "manifest"])
		.where({ field: "product", op: "eq", value: name })
		.all() as Array<Record<string, unknown>>;
	if (rows.length === 0)
		fail(404, `市场目录中无方案「${name}」`);
	const versionFilter = q.version == null || q.version === "" ? null : String(q.version);
	const versions = rows
		.filter(r => versionFilter === null || String(r.version) === versionFilter)
		.map(r => formBEntryOf(name, r))
		.sort((a, b) => compareVersions(String(b.version), String(a.version)));
	const live = versions.filter(v => v.yanked !== true).map(v => String(v.version)).sort(compareVersions);
	(json as { header: (k: string, v: string) => void }).header("Cache-Control", "no-store");
	return { product: name, latest: live.length === 0 ? null : live[live.length - 1]!, versions };
}

// ── v4 §三：yank 端点（签名下线/恢复，目录行级）───────────────────────────────────────────
// POST /market/yank：body { product, version, reason?, by?, restore? } + X-OJM 头签名。
// canonical `market-yank:<registry_id>:<product>:<version>`（无内容哈希——重放退化为幂等，
// 同上传端点推理）；授权 = key_id 须匹配行 key_id（发布者本人；不符 403，遗留 NULL 行
// 走 superadmin 管理通道）；版本不存在 404；重复 yank/unyank 幂等 200。yank 不动已装方案
// （G5 口径）——仅目录摘除 + 阻断新装/升级（安装解析的 yanked 精确版本拒装 409 人话，
// §四）。审计 by/reason 落 market_history（operator = key_id）。
const YANK_PRODUCT_RE = /^[a-z][a-z0-9-]{0,63}$/; // 与 cdn 上传白名单同源口径（C2-01）
const YANK_VERSION_RE = /^\d[0-9A-Z.+-]{0,63}$/i;

async function yankBody(env: MarketEnv): Promise<Record<string, unknown>> {
	const body = isObj(http.body) ? http.body : {};
	const product = String(body.product ?? "").trim();
	const version = String(body.version ?? "").trim();
	if (!YANK_PRODUCT_RE.test(product) || !YANK_VERSION_RE.test(version))
		fail(400, `product/version 非法：「${product}@${version}」——product ^[a-z][a-z0-9-]{0,63}$、版本数字开头`);
	const restore = body.restore === true;
	const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "";
	const by = typeof body.by === "string" ? body.by.slice(0, 64) : "";
	// 鉴权（与上传端点共享验面：头 → 信任库 → 限速 → registry_id）+ canonical 验签
	const { keyId, publicKey, registryId, signature } = await authenticateSignedKey({ trustPath: env.trustPath, registryId: env.registryId, configPath: env.configPath, verifyEd25519: env.verifyEd25519 }, "market-yank");
	const canonical = `market-yank:${registryId}:${product}:${version}`;
	if (!verifyCanonicalSig({ verifyEd25519: env.verifyEd25519 }, publicKey, canonical, signature))
		fail(401, "yank 签名验签失败：canonical 不符（字节级重放防护由内容寻址承载，yank 重放退化为幂等）——已拒");
	const rows = await db.table("market_release")
		.select(["id", "key_id", "yanked"])
		.where({ field: "product", op: "eq", value: product })
		.where({ field: "version", op: "eq", value: version })
		.limit(1)
		.all() as Array<{ id: unknown, key_id: unknown, yanked: unknown }>;
	if (rows.length === 0)
		fail(404, `市场目录中无「${product}@${version}」——无法下线/恢复不存在的版本`);
	const row = rows[0]!;
	const auditMsg = `by=${by === "" ? keyId : by}${reason === "" ? "" : ` reason=${reason}`}`;
	if (row.key_id == null || row.key_id === "") {
		await recordHistory({ solution: product, version, action: restore ? "unyank" : "yank", status: "failed", operator: keyId, message: `403 该行无发布者（遗留行）：${auditMsg}` });
		fail(403, `「${product}@${version}」是遗留目录行（无发布者绑定）——yank/恢复请走 superadmin 管理通道`);
	}
	if (row.key_id !== keyId) {
		await recordHistory({ solution: product, version, action: restore ? "unyank" : "yank", status: "failed", operator: keyId, message: `403 非发布者（行 key_id=${String(row.key_id)}）：${auditMsg}` });
		fail(403, `key「${keyId}」不是「${product}@${version}」的发布者（发布 key = ${String(row.key_id)}）——仅发布者本人可下线/恢复，换主 = 站点 superadmin 操作`);
	}
	const target = restore ? 0 : 1;
	if (Number(row.yanked) === target)
		return { ok: true, product, version, yanked: target === 1, idempotent: true };
	await db.table("market_release").update({ yanked: target }).where({ field: "id", op: "eq", value: row.id }).run();
	await recordHistory({ solution: product, version, action: restore ? "unyank" : "yank", status: "success", operator: keyId, message: auditMsg });
	return { ok: true, product, version, yanked: target === 1 };
}

/** 四端点组（oj v0.1.64 嵌套组：组名 = 路径段）；全业务体经 respond 收口（status 语义不落 500） */
export function createMarketApi(env: MarketEnv) {
	return {
		// POST /api/oj-market/install —— 安装编排（superadmin，R9）
		"install": {
			async post() {
				await respond(async () => {
					await assertSuperAdmin();
					return await installBody(env);
				});
			},
			// POST /api/oj-market/install/cancel —— 取消进行中的安装（superadmin，U5/P3-12）。
			// 按方案名寻址（R17 任务互斥：同名同时至多一个 running install）；写取消标记文件
			// （isolate 按请求隔离，FS 是唯一跨请求通道），runInstall 的 cancel 闭包在段间/migrate
			// spawn 逐块探测命中 → h.kill + 回退装前态（P3-8 语义）；终态 failed/partial + cancelled
			// 标记随任务文件可查。无 running 任务 → 404。
			cancel: {
				async post() {
					await respond(async () => {
						await assertSuperAdmin();
						const body = isObj(http.body) ? http.body : {};
						const name = String(body.name ?? "").trim();
						if (name === "")
							fail(400, "name is required");
						if (!/^[a-z][a-z0-9-]{0,63}$/.test(name))
							fail(400, `name 非法（须 ^[a-z][a-z0-9-]{0,63}$）：${name}`);
						const running = (await readTasks(env.taskDir)).some(t => t.name === name && t.status === "running");
						if (!running)
							fail(404, `「${name}」当前没有进行中的安装任务（取消只对 running 态有效）`);
						await atomicWriteText(cancelMarkerPath(env.taskDir, name), new Date().toISOString());
						return { ok: true, name, requested: true };
					});
				},
			},
		},
		// GET /api/oj-market/task?id= —— 任务轮询消费面（superadmin，§10.2 800ms 轮询）。
		// 简报 `task/:id` 段参数形态在模板 http 面无先例，照 contacts/detail?id= 惯例走 query（报告备案）。
		"task": {
			async get() {
				await respond(async () => {
					await assertSuperAdmin();
					const id = String((http as { query?: Record<string, unknown> }).query?.id ?? "").trim();
					if (id === "")
						fail(400, "id is required");
					const rec = await getTask(env.taskDir, id);
					if (rec === null)
						fail(404, `任务不存在或已过期（任务文件保留最近 10 条）：${id}`);
					return rec;
				});
			},
		},
		// POST /api/oj-market/enable —— 生命周期开关（superadmin；P1-13 瘦客户端触发面）。
		// 端点只做门禁 + 取参 + SetEnabledInput 组装，四处同写全归 setEnabled（D12，installer.ts 同纪律）；
		// 领域拒绝（未装/空锁/版本目录缺失）返回 {ok:false, message} 200——操作已执行、被域逻辑拒绝，
		// 人话在 message，CLI/市场页照 ok 位渲染。
		"enable": {
			async post() {
				await respond(async () => {
					await assertSuperAdmin();
					const body = isObj(http.body) ? http.body : {};
					const name = String(body.name ?? "").trim();
					if (name === "")
						fail(400, "name is required");
					if (typeof body.enabled !== "boolean")
						fail(400, `enabled 必须是布尔，实为「${String(body.enabled)}」`);
					return await setEnabled({
						name,
						enabled: body.enabled,
						sharedRoot: env.sharedRoot,
						lockPath: `${env.sharedRoot}/manifests.yaml`,
						state: await createStateStore(env.statePath),
						modulesJsonPath: env.modulesJsonPath,
						trustPath: env.trustPath,
						operator: (await operatorOf()) ?? undefined,
					});
				});
			},
		},
		// GET /api/oj-market/meta —— 登录即可（{apiVersion}，peerPlatform 预检；非 superadmin）
		"meta": {
			async get() {
				await respond(async () => {
					const uid = (http as { user?: { id?: unknown } }).user?.id;
					if (uid == null)
						fail(401, "unauthorized");
					return { apiVersion: API_VERSION };
				});
			},
		},
		// 信任库运维面（P2-2，C2-38/39，G3 双轨第一轨 / G5；全 superadmin，R9）：
		// GET    /market/trust          列表（含 .bak 回落 note——损坏时运维可见）
		// POST   /market/trust          TOFU 确认 {task_id}（P2-3）：自任务记录重取公钥复算指纹
		//                              逐字比对后入信任库——防「人确认 A、库里落 B」混淆代理
		// POST   /market/trust/key      新增信任（首次绑定不可改：撞绑定 409，C2-38）
		// DELETE /market/trust/key?key_id=  吊销（G5：只阻断新装/升级，不动已装方案）
		// 端点只做门禁 + 取参 + operator 反查；读写/原子写/首次绑定/吊销语义全归 trust.ts（ISP，同 enable/uninstall 纪律）。
		// del 动词（oj 运行期命名，devkit §http：DELETE 的方法名是 del 不是 delete）+ query 取参（system/roles del 同款先例）。
		// POST /api/oj-market/backfill —— 站点侧目录回填（v4 §六，三用：回填=恢复=对账）。
		// superadmin 一次性触发（升级后/灾备后）；扫 cdn/ 存量包 upsert market_release，
		// 幂等可重入；无 CLI 依赖（远端纯站点经本端点自愈目录）。语义详见 backfill.ts。
		"backfill": {
			async post() {
				await respond(async () => {
					await assertSuperAdmin();
					return await backfillReleases({
						cdnDir: env.cdnDir ?? "cdn",
						staging: env.staging,
						exec: env.exec,
						sha256Hex: env.sha256Hex,
						verifyEd25519: env.verifyEd25519,
						now: env.now,
					});
				});
			},
		},
		"trust": {
			async get() {
				await respond(async () => {
					await assertSuperAdmin();
					const store = createTrustStore(env.trustPath);
					return { keys: await store.list(), note: store.corruptNote?.() ?? null };
				});
			},
			async post() {
				await respond(async () => {
					await assertSuperAdmin();
					const body = isObj(http.body) ? http.body : {};
					const taskId = String(body.task_id ?? "").trim();
					if (taskId === "")
						fail(400, "task_id is required");
					const rec = await getTask(env.taskDir, taskId);
					if (rec === null)
						fail(404, `任务不存在或已过期（任务文件保留最近 10 条）：${taskId}`);
					if (rec.status !== "needs_trust" || rec.trust === undefined)
						fail(409, `任务 ${taskId} 不在待信任确认状态（status=${rec.status}）——无需确认`);
					// 混淆代理防线：公钥自任务记录重取，指纹复算逐字比对（记录疑被篡改即拒，信任库零变化）
					const raw = new Uint8Array(32);
					for (let i = 0; i < 32; i++)
						raw[i] = Number.parseInt(rec.trust.public_key.slice(i * 2, i * 2 + 2), 16);
					const fp = sha256Of(env)(raw);
					if (fp !== rec.trust.fingerprint)
						fail(409, "任务记录内指纹与公钥不一致——记录疑被篡改，拒绝确认（信任库零变化）");
					const result = await createTrustStore(env.trustPath).add(rec.trust.key_id, rec.trust.public_key, { operator: await operatorOf() });
					return { result, key_id: rec.trust.key_id, fingerprint: rec.trust.fingerprint };
				});
			},
			key: {
				async post() {
					await respond(async () => {
						await assertSuperAdmin();
						const body = isObj(http.body) ? http.body : {};
						const keyId = String(body.key_id ?? "").trim();
						const publicKey = String(body.public_key ?? "").trim();
						if (keyId === "" || publicKey === "")
							fail(400, "key_id and public_key are required");
						return { result: await createTrustStore(env.trustPath).add(keyId, publicKey, { operator: await operatorOf() }) };
					});
				},
				async del() {
					await respond(async () => {
						await assertSuperAdmin();
						const keyId = String((http as { query?: Record<string, unknown> }).query?.key_id ?? "").trim();
						if (keyId === "")
							fail(400, "key_id is required");
						return { revoked: await createTrustStore(env.trustPath).remove(keyId, { operator: await operatorOf() }) };
					});
				},
			},
		},
		// GET /api/oj-market/index —— 市场索引聚合（superadmin，R9）
		"index": {
			async get() {
				await respond(async () => {
					await assertSuperAdmin();
					return await indexBody(env, (http.query ?? {}) as Record<string, unknown>);
				});
			},
		},
		// GET /api/oj-market/catalog —— 市场目录清单（v4 §三：**匿名可读**，分页 JSON；
		// DB 直读合成单协议 shape，远端市场消费同一 shape）。no-store 防中间代理缓存陈旧目录。
		"catalog": {
			async get() {
				await respond(async () => {
					return await catalogBody(env, (http.query ?? {}) as Record<string, unknown>);
				});
			},
			// GET /api/oj-market/catalog/detail?name=[&version=] —— 单包详情（匿名可读；
			// 保留 yanked 条目 + 服务端组表 archive 正名，安装解析数据源，§四）
			detail: {
				async get() {
					await respond(async () => {
						return await detailBody((http.query ?? {}) as Record<string, unknown>);
					});
				},
			},
		},
		// POST /api/oj-market/yank —— 签名下线/恢复（v4 §三，发布者本人；清单摘除/详情保留）。
		// yank 不动已装方案（G5），仅目录摘除 + 阻断新装/升级；重复操作幂等 200；legacy 行 403 指向 superadmin。
		"yank": {
			async post() {
				await respond(async () => {
					return await yankBody(env);
				});
			},
		},
		// GET /api/oj-market/uninstall-impact?name= —— 卸载影响面预检（superadmin，R9）。
		// 返回前端二次确认所需的影响计数（角色数 + 受影响用户数），不改动任何状态。
		"uninstall-impact": {
			async get() {
				await respond(async () => {
					await assertSuperAdmin();
					const name = String((http as { query?: Record<string, unknown> }).query?.name ?? "").trim();
					if (name === "")
						fail(400, "name is required");
					return await computeUninstallImpact({
						name,
						sharedRoot: env.sharedRoot,
						lockPath: `${env.sharedRoot}/manifests.yaml`,
						state: await createStateStore(env.statePath),
						modulesJsonPath: env.modulesJsonPath,
					});
				});
			},
		},
		// POST /api/oj-market/uninstall —— 卸载编排（superadmin，R9）。
		// 端点只做门禁 + 取参 + operator 反查（历史留痕），四处同删全归 runUninstall（uninstall.ts 同纪律）；
		// 领域拒绝（未装/空锁拒启）返回 {ok:false, message} 200——人话在 message，CLI/市场页照 ok 位渲染。
		"uninstall": {
			async post() {
				await respond(async () => {
					await assertSuperAdmin();
					const body = isObj(http.body) ? http.body : {};
					const name = String(body.name ?? "").trim();
					if (name === "")
						fail(400, "name is required");
					const r = await runUninstall({
						name,
						sharedRoot: env.sharedRoot,
						lockPath: `${env.sharedRoot}/manifests.yaml`,
						state: await createStateStore(env.statePath),
						modulesJsonPath: env.modulesJsonPath,
						operator: (await operatorOf()) ?? undefined,
						reload: reloadOf(env),
					});
					// P3-11 宿主打磨：方案已不存在 = 资源缺失语义 → 404（非 200 {ok:false}）；
					// 其余领域拒绝（空锁拒启/级联失败等）维持 200 {ok:false} 人话在 message。
					if (!r.ok && r.reason === "not-installed")
						fail(404, r.message);
					return r;
				});
			},
		},

		// GET /api/oj-market/history —— 市场操作历史（只读消费面，供前端 HistoryDrawer）。
		// 平台级审计面（P4 上收 _platform）：install/enable/disable/uninstall/upgrade/rollback 留痕
		// 由 _lifecycle/history.ts recordHistory 写入；本端点仅登录用户可读（非匿名名单，Bearer 守卫保护）。
		// 表不存在/查询失败一律返回空数组（历史是观测面，不阻断主流程，与终态审计附录 B-5 同语义）。
		"history": {
			async get() {
				await respond(async () => {
					const rows = (await db.table("market_history")
						.select(["solution", "version", "action", "status", "operator", "message", "created_at"])
						.orderBy([{ field: "created_at", dir: "desc" }])
						.all()) as Array<Record<string, unknown>>;
					return rows ?? [];
				});
			},
		},

		// GET /api/oj-market/releases —— 发布历史（登录即可读；与市场卡片同口径的「浏览开放」）。
		//
		// 数据源 = market_release 上传写入行（v4 §四 DB 目录化：索引对账 syncReleases 已退役，
		// 发布历史即目录表按 published_at 倒序分页直读，零索引依赖）。
		"releases": {
			async get() {
				await respond(async () => {
					const uid = (http as { user?: { id?: unknown } }).user?.id;
					if (uid == null)
						fail(401, "unauthorized");
					const q = (http.query ?? {}) as Record<string, unknown>;
					const { page, size, offset } = pageArgs({ page: q.page, size: q.limit });
					const total = Number(
						(await db.table("market_release").select([{ fn: "count", as: "c" }]).all() as Array<Record<string, unknown>>)[0]?.c ?? 0,
					);
					const list = total === 0
						? []
						: await db.table("market_release")
							.select(["id", "product", "version", "key_id", "sha256", "size", "published_at", "published_at_source", "yanked"])
							.orderBy([{ field: "published_at", dir: "desc" }, { field: "id", dir: "desc" }])
							.limit(size)
							.offset(offset)
							.all() as unknown as ReleaseRow[];
					return { list, total, page, size };
				});
			},
		},
	};
}

const marketApi = createMarketApi(marketEnv());

// —— 契约 I/O（schema-first，oj v0.1.72+）：`.schema` 定义入参（body/query）、`.response`
// 定义出参，供 oj 在 handler 运行前校验 + 生成式 __client 推导有类型函数（与 notification/api.ts
// 同口径）。出参一律 additionalProperties:true 宽松，不约束运行期返回形状；入参对齐 handler 实际
// 收口（source 枚举 / 必填项），oj 先校验、handler 仍自校验（双保险，不放松运行期语义）。
marketApi.install.post.schema = {
	body: {
		type: "object",
		required: ["source", "name"],
		properties: { source: { type: "string", enum: ["cdn", "file"] }, name: { type: "string" }, version: { type: ["string", "null"] }, force: { type: "boolean" } },
	},
};
marketApi.install.post.response = { type: "object", properties: { task_id: { type: "string" } }, additionalProperties: true };
marketApi.install.cancel.post.schema = { body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } };
marketApi.install.cancel.post.response = { type: "object", properties: { ok: { type: "boolean" }, name: { type: "string" }, requested: { type: "boolean" } }, additionalProperties: true };
marketApi.task.get.schema = { query: { type: "object", required: ["id"], properties: { id: { type: "string" } } } };
marketApi.task.get.response = { type: "object", additionalProperties: true };
marketApi.enable.post.schema = { body: { type: "object", required: ["name", "enabled"], properties: { name: { type: "string" }, enabled: { type: "boolean" } } } };
marketApi.enable.post.response = { type: "object", additionalProperties: true };
marketApi.meta.get.response = { type: "object", properties: { apiVersion: { type: "string" } }, additionalProperties: true };
marketApi.trust.get.response = { type: "object", additionalProperties: true };
marketApi.trust.post.schema = { body: { type: "object", required: ["task_id"], properties: { task_id: { type: "string" } } } };
marketApi.trust.post.response = { type: "object", additionalProperties: true };
marketApi.trust.key.post.schema = { body: { type: "object", required: ["key_id", "public_key"], properties: { key_id: { type: "string" }, public_key: { type: "string" } } } };
marketApi.trust.key.post.response = { type: "object", additionalProperties: true };
marketApi.trust.key.del.schema = { query: { type: "object", required: ["key_id"], properties: { key_id: { type: "string" } } } };
marketApi.trust.key.del.response = { type: "object", additionalProperties: true };
marketApi.index.get.schema = {
	query: {
		type: "object",
		properties: { page: { type: "number", minimum: 1 }, size: { type: "number", minimum: 1, maximum: 200 } },
	},
};
marketApi.index.get.response = {
	type: "object",
	required: ["list", "total", "page", "size"],
	properties: {
		list: { type: "array", items: { type: "object", additionalProperties: true } },
		total: { type: "number" },
		page: { type: "number" },
		size: { type: "number" },
	},
};
marketApi.catalog.get.schema = {
	query: {
		type: "object",
		properties: { page: { type: "number", minimum: 1 }, size: { type: "number", minimum: 1, maximum: 200 } },
	},
};
marketApi.catalog.get.response = { type: "object", additionalProperties: true };
marketApi.catalog.detail.get.schema = {
	query: {
		type: "object",
		required: ["name"],
		properties: { name: { type: "string" }, version: { type: "string" } },
	},
};
marketApi.catalog.detail.get.response = { type: "object", additionalProperties: true };
marketApi.yank.post.schema = {
	body: {
		type: "object",
		required: ["product", "version"],
		properties: {
			product: { type: "string" },
			version: { type: "string" },
			reason: { type: "string" },
			by: { type: "string" },
			restore: { type: "boolean" },
		},
	},
};
marketApi.yank.post.response = { type: "object", additionalProperties: true };
marketApi["uninstall-impact"].get.schema = { query: { type: "object", required: ["name"], properties: { name: { type: "string" } } } };
marketApi["uninstall-impact"].get.response = { type: "object", additionalProperties: true };
marketApi.uninstall.post.schema = { body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } };
marketApi.uninstall.post.response = { type: "object", additionalProperties: true };
marketApi.history.get.response = { type: "array", items: { type: "object", additionalProperties: true } };
marketApi.releases.get.schema = {
	query: {
		type: "object",
		properties: {
			page: { type: "number", minimum: 1 },
			limit: { type: "number", minimum: 1, maximum: 200 },
		},
	},
};
marketApi.releases.get.response = {
	type: "object",
	required: ["list", "total", "page", "size"],
	properties: {
		list: { type: "array", items: { type: "object", additionalProperties: true } },
		total: { type: "number" },
		page: { type: "number" },
		size: { type: "number" },
	},
};

export default marketApi;
