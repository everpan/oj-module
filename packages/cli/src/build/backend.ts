// 后端构建编排（SRP 拆分自 build.ts，2026-11-03，计划 docs/plans/20261103-0930）：
// 编排 `bin/oj build` 生成 api/dist 产物——别名投影、能力闸门、密封值试解、
// 宿主 versions.json 双落点都在这一段，前端构建见 module-build.ts。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ALIAS_PATHS_FILE, syncAliasPaths } from "../alias-paths";
import { mergeConfigForDev } from "../dev-secrets";
import { resolveConfigPath, tryResolveLayout } from "../layout";
import { requireModuleRootCapability } from "../oj-caps";
import { resolveOjBin } from "../vendor";
import { resolveShellDist } from "../versions";

/**
 * 物化安装器 C2-09 真源：把内置宿主 `versions.json` 拷入 apiDist（B-11 布局，
 * 与 manifests.yaml 同层，方案安装器 peerRuntime 强制比对的读取面）。
 *
 * release（buildBackend 双落点）与 dev（ojm dev 第三落点，2026-11-07 支柱一：
 * dev 形态 platform.root=src 不经 oj build，此前无此文件 → 随站 bundle 收敛被
 * C2-09 fail-closed 永久拒装）共用本函数，两处必须同源。
 * 已有文件覆盖——派生物非用户数据，cli 升级后 dev 重启即刷新；源缺失返回 false
 * 不抛（shell-dist 未构建的合法态，告警归调用方）。
 */
export function materializeInstallerVersions(apiDist: string, shellDist: string = resolveShellDist()): boolean {
	const versionsSrc = path.join(shellDist, "versions.json");
	if (!fs.existsSync(versionsSrc))
		return false;
	fs.mkdirSync(apiDist, { recursive: true });
	fs.copyFileSync(versionsSrc, path.join(apiDist, "versions.json"));
	return true;
}

/** 锁条目下降/消失的判定结果（构建守卫用） */
export interface LockRegression {
	name: string
	from: string
	/** 构建后的版本；条目被整行移除时为 null */
	to: string | null
}

/** 解析 manifests.yaml（扁平 `name: version` 锁，机器产物无注释） */
export function parseLockVersions(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const raw of text.split("\n")) {
		const m = /^([\w.@/-]+):\s*(\S+)\s*$/.exec(raw.trim());
		if (m)
			out[m[1]!] = m[2]!;
	}
	return out;
}

/** 按段数值比较（0.2.10 > 0.2.9；非数字段按 0）；返回负数/0/正数 */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
	const pb = b.split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0)
			return d;
	}
	return 0;
}

/**
 * 找出「重建会把已装锁写坏」的条目。
 *
 * 背景（2026-11-08 实测 oj 0.1.125）：`oj build` 用源码 manifest **全量重写**
 * `dist/api/manifests.yaml`——不在源码树里的条目直接消失，版本比源码低的条目被静默
 * 改小，旧版本目录变成孤儿。线上跑预构建 `_platform`（源码快照较旧）时，重建会把
 * 已升级的模块降级甚至整行摘掉，`oj serve` 下一代会加载旧模块或整体报错。
 *
 * 判定：①版本变小 → downgraded；②条目消失且 `dist/api/<name>-<旧版本>` 目录仍在
 * （= 确实装过）→ dropped。只报告，处置交调用方（buildBackend 还原锁并 fail-closed）。
 */
export function findLockRegressions(
	before: Record<string, string>,
	after: Record<string, string>,
	dirExists: (name: string, version: string) => boolean,
): LockRegression[] {
	const out: LockRegression[] = [];
	for (const [name, from] of Object.entries(before)) {
		const to = after[name];
		if (to === undefined) {
			if (dirExists(name, from))
				out.push({ name, from, to: null });
			continue;
		}
		if (compareVersions(to, from) < 0)
			out.push({ name, from, to });
	}
	return out;
}

/**
 * 构建后端（api/src 存在时编排 `bin/oj build`，D8）。
 *
 * 绝不在此处跑 migrate：oj build 本身零磁盘副作用，`ojm build` 保持零 DB
 * 副作用（CI/无 DB 环境可跑）；迁移由 preview 在起服务前应用（设计 §6）。
 * 无后端源码返回 false（纯前端工程跳过）。
 */
