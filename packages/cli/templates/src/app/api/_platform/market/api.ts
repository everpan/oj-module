import type { SourceSeqVerdict } from "../_lifecycle/source-seq";
// 编排端点 + 市场索引（P1-12，R9/ISP）：/api/_platform/market/* 端点族同文件嵌套 handler 组
// （oj v0.1.64 组形态，notification/api.ts 同款；组名 = 路径段，路由不变；嵌套组最深 4 层，oj bridge/mod.rs walker）。
// 门（R9）：install/task/index 全 assertSuperAdmin 独占（市场页是「市场即样例」的第一方特权
// 例外，R29；权限码不构成门）；meta 登录即可（peerPlatform 预检先于判权）。
// 职责边界（ISP）：端点只做 门禁 + Form B 索引解析（安装器不拼 URL，installer.ts 同纪律）+
// InstallRequest 组装；任务生命周期/失败三分/终态审计全归 runInstall 状态机（P1-10），端点不重复编排。
// CDN 基址：sys_setting `framework.market_cdn_url`（PRD §5.3，缺省空 = 市场不可用，可读错误不崩）；
// 索引拉取走 IndexSource DIP（REG-CS5 三级化：catalog.yaml + shards/<n>.yaml）——读面带
// ETag/If-None-Match 条件请求（304 不重传），不再发 cache-control: no-cache（Q8：新鲜度由
// 服务端 max-age=60, stale-while-revalidate=60 + 索引自身 expires_at 共同承载）。
// 站点路径缺省（marketEnv）：oj serve release 布局生产口径（P1-16 接线 B3/B4）——共享根 = serve
// 挂载根 dist（锁 dist/manifests.yaml、版本目录 dist/<name>-<ver>/、versions.json 同根），
// 暂存/任务/sidecar 留 dist 外（R13 不与装配树冲突）；全字段可注入覆盖（测试 stub 同款）。
// file 源上传形态：照 personal-center/upload/api.ts 先例（http.files 双路径，大文件走 blob）；
// 上传包先过 R1 三步范式（list→validate→extract）取出 manifest.yaml 供 preflight——
// 未校验不解包，zip-slip 在信任边界外被拒。
import type { FetchFace } from "../_lifecycle/steps/download";
import type { ExecFace } from "../_lifecycle/steps/extract";
import type { ReloadFace } from "../_lifecycle/steps/reload";
import type { FetchInitFace } from "../_shared/site-facade";
import type { IndexKind, IndexSource } from "./index-source";
import { atomicWriteText, fsFace } from "../_lifecycle/atomic";
import { latestAppliedSeqOf, reconcile, runInstall, setEnabled } from "../_lifecycle/installer";
import { manifestOfUpload as sharedManifestOfUpload } from "../_lifecycle/manifest-of-upload";
import { compareVersions } from "../_lifecycle/semver";
import { sha384B64 } from "../_lifecycle/sha384";
import { guardAndRecordSourceSeq } from "../_lifecycle/source-seq";
import { createStateStore } from "../_lifecycle/state";
import { getTask, readTasks } from "../_lifecycle/tasks";
import { createTrustStore } from "../_lifecycle/trust";
import { computeUninstallImpact, runUninstall } from "../_lifecycle/uninstall";
import { respond } from "../_shared/respond";
import { assertSuperAdmin } from "../_shared/service/infra/access";
import { pageArgs } from "../_shared/service/infra/query";
import { journalHeadOf, readCanonicalOrigin, siteOrigin, withSiteOrigin } from "../_shared/site-facade";
import { BOOTSTRAP_KEY, seedBootstrapKey } from "./bootstrap";
import { httpIndexSource, indexPathOf } from "./index-source";

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
	/**
	 * 索引读取源注入（DIP，REG-CS5③）：缺省按 CDN 基址 + fetchOf 构造 HTTP 源
	 * （ETag/If-None-Match 条件请求）；本地目录索引 / 测试夹具可直注（localIndexSource）。
	 */
	indexSource?: IndexSource
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

/**
 * REG-CS6：相对市场基址（`market_cdn_url=/cdn` 本站点自供）**必须**有 canonical origin 才能补全为
 * 同源绝对 URL——绝对基址（外部真 CDN）不需要。缺失/非法即明确报错并指向具体设置项
 * （config.yaml `vars.canonical_origin`），绝不回落请求头 Host（伪造 Host 会牵引出站）。
 */
