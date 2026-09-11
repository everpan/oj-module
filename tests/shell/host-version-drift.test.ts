import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SHARED_DEPS } from "../../packages/cli/src/shared-deps";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 宿主与框架的共享依赖版本必须一致（A25）。
 *
 * 宿主（P1 起并入 cli，预构建产物 shell-dist/）把共享依赖预打包并经 importmap 提供给框架 runtime 与
 * 外部模块，它写进 `dist/versions.json` 的版本按 D12/C4 是外部模块工程必须
 * 严格相等的对齐基准。两侧各自声明就会漂移，而且**没有任何报错**——
 * 实测曾漂移到 3 个大版本（cssinjs 1.x/2.x、i18next 25/26、react-i18next 16/17），
 * 宿主把旧版本当"真相"强加给下游。
 *
 * 声明层由 pnpm catalog 收敛（`pnpm-workspace.yaml` 的 `catalogs:`），
 * 这个测试兜住「catalog 漏改 / 有人直接写死版本 / 装出第二份」。
 */

const SHELL_DIR = path.join(PROJECT_ROOT, "packages/cli");

/** 说明符 → 包名（深路径取包名段） */
function packageNameOf(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function installedVersion(fromDir: string, specifier: string): string | undefined {
	try {
		const pkgPath = path.join(fromDir, "node_modules", packageNameOf(specifier), "package.json");
		return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
	}
	catch {
		return undefined;
	}
}

describe("宿主与框架共享依赖版本一致（A25）", () => {
	it("共享表每个包在宿主与框架下的实装版本相同", () => {
		const drifted: string[] = [];

		for (const dep of SHARED_DEPS) {
			const pkgName = packageNameOf(dep.specifier);
			if (pkgName.startsWith("@oj-module"))
				continue;

			const shellVersion = installedVersion(SHELL_DIR, dep.specifier);
			const rootVersion = installedVersion(PROJECT_ROOT, dep.specifier);

			// 任一侧没装（shell 未声明、靠提升解析）都算缺口，只是不阻断
			if (!shellVersion || !rootVersion)
				continue;

			if (shellVersion !== rootVersion) {
				drifted.push(`  · ${dep.specifier}：宿主 ${shellVersion} ≠ 框架 ${rootVersion}`);
			}
		}

		expect(
			drifted,
			"宿主与框架的共享依赖版本已漂移——宿主会把自己的版本写进 versions.json 当基准：\n"
			+ `${drifted.join("\n")}\n`
			+ "修复：在 pnpm-workspace.yaml 的 catalogs 登记该包，两侧 package.json 改用 catalog:，然后 pnpm install。",
		).toEqual([]);
	});

	it("宿主声明了它要预打包的全部共享依赖（不靠 pnpm 提升）", () => {
		const shellPkg = JSON.parse(fs.readFileSync(path.join(SHELL_DIR, "package.json"), "utf-8"));
		const declared = { ...shellPkg.dependencies, ...shellPkg.devDependencies };

		const undeclared = SHARED_DEPS
			.map(dep => packageNameOf(dep.specifier))
			.filter(name => !name.startsWith("@oj-module"))
			.filter((name, i, all) => all.indexOf(name) === i)
			.filter(name => !(name in declared));

		expect(
			undeclared,
			`宿主预打包了但未声明的依赖（当前靠 pnpm 提升解析，共享表与声明层脱节）：${undeclared.join(", ")}`,
		).toEqual([]);
	});

	it("共享依赖统一走 catalog，不在各 package.json 里写死范围", () => {
		const manifests = [
			"package.json",
			"packages/runtime/package.json",
			"packages/cli/package.json",
			"apps/playground/package.json",
		];
		const hardcoded: string[] = [];

		for (const rel of manifests) {
			const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf-8"));
			const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
			for (const dep of SHARED_DEPS) {
				// @oj-module/* 是本仓 workspace 包，必须用 workspace:*，不进 catalog
				if (packageNameOf(dep.specifier).startsWith("@oj-module"))
					continue;
				const range = all[dep.specifier];
				if (range && range !== "catalog:")
					hardcoded.push(`  · ${rel} → ${dep.specifier}: ${range}`);
			}
		}

		expect(
			hardcoded,
			`以下共享依赖写死了版本范围，应改为 catalog:（单一真相）：\n${hardcoded.join("\n")}`,
		).toEqual([]);
	});
});
