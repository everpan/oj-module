// 编排端点 + 市场索引（P1-12，R9/ISP）：/api/_platform/market/* 端点族同文件嵌套 handler 组
// （oj v0.1.64 组形态，notification/api.ts 同款；组名 = 路径段，路由不变；嵌套组最深 4 层，oj bridge/mod.rs walker）。
// 门（R9）：install/task/index 全 assertSuperAdmin 独占（市场页是「市场即样例」的第一方特权
// 例外，R29；权限码不构成门）；meta 登录即可（peerPlatform 预检先于判权）。
// 职责边界（ISP）：端点只做 门禁 + Form B 索引解析（安装器不拼 URL，installer.ts 同纪律）+
// InstallRequest 组装；任务生命周期/失败三分/终态审计全归 runInstall 状态机（P1-10），端点不重复编排。
// CDN 基址：sys_setting `framework.market_cdn_url`（PRD §5.3，缺省空 = 市场不可用，可读错误不崩）；
// 索引/清单拉取恒带 Cache-Control: no-cache（索引时效性）。
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
import { fsFace } from "../_lifecycle/atomic";
import { latestAppliedSeqOf, reconcile, runInstall, setEnabled } from "../_lifecycle/installer";
import { compareVersions } from "../_lifecycle/semver";
import { sha384B64 } from "../_lifecycle/sha384";
import { createStateStore } from "../_lifecycle/state";
import { flattenBundleRoot } from "../_lifecycle/steps/extract";
import { getTask } from "../_lifecycle/tasks";
import { validateTarListing } from "../_lifecycle/tgz-guard";
import { createTrustStore } from "../_lifecycle/trust";
import { computeUninstallImpact, runUninstall } from "../_lifecycle/uninstall";
import { respond } from "../_shared/respond";
import { assertSuperAdmin } from "../_shared/service/access";
import { journalHeadOf, siteOrigin, withSiteOrigin } from "../_shared/site-facade";
import { BOOTSTRAP_KEY, seedBootstrapKey } from "./bootstrap";

// 站点编排面共享真源落 _shared/site-facade（P2-16 真机构建钉出：api.ts 是路由入口不可被模块内
// import）；此处 re-export 保持既有引用面（market-api.spec / 历史 import 路径）不变。
export { journalHeadOf, siteOrigin, withSiteOrigin };
export type { FetchInitFace };

/** 平台编排面版本（镜像 _platform/manifest.yaml version；peerPlatform 预检口径，manifest 升版须同步） */
const API_VERSION = "0.1.0";

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
	/** 站点 web 模块目录（<dist>/modules） */
	siteModulesDir: string
	/** 站点 modules.json 路径（与 siteModulesDir 同属 <dist>） */
	modulesJsonPath: string
	/** API 前缀（smoke 探针 URL 前缀） */
	apiPrefix: string
	/** 站点 config.yaml 路径（reloading 段 vars.ojm_install_seq 自增落盘处；缺省 config.yaml） */
	configPath?: string
	/** CDN 基址（缺省读 sys_setting `framework.market_cdn_url`；测试注入） */
	cdnBase?: () => Promise<string | null>
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
	/**
	 * 宿主 versions.json（C2-09 peerRuntime 比对真源，键 = 包名）。缺省读 <dist>/versions.json
	 * （ojm 宿主构建产物，与 modules.json 同目录，B-11 接线）；不可得 → undefined，manifest 声明
	 * peerRuntime 即预检 fail-closed 拒装（C2-09 语义保持）。
	 */
	hostVersions?: Record<string, string>
}

