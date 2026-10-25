/**
 * `ojm` 帮助文本与命令注册表（双语 zh-CN / en-US）。
 *
 * 单注册表两处消费（DRY）：
 *  - cli.ts 遍历注册表做 cac command/option 注册（描述按调用语言选取）；
 *  - 本模块渲染顶层分组帮助（usageText）与 per-command 详解段（cli.ts help 回调注入）。
 */
import process from "node:process";
import cac from "cac";

export type Lang = "zh-CN" | "en-US";

/**
 * CLI 帮助语言决议：OJM_LANG 显式指定 > LANG/LC_ALL/LC_MESSAGES 前缀探测 > 缺省 zh-CN。
 * （与 ojm install --locale 无关——那是站点侧终态文案语言。）
 */
export function resolveLang(env: NodeJS.ProcessEnv = process.env): Lang {
	const explicit = env.OJM_LANG?.toLowerCase();
	if (explicit === "en" || explicit === "en-us")
		return "en-US";
	if (explicit === "zh" || explicit === "zh-cn")
		return "zh-CN";
	const sys = (env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? "").toLowerCase();
	return sys.startsWith("en") ? "en-US" : "zh-CN";
}

function pick(b: { zh: string, en: string }, lang: Lang): string {
	return lang === "zh-CN" ? b.zh : b.en;
}

export interface HelpOption { raw: string, zh: string, en: string }

/** 子命令条目：详解（--help 注入）+ short（分组索引一行，可选） */
export interface SubHelp { zh: string, en: string, short?: { zh: string, en: string } }

export interface HelpEntry {
	/** action 分发键（cli.ts 的 switch 用） */
	key: string
	/** cac 注册名（含参数签名，如 "init [dir]" / "market [sub] [...rest]"） */
	name: string
	zh: string
	en: string
	options?: HelpOption[]
	/** --help 末尾追加的详解段 */
	detail?: { zh: string, en: string }
	/** 子命令详解（market / trust：--help 按匹配后 args[0] 注入对应条目） */
	subs?: Record<string, SubHelp>
	/** 放行未知选项（oj 透传五命令 / market 子命令自带解析器，raw 转发） */
	allowUnknownOptions?: boolean
}

export interface HelpGroup {
	key: string
	commands: HelpEntry[]
	zh: string
	en: string
}

/** 站点寻址三件套（生命周期命令共用） */
const SITE_OPTIONS: HelpOption[] = [
	{ raw: "--url <url>", zh: "站点地址（缺省 http://127.0.0.1:9778）", en: "Site URL (default http://127.0.0.1:9778)" },
	{ raw: "--user <user>", zh: "登录账号（或环境变量 OJM_USER）", en: "Login username (or env OJM_USER)" },
	{ raw: "--pass <pass>", zh: "登录密码（或环境变量 OJM_PASS；只走内存不落盘）", en: "Login password (or env OJM_PASS; memory-only, never persisted)" },
];

const OJ_PASSTHROUGH = ["test", "exec", "openapi", "migrate", "schema"];