async function assertOriginForRelativeBase(env: MarketEnv, base: string): Promise<void> {
	if (/^https?:\/\//i.test(base)) {
		return;
	}
	await requireCanonicalOrigin(env);
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
const INDEX_SIG_ALG = "Ed25519";

/** 索引规范串（REG-CS1，与 ojm publish indexCanonical 逐字一致）：`index:<kind>:<seq>:<sha256hex>` */
function indexCanonical(env: MarketEnv, kind: IndexKind, seq: number, text: string): string {
	const sha256 = sha256Of(env)(new TextEncoder().encode(text));
	return `index:${kind}:${seq}:${sha256}`;
}

/** Ed25519 验签面（P2-3；env 注入优先，缺省回落 isolate 全局 crypto.verifyEd25519） */
function verifyEd25519Of(env: MarketEnv): (publicKey: string, msg: string, sigBase64: string) => boolean {
	const g = globalThis as { crypto?: { verifyEd25519?: (pk: string, msg: string, sig: string) => boolean } };
	return env.verifyEd25519 ?? ((pk, msg, sig) => g.crypto!.verifyEd25519!(pk, msg, sig));
}

/** 验签判定：ok + 代次（读方据此做同代校验；seq 为 null = 旧格式签名，一律拒） */
interface IndexSigVerdict {
	ok: boolean
	seq: number | null
}

/**
 * 索引签名校验（REG-CS1，G4 fail-closed 口径）：解析 detached .sig 六字段 → 结构校验 →
 * 重算规范串（含 seq）→ verifyEd25519。返回 ok 仅当签名完整、覆盖代次且匹配索引字节。
 * 注：发布方信任（key 是否在信任库/bootstrap）由安装期 TOFU/信任库承载，此处仅做完整性（防 CDN 索引篡改）。
 */
function verifyIndexSig(env: MarketEnv, kind: IndexKind, text: string, sigText: string): IndexSigVerdict {
	let sig: unknown;
	try {
		sig = JSON.parse(sigText);
	}
	catch {
		return { ok: false, seq: null };
	}
	if (!isObj(sig))
		return { ok: false, seq: null };
	const { alg, value, public_key: publicKey, seq } = sig as { alg?: unknown, value?: unknown, public_key?: unknown, seq?: unknown };
	if (alg !== INDEX_SIG_ALG || typeof value !== "string" || typeof publicKey !== "string")
		return { ok: false, seq: null };
	// 签名未覆盖代次 = 旧格式（无法防「新总目录 + 旧分册」），拒
	if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1)
		return { ok: false, seq: null };
	return { ok: verifyEd25519Of(env)(publicKey, indexCanonical(env, kind, seq, text), value), seq };
}

/** 索引正文的代次（顶层 `seq`；纯内容形态（分片）无顶层键 → null，代次只由 .sig 承载） */
async function indexSeqOfText(text: string): Promise<number | null> {
	const g = globalThis as { yaml?: { parse: (t: string) => Promise<unknown> } };
	try {
		const doc = await g.yaml!.parse(text) as unknown;
		if (doc === null || typeof doc !== "object" || Array.isArray(doc))
			return null;
		const seq = (doc as Record<string, unknown>).seq;
		return typeof seq === "number" && Number.isInteger(seq) && seq >= 1 ? seq : null;
	}
	catch {
		return null;
	}
}

/** 缺签名/空签名的人话（两步可执行下一步，与 CLI `ojm market verify` 同一文案口径） */
const SIG_MISSING_NEXT = "完整性无保障，已拒载。下一步：① 让源执行 ojm market build-index --id <publisher.id> 重建并签名；② 或对既有索引补签 ojm publish <目录> --id <publisher.id>";

/**
 * 拉取索引并校验签名（REG-CS1，G4 fail-closed）——三级化后（catalog + shards）：
 * ① `.sig` 缺失 / 空 / 拉不到 → **拒载**（502）——不再「滚动发布期容忍」：
 *    容忍等于把索引完整性交给发布方自觉，谁改了索引都能装。
 * ② 签名不符或未覆盖代次 → 拒载（index_sig_mismatch）。
 * ③ 同代校验改「钉值」口径：catalog 正文 `shards: {<片号>: <代次>}` 钉每片的代次，
 *    分片签名 seq 必须等于钉值（`expectSeq`）——不等即拒（index_generation_mismatch，
 *    提示「源正在重建索引」）。byte 级相同的分片可跨代复用，故钉值而非恒等于 catalog 代次。
 * ④ catalog 另过两道新鲜度闸（REG-CS2，见 `guardCatalogFreshness`）：时效过期 `index_expired`、
 *    seq 回退 `index_stale`——回放与镜像落后在此处被挡住。
 *
 * `no` = 分片号（catalog 省略）；`expectSeq` = catalog 对该片的钉值（取 catalog 本身时省略）。
 * 关键：四类拒载都在 try 之外抛出——fail-closed 不能被任何 catch 吞掉。
 */
