/**
 * `ojm preview` —— 生产形态预览（设计 §6，2026-10-19 单服务化）。
 *
 * 职责：fail-fast 四查 → `oj migrate`（失败即退，不起 server）→ 派生
 * preview config（注入 web 挂载 + spa: true）→ `oj serve`（release/js，
 * **单进程同时出 API 与静态**）。ojm 不再自建 http server、不再反代——
 * 前后端同端口同进程，与「oj serve + web 挂载」的生产公式逐字同形。
 *
 * 派生 config 为临时产物（api/.ojm-preview.yaml，与原件同目录保证相对
 * 路径解析一致），三路清理：ready 拒绝路径 / SIGINT / process exit 兜底
 * （语义与落盘见 preview-config.ts）。
 *
 * web.config.ts 的 htmlTransform 是 serve 期钩子，单服务下 oj 直出 HTML
 * 无从介入——启动时检测到配置即 WARN 并指向 oj 的 html_meta /
 * html_meta_handler（devkit 手册「静态站点与 per-route meta」）。
 *
 * 一律传绝对路径：oj 命令行相对 CWD、config 内相对 config 目录，混用即歧义。
 */

import type { ModulesConfig } from "./config";
import type { OjProcess } from "./oj";
import type { PreviewConfigFiles } from "./preview-config";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadModulesConfig } from "./config";
import { resolveConfigPath, resolveLayout } from "./layout";
import { startOj } from "./oj";
import { readOjApiPrefix } from "./oj-config";
import { hasRootApiMount, parseMounts, writePreviewConfig } from "./preview-config";
import { normalizeSiteBase } from "./site-base";
import { resolveOjBin } from "./vendor";

export interface PreviewOptions {
	/** 显式端口（覆盖派生 config 的 server.port）；缺省沿用 config（oj 代码默认 9778） */
	port?: number
	/** 注入桩站点目录（默认 layout.distDir） */
	siteDir?: string
	/** 注入桩 oj 命令执行（migrate）；默认 execFileSync(bin/oj, args, inherit) */
	execOj?: (args: string[]) => void
	/** 注入桩 oj 进程；默认 startOj */
	ojStarter?: (configPath: string, base: string, apiPath: string, extraArgs: string[]) => OjProcess
	/** 注入桩派生 config 落盘（测试）；默认 writePreviewConfig */
	configWriter?: (projectRoot: string, opts: { siteDir: string, prefix?: string, port?: number, apiRoot?: string }) => PreviewConfigFiles
}

export interface PreviewHandle {
	/** 停 oj 子进程并清理派生 config（测试与编程式消费用） */
	stop: () => Promise<void>
}

/**
 * 单服务 preview。返回后进程保活依赖 oj 子进程 stdio 管道（ref 状态）
 * 与已注册的信号 handler；Ctrl+C 走 SIGINT 善后。
 */