export const HELP_GROUPS: HelpGroup[] = [
	{
		key: "scaffold",
		zh: "工程脚手架",
		en: "Project scaffolding",
		commands: [
			{
				key: "init",
				name: "init [dir]",
				zh: "前后端一体化工程脚手架（幂等补缺）",
				en: "Full-stack project scaffolding (idempotent, fills gaps only)",
				options: [
					{ raw: "--yes", zh: "非交互：缺省回答一律 yes", en: "Non-interactive: default all answers to yes" },
				],
				detail: {
					zh: "ojm init [dir] [--yes]\n  前后端一体化工程脚手架（幂等补缺：重跑只补缺失文件，永不覆盖已有文件）",
					en: "ojm init [dir] [--yes]\n  Full-stack project scaffolding (idempotent: re-runs only fill missing files, never overwrite existing ones)",
				},
			},
			{
				key: "new",
				name: "new [name] [...extra]",
				zh: "脚手架内生成用户方案骨架（src/<name>/{api,web} + solution.yaml）",
				en: "Generate a solution skeleton inside the project (src/<name>/{api,web} + solution.yaml)",
				options: [
					{ raw: "--layout <layout>", zh: "页面布局 container|none", en: "Page layout container|none" },
					{ raw: "--api", zh: "同时生成 api 骨架（oj manifest + ping 示例）", en: "Also generate the api skeleton (oj manifest + ping sample)" },
				],
				detail: {
					zh: "ojm new <name> [--layout container|none] [--api]\n  守卫：非 ojm 工程 / 历史布局 / 非法名 / 保留名 / 框架自带名 / 重名一律拒绝（零写入）\n  module-root 布局以 src/<name>/web/entry.ts 扫描收录，无需登记 web.config.ts",
					en: "ojm new <name> [--layout container|none] [--api]\n  Guards: rejects non-ojm projects / legacy layouts / illegal names / reserved names / builtin names / duplicates (zero writes)\n  module-root layouts are collected by scanning src/<name>/web/entry.ts — no web.config.ts registration needed",
				},
			},
		],
	},
	{
		key: "dev",
		zh: "开发与构建",
		en: "Development & build",
		commands: [
			{
				key: "dev",
				name: "dev [port]",
				zh: "启动开发服务器（/api 反代 oj + 模块重建 + SSE 刷新）",
				en: "Start dev server (/api proxy to oj + module rebuild + SSE refresh)",
				detail: {
					zh: "ojm dev [port]\n  开发模式快捷键（仅 TTY 终端，类 Vite）：\n    r  强制重建并热更新    h  显示帮助    c  清屏    o  浏览器打开\n    q  退出（后端 oj 一并终止）\n  port 缺省 5174（oj 后端端口以 config.yaml 的 server.port 为准）",
					en: "ojm dev [port]\n  Dev-mode shortcuts (TTY only, Vite-like):\n    r  force rebuild + hot reload    h  show help    c  clear screen    o  open browser\n    q  quit (terminates the oj backend as well)\n  port defaults to 5174 (the oj backend port comes from config.yaml server.port)",
				},
			},
			{
				key: "build",
				name: "build",
				zh: "构建后端（oj build）与模块产物；--bundle 打确定性方案包",
				en: "Build backend (oj build) and module artifacts; --bundle builds a deterministic solution bundle",
				options: [
					{ raw: "--bundle [name]", zh: "方案包构建：契约校验（fail-fast）→ 确定性 tgz + sha256；带值只打该方案，无值 = 全部用户方案", en: "Solution bundle: contract check (fail-fast) → deterministic tgz + sha256; with a value builds only that solution, bare flag builds all user solutions" },
					{ raw: "--out <dir>", zh: "--bundle 输出目录（缺省 dist/）", en: "Output directory for --bundle (default dist/)" },
				],
				detail: {
					zh: "ojm build [--bundle [name]] [--out <dir>]\n  构建后端（oj build）与模块产物（含全站合并）\n  --bundle 产出 dist/<name>-<version>.tgz + sha256（市场安装器的上游产物）",
					en: "ojm build [--bundle [name]] [--out <dir>]\n  Builds the backend (oj build) and module artifacts (including the site-wide merge)\n  --bundle produces dist/<name>-<version>.tgz + sha256 (upstream artifact for the marketplace installer)",
				},
			},
			{
				key: "preview",
				name: "preview [port]",
				zh: "生产形态预览（migrate → oj serve 单服务，深链回落）",
				en: "Production-shape preview (migrate → oj serve single service, deep-link fallback)",
				detail: {
					zh: "ojm preview [port]\n  静态由 oj web 挂载直出；ojm 不起第二个服务、不做反代\n  port 缺省取 config 的 server.port",
					en: "ojm preview [port]\n  Static files are served directly by the oj web mount; ojm starts no second service and does no proxying\n  port defaults to the config server.port",
				},
			},
			{
				key: "api",
				name: "api [dir]",
				zh: "契约代码生成（client / routes / openapi / stub）；--check 四重对账",
				en: "Contract code generation (client / routes / openapi / stub); --check runs the four-way reconciliation",
				options: [
					{ raw: "--check", zh: "四重对账（生成物同步 / route 双向 / routes.js / WS 路由鉴权）", en: "Four-way reconciliation (generated sync / bidirectional routes / routes.js / WS route auth)" },
					{ raw: "--exempt <path>", zh: "豁免清单，覆盖默认 .ojm-api-exempt.json（工程根）", en: "Exemption list, overrides the default .ojm-api-exempt.json (project root)" },
					{ raw: "--docs", zh: "出自包含文档站（单文件离线可看）", en: "Generate a self-contained docs site (single file, works offline)" },
				],
				detail: {
					zh: "ojm api [dir] [--check] [--docs] [--exempt <path>]\n  dir 缺省当前目录；显式目录须先存在",
					en: "ojm api [dir] [--check] [--docs] [--exempt <path>]\n  dir defaults to cwd; an explicit directory must exist",
				},
			},
		],
	},
	{
		key: "diagnostics",
		zh: "清单与诊断",
		en: "Manifest & diagnostics",
		commands: [
			{
				key: "info",
				name: "info",
				zh: "版本矩阵与模块清单（报障用）",
				en: "Version matrix and module list (for bug reports)",
				options: [
					{ raw: "--all", zh: "展开框架自带模块（默认折叠为一行计数）", en: "Expand builtin modules (collapsed to a one-line count by default)" },
				],
				detail: {
					zh: "ojm info [--all]\n  输出版本矩阵与模块清单（报障用，US-7）",
					en: "ojm info [--all]\n  Prints the version matrix and module list (for bug reports, US-7)",
				},
			},
			{
				key: "merge",
				name: "merge [out] [...inputs]",
				zh: "合并多团队清单（清单先后 = 接管优先级）",
				en: "Merge team manifests (earlier manifest wins takeover priority)",
				detail: {
					zh: "ojm merge <out.json> <in1.json> [in2.json ...]\n  合并多团队清单（R12；同名模块显式拒绝）",
					en: "ojm merge <out.json> <in1.json> [in2.json ...]\n  Merge team manifests (R12; duplicate module names are rejected explicitly)",
				},
			},
			{
				key: "vendor",
				name: "vendor [tag]",
				zh: "下载/重装 oj vendor（经 npm 包 @oj-bin/oj）",
				en: "Download/reinstall the oj vendor (via the npm package @oj-bin/oj)",
				options: [
					{ raw: "--force", zh: "即使已存在也重新下载", en: "Re-download even if already present" },
				],
				detail: {
					zh: "ojm vendor [tag] [--force]\n  tag 缺省取最新，形如 v0.1.13",
					en: "ojm vendor [tag] [--force]\n  tag defaults to latest, e.g. v0.1.13",
				},
			},
			{
				key: "config",
				name: "config [sub]",
				zh: "查看生效配置（仓库源 / 凭据来源 / 站点定位；不回显密钥）",
				en: "Show effective config (registry source / credential origin / site addressing; never echoes secrets)",
				options: [
					{ raw: "--show-origin", zh: "每行附「该值从哪来」（flag / .ojmrc / 用户配置 / 环境变量）", en: "Append where each value came from (flag / .ojmrc / user config / env)" },
					{ raw: "--json", zh: "stdout 只放一份 JSON 信封（人话改走 stderr）", en: "Emit a single JSON envelope on stdout (human lines move to stderr)" },
				],
				subs: {
					ls: {
						short: { zh: "列出生效配置（`ls` 可省略）", en: "List effective config (`ls` may be omitted)" },
						zh: "ojm config ls [--show-origin] [--json]\n  列出仓库源 / 凭据来源 / 站点定位。未配置不是错误（退出码 0）：诊断命令的职责就是把「这里空着」显示出来",
						en: "ojm config ls [--show-origin] [--json]\n  List the registry source / credential origin / site addressing. Unset is not an error (exit 0): a diagnostics command exists precisely to show that something is empty",
					},
				},
				detail: {
					zh: "ojm config ls [--show-origin] [--json]\n  源解析顺序：--registry > 工程根 .ojmrc > ~/.ojm/config.json；本 CLI 不内置缺省源\n  凭据：OJM_REGISTRY_TOKEN（CI 首选）> ~/.ojm/config.json 的 registries[<origin>].token\n  只报「从哪来」，token 与密码一个字都不打印",
					en: "ojm config ls [--show-origin] [--json]\n  Source order: --registry > project .ojmrc > ~/.ojm/config.json; there is no built-in default\n  Credential: OJM_REGISTRY_TOKEN (preferred in CI) > registries[<origin>].token in ~/.ojm/config.json\n  Only the origin is reported — tokens and passwords are never printed",
				},
			},
		],
	},
	{
		key: "market-lifecycle",
		zh: "方案市场（站点侧生命周期）",
		en: "Marketplace (site-side lifecycle)",
		commands: [
			{
				key: "install",
				name: "install [target]",
				zh: "安装方案包到目标站点（file 上传 / CDN 市场源）",
				en: "Install a solution bundle to the target site (file upload / CDN marketplace source)",
				options: [
					...SITE_OPTIONS,
					{ raw: "--name <name>", zh: "覆盖文件名推导的方案名", en: "Override the solution name derived from the file name" },
					{ raw: "--version <version>", zh: "覆盖文件名推导的版本", en: "Override the version derived from the file name" },
					{ raw: "--locale <locale>", zh: "终态文案语言 zh-CN|en-US", en: "Language of the final status message zh-CN|en-US" },
				],
				detail: {
					zh: "ojm install <file.tgz | name[@version]> [--url <u>] [--user <u>] [--pass <p>] [--name <n>] [--version <v>] [--locale <zh-CN|en-US>]\n  本地 tgz 走 file 上传（<name>-<version>.tgz 文件名推导身份，可 --name/--version 覆盖）；name[@version] 走 CDN 市场源\n  登录 → 提交 → 轮询任务至终态并打印结果（失败附原因 + 指引）\n  站点寻址：--url/--user/--pass，或环境变量 OJM_URL / OJM_USER / OJM_PASS",
					en: "ojm install <file.tgz | name[@version]> [--url <u>] [--user <u>] [--pass <p>] [--name <n>] [--version <v>] [--locale <zh-CN|en-US>]\n  Local tgz goes through file upload (identity derived from the <name>-<version>.tgz file name, overridable via --name/--version); name[@version] goes through the CDN marketplace\n  Login → submit → poll the task to a terminal state and print the result (failures include the reason + guidance)\n  Site addressing: --url/--user/--pass, or env vars OJM_URL / OJM_USER / OJM_PASS",
				},
			},
			{
				key: "enable",
				name: "enable [name]",
				zh: "启用已装方案（四处同写）",
				en: "Enable an installed solution (writes to four places)",
				options: SITE_OPTIONS,
				detail: {
					zh: "ojm enable|disable <name> [--url <u>] [--user <u>] [--pass <p>]\n  启用/禁用已装方案（四处同写：锁 / sidecar / 路由清单 / 模块清单）\n  站点寻址同上",
					en: "ojm enable|disable <name> [--url <u>] [--user <u>] [--pass <p>]\n  Enable/disable an installed solution (four synchronized writes: lock / sidecar / route manifest / module manifest)\n  Site addressing: same as above",
				},
			},
			{
				key: "disable",
				name: "disable [name]",
				zh: "禁用已装方案（四处同写）",
				en: "Disable an installed solution (writes to four places)",
				options: SITE_OPTIONS,
			},
			{
				key: "uninstall",
				name: "uninstall [name]",
				zh: "卸载已装方案（四处同删 + 权限级联清理）",
				en: "Uninstall a solution (four synchronized removals + permission cascade cleanup)",
				options: [
					...SITE_OPTIONS,
					// Q7：注册出来只为拒绝——给了即 exit 2，并说明「卸载不涉及仓库」
					{ raw: "--registry <url>", zh: "（不支持）卸载不涉及仓库：本命令只认站点寻址，给了即报错退出 2", en: "(unsupported) Uninstall does not involve a registry: this command only takes site addressing; passing it exits 2" },
				],
				detail: {
					zh: "ojm uninstall <name> [--url <u>] [--user <u>] [--pass <p>]\n  四处同删 + 权限级联清理 + 版本目录移除；站点至少保留一个已锁模块\n  站点寻址同上；**卸载不涉及仓库**——包已经在站点上，来源不影响删除范围，故不接 --registry",
					en: "ojm uninstall <name> [--url <u>] [--user <u>] [--pass <p>]\n  Four synchronized removals + permission cascade cleanup + version directory removal; a site keeps at least one locked module\n  Site addressing: same as above; **uninstall does not involve a registry** — the package is already on the site, so its origin has no effect on the removal scope, hence no --registry",
				},
			},
			{
				key: "view",
				name: "view [target]",
				zh: "查看包映射（目录键 ↔ 物理名）",
				en: "Show a package mapping (directory key ↔ physical name)",
				options: [
					...SITE_OPTIONS,
					{ raw: "--json", zh: "stdout 只放一份 JSON 信封（人话改走 stderr）", en: "Emit a single JSON envelope on stdout (human lines move to stderr)" },
				],
				detail: {
					zh: "ojm view @<scope>/<name> [--url <u>] [--user <u>] [--pass <p>] [--json]\n  同时显示目录键（@acme/demo）与物理名（acme-demo）：前者是仓库门牌，后者才是磁盘/路由/文件名\n  只收目录键——物理名是单向换算（acme-x-demo 可能来自 @acme-x/demo 或 @acme/x-demo），裸 slug 无法反推\n  站点寻址同上；缺凭据退出 2",
					en: "ojm view @<scope>/<name> [--url <u>] [--user <u>] [--pass <p>] [--json]\n  Print both the directory key (@acme/demo) and the physical name (acme-demo): the former is the registry door plate, the latter is the on-disk/route/file name\n  Directory keys only — the mapping is one-way (acme-x-demo may come from @acme-x/demo or @acme/x-demo), so a bare slug cannot be reversed\n  Site addressing: same as above; missing credentials exit 2",
				},
			},
			{
				key: "trust",
				name: "trust [sub] [keyId] [pub]",
				zh: "发布方信任库管理（TOFU 确认）",
				en: "Publisher trust store management (TOFU confirmation)",
				options: [
					...SITE_OPTIONS,
					{ raw: "--task <id>", zh: "TOFU 确认：needs_trust 终态任务 id", en: "TOFU confirm: task id of a needs_trust terminal state" },
				],
				detail: {
					zh: "ojm trust ls|add|revoke|confirm [--url <u>] [--user <u>] [--pass <p>]\n  发布方信任库管理（站点 .solutions/trusted-keys.yaml）",
					en: "ojm trust ls|add|revoke|confirm [--url <u>] [--user <u>] [--pass <p>]\n  Publisher trust store management (site-side .solutions/trusted-keys.yaml)",
				},
				subs: {
					ls: {
						short: { zh: "列出已信任 key（含 sha256 指纹分组展示）", en: "List trusted keys (grouped sha256 fingerprints)" },
						zh: "ojm trust ls [key_id 前缀?]\n  列出已信任 key（含 sha256 指纹分组展示）",
						en: "ojm trust ls [key_id prefix?]\n  List trusted keys (grouped display with sha256 fingerprints)",
					},
					add: {
						short: { zh: "新增信任（64 hex 公钥；首次绑定不可改）", en: "Add trust (64-hex public key; first binding immutable)" },
						zh: "ojm trust add <key_id> <pub>\n  新增信任（64 hex 公钥；首次绑定不可改）",
						en: "ojm trust add <key_id> <pub>\n  Add trust (64-hex public key; the first binding is immutable)",
					},
					revoke: {
						short: { zh: "吊销（阻断新装/升级，不动已装方案）", en: "Revoke (blocks new installs/upgrades, installed untouched)" },
						zh: "ojm trust revoke <key_id>\n  吊销（阻断新装/升级，不动已装方案）",
						en: "ojm trust revoke <key_id>\n  Revoke (blocks new installs/upgrades, leaves installed solutions untouched)",
					},
					confirm: {
						short: { zh: "TOFU 确认：待确认 key 入库", en: "TOFU confirm: import the pending key" },
						zh: "ojm trust confirm --task <id>\n  TOFU 确认：把 needs_trust 终态待确认 key 入库",
						en: "ojm trust confirm --task <id>\n  TOFU confirm: import the key pending from a needs_trust terminal state",
					},
				},
			},
		],
	},
	{
		key: "signing",
		zh: "发布与签名（作者侧）",
		en: "Publishing & signing (author side)",
		commands: [
			{
				key: "keygen",
				name: "keygen",
				zh: "生成 Ed25519 签名密钥对",
				en: "Generate an Ed25519 signing key pair",
				options: [
					{ raw: "--id <id>", zh: "发布方 key id（形如 publisher.key）", en: "Publisher key id (e.g. publisher.key)" },
					{ raw: "--out <dir>", zh: "输出目录（缺省 ~/.ojm/keys/<id>/；指到工程树内须 --yes）", en: "Output directory (default ~/.ojm/keys/<id>/; pointing inside the project tree requires --yes)" },
					{ raw: "--yes", zh: "确认私钥落盘到工程树内（私钥入仓即泄露）", en: "Acknowledge writing the private key inside the project tree (a private key in the repo is leaked)" },
				],
				detail: {
					zh: "ojm keygen --id <publisher.id> [--out <dir>] [--yes]\n  私钥默认 ~/.ojm/keys/<id>/ 永不出目录；打印公钥 hex 供 ojm trust add / 模板回填",
					en: "ojm keygen --id <publisher.id> [--out <dir>] [--yes]\n  The private key stays under ~/.ojm/keys/<id>/ by default; prints the public key hex for ojm trust add / template backfill",
				},
			},
			{
				key: "sign",
				name: "sign [file]",
				zh: "detached 侧车签名（产出 <tgz>.sig）",
				en: "Detached sidecar signing (produces <tgz>.sig)",
				options: [
					{ raw: "--id <id>", zh: "发布方 key id", en: "Publisher key id" },
					{ raw: "--key <pem>", zh: "指定私钥 pem（须同时 --id）", en: "Explicit private key pem (requires --id as well)" },
					{ raw: "--check", zh: "离线自检签名", en: "Offline signature self-check" },
				],
				detail: {
					zh: "ojm sign <file.tgz> [--id <publisher.id>] [--key <pem>] [--check]\n  detached 侧车签名：产出 <tgz>.sig（ojm install 自动探测随包上传）；私钥缺省取 ~/.ojm/keys/<id>/private.pem",
					en: "ojm sign <file.tgz> [--id <publisher.id>] [--key <pem>] [--check]\n  Detached sidecar signature: produces <tgz>.sig (ojm install auto-detects and uploads it with the bundle); the private key defaults to ~/.ojm/keys/<id>/private.pem",
				},
			},
			{
				key: "publish",
				name: "publish [dir]",
				zh: "索引发布（重算 catalog/shards + 侧车签名）",
				en: "Index publishing (recompute catalog/shards + sidecar signatures)",
				options: [
					{ raw: "--id <id>", zh: "发布方 key id", en: "Publisher key id" },
					{ raw: "--key <pem>", zh: "指定私钥 pem", en: "Explicit private key pem" },
					{ raw: "--check", zh: "离线自检索引签名（catalog + 各分片）", en: "Offline self-check of index signatures (catalog + each shard)" },
					{ raw: "--registry <url>", zh: "仓库源（覆盖 .ojmrc / 用户配置；本 CLI 无内置缺省源）", en: "Registry URL (overrides .ojmrc / user config; no built-in default)" },
					{ raw: "--dry-run", zh: "只算不写：打印本次会写哪些文件，盘上零改动", en: "Compute only: print which files would be written, change nothing on disk" },
					{ raw: "--json", zh: "stdout 只放一份 JSON 信封（人话改走 stderr）", en: "Emit a single JSON envelope on stdout (human lines move to stderr)" },
				],
				detail: {
					zh: "ojm publish <dir> [--id <key>] [--key <pem>] [--check] [--registry <url>] [--dry-run] [--json]\n  重算 <dir>/catalog.yaml + shards/<n>.yaml（确定性 stringify，消弭格式漂移）→ 各产出 detached 侧车签名 → 写回 <dir>\n  未配仓库源时只写本地目录（不上传），并明说这一点；--dry-run 全程零写入\n  退出码：0 成功 / 1 业务失败（签名不符、私钥缺失、--check 没过）/ 2 用法错误",
					en: "ojm publish <dir> [--id <key>] [--key <pem>] [--check] [--registry <url>] [--dry-run] [--json]\n  Recompute <dir>/catalog.yaml + shards/<n>.yaml (deterministic stringify to eliminate format drift) → produce a detached sidecar signature for each → write back to <dir>\n  With no registry source it only writes the local directory (no upload) and says so; --dry-run writes nothing at all\n  Exit codes: 0 success / 1 business failure (signature mismatch, missing key, --check failed) / 2 usage error",
				},
			},
		],
	},
	{
		key: "market-cdn",
		zh: "本地市场模拟 CDN",
		en: "Local marketplace mock CDN",
		commands: [
			{
				key: "market",
				name: "market [sub] [...rest]",
				zh: "本地模拟 CDN 与市场链路（setup / publish / build-index / verify / trial）",
				en: "Local mock CDN and marketplace pipeline (setup / publish / build-index / verify / trial)",
				allowUnknownOptions: true,
				options: [
					{ raw: "--url <url>", zh: "站点地址", en: "Site URL" },
					{ raw: "--user <user>", zh: "登录账号", en: "Login username" },
					{ raw: "--pass <pass>", zh: "登录密码", en: "Login password" },
					{ raw: "--new-pass <pass>", zh: "首次改密期的新密码（setup）", en: "New password during the forced-reset period (setup)" },
					{ raw: "--fixture <name@version>", zh: "合成 fixture 方案包（publish / trial）", en: "Synthesize a fixture bundle (publish / trial)" },
					{ raw: "--real <project>", zh: "走真实方案工程发包（publish）", en: "Publish from a real solution project (publish)" },
					{ raw: "--id <key>", zh: "签名 key id", en: "Signing key id" },
					{ raw: "--key <pem>", zh: "签名私钥 pem", en: "Signing private key pem" },
					{ raw: "--rebuild-index", zh: "发包后顺带重建索引（publish）", en: "Rebuild the index after publishing (publish)" },
					{ raw: "--check", zh: "离线自检签名", en: "Offline signature self-check" },
				],
				subs: {
					"setup": {
						short: { zh: "framework.market_cdn_url 指向外部真 CDN（脚手架缺省 /cdn 免 setup）", en: "Point framework.market_cdn_url at an external CDN (scaffold defaults to /cdn, no setup needed)" },
						zh: "ojm market setup [--url <站点地址>] [--user <u> --pass <p>] [--new-pass <p>]\n  把系统设置 framework.market_cdn_url 改写为绝对地址（外部真 CDN 场景；脚手架 seed 缺省 /cdn = 本站点自供，免 setup）。首跑若账号处于首次改密期（seed admin must_change=1），会自动改密换全权 token 后再写入",
						en: "ojm market setup [--url <site>] [--user <u> --pass <p>] [--new-pass <p>]\n  Rewrite the framework.market_cdn_url system setting to an absolute URL (external CDN scenario; the scaffold seed defaults to /cdn = site-served, no setup needed). On first run, if the account is in the forced password-reset period (seed admin must_change=1), it resets the password to obtain a full-privilege token before writing",
					},
					"publish": {
						short: { zh: "方案包落进 cdn/ + 包级签名（不碰索引）", en: "Drop a bundle into cdn/ + package-level signature (index untouched)" },
						zh: "ojm market publish [--fixture <name@version>] [--real <方案工程>] [--id <key>] [--key <pem>] [--rebuild-index] [--check]\n  把方案包落进 cdn/：合成 fixture（或 --real 走 ojm build --bundle）→ 确定性 tgz → 包级 detached 签名 <name>-<version>.tgz.sig。不碰索引（索引由 build-index 扫描重建，多人发布才不会互相覆盖）",
						en: "ojm market publish [--fixture <name@version>] [--real <project>] [--id <key>] [--key <pem>] [--rebuild-index] [--check]\n  Drop a solution bundle into cdn/: synthesize a fixture (or --real via ojm build --bundle) → deterministic tgz → package-level detached signature <name>-<version>.tgz.sig. Does not touch the index (the index is rebuilt by build-index so concurrent publishers don't overwrite each other)",
					},
					"build-index": {
						short: { zh: "扫描重建三级索引（catalog + shards）并签名", en: "Rebuild the three-tier index (catalog + shards) from a scan and sign" },
						zh: "ojm market build-index [--id <key>] [--key <pem>] [--check]\n  扫描 cdn/*.tgz、提取包内 manifest，全量重建 catalog.yaml（包名→分片号）+ shards/<n>.yaml（每片 ≤1000 版本）并签名。原子落盘（先分片后 catalog）；结果只取决于目录内容：连续执行字节一致",
						en: "ojm market build-index [--id <key>] [--key <pem>] [--check]\n  Scan cdn/*.tgz, extract each bundle's manifest, fully rebuild catalog.yaml (name→shard) + shards/<n>.yaml (≤1000 versions each) and sign them. Atomic landing (shards before catalog); the result depends only on directory content: consecutive runs are byte-identical",
					},
					"verify": {
						short: { zh: "离线验包（sha256 / 验签 / 索引 / manifest 结构）", en: "Offline bundle verification (sha256 / signatures / index / manifest)" },
						zh: "ojm market verify [--file <tgz>] [--rebuild-index]\n  离线验包（不起站点、不装、不要凭据）：sha256 完整性 / 包级 Ed25519 验签 / 索引验签（catalog 与各分片分列）/ manifest 结构分列输出。--rebuild-index 额外双向比对「扫描重建的索引」与盘上索引：既报落了包却没重建（索引缺条目），也报索引声明了、盘上包却没了的反向漂移。注意：校验通过只说明来源与完整性，不构成内容安全性背书",
						en: "ojm market verify [--file <tgz>] [--rebuild-index]\n  Offline bundle verification (no site, no install, no credentials): sha256 integrity / package-level Ed25519 signature / index signature (catalog and each shard listed separately) / manifest structure in separate sections. --rebuild-index additionally runs a two-way comparison of the index rebuilt from a scan against the one on disk: it reports both a dropped bundle whose index entry is missing, and the reverse drift where the index declares a version whose tgz is gone. Note: passing only proves origin and integrity — it is not an endorsement of content safety",
					},
					"trial": {
						short: { zh: "一次性隔离站点试装，跑完即毁", en: "Full install trial in a throwaway isolated site" },
						zh: "ojm market trial [--fixture <name@version>] [--keep]\n  在一次性隔离站点（随机端口 + 一次性 DB/密钥/凭据/信任库/CDN）里跑完整安装，跑完即毁；--keep 保留现场供排查",
						en: "ojm market trial [--fixture <name@version>] [--keep]\n  Run a full install in a throwaway isolated site (random port + throwaway DB/keys/credentials/trust store/CDN), destroyed right after; --keep preserves the scene for debugging",
					},
					"walkthrough": {
						short: { zh: "隔离站点跑全套市场操作并出 AC 表", en: "Run the full marketplace operation set in an isolated site, print an AC table" },
						zh: "ojm market walkthrough [--only <op>] [--strict] [--keep]\n  隔离站点跑全套市场操作并出 AC 表",
						en: "ojm market walkthrough [--only <op>] [--strict] [--keep]\n  Run the full marketplace operation set in an isolated site and print an AC table",
					},
				},
			},
		],
	},
	{
		key: "oj-passthrough",
		zh: "oj 子命令透传",
		en: "oj subcommand passthrough",
		commands: OJ_PASSTHROUGH.map(sub => ({
			key: "oj",
			name: sub,
			zh: `透传给 oj ${sub}（自动补 -c <project>/config.yaml）`,
			en: `Passthrough to oj ${sub} (auto-appends -c <project>/config.yaml)`,
			allowUnknownOptions: true,
			detail: {
				zh: `ojm ${sub} [args...]\n  透传给 oj 同名子命令（自动补 -c <project>/config.yaml；其余参数原样转发）`,
				en: `ojm ${sub} [args...]\n  Passthrough to the oj subcommand of the same name (auto-appends -c <project>/config.yaml; all other arguments are forwarded as-is)`,
			},
		})),
	},
];

