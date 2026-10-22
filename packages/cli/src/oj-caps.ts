/**
 * oj 二进制**能力**探针（设计 202610220010 §7「双探」）。
 *
 * 为什么不能只看版本号：`bin/oj` 允许手改/手替（vendor.ts:143 的逃生门），
 * `bin/.oj-version` 标记会漂移；且 vendor.ts:102-110 已实证「`oj -V` 正常但
 * JsRuntime 能力缺失」真实存在。版本号是声明，能跑通才是事实。
 *
 * 为什么单独探 `--module-root`：module-root 布局（`src/<name>/{api,web}`）依赖
 * oj 的模块根可配置。能力缺失时必须 fail-fast 并给处置命令——回落旧布局会让
 * 「源码搬了、构建产物还是旧的」这种半坏状态长期存在，比直接失败难排查得多。
 *
 * 缓存：`bin/.oj-caps`，以二进制的 size+mtime 为指纹。指纹变了就重探，
 * 所以手替 `bin/oj` 不会吃到旧缓存。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveOjBin } from "./vendor";

export interface OjCaps {
	/** `oj build --help` 是否接受 `--module-root <DIR>`（源码树根，与 `-d` 互斥） */
	moduleRoot: boolean
}

/** 探针执行器（测试注入）：执行 oj 子命令并返回合并输出 */
export type OjProbeRun = (ojBin: string, args: string[]) => string;

const defaultRun: OjProbeRun = (ojBin, args) =>
	execFileSync(ojBin, args, { encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });

export const CAPS_FILE = ".oj-caps";

/** 二进制指纹：size + mtime 足以识别「换了文件」，比哈希便宜且无 IO 放大 */
function fingerprint(ojBin: string): string {
	const st = fs.statSync(ojBin);
	return `${st.size}:${Math.floor(st.mtimeMs)}`;
}

function capsPath(binDir: string): string {
	return path.join(binDir, CAPS_FILE);
}

/** 缓存文件形状：指纹 + 能力位 */
interface CapsCache {
	fingerprint?: string
	caps?: Partial<OjCaps>
}

/** 读缓存；指纹不匹配或结构不对 → null（重探） */
export function readCapsCache(ojBin: string): OjCaps | null {
	try {
		const raw = JSON.parse(fs.readFileSync(capsPath(path.dirname(ojBin)), "utf-8")) as CapsCache | null;
		if (!raw || raw.fingerprint !== fingerprint(ojBin) || typeof raw.caps?.moduleRoot !== "boolean")
			return null;
		return { moduleRoot: raw.caps.moduleRoot };
	}
	catch {
		return null;
	}
}

/** 写缓存（失败不影响主流程：缓存只是加速，不是正确性来源） */
export function writeCapsCache(ojBin: string, caps: OjCaps): void {
	try {
		fs.writeFileSync(
			capsPath(path.dirname(ojBin)),
			`${JSON.stringify({ fingerprint: fingerprint(ojBin), caps }, null, 2)}\n`,
			"utf-8",
		);
	}
	catch {
		// 只读目录 / 权限不足：忽略
	}
}

/** 现场探测：解析 `oj build --help` 的旗标列表（不缓存） */
export function probeOjCaps(ojBin: string, run: OjProbeRun = defaultRun): OjCaps {
	let help = "";
	try {
		help = run(ojBin, ["build", "--help"]);
	}
	catch (error) {
		throw new Error(
			`[ojm] 无法执行 ${ojBin} build --help：${(error as Error).message}\n`
			+ "处置：`ojm vendor` 重装 oj 二进制。",
		);
	}
	// 只认长旗标整词：`--module-root <DIR>`；避免帮助文本里的说明文字误命中
	return { moduleRoot: /--module-root\b/.test(help) };
}

/**
 * module-root 布局的能力闸门：缺失即抛，文案给处置命令。
 * 有缓存走缓存（热路径每次 build/dev 都会经过这里）。
 */
export function requireModuleRootCapability(
	projectRoot: string,
	run: OjProbeRun = defaultRun,
): OjCaps {
	const ojBin = resolveOjBin(projectRoot);
	if (!fs.existsSync(ojBin)) {
		throw new Error(
			`[ojm] 缺少 ${ojBin}：module-root 布局需要 oj 提供 --module-root。\n`
			+ "处置：`ojm vendor` 安装 oj 二进制。",
		);
	}

	const caps = readCapsCache(ojBin) ?? (() => {
		const probed = probeOjCaps(ojBin, run);
		writeCapsCache(ojBin, probed);
		return probed;
	})();

	if (caps.moduleRoot)
		return caps;

	const version = (() => {
		try {
			return run(ojBin, ["-V"]).trim() || "(未知)";
		}
		catch {
			return "(不可探测)";
		}
	})();
	throw new Error(
		`[ojm] 当前 oj 不支持 --module-root（版本 ${version}），无法构建 src/<name>/{api,web} 布局。\n`
		+ "原因：module-root 布局要求 oj build / serve 的模块根可配置；本版 oj 只认 `-d` 首层子目录为模块。\n"
		+ "处置：升级 oj 后重试——`ojm vendor <tag>`（需 >= 支持 --module-root 的版本），"
		+ "或把工程改回 web/src/<name> 布局。\n"
		+ `缓存：${capsPath(path.dirname(ojBin))}（换二进制后指纹变化会自动重探）。`,
	);
}