async function fetchIndex(env: MarketEnv, source: IndexSource, base: string, kind: IndexKind, no?: number, expectSeq?: number): Promise<{ text: string, seq: number }> {
	// 人话里的文件名与 CDN 布局逐字一致（indexPathOf 单点）：shards/<n>.yaml，不是 shard/<n>.yaml
	const label = indexPathOf(kind, no);
	const file = await source.read(kind, no);
	if (file === null)
		fail(502, `市场索引 ${label} 拉取失败（请检查市场地址与网络）`);
	const sigText = file.sig;
	if (sigText === null || sigText.trim() === "")
		fail(502, `市场索引 ${label} 缺签名文件 ${label}.sig（index_sig_missing）——${SIG_MISSING_NEXT}`);
	const verdict = verifyIndexSig(env, kind, file.body, sigText);
	if (!verdict.ok || verdict.seq === null)
		fail(502, `市场索引 ${label} 签名校验失败（index_sig_mismatch：索引被篡改、签名不符或签名未覆盖代次，G4 fail-closed）——请重新发布并签名`);
	const seq = verdict.seq;
	// 正文自带代次时（catalog）必须与签名一致——防止「改了正文没换签名」的半个写入；
	// 分片正文是纯内容（无顶层 seq），代次只由签名 + catalog 钉值携带，故不过此闸。
	const textSeq = await indexSeqOfText(file.body);
	if (textSeq !== null && textSeq !== seq)
		fail(502, `市场索引 ${label} 正文是第 ${textSeq} 代、签名是第 ${seq} 代（index_generation_mismatch）——源正在重建索引，请稍后重试`);
	if (expectSeq !== undefined && expectSeq !== seq)
		fail(502, `市场索引 ${label} 签名是第 ${seq} 代，总目录钉的是第 ${expectSeq} 代（index_generation_mismatch）——源正在重建索引，请稍后重试`);
	// ④ 新鲜度只在 catalog 上判一次：代次真源与时效盖章都在它身上，分片跟着走
	if (kind === "catalog")
		await guardCatalogFreshness(env, base, file.body, seq);
	return { text: file.body, seq };
}

/**
 * REG-CS2 索引新鲜度（防回放/降级）：总目录过了签名之后还要过时效与代次水位两道闸。
 *
 * - `expires_at` 已过 → `index_expired`：索引自带失效时刻，源停止运营超过 TTL 就不再可信。
 *   （§5.3 可用性通道的「窗口内用缓存副本」由 HTTP 缓存层兑现——服务端
 *    `max-age=60, stale-while-revalidate=60` + 读取器条件请求；到达读取器手里的副本
 *    自身过期即拒，与§5.3 不冲突。）
 * - `seq` 小于本源见过的最大代次 → `index_stale`：镜像落后或旧索引被回放。
 * - 水位读不到/写不进 → `index_state_corrupt`：fail-closed，不静默重置成「第一次见」。
 */
async function guardCatalogFreshness(env: MarketEnv, base: string, text: string, seq: number): Promise<void> {
	const times = await indexTimesOfText(text);
	if (times === null)
		fail(502, "市场索引 catalog.yaml 缺 issued_at / expires_at（index_expired）——索引未带时效，请让源执行 ojm market build-index 重建");
	const now = env.now?.() ?? Math.floor(Date.now() / 1000);
	if (now > times.expires_at)
		fail(502, `市场索引 catalog.yaml 已于 ${new Date(times.expires_at * 1000).toISOString()} 失效（index_expired）——源未在其自声明的有效期内重建索引，请让源执行 ojm market build-index 后再装`);

	let verdict: SourceSeqVerdict;
	try {
		verdict = await guardAndRecordSourceSeq(base, seq);
	}
	catch {
		fail(502, "市场索引代次水位写不进去（index_state_corrupt）——reg_source_seq 不可写，防回放保护失效，已拒载。请检查站点数据库权限后重试");
	}
	if (verdict.ok)
		return;
	if (verdict.code === "index_stale")
		fail(502, `市场索引 catalog.yaml 是第 ${seq} 代，本源已见过第 ${verdict.prev} 代（index_stale）——源可能被回放或镜像落后，请核实源状态后再装`);
	fail(502, "市场索引代次水位不可读（index_state_corrupt）——reg_source_seq 记录损坏，请检查站点数据库后重试（不静默重置，否则防回放形同虚设）");
}

/**
 * catalog 解析（REG-CS5：包名 → 分片号 + 片号 → 代次钉值）。畸形即拒不猜——索引是签名过的
 * 不可信输入，结构破损与字节被改同类对待（G4 fail-closed）。
 */
