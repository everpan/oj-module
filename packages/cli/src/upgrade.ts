import { Buffer } from "node:buffer";
/**
 * `ojm upgrade` —— 框架升级（计划 20261122-1055）。
 *
 * 以 `ojm init --yes` 为基础：用户侧工程无源码，升级 = 换钉 @oj-module/cli + runtime
 * （lockstep 同版本，runtime 缺该版本回退其 latest）→ 由**新装的 CLI 自己**跑
 * `init --yes` 恢复保护根（src/app、src/oj-market），框架自带模块随模板升级。
 *
 * 纪律：
 *  - 先评估后执行：评估阶段零工程写入（registry packument + 目标版本 tgz 解到临时目录
 *    只做漂移预览）；无 --yes 打印评估即退。
 *  - 改动面收敛：package.json 两个 devDep + node_modules（pnpm）+ 保护根 + .ojm-upgrade/
 *    备份目录；config.yaml、自定义 src/<name>、overlay DB（enabled 方案）一律不碰。
 *  - 备份 + 回退：执行前 sha256 清单备份，S3-S5 任一失败回滚备份、补 pnpm install，
 *    报告失败阶段 + 原始错误 + 备份路径。bin/（oj 二进制）不在回滚面：能力闸门
 *    （MIN_OJ_VERSION）保证其只前进到兼容版本（失败时新旧可共存）。
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parse as parseYaml } from "yaml";
import { BUILTIN_LIST_FILE } from "./builtin";
import { collectDefaultModuleDrift, PROTECTED_ROOTS } from "./scaffold-guard";

const SCOPE_CLI = "@oj-module/cli";
const SCOPE_RT = "@oj-module/runtime";
/** 备份保留份数（轮换最旧） */
const BACKUP_KEEP = 3;
/** 顶层备份文件（缺失则跳过；保护根目录整树递归备份） */
const TOP_FILES = [
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"config.yaml",
	"web.config.ts",
	"tsconfig.json",
	"src/tsconfig.json",
	`src/${BUILTIN_LIST_FILE}`,
] as const;

export interface UpgradeDeps {
	/** 注入 fetch（测试）；缺省全局 fetch */
	fetchFn?: typeof fetch
	/** 注入下载解包（测试用假模板树顶替）；缺省 packument → tarball → tar -xzf 到临时目录 */
	stageNewCli?: (target: string) => Promise<{ dir: string, runtimeVersion?: string }>
	/** 注入命令执行器（测试）；缺省 execFileSync stdio:inherit。pnpm add / pnpm install 走这里 */
	runCmd?: (cmd: string, args: string[], cwd: string) => void
	/** 注入新 CLI init --yes（测试）；缺省 node <proj>/node_modules/@oj-module/cli/bin/ojm.mjs init --yes */
	spawnInit?: (ojmBin: string, args: string[], cwd: string) => void
}

export interface UpgradeOptions extends UpgradeDeps {
	/** 非交互确认：无则打印评估后退出（零写入） */
	yes?: boolean
	/** 钉目标版本（缺省 registry dist-tags.latest） */
	to?: string
	/** registry 地址（缺省 https://registry.npmjs.org） */
	registry?: string
}

export interface UpgradeResult {
	status: "assessed" | "up-to-date" | "upgraded"
	/** 目标版本（up-to-date/assessed 时 = 解析出的 latest） */
	to: string
	/** 备份目录（upgraded 时存在；回滚失败时也指向该备份） */
	backupDir?: string
}

interface Packument {
	"dist-tags": { latest?: string }
	"versions": Record<string, { version: string, dist?: { tarball?: string } }>
}

function defaultRegistryOf(opts: UpgradeOptions): string {
	return (opts.registry ?? "https://registry.npmjs.org").replace(/\/+$/, "");
}

async function fetchPackument(registry: string, name: string, fetchFn: typeof fetch): Promise<Packument> {
	const res = await fetchFn(`${registry}/${name.replace("/", "%2f")}`);
	if (!res.ok)
		throw new Error(`registry 不可达：GET ${name} → HTTP ${res.status}`);
	return await res.json() as Packument;
}

