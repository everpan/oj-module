/**
 * oj config.yaml 的极简读取（设计 §4）。
 *
 * 只读 `server:` 顶层块下的标量字段，用行级正则而非 YAML 解析器——不为
 * 一个端口引依赖。config 由 `ojm init` 生成，字段 miss 即被手改：直接报错，
 * 绝不静默回落（oj 代码默认端口是 9778，回落错值会与实际监听错位，
 * 审阅记录二）。
 */

import fs from "node:fs";

/** 提取 `server:` 块内某标量字段的值；引号与行内注释容忍，miss 返回 undefined */
export function readOjServerField(configPath: string, field: string): string | undefined {
	const lines = fs.readFileSync(configPath, "utf-8").split(/\r?\n/);
	let inServer = false;
	for (const line of lines) {
		if (!inServer) {
			if (/^server:\s*(?:#.*)?$/.test(line.trim()))
				inServer = true;
			continue;
		}
		// 下一个顶层键（非缩进行）→ server 块结束
		if (/^\S/.test(line))
			break;
		const match = line.match(new RegExp(`^\\s+${field}:\\s*"?([^"#\\s]+)"?\\s*(#.*)?$`));
		if (match)
			return match[1];
	}
	return undefined;
}

/**
 * API 基础前缀（devkit 手册 §10：新键 `api_prefix`，旧键 `base` 仅兼容，
 * 并存会被 oj 报 duplicate field 拒启——故优先读新键，旧工程回落 `base`）。
 */
export function readOjApiPrefix(configPath: string): string {
	const prefix = readOjServerField(configPath, "api_prefix") ?? readOjServerField(configPath, "base");
	return prefix ?? "/api";
}

export function readOjPort(configPath: string): number {
	const raw = readOjServerField(configPath, "port");
	const port = raw === undefined ? Number.NaN : Number(raw);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(
			`[ojm] ${configPath} 缺少合法的 server.port。\n`
			+ "该文件由 ojm init 生成，手动改动后请保留端口配置（oj 代码默认 9778）。",
		);
	}
	return port;
}
