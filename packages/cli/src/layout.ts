/**
 * 模块工程布局探测（设计 D11，2026-09-11 硬切换）。
 *
 * dev/build/preview 对「源码目录、产物目录、watch 目录」的全部路径取值
 * 一律经此模块，禁止各自手拼——布局分叉点收敛一处。
 *
 * 布局（uni-dev）：web/src/ + web/dist/（src/dist 同级配对）。
 * 框架根仓自身为平铺 web/<name>/（dogfooding，产物落 build/，不经 ojm）。
 * 硬切换只认 web/：存量 modules/ 工程不再探测，须迁移
 * （modules/ → web/，modules.config.ts → web.config.ts）。
 * watch 目标绝不含产物目录：若 watch `web/`，重建产物（web/dist）
 * 会反过来触发重建，形成自触发循环（设计 §4）。
 */

import fs from "node:fs";
import path from "node:path";

export interface ProjectLayout {
	kind: "new" | "flat"
	/** 模块源码目录（watch 与 build 的 entry 来源） */
	modulesSrc: string
	/** 产物目录：dev 写 modules.json + modules/；ojm build 合并全站于此 */
	distDir: string
	/** fs.watch 目标（纯源码，永不落产物） */
	watchTarget: string
}

export function resolveLayout(projectRoot: string): ProjectLayout {
	if (fs.existsSync(path.join(projectRoot, "web/src"))) {
		return {
			kind: "new",
			modulesSrc: path.join(projectRoot, "web/src"),
			distDir: path.join(projectRoot, "web/dist"),
			watchTarget: path.join(projectRoot, "web/src"),
		};
	}
	// 框架根仓：平铺 web/<name>/（readModuleDefinition 的裸说明符扫描复用此探测，B10）
	if (fs.existsSync(path.join(projectRoot, "web"))) {
		return {
			kind: "flat",
			modulesSrc: path.join(projectRoot, "web"),
			distDir: path.join(projectRoot, "build"),
			watchTarget: path.join(projectRoot, "web"),
		};
	}
	throw new Error(
		`[ojm] ${projectRoot} 下未发现 web/——web 布局硬切换后只认 web/src + web/dist，`
		+ "存量 modules/ 工程请迁移：modules/ → web/，modules.config.ts → web.config.ts。",
	);
}

export function resolveWatchTarget(projectRoot: string): string {
	return resolveLayout(projectRoot).watchTarget;
}