/** 默认 stage：下载目标版本 tgz → tar 解到临时目录（漂移对比用模板树 + runtime 配对版本） */
async function defaultStage(registry: string, target: string, fetchFn: typeof fetch) {
	const doc = await fetchPackument(registry, SCOPE_CLI, fetchFn);
	const tarball = doc.versions[target]?.dist?.tarball;
	if (!tarball)
		throw new Error(`registry 上 ${SCOPE_CLI}@${target} 没有 dist.tarball`);
	const res = await fetchFn(tarball);
	if (!res.ok)
		throw new Error(`tarball 下载失败：HTTP ${res.status}`);
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ojm-upgrade-${target}-`));
	const tgz = path.join(tmp, "cli.tgz");
	fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
	execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
	const dir = path.join(tmp, "package");
	// runtime 配对版本取新 cli 自带的宿主版本快照（lockstep 真源）；缺省 undefined → 外面回退
	let runtimeVersion: string | undefined;
	try {
		const snap = JSON.parse(fs.readFileSync(path.join(dir, "vendor", "host-versions.json"), "utf8")) as { matrix?: Record<string, string> };
		runtimeVersion = snap.matrix?.[SCOPE_RT];
	}
	catch { /* 快照缺失：回退 packument 裁决 */ }
	return { dir, runtimeVersion };
}

function currentCliVersion(projectRoot: string): string {
	const pkgPath = path.join(projectRoot, "package.json");
	if (!fs.existsSync(pkgPath))
		throw new Error(`[ojm] ${projectRoot} 没有 package.json，不是 ojm 工程`);
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { devDependencies?: Record<string, string> };
	const v = pkg.devDependencies?.[SCOPE_CLI];
	if (!v)
		throw new Error(`[ojm] package.json 未钉 ${SCOPE_CLI}——请先在工程内安装 oj-module 框架`);
	return v.replace(/^\D*/, ""); // 剥 ^/~ 等前缀（init 产物是精确版本，防御一手）
}

function topLevelKeys(yamlText: string): Set<string> {
	try {
		const doc = parseYaml(yamlText) as unknown;
		return new Set(doc !== null && typeof doc === "object" ? Object.keys(doc as Record<string, unknown>) : []);
	}
	catch {
		return new Set(); // 解析不了就当无键（评估是建议面，不阻断）
	}
}

interface BackupManifest {
	created: string
	files: Array<{ rel: string, sha256: string, size: number }>
}

/** 备份：顶层清单文件（存在才收）+ 保护根整树；sha256 清单落备份目录 */
function takeBackup(projectRoot: string, backupRoot: string): string {
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
	const dir = path.join(backupRoot, `backup-${stamp}`);
	const files: BackupManifest["files"] = [];
	const push = (rel: string, abs: string): void => {
		const buf = fs.readFileSync(abs);
		files.push({ rel, sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length });
		const dest = path.join(dir, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, buf);
	};
	for (const rel of TOP_FILES) {
		const abs = path.join(projectRoot, rel);
		if (fs.existsSync(abs) && fs.statSync(abs).isFile())
			push(rel, abs);
	}
	for (const root of PROTECTED_ROOTS) {
		const walk = (dirAbs: string, relBase: string): void => {
			for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
				const abs = path.join(dirAbs, ent.name);
				const rel = `${relBase}/${ent.name}`;
				if (ent.isDirectory())
					walk(abs, rel);
				else if (ent.isFile())
					push(rel, abs);
			}
		};
		const abs = path.join(projectRoot, root);
		if (fs.existsSync(abs))
			walk(abs, root);
	}
	fs.mkdirSync(dir, { recursive: true });
	files.sort((a, b) => a.rel.localeCompare(b.rel));
	fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify({ created: new Date().toISOString(), files }, null, 2)}\n`);
	// 轮换：保留最近 BACKUP_KEEP 份（olds 已含本次新备份）
	const olds = fs.readdirSync(backupRoot).filter(d => d.startsWith("backup-")).sort();
	for (const old of olds.slice(0, Math.max(0, olds.length - BACKUP_KEEP)))
		fs.rmSync(path.join(backupRoot, old), { recursive: true, force: true });
	return dir;
}