export async function buildBackend(projectRoot: string): Promise<boolean> {
	// 没有模块源码的工程（如 market 的隔离站点根）直接跳过——不能因为探测不到布局就抛
	const layout = tryResolveLayout(projectRoot);
	const moduleRoot = layout?.kind === "module-root";
	const apiSrc = moduleRoot
		? layout.modulesSrc
		: path.join(projectRoot, "api/src");
	if (!fs.existsSync(apiSrc))
		return false;

	const oj = resolveOjBin(projectRoot);
	if (!fs.existsSync(oj)) {
		throw new Error(
			`[ojm] 找到 ${path.relative(projectRoot, apiSrc) || "."} 但缺少 ${oj}。\n`
			+ "请重跑 ojm init 幂等补缺（不会覆盖 config 与用户代码）。",
		);
	}
	// 能力闸门先于任何写入：失败时磁盘上不留半成品
	if (moduleRoot)
		requireModuleRootCapability(projectRoot);

	// 别名投影：模块增删后要让 TS 的 paths 跟上（否则 `#/<模块名>/…` 在编辑器/typecheck
	// 里解析不到，退化成 any）。内容未变不写盘。
	const syncedPaths = syncAliasPaths(projectRoot);
	if (syncedPaths === "created" || syncedPaths === "updated")
		console.log(`[ojm] 已${syncedPaths === "created" ? "生成" : "更新"} ${ALIAS_PATHS_FILE}（\`#/<模块名>/…\` 的 TS paths 投影）`);

	const apiDist = layout?.apiDist ?? path.join(projectRoot, "dist", "api");
	console.log("[ojm] oj build（后端）…");
	// 必须显式给 -c：oj build 的 -c 缺省是 ./config.yaml（相对 CWD），而 config 在
	// <project>/config/ 下——漏传会静默读不到配置，连带 tasks 镜像目录回落默认 "tasks"、
	// sql_guard 声明校验不生效（oj 只 warn 两行，极易被忽略）。
	const configPath = resolveConfigPath(projectRoot);
	// 与 dev 同一条合并链路（方案 A'）：tracked + gitignored config.local.yaml 深合并 →
	// .ojm-tmp-config.yaml，-c 指向合并产物。全新 clone 的机器只有本机 dev 密钥对，tracked
	// 的 prod ENC（jwt_secret）按设计解不开——直接喂 tracked 会让密封值预检误杀（dev 能跑、
	// build 必挂）。合并产物里 jwt 已被本机 dev 密文覆盖，而编译本身不需要密文明文，产物也不
	// 嵌 config（部署侧自带）。产物与 config.yaml 同目录，secrets.private_key_path 等相对路径
	// 解析不变；非 jwt 的 ENC 解不开仍由链路内红线抛错（防护不降级）。
	let effectiveConfigPath: string | undefined;
	if (fs.existsSync(configPath))
		effectiveConfigPath = mergeConfigForDev(projectRoot, configPath);
	// --no-minify：oj 的 swc minify 当前会把产物压坏，必须绕开。实测两种坏法：
	//   1) `const rows = await db.query(...); rows[0]` → 压成 `await db.query(...)[0]`，
	//      下标先于 await 求值，Promise 上取 [0] 得 undefined（登录恒 401）；
	//   2) `if (cond) x = y` → 压成 `cond && x = y`，赋值作 && 右项缺括号 →
	//      SyntaxError: Invalid left-hand side in assignment（端点 500）。
	// 0.1.32 / 0.1.50 均复现。产物体积换正确性，等上游修好再撤这个旗标。
	// v0.1.85：`--module-root <dir>` 与 `-d` 互斥（都是「源码树根」）。新布局给 src，
	// oj 在子树内递归找 manifest.yaml（命中 src/<name>/api/manifest.yaml 即停）。
	const sourceArgs = layout?.moduleRoot ? ["--module-root", layout.moduleRoot] : ["-d", apiSrc];
	// 出包前先自己确认 config 能读：读不动时 oj build 会静默关掉 sql_guard（见函数注释）
	if (effectiveConfigPath)
		assertSealedValuesOpenable(oj, effectiveConfigPath);
	// 重建不得把已装模块写坏（2026-11-08 实测 oj 0.1.125：oj build 用源码 manifest 全量重写
	// manifests.yaml）。先留底，构建后比对，出现降级/条目消失就还原锁并 fail-closed——
	// 线上跑预构建 _platform（源码快照较旧）时，静默降级会让孩子下一代的 serve 加载旧模块
	// 或直接因「锁里目录缺失」整体报错，比构建失败难查得多。
	const lockPath = path.join(apiDist, "manifests.yaml");
	const lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf-8") : null;
	execFileSync(oj, [
		"build",
		...(effectiveConfigPath ? ["-c", effectiveConfigPath] : []),
		...sourceArgs,
		"-o",
		apiDist,
		"--no-minify",
	], { stdio: "inherit" });
	if (lockBefore !== null) {
		const lockAfter = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf-8") : "";
		const regressions = findLockRegressions(
			parseLockVersions(lockBefore),
			parseLockVersions(lockAfter),
			(name, version) => fs.existsSync(path.join(apiDist, `${name}-${version}`)),
		);
		if (regressions.length > 0) {
			// 还原锁：构建产物作废但线上装配面不受影响（旧版本目录仍在）
			fs.writeFileSync(lockPath, lockBefore, "utf-8");
			const lines = regressions.map(r => `  · ${r.name}: ${r.from} → ${r.to ?? "（条目被移除）"}`).join("\n");
			throw new Error(
				`[ojm] 构建中止：${lockPath} 会被这次重建写坏，已还原为构建前内容。\n${lines}\n`
				+ "原因：oj build 用源码 manifest 全量重写锁——源码里的模块版本低于 dist/api 已装版本，\n"
				+ "      或源码里没有该模块（预构建 _platform 的源码快照较旧时最常见）。\n"
				+ "处置：把源码 src/<name>/api/manifest.yaml 的 version 抬到 >= 已装版本后重跑；\n"
				+ "      确认要下线该模块时，先删 dist/api/<name>-<已装版本>/ 目录再构建（删目录 = 明确放弃该版本）。",
			);
		}
	}
	// 宿主 versions.json 双落点：站点壳从 shell-dist 拷进 dist/web（mergeShellSite），
	// 而方案安装器读的是 `dist/api/versions.json`（B-11：与 manifests.yaml 同层，用于
	// peerRuntime 强制比对）。两处必须同源，否则新工程 `ojm build` 完仍装不上方案——
	// preflight 直接 C2-09 fail-closed「无法读取宿主 runtime 版本」。
	if (!materializeInstallerVersions(apiDist))
		console.warn("[ojm] ⚠️ 内置宿主 versions.json 缺失（shell-dist 未构建？）：方案安装将被 C2-09 fail-closed 拒绝。");
	return true;
}