export async function runPreview(projectRoot: string, opts: PreviewOptions = {}): Promise<PreviewHandle> {
	const layout = resolveLayout(projectRoot);
	const siteDir = opts.siteDir ?? layout.distDir;
	const ojBin = resolveOjBin(projectRoot);
	const configPath = resolveConfigPath(projectRoot);
	const apiDist = path.join(projectRoot, "api", "dist");

	// fail-fast 四查：缺一即提示对应补救（init 幂等补缺 / ojm build 产物）
	if (!existsSync(ojBin))
		throw new Error(`[ojm] 缺少 ${ojBin}。\n请重跑 ojm init 或 ojm vendor（联网下载 oj，不覆盖 config 与用户代码）。`);
	if (!existsSync(configPath))
		throw new Error(`[ojm] 缺少 ${configPath}。\n请重跑 ojm init 生成后端配置。`);
	if (!existsSync(path.join(siteDir, "index.html")))
		throw new Error(`[ojm] ${siteDir} 缺少 index.html。\n请先 ojm build（构建模块并合并全站）。`);
	if (!existsSync(path.join(apiDist, "manifests.yaml")))
		throw new Error(`[ojm] ${apiDist} 缺少 manifests.yaml。\n请先 ojm build（后端 oj build 产物）。`);

	// DR-5：htmlTransform 存在性检测（只读 web.config.ts 的字段，不 import 变换模块——
	// 单服务下 oj 直出 HTML，钩子不生效；执行用户代码只会白付副作用）
	const moduleConfig = await warnHtmlTransformUnsupported(projectRoot);

	// 站点部署前缀：web.config.ts 的 siteBase（"{siteBase}" → 挂载 prefix "/oj"）。
	// 产物里的 URL 已按 siteBase 重写，preview 必须挂在同一前缀上，否则白屏。
	const sitePrefix = mountPrefixOf(moduleConfig?.siteBase);

	const execOj = opts.execOj ?? ((args: string[]) => execFileSync(ojBin, args, { stdio: "inherit" }));

	// D8：先迁移再起服务；migrate 非零退出 → 透传 stderr、ojm 非零退出、不起 server
	console.log("[ojm] oj migrate（应用待执行迁移）…");
	execOj(["migrate", "-c", configPath, "-d", apiDist]);

	// 派生 config 在 migrate 成功后落盘：失败即退路径零残留
	const base = readOjApiPrefix(configPath);
	const writer = opts.configWriter ?? ((root: string, o: { siteDir: string, prefix?: string, port?: number, apiRoot?: string }) => writePreviewConfig(root, o));
	// apiRoot 交给派生器：release 下 platform.root 必须指向 api/dist（与 --api-path 同源）
	const preview = writer(projectRoot, { siteDir, prefix: sitePrefix, port: opts.port, apiRoot: apiDist });

	// / api 挂载与注入的 web 挂载配对时 oj 不开 SPA 回落（oj 语义，见 devkit 手册 §13）。
	// 仅在站点挂根时成立：web 挂到 /oj 时两者不配对，深链回落正常。
	if (sitePrefix === "/" && hasRootApiMount(parseMounts(readFileSync(configPath, "utf-8"), configPath)))
		console.warn("[ojm] config 的 api 挂载位于 /：与 web 挂载配对时 oj 不做 SPA 深链回落（已知限制），深链接刷新将 404。");

	const starter = opts.ojStarter ?? ((cfg: string, b: string, apiPath: string, extraArgs: string[]) =>
		startOj(cfg, b, apiPath, undefined, extraArgs));
	// starter 可能同步抛错（startOj 首行 readOjPort 对缺/坏 server.port 即 throw，
	// 先于返回 OjProcess）——此刻 exit 兜底尚未注册，必须就地清理派生 config
	let oj: OjProcess;
	try {
		oj = starter(preview.configPath, base, apiDist, []);
	}
	catch (error) {
		preview.cleanup();
		throw error;
	}
	try {
		await oj.ready;
	}
	catch (error) {
		// F3：ready 拒绝必须先回收子进程，否则 oj 孤儿化继续占端口；派生 config 一并清理
		await oj.stop().catch(() => {});
		preview.cleanup();
		throw error;
	}
	console.log(`[ojm] oj 已就绪（release/js，单服务：${base} API + 静态 SPA 同进程）：http://127.0.0.1:${oj.port}`);
	console.log(`\n[ojm] preview 已启动：http://localhost:${oj.port}${sitePrefix === "/" ? "" : sitePrefix}`);
	console.log(`[ojm] 静态由 oj web 挂载直出（spa 深链回落）；派生 config ${path.basename(preview.configPath)} 为本进程临时产物，退出自动清理`);

	// 退出回收：派生 config 必须随 oj 一起消亡（test/integration 断言其不存在）
	// 终端 Ctrl-C 是进程组信号：外层 bin 转发一份 + 组送达一份，内层会收到
	// 两个 SIGINT。用 on + 幂等守卫吞掉第二个——once 在首次触发后即摘除，
	// 第二个 SIGINT 会走默认动作杀死本进程，清理全没跑（2026-10-19 冒烟实测）。
	let stopping = false;
	const onSigint = () => {
		if (stopping)
			return;
		stopping = true;
		console.log("\n[ojm] 正在退出…");
		// 同步先删派生 config：后续任何死亡路径（含信号）都零残留；oj 运行中
		// 已读入 config，运行期删除文件无影响
		preview.cleanup();
		void oj.stop().finally(() => process.exit(0));
		setTimeout(() => process.exit(0), 1500).unref();
	};
	process.on("SIGINT", onSigint);
	// 兜底：非优雅路径退出（未捕获异常等）时同步清掉派生 config，防下次启动读到陈旧文件
	const onExit = () => {
		preview.cleanup();
	};
	process.once("exit", onExit);

	// stop 摘除信号/退出 handler：编程式同进程多次调用不累积旧实例的闭包
	// （CLI 单次调用行为不变）
	const stop = async () => {
		process.removeListener("SIGINT", onSigint);
		process.removeListener("exit", onExit);
		await oj.stop();
		preview.cleanup();
	};

	return { stop };
}

/**
 * web.config.ts 配了 htmlTransform → WARN；返回已加载的配置（preview 还要读
 * siteBase 决定挂载前缀）。加载失败（缺文件/坏配置）静默跳过：能走到 preview
 * 的工程必然过 ojm build，config 问题会在那里先炸。
 */
async function warnHtmlTransformUnsupported(projectRoot: string): Promise<ModulesConfig | undefined> {
	try {
		const config = await loadModulesConfig(projectRoot);
		if (config.htmlTransform) {
			console.warn(
				"[ojm] web.config.ts 配置了 htmlTransform：单服务 preview 由 oj 直出 HTML，该钩子不生效。\n"
				+ "逐路由 meta 请改用 oj 的 server.html_meta（构建期 JSON）或 server.html_meta_handler（运行期 handler），"
				+ "见 bin/devkit/api-manual.md「静态站点与 per-route meta」。",
			);
		}
		return config;
	}
	catch {
		// config 加载失败：不阻塞 preview（build 已先行校验过）
		return undefined;
	}
}

/**
 * `siteBase`（`"/oj"` / `"/oj/"` / 空）→ oj 挂载 prefix（`"/oj"` / `"/"`）。
 *
 * 两者只差尾斜杠：`siteBase` 是 URL 拼接口径（恒带尾斜杠），oj 的 mount
 * prefix 是路径口径（不带尾斜杠，见模板 config 的 `/api`）。
 */
function mountPrefixOf(siteBase: string | undefined): string {
	const normalized = normalizeSiteBase(siteBase);
	return normalized === "/" ? "/" : normalized.slice(0, -1);
}