async function parseCatalog(text: string, base: string): Promise<{ pins: Map<number, number>, solutions: Array<{ name: string, shards: number[] }> }> {
	const g = globalThis as { yaml?: { parse: (t: string) => Promise<unknown> } };
	let doc: unknown;
	try {
		doc = await g.yaml!.parse(text);
	}
	catch {
		fail(502, `市场索引解析失败：${base}/catalog.yaml 不是合法索引`);
	}
	if (!isObj(doc))
		fail(502, `市场索引解析失败：${base}/catalog.yaml 不是键值文档`);
	const pins = new Map<number, number>();
	if (isObj(doc.shards)) {
		for (const [k, v] of Object.entries(doc.shards)) {
			const no = Number(k);
			if (Number.isInteger(no) && no >= 1 && typeof v === "number" && Number.isInteger(v) && v >= 1)
				pins.set(no, v);
		}
	}
	if (pins.size === 0)
		fail(502, "市场索引 catalog.yaml 的分片钉值为空（index_generation_mismatch）——索引结构破损，请让源执行 ojm market build-index 重建");
	const solutions: Array<{ name: string, shards: number[] }> = [];
	for (const s of Array.isArray(doc.solutions) ? doc.solutions : []) {
		if (!isObj(s) || typeof s.name !== "string" || s.name === "")
			continue;
		// 片号须是已钉值正整数：指向未钉片的方案 = 结构破损，拒载（不静默跳过，那会伪装成「没有该方案」）
		const nos = Array.isArray(s.shards) ? s.shards.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && pins.has(n)) : [];
		if (nos.length === 0)
			fail(502, `市场索引 catalog.yaml 中方案「${s.name}」未指向任何已钉分片（index_generation_mismatch）——索引结构破损，请让源执行 ojm market build-index 重建`);
		solutions.push({ name: s.name, shards: nos });
	}
	return { pins, solutions };
}

/** 分片内的方案条目（版本条目 = Form B manifest：name/version/archive/yanked/yanked_at + manifest 全字段） */
interface ShardSolution {
	name: string
	latest: string | null
	versions: Array<Record<string, unknown>>
}

/** 分片解析（纯内容无 meta：`{solutions: [{name, latest, versions}]}`；结构破损即拒，不猜） */
async function parseShard(text: string, label: string): Promise<ShardSolution[]> {
	const g = globalThis as { yaml?: { parse: (t: string) => Promise<unknown> } };
	let doc: unknown;
	try {
		doc = await g.yaml!.parse(text);
	}
	catch {
		fail(502, `市场索引 ${label} 不是合法索引（解析失败）`);
	}
	if (!isObj(doc) || !Array.isArray(doc.solutions))
		fail(502, `市场索引 ${label} 解析失败：缺 solutions 数组——索引结构破损，请让源执行 ojm market build-index 重建`);
	const out: ShardSolution[] = [];
	for (const s of doc.solutions) {
		if (!isObj(s) || typeof s.name !== "string" || s.name === "")
			continue;
		out.push({
			name: s.name,
			latest: typeof s.latest === "string" ? s.latest : null,
			versions: Array.isArray(s.versions) ? s.versions.filter(isObj) : [],
		});
	}
	return out;
}

/** 索引读取源（DIP，REG-CS5③）：注入面优先，缺省按 CDN 基址 + fetchOf 构造 HTTP 源 */
async function indexSourceOf(env: MarketEnv, base: string): Promise<IndexSource> {
	return env.indexSource ?? httpIndexSource(await fetchOf(env), base);
}

/** 索引时效（顶层 `issued_at` / `expires_at`；缺任一或非数 → null，按 REG-CS2 拒） */
async function indexTimesOfText(text: string): Promise<{ issued_at: number, expires_at: number } | null> {
	const g = globalThis as { yaml?: { parse: (t: string) => Promise<unknown> } };
	try {
		const doc = await g.yaml!.parse(text) as unknown;
		if (doc === null || typeof doc !== "object" || Array.isArray(doc))
			return null;
		const issuedAt = (doc as Record<string, unknown>).issued_at;
		const expiresAt = (doc as Record<string, unknown>).expires_at;
		if (typeof issuedAt !== "number" || typeof expiresAt !== "number")
			return null;
		return { issued_at: issuedAt, expires_at: expiresAt };
	}
	catch {
		return null;
	}
}

/** http.user.id → username（operator 历史留痕，uninstall 端点同款反查；查询失败不阻断编排） */
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
 * Form B 索引解析（安装器不拼 URL——市场侧职责，installer.ts 同纪律）：
 * catalog.yaml 定包名 → 分片号（无版本明细）→ 分片内按版本精确取（版本条目即 manifest，
 * 原 manifests.yaml 聚合清单并入分片，装一个包不再有第三份全量拉取）→ 分发包 URL =
 * base + 条目 archive.file。分片按号**降序**尝试：装箱口径下新版本进新片，最高片持有
 * 最新版——latest 安装只拉 1 片（REG-CS5 验收：一次安装索引请求 ≤ 1 catalog + 1 shard）。
 */
