/**
 * `ram info`（设计文档 §1 / US-7，P7.11）：一键输出报障所需的版本矩阵。
 *
 * 模块开发者怀疑 runtime 有 bug 时，把本命令输出直接粘贴给框架团队即可
 * 复现环境——代替「拿不到框架源码」的自行翻查（O4 已定：包内不发源码/map）。
 */

import type { ManifestModule } from "./manifest";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

import http from "node:http";
import path from "node:path";
import { loadModulesConfig } from "./config";
import { mergeModuleManifests } from "./manifest";
import { readOjApiPrefix, readOjServerField } from "./oj-config";
import { readLocalVersion } from "./vendor";
import { readHostVersions, resolveShellDist } from "./versions";

function readPkgVersion(pkgJsonPath: string): string {
	try {
		return JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")).version ?? "unknown";
	}
	catch {
		return "unknown";
	}
}

/** oj 观测桩（测试注入）；默认实现分别跑 `bin/oj -V` 与 `GET {base}/health` */
export interface OjObservability {
	/** 现场版本（stdout 原文）；null = 不可探测 */
	ojVersion: () => string | null
	/** /health 响应体；null = 服务未运行或不可达 */
	ojHealth: () => Promise<Record<string, unknown> | null>
}

/** `bin/oj -V`；进程缺失/非零退出/超时 → null（info 只观测，不失败） */
function probeOjVersion(ojBin: string): string | null {
	try {
		return execFileSync(ojBin, ["-V"], { timeout: 3000 }).toString().trim();
	}
	catch {
		return null;
	}
}

/** `GET http://127.0.0.1:{port}{base}/health`；任何失败 → null */
function probeOjHealth(base: string, port: number): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const req = http.get({ host: "127.0.0.1", port, path: `${base}/health`, timeout: 2000 }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", chunk => chunks.push(chunk as Buffer));
			res.on("end", () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
				}
				catch {
					resolve(null);
				}
			});
		});
		req.on("timeout", () => {
			req.destroy();
			resolve(null);
		});
		req.on("error", () => resolve(null));
	});
}

/** CLI 默认观测：真跑 `bin/oj -V` 与真探 /health */
export function realOjObservability(projectRoot: string): OjObservability {
	const ojBin = path.join(projectRoot, "bin/oj");
	const configPath = path.join(projectRoot, "api/config.yaml");
	return {
		ojVersion: () => (fs.existsSync(ojBin) ? probeOjVersion(ojBin) : null),
		ojHealth: () => {
			// F4：readOjServerField 是同步读文件，config 缺失时同步 throw 会
			// 穿透调用方的 .catch（throw 发生在 Promise 构造之前）——必须就地兜住
			try {
				const port = readOjServerField(configPath, "port");
				const base = readOjApiPrefix(configPath);
				return port ? probeOjHealth(base, Number(port)) : Promise.resolve(null);
			}
			catch {
				return Promise.resolve(null);
			}
		},
	};
}

export async function printInfo(projectRoot: string, oj: OjObservability = realOjObservability(projectRoot)): Promise<void> {
	const cliVersion = readPkgVersion(path.join(projectRoot, "node_modules/@react-antd-module/cli/package.json"));
	const runtimeVersion = readPkgVersion(path.join(projectRoot, "node_modules/@react-antd-module/runtime/package.json"));

	let shellDist = "";
	let hostVersions: Record<string, string> = {};
	try {
		shellDist = resolveShellDist();
		hostVersions = readHostVersions(shellDist);
	}
	catch {
		console.warn("[ram] 未找到 cli 内置宿主（shell-dist），共享依赖版本矩阵不可得");
	}

	let moduleLines = "（modules.config.ts 加载失败或无模块）";
	try {
		const config = await loadModulesConfig(projectRoot);
		moduleLines = config.modules
			.map(m => `  · ${m.name}（${m.entry}）${m.enabled === false ? " [disabled]" : ""}`)
			.join("\n");
	}
	catch (error) {
		moduleLines = `（加载失败：${(error as Error).message}）`;
	}

	const matrix = Object.entries(hostVersions)
		.map(([spec, version]) => `  ${spec}: ${version}`)
		.join("\n");

	// ---- 后端（oj）观测段：工程有 config.yaml 或 bin/oj 才展示；观测不可达仅降级不失败 ----
	let backendBlock = "";
	const configPath = path.join(projectRoot, "api/config.yaml");
	const ojBin = path.join(projectRoot, "bin/oj");
	if (fs.existsSync(configPath) || fs.existsSync(ojBin)) {
		// 安装标记（ram vendor/init 下载时写入）；bin/oj 存在但无标记 → 未知
		const markerVersion = readLocalVersion(path.join(projectRoot, "bin"));
		const siteVersion = oj.ojVersion() ?? `${ojBin} 无法探测（缺失或不可执行）`;
		const readConfig = (field: string) => {
			try {
				return readOjServerField(configPath, field);
			}
			catch {
				return undefined;
			}
		};
		const port = readConfig("port") ?? "（config.yaml 缺失或未配置）";
		const base = readConfig("api_prefix") ?? readConfig("base") ?? "/api";

		const health = await oj.ojHealth().catch(() => null);
		const certLine = health
			? `证书状态:  ${health.certificate_status ?? "unknown"}（到期 ${health.certificate_expiry ?? "unknown"}）`
			: "证书状态:  无法探测（服务未运行时属正常；ram dev/preview 起服后可测）";

		const markerShort = markerVersion?.replace(/^v/, "");
		const drift = markerShort && siteVersion.includes(markerShort)
			? ""
			: markerShort
				? `\n  [!] 现场版本与安装标记（${markerVersion}）不一致，请核对（ram vendor --force 重装）`
				: "";
		backendBlock = `
后端（oj）:
  安装标记:  ${markerVersion ?? "未知（缺 bin/.oj-version，ram vendor 重装）"}
  现场版本:  ${siteVersion}${drift}
  端口/base: ${port} / ${base}（api/config.yaml）
  ${certLine}
`;
	}

	console.log(`ram info（报障请完整粘贴以下输出）
================================
cli:     ${cliVersion}
runtime: ${runtimeVersion}（本地安装）
shell:   ${hostVersions["@react-antd-module/runtime"] ?? "unknown"}（宿主 dist 内建，${shellDist || "未找到"}）

共享依赖版本矩阵（宿主 versions.json）:
${matrix || "  （不可得）"}

当前工程模块清单:
${moduleLines}${backendBlock}
`);
}

/** `ram merge`（R12 接线，P7.15）：合并多份 modules.json，同名模块显式拒绝 */
export async function mergeManifests(outFile: string, inputs: string[]): Promise<void> {
	if (!outFile || inputs.length === 0)
		throw new Error("用法：ram merge <out.json> <in1.json> [in2.json ...]（至少一份输入清单）");

	const sources = inputs.map(file => ({
		source: file,
		modules: JSON.parse(fs.readFileSync(file, "utf-8")) as ManifestModule[],
	}));
	const merged = mergeModuleManifests(sources);
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.writeFileSync(outFile, `${JSON.stringify(merged, null, 2)}\n`);
	console.log(`[ram] 已合并 ${inputs.length} 份清单（${merged.length} 个模块）→ ${outFile}`);
}