/** 回滚：保护根内「备份没有的新文件」清除 + 备份文件逐份写回；顶层文件直接写回 */
function restoreBackup(projectRoot: string, dir: string): void {
	const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as BackupManifest;
	const backed = new Set(manifest.files.map(f => f.rel));
	for (const root of PROTECTED_ROOTS) {
		const absRoot = path.join(projectRoot, root);
		if (!fs.existsSync(absRoot))
			continue;
		const walk = (dirAbs: string, relBase: string): void => {
			for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
				const abs = path.join(dirAbs, ent.name);
				const rel = `${relBase}/${ent.name}`;
				if (ent.isDirectory())
					walk(abs, rel);
				else if (ent.isFile() && !backed.has(rel))
					fs.rmSync(abs);
			}
		};
		walk(absRoot, root);
	}
	for (const f of manifest.files) {
		const dest = path.join(projectRoot, f.rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, fs.readFileSync(path.join(dir, f.rel)));
	}
}

function fmtDrift(drift: { modified: string[], missing: string[], extra: string[] }): string {
	return [
		`modified=${drift.modified.length}${drift.modified.length ? `（${drift.modified.slice(0, 5).join(", ")}${drift.modified.length > 5 ? "…" : ""}）` : ""}`,
		`missing=${drift.missing.length}${drift.missing.length ? `（${drift.missing.slice(0, 5).join(", ")}${drift.missing.length > 5 ? "…" : ""}）` : ""}`,
		`extra=${drift.extra.length}${drift.extra.length ? `（${drift.extra.slice(0, 5).join(", ")}${drift.extra.length > 5 ? "…" : ""}）` : ""}`,
	].join("，");
}

