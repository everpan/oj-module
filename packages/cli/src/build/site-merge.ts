// 宿主站点合并（SRP 拆分自 build.ts，2026-11-03，计划 docs/plans/20261103-0930）：
// shell-dist 全量拷贝 + index.html 的 siteBase/apiBase 改写，仅 `ojm build` 调用。
import fs from "node:fs";
import path from "node:path";
import { normalizeSiteBase, rewriteIndexHtml } from "../site-base";
import { resolveShellDist } from "../versions";

/**
 * 全站合并（仅 `ojm build` 调用，设计 §5）：清场后拷 shell dist 全量，
 * 再由模块构建写入 modules.json 与 modules/。清场防旧哈希资产无限累积
 * （shell 每次重构建生成新哈希文件名）；devServer 热重建路径不合并——
 * dev 的 / 与 /assets/* 直接服务 shell dist，合并产物无人消费。
 *
 * siteBase 非空时（站点挂载在 `/oj` 这类子路径）改写 index.html 的站内绝对
 * URL；apiBase 非空时注入 `window.__OJ_API_BASE__`（API 挂载前缀部署期可配，
 * 见 site-base.ts）。两者都为空则产物与既有行为逐字节一致。
 */
export function mergeShellSite(distDir: string, siteBase: string, apiBase: string): void {
	const shellDist = resolveShellDist();
	fs.rmSync(distDir, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(distDir), { recursive: true });
	fs.cpSync(shellDist, distDir, { recursive: true });

	const indexPath = path.join(distDir, "index.html");
	if (normalizeSiteBase(siteBase) !== "/" || apiBase.trim()) {
		fs.writeFileSync(indexPath, rewriteIndexHtml(fs.readFileSync(indexPath, "utf-8"), siteBase, apiBase));
		if (normalizeSiteBase(siteBase) !== "/")
			console.log(`[ojm] 站点 index.html 已按 siteBase=${normalizeSiteBase(siteBase)} 重写（子路径部署）`);
		if (apiBase.trim())
			console.log(`[ojm] API 前缀已注入 index.html：${apiBase.trim().replace(/\/+$/, "")}（apiBase）`);
	}
	console.log(`[ojm] 已合并宿主站点 → ${distDir}`);
}
