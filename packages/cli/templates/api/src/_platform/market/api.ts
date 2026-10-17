// 编排端点 + 市场索引（P1-12，R9/ISP）：/api/_platform/market/* 四端点同文件嵌套 handler 组
// （oj v0.1.64 组形态，notification/api.ts 同款；组名 = 路径段，路由不变）。
// 门（R9）：install/task/index 全 assertSuperAdmin 独占（市场页是「市场即样例」的第一方特权
// 例外，R29；权限码不构成门）；meta 登录即可（peerPlatform 预检先于判权）。
// 职责边界（ISP）：端点只做 门禁 + Form B 索引解析（安装器不拼 URL，installer.ts 同纪律）+
// InstallRequest 组装；任务生命周期/失败三分/终态审计全归 runInstall 状态机（P1-10），端点不重复编排。
// CDN 基址：sys_setting `framework.market_cdn_url`（PRD §5.3，缺省空 = 市场不可用，可读错误不崩）；
// 索引/清单拉取恒带 Cache-Control: no-cache（索引时效性）。
// 站点路径缺省（marketEnv）：D3 单 mount 形态 fs 根相对保守值——生产口径由部署层（P1-16 e2e）
// 钉定，编排层不隐式推导站点布局；MarketEnv 全字段可注入覆盖（测试 stub 同款）。
// file 源上传形态：照 personal-center/upload/api.ts 先例（http.files 双路径，大文件走 blob）；
// 上传包先过 R1 三步范式（list→validate→extract）取出 manifest.yaml 供 preflight——
// 未校验不解包，zip-slip 在信任边界外被拒。
import type { FetchFace } from "../_lifecycle/steps/download";
import type { ExecFace } from "../_lifecycle/steps/extract";
import type { ReloadFace } from "../_lifecycle/steps/reload";
import { fsFace } from "../_lifecycle/atomic";
import { runInstall } from "../_lifecycle/installer";
import { compareVersions } from "../_lifecycle/semver";
import { createStateStore } from "../_lifecycle/state";
import { getTask } from "../_lifecycle/tasks";
import { validateTarListing } from "../_lifecycle/tgz-guard";
import { respond } from "../_shared/respond";
import { assertSuperAdmin } from "../_shared/service/access";

/** 平台编排面版本（镜像 _platform/manifest.yaml version；peerPlatform 预检口径，manifest 升版须同步） */
const API_VERSION = "0.1.0";

/** 带缓存指令的拉取面（FetchFace 的超集：oj 全局 fetch/测试 stub 天然满足，少参函数可赋多参形） */
type FetchInitFace = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
	ok: boolean
	status: number
	arrayBuffer: () => Promise<ArrayBuffer>
}>;

export interface MarketEnv {
	/** 共享根（manifests.yaml 所在目录 = 版本目录父级，D3 单 mount 形态） */
	sharedRoot: string
	/** 暂存目录（.staging） */
	staging: string
	/** 任务状态目录（.install-tasks） */
	taskDir: string
	/** sidecar 状态文件（.solutions/state.yaml） */
	statePath: string
	/** 站点数据目录（`oj migrate -d` 实参） */
	dataDir: string
	/** sqlite 库文件路径（R14 备份源） */
	dbPath: string
	/** 站点 web 模块目录（<dist>/modules） */
	siteModulesDir: string
	/** 站点 modules.json 路径（与 siteModulesDir 同属 <dist>） */
	modulesJsonPath: string
	/** API 前缀（smoke 探针 URL 前缀） */
	apiPrefix: string
	/** CDN 基址（缺省读 sys_setting `framework.market_cdn_url`；测试注入） */
	cdnBase?: () => Promise<string | null>
	/** 注入面（DIP）：缺省回落 isolate 全局 fetch / exec.run / server.reloadConfig / crypto.sha384B64 */
	fetch?: FetchFace
	exec?: ExecFace
	reload?: ReloadFace
	sha384B64?: (data: Uint8Array) => string
	/** sha256 摘要面（verifying 段；缺省回落运行时全局，同 verify.ts） */
	sha256Hex?: (data: Uint8Array) => string
	/** 迁移账本 head（缺省 null = 跳过禁降版判定，同 installer） */
	ledgerHead?: number | bigint | null
	/**
	 * 宿主 versions.json（C2-09 peerRuntime 比对真源，键 = 包名）。缺省不注入——manifest 声明
	 * peerRuntime 即预检 fail-closed 拒装（C2-09 语义），真源读取位由部署层（P1-16 e2e）钉定。
	 */
	hostVersions?: Record<string, string>
}