export const COMMANDS: HelpEntry[] = HELP_GROUPS.flatMap(g => g.commands);

export function findCommand(rawName: string): HelpEntry | undefined {
	return COMMANDS.find(c => c.name === rawName);
}

/** 首位置参数是否是已知命令（cac 只按首段匹配，子命令如 verify 不算独立命令）。 */
export function isKnownCommand(name: string): boolean {
	return COMMANDS.some(c => c.name.split(" ")[0] === name);
}

interface HelpSection { title?: string, body: string }

/**
 * 借 cac 的 Commands 分节排版（命令名对齐 + 描述列）渲染一组命令行。
 * cac.outputHelp 只走 console.log：临时静默，section 经 help 回调捕获后自行拼接。
 */
function renderGroupBody(lang: Lang, entries: HelpEntry[]): string {
	const cli = cac("ojm");
	for (const e of entries) {
		// 带子命令的命令（market）：索引按子命令展开一行一条，父命令本身不上索引
		if (e.subs) {
			const prefix = e.name.split(" ")[0];
			for (const [sub, s] of Object.entries(e.subs)) {
				const desc = s.short ? pick(s.short, lang) : pick(s, lang).split("\n")[0];
				cli.command(`ojm ${prefix} ${sub}`, desc);
			}
			continue;
		}
		// 索引不展示守卫用 variadic（如 new 的 [...extra]），只显示主签名
		cli.command(`ojm ${e.name.replace(/\s*\[\.\.\.\w+\]$/, "")}`, pick(e, lang));
	}
	let sections: HelpSection[] = [];
	cli.help((s) => {
		sections = s;
		return s;
	});
	const log = console.log;
	console.log = () => {};
	try {
		cli.outputHelp();
	}
	finally {
		console.log = log;
	}
	return sections.find(s => s.title === "Commands")?.body ?? "";
}

