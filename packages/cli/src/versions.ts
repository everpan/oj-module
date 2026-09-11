/**
 * 版本矩阵门禁（设计文档 C4 / D12，P4.5）。
 *
 * 宿主 shell 构建时把共享表各包的**实际安装版本**落进 dist/versions.json；
 * CLI 加载模块工程前校验：硬共享依赖只能进 devDependencies，且
 * **安装后的实际版本**与宿主严格相等（读 node_modules，非 semver 兼容判断，
 * 也非 devDependencies 里的范围字面量）——类型来自 node_modules、实现来自
 * 宿主 importmap，两者差一个 minor 就可能双实例崩。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SHARED_DEPS } from "./shared-deps";

/** cli 包根（本文件位于 <cliRoot>/src/） */
const CLI_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 读取宿主 shell 产物中的共享依赖实际版本表 */
export function readHostVersions(shellDist: string): Record<string, string> {
	return JSON.parse(fs.readFileSync(path.join(shellDist, "versions.json"), "utf-8"));
}

/**
 * 定位预构建宿主产物。
 *
 * P1：宿主已并入 cli 包（`<cliRoot>/shell-dist`）——不再查工程 node_modules
 * 里的独立 shell 包，也没有 monorepo 路径回退。安装/检出 cli 即自带宿主，
 * 消除「先 build 宿主才能用 cli」的隐性顺序约束（原 cli↔shell 环的一半）。
 */
export function resolveShellDist(): string {
	const dir = path.join(CLI_ROOT, "shell-dist");
	if (fs.existsSync(dir))
		return dir;
	throw new Error(
		"找不到 cli 内置的预构建宿主（shell-dist）。\n"
		+ "源码形态请先构建：pnpm --filter @oj-module/cli build:shell",
	);
}

/**
 * 读取模块工程中某共享依赖的安装后版本（node_modules 解析，跟随 pnpm symlink）；
 * 未安装返回 undefined（仅声明未安装时跳过版本比对，由包管理器保证一致性）。
 */
/**
 * 说明符 → 包名：深路径（react/jsx-runtime、@scope/pkg/sub）取包名段。
 * P7.15 修复：此前直接按说明符拼 node_modules/<specifier>/package.json，
 * 深路径下该文件不存在，版本比对被静默跳过（评审 I36）。
 */
export function packageNameOf(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

export function readInstalledVersion(projectRoot: string, specifier: string): string | undefined {
	try {
		const pkgJson = path.join(projectRoot, "node_modules", packageNameOf(specifier), "package.json");
		const parsed = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
		return typeof parsed.version === "string" ? parsed.version : undefined;
	}
	catch {
		return undefined;
	}
}

/** 纯校验：返回违规描述列表（空数组 = 通过） */
export function validateSharedVersions(
	pkg: { dependencies?: Record<string, string>, devDependencies?: Record<string, string> },
	hostVersions: Record<string, string>,
	readInstalled: (specifier: string) => string | undefined,
): string[] {
	const hardSpecifiers = SHARED_DEPS.filter(dep => dep.hard).map(dep => dep.specifier);
	const errors: string[] = [];

	for (const spec of hardSpecifiers) {
		if (pkg.dependencies?.[spec]) {
			errors.push(
				`· ${spec} 是硬共享依赖，禁止放入 dependencies（由宿主 importmap 统一提供，自带将产生双实例）；请移入 devDependencies`,
			);
		}
		const want = hostVersions[spec];
		const got = readInstalled(spec);
		if (want && got && got !== want) {
			errors.push(
				`· ${spec}: 安装版本 ${got} 与宿主严格相等校验失败（期望 ${want}）；请对齐版本后重新安装`,
			);
		}
	}
	return errors;
}

/** 校验模块工程的共享依赖版本矩阵，违规直接抛错并打印期望值 */
export function checkSharedVersions(projectRoot: string, shellDist: string): void {
	const versions = readHostVersions(shellDist);
	const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
	const errors = validateSharedVersions(pkg, versions, spec => readInstalledVersion(projectRoot, spec));

	if (errors.length > 0) {
		throw new Error(
			`[ojm] 版本矩阵门禁（C4/D12）校验失败：\n${errors.join("\n")}\n`
			+ "设计文档：docs/archive/prd/202608291025-framework-npm-package-design.md §4.3",
		);
	}
}