/** D3 单 mount 形态的 fs 根相对保守缺省（生产口径 P1-16 e2e 钉定；全字段可覆盖） */
export function marketEnv(): MarketEnv {
	return {
		sharedRoot: "modules",
		staging: "modules/.staging",
		taskDir: "modules/.install-tasks",
		statePath: "modules/.solutions/state.yaml",
		dataDir: "data",
		dbPath: "data/db.sqlite",
		siteModulesDir: "dist/modules",
		modulesJsonPath: "dist/modules.json",
		apiPrefix: "/api",
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
	return env.exec ?? { run: argv => g.exec!.run(argv) };
}

function reloadOf(env: MarketEnv): ReloadFace {
	const g = globalThis as { server?: { reloadConfig: ReloadFace["reloadConfig"] } };
	return env.reload ?? { reloadConfig: () => g.server!.reloadConfig() };
}

function sha384Of(env: MarketEnv): (data: Uint8Array) => string {
	const g = globalThis as { crypto?: { sha384B64?: (data: Uint8Array) => string } };
	return env.sha384B64 ?? ((data: Uint8Array) => g.crypto!.sha384B64!(data));
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
	return { version, archiveUrl: `${base}/${String(hit.file)}`, manifest };
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
	const task = await runInstall({
		manifest,
		name,
		version,
		state: await createStateStore(env.statePath),
		archiveUrl,
		sharedRoot: env.sharedRoot,
		staging: env.staging,
		taskDir: env.taskDir,
		dataDir: env.dataDir,
		dbPath: env.dbPath,
		siteModulesDir: env.siteModulesDir,
		modulesJsonPath: env.modulesJsonPath,
		apiPrefix: env.apiPrefix,
		fetch: fetch as FetchFace,
		exec: execOf(env),
		reload: reloadOf(env),
		sha384B64: sha384Of(env),
		sha256Hex: env.sha256Hex,
		ledgerHead: env.ledgerHead ?? null,
		hostVersions: env.hostVersions,
	});
	return { task_id: task.id };
}

interface IndexRow {
	name: string
	latest: string | null
	installed: string | null
	enabled: boolean | null
	upgradable: boolean
}

/** GET index 主体：CDN bundles.yaml（no-cache）⊕ 本地 sidecar state——CDN 序优先，本地独有方案殿后 */
async function indexBody(env: MarketEnv): Promise<IndexRow[]> {
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
	const rows: IndexRow[] = [];
	const seen = new Set<string>();
	for (const s of cdn) {
		const name = typeof s.name === "string" ? s.name : "";
		if (name === "" || seen.has(name))
			continue;
		seen.add(name);
		const latest = typeof s.latest === "string" ? s.latest : null;
		const side = local[name];
		rows.push({
			name,
			latest,
			installed: side?.version ?? null,
			enabled: side?.enabled ?? null,
			upgradable: latest !== null && side !== undefined && compareVersions(side.version, latest) < 0,
		});
	}
	for (const [name, side] of Object.entries(local)) {
		if (!seen.has(name))
			rows.push({ name, latest: null, installed: side.version, enabled: side.enabled, upgradable: false });
	}
	return rows;
}

/** 四端点组（oj v0.1.64 嵌套组：组名 = 路径段）；全业务体经 respond 收口（status 语义不落 500） */
export function createMarketApi(env: MarketEnv) {
	return {
		// POST /api/_platform/market/install —— 安装编排（superadmin，R9）
		install: {
			async post() {
				await respond(async () => {
					await assertSuperAdmin();
					return await installBody(env);
				});
			},
		},
		// GET /api/_platform/market/task?id= —— 任务轮询消费面（superadmin，§10.2 800ms 轮询）。
		// 简报 `task/:id` 段参数形态在模板 http 面无先例，照 contacts/detail?id= 惯例走 query（报告备案）。
		task: {
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
		// GET /api/_platform/market/meta —— 登录即可（{apiVersion}，peerPlatform 预检；非 superadmin）
		meta: {
			async get() {
				await respond(async () => {
					const uid = (http as { user?: { id?: unknown } }).user?.id;
					if (uid == null)
						fail(401, "unauthorized");
					return { apiVersion: API_VERSION };
				});
			},
		},
		// GET /api/_platform/market/index —— 市场索引聚合（superadmin，R9）
		index: {
			async get() {
				await respond(async () => {
					await assertSuperAdmin();
					return await indexBody(env);
				});
			},
		},
	};
}

export default createMarketApi(marketEnv());