function sectionsToString(sections: HelpSection[]): string {
	return sections.map(s => (s.title ? `${s.title}:\n${s.body}` : s.body)).join("\n\n");
}

/** 顶层帮助 sections（usageText 与 cli.ts 的全局 help 回调同源）。 */
export function topHelpSections(lang: Lang): HelpSection[] {
	return [
		{ title: lang === "zh-CN" ? "用法" : "Usage", body: "ojm <command> [options]" },
		...HELP_GROUPS.map(g => ({ title: pick(g, lang), body: renderGroupBody(lang, g.commands) })),
		{
			body: [
				`ojm --version | -V        ${lang === "zh-CN" ? "显示 cli 包版本" : "Show the cli package version"}`,
				`ojm <cmd> --help          ${lang === "zh-CN" ? "单命令详解（如 ojm market setup --help）" : "Per-command details (e.g. ojm market setup --help)"}`,
				`--json                    ${lang === "zh-CN" ? "机器通道：stdout 只放一份 JSON 信封，人话改走 stderr" : "Machine channel: one JSON envelope on stdout, human lines move to stderr"}`,
				lang === "zh-CN"
					? "退出码                    0 成功 / 1 业务失败 / 2 用法错误（改脚本即可）"
					: "Exit codes                0 success / 1 business failure / 2 usage error (fix the command line)",
			].join("\n"),
		},
	];
}

export function usageText(lang: Lang = resolveLang()): string {
	return sectionsToString(topHelpSections(lang));
}

/** 单个分组的帮助文本（bare `ojm market` 等场景）。 */
export function groupHelpText(groupKey: string, lang: Lang): string | undefined {
	const g = HELP_GROUPS.find(x => x.key === groupKey);
	if (!g)
		return undefined;
	return `${pick(g, lang)}:\n${renderGroupBody(lang, g.commands)}`;
}
