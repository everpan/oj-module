/**
 * 模块工程布局探测（设计 D11）。
 *
 * dev/build/preview 对「源码目录、产物目录、watch 目录」的全部路径取值
 * 一律经此模块，禁止各自手拼——布局分叉点收敛一处，legacy 分支才有
 * 单点删除的可能（删除里程碑：下个 minor）。
 *
 * 新布局（uni-dev）：modules/src/ + modules/dist/（src/dist 同级配对）
 * 旧布局（历史）：   modules/    + dist/
 * watch 目标绝不含产物目录：新布局若 watch `modules/`，重建产物
 * （modules/dist）会反过来触发重建，形成自触发循环（设计 §4）。
 */

import fs from "node:fs";
import path from "node:path";

export interface ProjectLayout {
	kind: "new" | "legacy"
	/** 模块源码目录（watch 与 build 的 entry 来源） */
	modulesSrc: string
	/** 产物目录：dev 写 modules.json + modules/；ojm build 合并全站于此 */
	distDir: string
	/** fs.watch 目标（纯源码，永不落产物） */
	watchTarget: string
}

export function resolveLayout(projectRoot: string): ProjectLayout {
	const hasNewLayout = fs.existsSync(path.join(projectRoot, "modules/src"));
	if (hasNewLayout) {
		return {
			kind: "new",
			modulesSrc: path.join(projectRoot, "modules/src"),
			distDir: path.join(projectRoot, "modules/dist"),
			watchTarget: path.join(projectRoot, "modules/src"),
		};
	}
	return {
		kind: "legacy",
		modulesSrc: path.join(projectRoot, "modules"),
		distDir: path.join(projectRoot, "dist"),
		watchTarget: path.join(projectRoot, "modules"),
	};
}

export function resolveWatchTarget(projectRoot: string): string {
	return resolveLayout(projectRoot).watchTarget;
}