/** 宿主 versions.json 布局推导（B-11）：与 modules.json 同目录（<dist>/versions.json） */
export function versionsJsonPathOf(modulesJsonPath: string): string {
	const slash = modulesJsonPath.lastIndexOf("/");
	return slash === -1 ? "versions.json" : `${modulesJsonPath.slice(0, slash)}/versions.json`;
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

/** hostVersions 注入缺省：显式注入优先，否则读 <dist>/versions.json；不可得 → undefined（C2-09 fail-closed） */
async function hostVersionsOf(env: MarketEnv): Promise<Record<string, string> | undefined> {
	if (env.hostVersions !== undefined) {
		return env.hostVersions;
	}
	try {
		return parseVersionsJson(new TextDecoder().decode(await fsFace().readFile(versionsJsonPathOf(env.modulesJsonPath))));
	}
	catch {
		return undefined;
	}
}

/** oj serve release 布局生产缺省（P1-16 B3/B4；全字段可覆盖） */
export function marketEnv(): MarketEnv {
	return {
		sharedRoot: "dist",
		staging: "modules/.staging",
		taskDir: "modules/.install-tasks",
		statePath: "modules/.solutions/state.yaml",
		trustPath: ".solutions/trusted-keys.yaml",
		dbPath: "db.sqlite",
		siteModulesDir: "dist/modules",
		modulesJsonPath: "dist/modules.json",
		apiPrefix: "/api",
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

function fetchOf(env: MarketEnv): FetchInitFace {
	return env.fetch ?? (globalThis as { fetch?: FetchInitFace }).fetch as FetchInitFace;
}

function execOf(env: MarketEnv): ExecFace {
	const g = globalThis as { exec?: { run: ExecFace["run"] } };
	return env.exec ?? { run: (argv, opts) => g.exec!.run(argv, opts) };
}

function reloadOf(env: MarketEnv): ReloadFace {
	const g = globalThis as { server?: { reloadConfig: ReloadFace["reloadConfig"] } };
	return env.reload ?? { reloadConfig: () => g.server!.reloadConfig() };
}

function sha384Of(env: MarketEnv): (data: Uint8Array) => string {
	// oj isolate 无 sha384 原语（0.1.78 实测）→ 纯 JS 过渡实现兜底；isolate 原语落地后可换回
	return env.sha384B64 ?? sha384B64;
}

function sha256Of(env: MarketEnv): (data: Uint8Array) => string {
	const g = globalThis as { crypto?: { sha256Hex?: (data: Uint8Array) => string } };
	return env.sha256Hex ?? ((data: Uint8Array) => g.crypto!.sha256Hex!(data));
}

/** CDN 基址：注入面优先，缺省读设置表（值/缺省值俱空 = 未配置；表异常视同未配置，消费端给可读错误） */
async function cdnBaseOf(env: MarketEnv): Promise<string | null> {
	if (env.cdnBase) {
		const injected = String(await env.cdnBase() ?? "").trim();
		return injected === "" ? null : injected.replace(/\/+$/, "");
	}
	try {
		const rows = await db.query("select value, default_value from sys_setting where key = ?", ["framework.market_cdn_url"]) as Array<Record<string, unknown>>;
		const v = String(rows[0]?.value ?? rows[0]?.default_value ?? "").trim().replace(/\/+$/, "");
		return v === "" ? null : v;
	}
	catch {
		return null;
	}
}

/** CDN 文本拉取（bundles.yaml/manifests.yaml）：恒带 Cache-Control: no-cache（索引时效性） */
async function fetchText(fetch: FetchInitFace, url: string): Promise<string> {
	const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
	if (!res.ok)
		fail(502, `索引拉取失败：${url} 返回 HTTP ${res.status}（请检查市场地址与网络）`);
	return new TextDecoder().decode(await res.arrayBuffer());
}

/** http.user.id → username（operator 历史留痕，uninstall 端点同款反查；查询失败不阻断编排） */
async function operatorOf(): Promise<string | null> {
	const uid = (http as { user?: { id?: unknown } }).user?.id;
	if (uid == null) {
		return null;
	}
	try {
		const u = await db.query("select username from users where id = ?", [uid]) as Array<{ username: string }>;
		return u[0]?.username ?? null;
	}
	catch {
		return null;
	}
}

/** sys_solution_route enabled（reconcile route 一致性面；无行/查询失败 → null 不猜） */
async function routeEnabledOf(name: string): Promise<boolean | null> {
	try {
		const rows = await db.query("select enabled from sys_solution_route where module = ? and deprecated = 0 limit 1", [name]) as Array<{ enabled: unknown }>;
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
 * bundles.yaml 定版本（缺省 latest，同名只展示最高版本 PRD §5.3）→ manifests.yaml 按
 * name+version 精确取 manifest → 分发包 URL = base + 索引 file 字段。
 */
async function resolveCdn(base: string, name: string, reqVersion: string | null, fetch: FetchInitFace): Promise<ResolvedBundle> {
	const g = globalThis as { yaml?: { parse: (text: string) => Promise<unknown> } };
	const bundles = await g.yaml!.parse(await fetchText(fetch, `${base}/bundles.yaml`)) as { solutions?: unknown };
	const entry = (Array.isArray(bundles.solutions) ? bundles.solutions : []).find(s => isObj(s) && s.name === name);
	if (!isObj(entry))
		fail(404, `市场索引中无方案「${name}」（${base}/bundles.yaml）`);
	const versions = Array.isArray(entry.versions) ? entry.versions.filter(isObj) : [];
	const version = reqVersion ?? (typeof entry.latest === "string" ? entry.latest : null);
	const hit = versions.find(v => String(v.version) === version);
	if (version === null || !isObj(hit))
		fail(404, `市场索引中无方案「${name}」版本「${reqVersion ?? "latest"}」（${base}/bundles.yaml）`);
	const list = await g.yaml!.parse(await fetchText(fetch, `${base}/manifests.yaml`)) as unknown;
	const manifest = (Array.isArray(list) ? list : []).find(m => isObj(m) && m.name === name && String(m.version) === version);
	if (!isObj(manifest))
		fail(404, `聚合清单缺 ${name}@${version} 的 manifest（manifests.yaml 与 bundles.yaml 不一致，Form B 真源破损）`);
	// P2-11 索引投毒加固：bundles.yaml 的 file 逐字 <name>-<version>.tgz（索引未签名属不可信输入，
	// 过弱形态可拼宿主任意路径；逐字等值排除 ../、绝对路径、异名、异版本）
	const file = typeof hit.file === "string" ? hit.file : "";
	if (file !== `${name}-${version}.tgz`) {
		fail(502, `索引分发包 file「${file}」须逐字为 <name>-<version>.tgz（「${name}-${version}.tgz」）——索引投毒加固（P2-11），疑似被篡改的 bundles.yaml`);
	}
	return { version, archiveUrl: `${base}/${file}`, manifest };
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
 * file 源 manifest 提取：上传包先过 R1 三步范式（tar -tvzf 列表 → validateTarListing →
 * tar -xzf -C staging）再读 manifest.yaml——未校验不解包，zip-slip 拒在信任边界外。
 * 预解包产物与安装器 extracting 段同目录幂等（staging 就位即止，rename 归 lock_commit）。
 */
async function manifestOfUpload(env: MarketEnv, bytes: Uint8Array, exec: ExecFace): Promise<unknown> {
	const f = fsFace();
	const staged = `${env.staging}/upload.tgz`; // 常量名不含用户输入，无穿越面；download 段按 manifest.archive.file 重写正名
	await f.mkdir(env.staging, { recursive: true });
	await f.writeFile(staged, bytes);
	const listed = await exec.run(["tar", "-tvzf", staged]);
	if (listed.code !== 0)
		fail(400, `上传包列表失败（tar -tvzf）：${(listed.stderr || listed.stdout).trim()}——包体损坏？`);
	// 铁律②：tar 输出恒带尾随换行，先 trim 尾部空行再 split（extract.ts 同款）
	const lines = listed.stdout.replace(/\n+$/, "").split("\n");
	const v = validateTarListing(lines);
	if (!v.ok)
		fail(400, `上传包含非法成员「${v.offender}」——R1 zip-slip 防护拒收（list→validate→extract 三步范式）`);
	const extracted = await exec.run(["tar", "-xzf", staged, "-C", env.staging]);
	if (extracted.code !== 0)
		fail(400, `上传包解包失败（tar -xzf）：${(extracted.stderr || extracted.stdout).trim()}`);
	await flattenBundleRoot(env.staging);
	const g = globalThis as { yaml?: { parse: (text: string) => Promise<unknown> } };
	try {
		return await g.yaml!.parse(new TextDecoder().decode(await f.readFile(`${env.staging}/manifest.yaml`)));
	}
	catch (e) {
		return fail(400, `上传包 manifest.yaml 不可解析：${String(e)}`);
	}
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
		const r = await resolveCdn(base, name, reqVersion, fetchOf(env));
		manifest = r.manifest;
		version = r.version;
		archiveUrl = r.archiveUrl;
		fetch = fetchOf(env);
	}
	// 第一方 bootstrap key 播种（P2-12，G3 双轨第一轨）：runInstall 之前——market 首装免 TOFU。
	// key 未回填（null）或信任库已初始化 → no-op（不与运维吊销对抗）
	await seedBootstrapKey(env.trustPath, env.bootstrapKey !== undefined ? env.bootstrapKey : BOOTSTRAP_KEY);
	const task = await runInstall({
		manifest,
		name,
		version,
		operator: await operatorOf(),
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
		fetch: withSiteOrigin(fetch),
		exec: execOf(env),
		reload: reloadOf(env),
		sha384B64: sha384Of(env),
		sha256Hex: env.sha256Hex,
		verifyEd25519: env.verifyEd25519,
		ledgerHead: env.ledgerHeadOf ? await env.ledgerHeadOf(name) : (env.ledgerHead ?? null),
		hostVersions: await hostVersionsOf(env),
		// 宿主平台编排面 API 版本（C2-11 peerPlatform 比对真源；与 meta 端点 apiVersion、_platform/manifest.yaml 版本同源，手工同步）
		hostApiVersion: API_VERSION,
		trustPath: env.trustPath,
	});
	return { task_id: task.id };
}

interface IndexRow {
	name: string
	latest: string | null
	installed: string | null
	enabled: boolean | null
	upgradable: boolean
	/** CDN 版本全集（P2-11）：回滚候选不止本站已装旧版；索引缺段/畸形 → [] 降级不炸 */
	available: string[]
	/** 最新版 changelog（C2-08，R27 卡片版本对比；manifests.yaml 不可得 → null） */
	changelog: unknown
	/** 最新版发布方（manifest author，C2-07；manifests.yaml 不可得 → null） */
	publisher: string | null
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
		const rows = await db.query(
			"select operator from market_history where solution = ? and action = 'install' order by created_at desc, rowid desc limit 1",
			[name],
		) as Array<{ operator: unknown }>;
		const op = rows[0]?.operator;
		return typeof op === "string" ? op : null;
	}
	catch {
		return null;
	}
}

/** GET index 主体：CDN bundles.yaml（no-cache）⊕ 本地 sidecar state——CDN 序优先，本地独有方案殿后 */
async function indexBody(env: MarketEnv): Promise<IndexRow[]> {
	// 对账即服务（P1-10 接线③）：市场页刷新即对账时点——锁 ↔ 账本 head 自愈 + enabled 不一致
	// 自动修复先行（失败只记日志，不阻断索引），失败站点的市场页每次打开都在尝试自愈
	await reconcileOf(env);
	const base = await cdnBaseOf(env);
	if (base === null)
		fail(503, "未配置市场地址（framework.market_cdn_url）——卡片区显示「未配置市场地址」（PRD §5.3）");
	const g = globalThis as { yaml?: { parse: (text: string) => Promise<unknown> } };
	const text = await fetchText(fetchOf(env), `${base}/bundles.yaml`);
	let bundles: { solutions?: unknown };
	try {
		bundles = await g.yaml!.parse(text) as { solutions?: unknown };
	}
	catch {
		fail(502, `市场索引解析失败：${base}/bundles.yaml 不是合法索引`);
	}
	const cdn = (Array.isArray(bundles.solutions) ? bundles.solutions : []).filter(isObj);
	const local = (await createStateStore(env.statePath)).read().solutions;
	// manifests.yaml 单次拉取供 changelog/publisher（P2-11）：失败降级 null 不阻断索引（可用性优先）
	let manifests: Record<string, unknown>[] = [];
	try {
		const list = await g.yaml!.parse(await fetchText(fetchOf(env), `${base}/manifests.yaml`));
		if (Array.isArray(list))
			manifests = list.filter(isObj);
	}
	catch {
		// 降级：changelog/publisher 全 null，索引主体照常返回
	}
	const manifestOf = (name: string, version: string | null): Record<string, unknown> | undefined =>
		version === null ? undefined : manifests.find(m => m.name === name && String(m.version) === version);
	const rows: IndexRow[] = [];
	const seen = new Set<string>();
	for (const s of cdn) {
		const name = typeof s.name === "string" ? s.name : "";
		if (name === "" || seen.has(name))
			continue;
		seen.add(name);
		const latest = typeof s.latest === "string" ? s.latest : null;
		const side = local[name];
		// available：versions[].version 字符串全集（缺段/畸形 → [] 降级）
		const available = (Array.isArray(s.versions) ? s.versions : [])
			.map(v => isObj(v) && typeof v.version === "string" ? v.version : "")
			.filter(x => x !== "");
		const m = manifestOf(name, latest) ?? manifestOf(name, side?.version ?? null);
		rows.push({
			name,
			latest,
			installed: side?.version ?? null,
			enabled: side?.enabled ?? null,
			upgradable: latest !== null && side !== undefined && compareVersions(side.version, latest) < 0,
			available,
			changelog: m?.changelog ?? null,
			publisher: typeof m?.author === "string" ? m.author : null,
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
				trust_state: side.trust_state ?? null,
				key_id: side.archive?.key_id ?? null,
				operator: await lastInstallOperatorOf(name),
			});
		}
	}
	return rows;
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
						operator: await operatorOf(),
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
					return await runUninstall({
						name,
						sharedRoot: env.sharedRoot,
						lockPath: `${env.sharedRoot}/manifests.yaml`,
						state: await createStateStore(env.statePath),
						modulesJsonPath: env.modulesJsonPath,
						operator: await operatorOf(),
					});
				});
			},
		},
	};
}

export default createMarketApi(marketEnv());