async function resolveCdn(env: MarketEnv, base: string, name: string, reqVersion: string | null, fetch: FetchInitFace): Promise<ResolvedBundle> {
	const source = httpIndexSource(fetch, base);
	// 总目录（catalog）= 代次与时效真源；分片钉值同代才可用（REG-CS1③）
	const catalog = await fetchIndex(env, source, base, "catalog");
	const { pins, solutions } = await parseCatalog(catalog.text, base);
	const entry = solutions.find(s => s.name === name);
	if (entry === undefined)
		fail(404, `市场索引中无方案「${name}」（${base}/catalog.yaml）`);
	// 降序：最高片先试（latest 路径一片即中）；精确老版本落在低片时继续往下，直到找到或找遍
	for (const no of [...entry.shards].sort((a, b) => b - a)) {
		const pin = pins.get(no);
		if (pin === undefined)
			fail(502, `市场索引 catalog.yaml 钉值缺 shards/${no}.yaml（index_generation_mismatch）——源正在重建索引，请稍后重试`);
		const shard = await fetchIndex(env, source, base, "shard", no, pin);
		const sol = (await parseShard(shard.text, `shards/${no}.yaml`)).find(s => s.name === name);
		if (sol === undefined)
			continue;
		// REG-CS2 `latest` 单调不降（三级化后移到分片条目）：分片声明的 latest 不得低于本片
		// 已声明版本中的最高未下线版本。把 latest 往下改是「让站点装回旧版」的最短路径
		// （yank 之后回退声明），必须挡在解析处。已下线版本（REG-CS4 yanked）不计入——
		// 否则 yank 掉最高版会把 latest 主动下调，被误判成索引回退；latest 本就指向未下线的最高版。
		const liveSorted = sol.versions.filter(v => v.yanked !== true).map(v => String(v.version)).sort(compareVersions);
		const highest = liveSorted.length === 0 ? null : liveSorted[liveSorted.length - 1]!;
		if (sol.latest !== null && highest !== null && compareVersions(sol.latest, highest) < 0)
			fail(502, `市场索引中方案「${name}」的 latest 是 ${sol.latest}，低于已声明的最高版本 ${highest}（index_latest_regressed）——索引被回退，请核实源状态后再装`);
		const version = reqVersion ?? sol.latest;
		if (version !== null) {
			const hit = sol.versions.find(v => String(v.version) === version);
			if (hit !== undefined) {
				// REG-CS4 yank：精确指定被下线版本 → 拒装（latest 路径不命中，源方 rebuilt 时 latest 已跳过 yanked）；
				// 已装实例不受影响（不在此解析路径内）。错误信息明示「版本已下线」而非「无此版本」，避免误导。
				if (reqVersion !== null && hit.yanked === true)
					fail(409, `方案「${name}」版本「${version}」已被发布方下线（REG-CS4 yank），无法安装；已安装实例不受影响。如需继续请联系发布方或改用其他版本`);
				// P2-11 索引投毒加固：archive.file 逐字 <name>-<version>.tgz（索引是签名过的不可信输入，
				// 过弱形态可拼宿主任意路径；逐字等值排除 ../、绝对路径、异名、异版本）
				const archive = isObj(hit.archive) ? hit.archive : {};
				const file = typeof archive.file === "string" ? archive.file : "";
				if (file !== `${name}-${version}.tgz`) {
					fail(502, `索引分发包 file「${file}」须逐字为 <name>-<version>.tgz（「${name}-${version}.tgz」）——索引投毒加固（P2-11），疑似被篡改的索引`);
				}
				// 版本条目即 Form B manifest（原 manifests.yaml 并入分片）：取到条目即取到 manifest
				return { version, archiveUrl: `${base}/${file}`, manifest: hit };
			}
		}
		// 版本不在这片（更低分片或真没有）：继续往低片找
	}
	fail(404, `市场索引中无方案「${name}」版本「${reqVersion ?? "latest"}」（${base}/catalog.yaml → shards）`);
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
		const r = await resolveCdn(env, base, name, reqVersion, await fetchOf(env));
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

/** 最近一次安装操作人（回落 market_history 行；表不存在/查询失败/无行 → null，观测面不阻断索引） */
async function lastInstallOperatorOf(name: string): Promise<string | null> {
	try {
		const rows = await db.table("market_history")
			.select(["operator"])
			.where({ field: "solution", op: "eq", value: name })
			.where({ field: "action", op: "eq", value: "install" })
			.orderBy([{ field: "created_at", dir: "desc" }, { field: "rowid", dir: "desc" }])
			.limit(1)
			.all() as Array<{ operator: unknown }>;
		const op = rows[0]?.operator;
		return typeof op === "string" ? op : null;
	}
	catch {
		return null;
	}
}

/**
 * GET index 主体：CDN catalog + shards ⊕ 本地 sidecar state——CDN 序优先，本地独有方案殿后。
 *
 * 三级化后市场页的拉取形态：1 catalog + catalog 指向的全部分片（去重）——`available`
 * 回滚候选要版本全集，故页面比安装多拉几片；安装侧仍 ≤ 1 catalog + 1 shard（resolveCdn）。
 * 版本条目即 Form B manifest：latest 的 changelog/publisher/summary/description 直接从
 * 分片条目取，不再有独立的聚合清单拉取。分片拉取/验签失败即 502（REG-CS1：可用性不再
 * 压过完整性）。
 */
interface IndexSnapshot {
	base: string
	/** catalog 的签名时效（发布时间兜底；索引缺时效 → null） */
	issuedAt: number | null
	solutions: Array<{ name: string, shards: number[] }>
	shardDocs: Map<number, ShardSolution[]>
}

/**
 * 读整份签名索引（catalog + 它指向的全部分片）。
 *
 * 市场卡片（indexBody）与发布历史（syncReleases）都要「全量版本视图」，读取与验签只有这一份：
 * 两处各写一遍 `fetchIndex` 循环，迟早漂移成「卡片看得见、历史看不见」。
 */
async function readIndexSnapshot(env: MarketEnv): Promise<IndexSnapshot> {
	const base = await cdnBaseOf(env);
	if (base === null)
		fail(503, "未配置市场地址（framework.market_cdn_url）——卡片区显示「未配置市场地址」（PRD §5.3）");
	await assertOriginForRelativeBase(env, base);
	const source = await indexSourceOf(env, base);
	const catalog = await fetchIndex(env, source, base, "catalog");
	const times = await indexTimesOfText(catalog.text);
	const { pins, solutions } = await parseCatalog(catalog.text, base);
	// 拉取 catalog 指向的全部分片（去重、升序确定性）；每片都过签名 + 钉值同代校验
	const shardDocs = new Map<number, ShardSolution[]>();
	for (const no of [...pins.keys()].sort((a, b) => a - b)) {
		const shard = await fetchIndex(env, source, base, "shard", no, pins.get(no)!);
		shardDocs.set(no, await parseShard(shard.text, `shards/${no}.yaml`));
	}
	return { base, issuedAt: times?.issued_at ?? null, solutions, shardDocs };
}

async function indexBody(env: MarketEnv): Promise<IndexRow[]> {
	// 对账即服务（P1-10 接线③）：市场页刷新即对账时点——锁 ↔ 账本 head 自愈 + enabled 不一致
	// 自动修复先行（失败只记日志，不阻断索引），失败站点的市场页每次打开都在尝试自愈
	await reconcileOf(env);
	const { solutions, shardDocs } = await readIndexSnapshot(env);
	const local = (await createStateStore(env.statePath)).read().solutions;
	const rows: IndexRow[] = [];
	const seen = new Set<string>();
	for (const entry of solutions) {
		const name = entry.name;
		if (seen.has(name))
			continue;
		seen.add(name);
		// 合并该包全部分片的版本条目（降序拼：最高片持有最新版，latest 取首片即得）
		const merged: Array<Record<string, unknown>> = [];
		let latest: string | null = null;
		for (const no of [...entry.shards].sort((a, b) => b - a)) {
			const sol = shardDocs.get(no)?.find(s => s.name === name);
			if (sol === undefined)
				continue;
			if (latest === null)
				latest = sol.latest;
			merged.push(...sol.versions);
		}
		const side = local[name];
		// available：版本全集（缺段/畸形 → [] 降级）；分片内升序、跨片重排为全局升序
		const available = merged.map(v => typeof v.version === "string" ? v.version : "").filter(x => x !== "").sort(compareVersions);
		const manifestOf = (version: string | null): Record<string, unknown> | undefined =>
			version === null ? undefined : merged.find(v => String(v.version) === version);
		const m = manifestOf(latest) ?? manifestOf(side?.version ?? null);
		// 发布者：取最新版 Form B archive.signature.key_id（Ed25519 验签过的签名身份，离线可验）；
		// manifest.author 是自报字段，二者不同。缺签名/畸形 → null（不拿自报值冒充）。
		const rawArchive: unknown = m?.archive;
		const rawSig: unknown = isObj(rawArchive) ? rawArchive.signature : undefined;
		const publisherKey = isObj(rawSig) && typeof rawSig.key_id === "string" ? rawSig.key_id : null;
		rows.push({
			name,
			latest,
			installed: side?.version ?? null,
			enabled: side?.enabled ?? null,
			upgradable: latest !== null && side !== undefined && compareVersions(side.version, latest) < 0,
			available,
			changelog: m?.changelog ?? null,
			publisher: typeof m?.author === "string" ? m.author : null,
			publisher_key: publisherKey,
			license: typeof m?.license === "string" ? m.license : null,
			summary: typeof m?.summary === "string" ? m.summary : null,
			description: typeof m?.description === "string" ? m.description : null,
			trust_state: side?.trust_state ?? null,
			key_id: side?.archive?.key_id ?? null,
			operator: await lastInstallOperatorOf(name),
		});
	}
	for (const [name, side] of Object.entries(local)) {
		if (!seen.has(name)) {
			rows.push({
				name,
				latest: null,
				installed: side.version,
				enabled: side.enabled,
				upgradable: false,
				available: [],
				changelog: null,
				publisher: null,
				publisher_key: null,
				license: null,
				summary: null,
				description: null,
				trust_state: side.trust_state ?? null,
				key_id: side.archive?.key_id ?? null,
				operator: await lastInstallOperatorOf(name),
			});
		}
	}
	return rows;
}

/** 发布历史行（市场索引里出现过的每个 product@version） */
interface ReleaseRow {
	id: number
	product: string
	version: string
	key_id: string | null
	sha256: string | null
	size: number | null
	published_at: number
	/** 时间来源：file = tgz 的 Last-Modified；index = 索引生成时间兜底 */
	published_at_source: "file" | "index"
	yanked: number
}

/**
 * 取单版本的「发布时间」。
 *
 * 优先 HEAD 分发包读 `Last-Modified`——那是包落进 CDN 的时刻，也就是真正的发版时间。
 * 读不到（源不吐该头 / 网络失败 / file 名缺失）才回落到索引生成时间：`ojm market publish`
 * 与 `build-index` 在推荐流程里紧邻执行，两者差值只有重建索引的耗时。
 *
 * 只对**首次入库**的版本调一次（已入库的 published_at 不再改写）——历史一旦记录就是事实，
 * 不该被后续重新发布/重新建索引刷新。
 */
async function archivePublishedAt(env: MarketEnv, base: string, file: unknown, fallback: number): Promise<{ at: number, source: "file" | "index" }> {
	if (typeof file !== "string" || file === "")
		return { at: fallback, source: "index" };
	try {
		// HEAD 不在 FetchInitFace 的最小形状里（安装面只需要 GET），但运行时 fetch 原生支持：
		// 这里显式窄化一次，避免为「读一个头」再造第二种下载实现。
		const head = await fetchOf(env) as unknown as (url: string, init?: { method?: string }) => Promise<{ headers?: { get: (n: string) => string | null } }>;
		const res = await head(`${base}/${encodeURIComponent(file)}`, { method: "HEAD" });
		const raw = res.headers?.get?.("last-modified") ?? res.headers?.get?.("Last-Modified") ?? null;
		if (raw !== null && raw !== "") {
			const at = Math.floor(Date.parse(raw) / 1000);
			if (Number.isFinite(at) && at > 0)
				return { at, source: "file" };
		}
	}
	catch {}
	return { at: fallback, source: "index" };
}

/**
 * 把索引里出现过的版本同步进 `market_release`（幂等：只补新行）。
 *
 * 为什么不做成「发版时由 CLI 上报」：`ojm market publish` 是纯本地操作（不登录、可离线），
 * 加一条上报链路就得再造一套写端授权的信任面；而**签名索引本身就是发版事实**——
 * 站点已经在读它，历史直接从这里落库，既不用新协议，也不会出现「上报成功但包里没有」的分叉。
 *
 * 索引拉取/验签失败由调用方兜住（历史是观测面，不阻断页面：返回已入库行 + syncError）。
 */
async function syncReleases(env: MarketEnv): Promise<void> {
	const snapshot = await readIndexSnapshot(env);
	const fallbackAt = snapshot.issuedAt ?? (env.now?.() ?? Math.floor(Date.now() / 1000));
	const now = env.now?.() ?? Math.floor(Date.now() / 1000);

	const existingRows = await db.table("market_release").select(["id", "product", "version", "yanked"]).all() as Array<Record<string, unknown>>;
	const existing = new Map(existingRows.map(r => [`${String(r.product)}@${String(r.version)}`, { id: Number(r.id), yanked: Number(r.yanked) }]));

	for (const sol of snapshot.shardDocs.values()) {
		for (const entry of sol) {
			for (const v of entry.versions) {
				const version = typeof v.version === "string" ? v.version : "";
				if (version === "")
					continue;
				const dedupeKey = `${entry.name}@${version}`;
				const yanked = v.yanked === true ? 1 : 0;
				const prior = existing.get(dedupeKey);
				if (prior !== undefined) {
					// 已入库的 published_at 是事实、不再改写；但 yank 状态是「当前是否在架」，跟随索引
					if (prior.yanked !== yanked)
						await db.table("market_release").update({ yanked }).where({ field: "id", op: "eq", value: prior.id }).run();
					continue;
				}
				const archive = isObj(v.archive) ? v.archive : {};
				const sig = isObj(archive.signature) ? archive.signature : {};
				const { at, source } = await archivePublishedAt(env, snapshot.base, archive.file, fallbackAt);
				try {
					await db.table("market_release").insert({
						product: entry.name,
						version,
						key_id: typeof sig.key_id === "string" ? sig.key_id : null,
						sha256: typeof archive.sha256 === "string" ? archive.sha256 : null,
						size: typeof archive.size === "number" ? archive.size : null,
						published_at: at,
						published_at_source: source,
						yanked,
						first_seen_at: now,
					}).run();
					existing.set(dedupeKey, { id: -1, yanked });
				}
				catch {
					// 并发同步（两个页面同时打开）撞唯一键：另一路已写入，跳过即可
				}
			}
		}
	}
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
		archive.signature = { alg: row.sig_alg, key_id: row.key_id, public_key: row.sig_public_key, value: row.sig_value, canon: "v2" };
	return { ...base, name: product, version: String(row.version), yanked: Number(row.yanked) === 1, archive };
}

/** market_release 行 → manifest 摘要对象（catalog 展示字段源；NULL/坏行 → null 降级） */
function manifestSummaryOf(row: Record<string, unknown>): Record<string, unknown> | null {
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
async function catalogBody(q: Record<string, unknown>): Promise<Record<string, unknown>> {
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
	return { api_version: CATALOG_API_VERSION, page, size, total, truncated: offset + slice.length < total, items: slice };
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
		.select(["product", "version", "key_id", "sha256", "size", "yanked", "sig_alg", "sig_value", "sig_public_key", "manifest"])
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

/** 四端点组（oj v0.1.64 嵌套组：组名 = 路径段）；全业务体经 respond 收口（status 语义不落 500） */
export function createMarketApi(env: MarketEnv) {
	return {
		// POST /api/_platform/market/install —— 安装编排（superadmin，R9）
		"install": {
			async post() {
				await respond(async () => {
					await assertSuperAdmin();
					return await installBody(env);
				});
			},
			// POST /api/_platform/market/install/cancel —— 取消进行中的安装（superadmin，U5/P3-12）。
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
		// GET /api/_platform/market/task?id= —— 任务轮询消费面（superadmin，§10.2 800ms 轮询）。
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
		// POST /api/_platform/market/enable —— 生命周期开关（superadmin；P1-13 瘦客户端触发面）。
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
		// GET /api/_platform/market/meta —— 登录即可（{apiVersion}，peerPlatform 预检；非 superadmin）
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
		// GET /api/_platform/market/index —— 市场索引聚合（superadmin，R9）
		"index": {
			async get() {
				await respond(async () => {
					await assertSuperAdmin();
					return await indexBody(env);
				});
			},
		},
		// GET /api/_platform/market/catalog —— 市场目录清单（v4 §三：**匿名可读**，分页 JSON；
		// DB 直读合成单协议 shape，远端市场消费同一 shape）。no-store 防中间代理缓存陈旧目录。
		"catalog": {
			async get() {
				await respond(async () => {
					return await catalogBody((http.query ?? {}) as Record<string, unknown>);
				});
			},
			// GET /api/_platform/market/catalog/detail?name=[&version=] —— 单包详情（匿名可读；
			// 保留 yanked 条目 + 服务端组表 archive 正名，安装解析数据源，§四）
			detail: {
				async get() {
					await respond(async () => {
						return await detailBody((http.query ?? {}) as Record<string, unknown>);
					});
				},
			},
		},
		// GET /api/_platform/market/uninstall-impact?name= —— 卸载影响面预检（superadmin，R9）。
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
		// POST /api/_platform/market/uninstall —— 卸载编排（superadmin，R9）。
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

		// GET /api/_platform/market/history —— 市场操作历史（只读消费面，供前端 HistoryDrawer）。
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

		// GET /api/_platform/market/releases —— 发布历史（登录即可读；与市场卡片同口径的「浏览开放」）。
		//
		// 数据源是签名索引本身：每次读取先把索引里出现过的 product@version 补进 market_release
		// （只补新行，published_at 一次写定），再按发布时间倒序分页返回。索引拉不到/验签失败
		// 不阻断查询：返回已入库行 + syncError，页面照常显示历史并提示「暂时读不到索引」。
		"releases": {
			async get() {
				await respond(async () => {
					const uid = (http as { user?: { id?: unknown } }).user?.id;
					if (uid == null)
						fail(401, "unauthorized");
					let syncError: string | null = null;
					try {
						await syncReleases(env);
					}
					catch (e) {
						syncError = e instanceof Error ? e.message : String(e);
					}
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
					return { list, total, page, size, syncError };
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
marketApi.index.get.response = { type: "array", items: { type: "object", additionalProperties: true } };
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
		syncError: { type: ["string", "null"] },
	},
};

export default marketApi;
