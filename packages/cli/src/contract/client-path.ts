import type { ProjectLayout } from "../layout";

import path from "node:path";
import { loadSiteConfig } from "../config";
import { webSrcOf } from "../layout";

/**
 * 生成 client 的落盘目录（`ojm api` 写、`ojm api --check` 核对，同一真源）。
 *
 * 缺省口径不变：`<project>/src/<api 前缀>/web/__client`（历史布局 `web/src/<模块>/__client`）。
 * 多根聚合模块（web.config `clientOwners`）把多个业务域的 client 收进同一个 web 模块：
 * 落 `<project>/src/<归属模块>/web/<api 前缀>/__client`——页面与该目录一起迁移，
 * 页面里的相对导入 `../../__client` 不用改。
 */
export function clientDirOf(
	layout: ProjectLayout | null,
	cwd: string,
	apiModule: string,
	owners: Record<string, string> = {},
): string {
	const owner = owners[apiModule] ?? apiModule;
	const base = layout ? webSrcOf(layout, owner) : path.join(cwd, "web/src", owner);
	return owner === apiModule ? path.join(base, "__client") : path.join(base, apiModule, "__client");
}

/** 读 web.config.ts 的 `clientOwners`（缺文件 / 未配置 = 空表，口径回落同名模块） */
export async function loadClientOwners(projectRoot: string): Promise<Record<string, string>> {
	const config = await loadSiteConfig(projectRoot);
	return config.clientOwners ?? {};
}