/**
 * config 里的密封值（`oj secret seal` 产物）在 build 前试解一把——fail-closed。
 *
 * **为什么不能只信 oj 的 warn**：实测（oj 0.1.115）config 读不动时 `oj build` **退出码仍是 0**，
 * 只往 stderr 甩两行「读配置失败 → 镜像目录回落默认 tasks / 本次 build 按 sql_guard=off 处理」，
 * 然后照常出包。那两行夹在模块清单里极易被忽略，而关掉的 `sql_guard` 正是 tenant 声明校验
 * （跨模块 SQL 的唯一守卫）——包看起来完好，检查其实没跑。
 *
 * 对象是**合并产物**（`mergeConfigForDev` 出的 .ojm-tmp-config.yaml）：tracked 的 prod jwt
 * ENC 在合并时已被本机 dev 密文覆盖，能走到这里的密文本机都该解得开——解不开只可能是本机
 * dev jwt 坏了或 local 覆盖里带了别的密文，属兜底双保险（第一道闸是链路内红线）。
 *
 * 探法就是 oj 自己的排障命令 `oj secret open`：它和 `oj serve` / `oj build` 用同一套密钥解析
 * （`OJ_SECRET_KEY` → `OJ_SECRET_KEY_FILE` → config 的 `secrets.private_key_path`），
 * 解不开就非零退出。明文只可能出现在它的 stdout，这里直接丢弃，不落终端也不落日志。
 */
function assertSealedValuesOpenable(oj: string, configPath: string): void {
	// 注释行不算：config 里留着注释掉的旧密文很常见，naive 匹配会让 build 因为一行 `#` 而失败
	const live = fs.readFileSync(configPath, "utf-8")
		.split("\n")
		.filter(line => !line.trimStart().startsWith("#"))
		.join("\n");
	const sealed = [...new Set(live.match(/ENC\[[^\]\n]+\]/g) ?? [])];
	for (const value of sealed) {
		try {
			execFileSync(oj, ["secret", "open", "-c", configPath, value], { stdio: ["ignore", "ignore", "pipe"] });
		}
		catch (e) {
			const stderr = String((e as { stderr?: unknown }).stderr ?? "").trim();
			const detail = stderr || (e as Error).message;
			throw new Error(
				`[ojm] config 里的密封值解不开，已停在出包前：${configPath}\n`
				+ `      oj 说：${detail}\n`
				+ "\n"
				+ "不能放行：oj build 遇到读不动的 config 不会失败（退出码 0），只 warn 两行就继续——\n"
				+ "tasks 镜像目录回落默认值，sql_guard（tenant 声明校验）直接关掉。那种包看着正常，\n"
				+ "跨模块 SQL 的守卫却没跑过。\n"
				+ "\n"
				+ "两类原因，都修得了：\n"
				+ "  1) 本机加载的私钥与密封时用的公钥不是一对——最常见是换机器/换部署目录时只带了\n"
				+ "     config.yaml，没带 config/secrets-private.pem；\n"
				+ "  2) 密文被改过——手工编辑、复制被截断、编辑器把长行折了。\n"
				+ "\n"
				+ "dev 机提示：jwt_secret 由 config.local.yaml 供给（本机密钥可轮换）；若解不开的就是它，\n"
				+ "      删掉 config.local.yaml 里的 auth.jwt_secret 行，重跑一次 ojm dev 会重新密封。\n"
				+ "\n"
				+ "单独验一条：oj secret open -c <config> '<那个 ENC[...] 值>'（成功=这条没问题，失败=就是它）\n"
				+ "修法：把配对私钥带到本机（OJ_SECRET_KEY / OJ_SECRET_KEY_FILE / config 的 secrets.private_key_path\n"
				+ "      三选一）；密钥确实换了，就在本机重新 oj secret seal 覆写该值（明文走 stdin，别上命令行）。",
			);
		}
	}
}