export async function upgradeProject(projectRoot: string, opts: UpgradeOptions = {}): Promise<UpgradeResult> {
	const registry = defaultRegistryOf(opts);
	const fetchFn = opts.fetchFn ?? fetch;
	const runCmd = opts.runCmd ?? ((cmd: string, args: string[], cwd: string): void => {
		execFileSync(cmd, args, { cwd, stdio: "inherit" });
	});
	const stageNewCli = opts.stageNewCli ?? (async (target: string) => await defaultStage(registry, target, fetchFn));
	const spawnInit = opts.spawnInit ?? ((ojmBin: string, args: string[], cwd: string): void => {
		execFileSync(process.execPath, [ojmBin, ...args], { cwd, stdio: "inherit" });
	});
	const log = (s: string): void => console.log(`[ojm] ${s}`);

	const current = currentCliVersion(projectRoot);
	// S1 评估（只读）：packument 裁决目标版本 + 拉目标模板做漂移预览
	const cliDoc = await fetchPackument(registry, SCOPE_CLI, fetchFn);
	const rtDoc = await fetchPackument(registry, SCOPE_RT, fetchFn);
	const target = opts.to ?? cliDoc["dist-tags"].latest;
	if (target === undefined || cliDoc.versions[target] === undefined) {
		const avail = Object.keys(cliDoc.versions).slice(-5).join(", ");
		throw new Error(`[ojm] 目标版本 ${target ?? "(无 latest)"} 不在 ${SCOPE_CLI} 已发布版本中（最近可用：${avail}）`);
	}
	const stage = await stageNewCli(target);
	const runtimeVersion = stage.runtimeVersion ?? (rtDoc.versions[target] !== undefined ? target : rtDoc["dist-tags"].latest);
	if (runtimeVersion === undefined)
		throw new Error(`[ojm] ${SCOPE_RT} 无可用版本（packument 缺 latest）`);

	log(`升级评估：${SCOPE_CLI} ${current} → ${target}（registry 最新），${SCOPE_RT} 配对 ${runtimeVersion}`);
	const drift = collectDefaultModuleDrift(projectRoot, path.join(stage.dir, "templates"));
	if (drift)
		log(`保护根相对新版本模板漂移预览：${fmtDrift(drift)}（init --yes 将恢复为新模板，其中本地修改会被丢弃）`);
	const tplConfig = path.join(stage.dir, "templates", "config.yaml");
	const projConfig = path.join(projectRoot, "config.yaml");
	if (fs.existsSync(tplConfig) && fs.existsSync(projConfig)) {
		const tplKeys = topLevelKeys(fs.readFileSync(tplConfig, "utf8"));
		const projKeys = topLevelKeys(fs.readFileSync(projConfig, "utf8"));
		const added = [...tplKeys].filter(k => !projKeys.has(k));
		if (added.length > 0)
			log(`config.yaml 新顶层键（评估提示，init 不覆盖 config.yaml，请按需手动合并）：${added.join(", ")}`);
	}
	log("不受影响：config.yaml、自定义 src/<name> 模块、cdn/ 与 dist/、站点 DB（已装方案及其 enabled 状态）");
	if (current === target) {
		log(`已是最新版本（${target}），无需升级`);
		return { status: "up-to-date", to: target };
	}
	if (!opts.yes) {
		log("以上为评估结果（零写入）。确认无误后加 --yes 执行升级");
		return { status: "assessed", to: target };
	}

	// S2 备份（备份失败 = 中止，此时零改动）
	const backupRoot = path.join(projectRoot, ".ojm-upgrade");
	let backupDir = "";
	try {
		fs.mkdirSync(backupRoot, { recursive: true });
		backupDir = takeBackup(projectRoot, backupRoot);
		log(`已备份至 ${path.relative(projectRoot, backupDir) || backupDir}（含 sha256 清单，保留最近 ${BACKUP_KEEP} 份）`);
	}
	catch (e) {
		throw new Error(`[ojm] 备份失败（升级已中止，工程未改动）：${(e as Error).message}`);
	}

	const rollback = (stageNo: string, error: unknown): never => {
		const msg = error instanceof Error ? error.message : String(error);
		log(`升级失败（阶段 ${stageNo}）：${msg}——正在回滚备份…`);
		try {
			restoreBackup(projectRoot, backupDir);
			runCmd("pnpm", ["install"], projectRoot);
		}
		catch (rb) {
			throw new Error(`[ojm] 升级失败（阶段 ${stageNo}）：${msg}\n⚠️ 自动回滚也失败：${(rb as Error).message}——请从备份手动恢复：${backupDir}`);
		}
		throw new Error(`[ojm] 升级失败（阶段 ${stageNo}）：${msg}\n已回滚至升级前状态（备份保留在 ${backupDir}）`);
	};

	// S3 换版（显式 --registry 时转发给 pnpm add：用户的 registry 意图必须贯穿全链路，
	// 否则升级看得见版本却装不上——2026-11-22 真机实锤）
	try {
		log(`安装 ${SCOPE_CLI}@${target} + ${SCOPE_RT}@${runtimeVersion}…`);
		const addArgs = ["add", "-D", `${SCOPE_CLI}@${target}`, `${SCOPE_RT}@${runtimeVersion}`];
		if (opts.registry !== undefined)
			addArgs.push("--registry", registry);
		runCmd("pnpm", addArgs, projectRoot);
	}
	catch (e) {
		rollback("S3", e);
	}

	// S4 由新 CLI 自己恢复保护根（init --yes 语义：覆盖/清理 src/app、src/oj-market）
	try {
		const ojmBin = path.join(projectRoot, "node_modules", "@oj-module", "cli", "bin", "ojm.mjs");
		log("以新版本 CLI 重跑 init --yes（恢复框架自带模块）…");
		spawnInit(ojmBin, ["init", "--yes"], projectRoot);
	}
	catch (e) {
		rollback("S4", e);
	}

	// S5 后置漂移检：相对新模板必须归零
	const post = collectDefaultModuleDrift(projectRoot, path.join(stage.dir, "templates"));
	if (post && (post.modified.length > 0 || post.missing.length > 0 || post.extra.length > 0)) {
		const bad = [...post.modified, ...post.missing, ...post.extra].slice(0, 5).join(", ");
		rollback("S5", new Error(`新基线仍有漂移：${bad}`));
	}

	log(`升级完成：${SCOPE_CLI} ${current} → ${target}。bin/（oj 二进制）若被更新不在回滚面，能力闸门保证版本兼容；如需回退整个升级，可用备份：${backupDir}`);
	return { status: "upgraded", to: target, backupDir };
}
