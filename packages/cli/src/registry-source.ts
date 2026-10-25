// registry 源解析（REG-R12 / 需求 §10.3）：作者侧命令的仓库地址与凭据从哪来。
//
// 解析顺序（**低层不得放宽高层**，逐级只在前一级缺失时才看下一级）：
//   ① `--registry <url>`（本次调用）
//   ② 工程级 `.ojmrc`（可入库，只放地址）—— 团队共享同一个源
//   ③ 用户级 `~/.ojm/config.json` 的 `registry`
//   ④ 没有内置缺省源：以上都缺 → 用法错误（exit 2）
//
// **为什么不给缺省源**：需求 §11 开放问题 1（公共托管 vs 私有部署优先）未拍板，内置一个域名
// 等于替产品做决定，还会让「忘了配源」的 CI 静默发到某个仓。这里一律 fail-closed：
// 未配置就报错，并把三条配法写进消息。
//
// 凭据（**只管来源，不落盘**）：
//   ① `OJM_REGISTRY_TOKEN` 环境变量（CI 首选；需求 §10.3「CI 用 env token」）
//   ② `~/.ojm/config.json` 的 `registries[<origin>].token`（按源分桶，换源不会串用）
//   ③ 缺失 —— 由上层的发布流程给可操作报错，本模块不猜
//
// 工程级 `.ojmrc` **不收 token**：它要入库，token 入仓即泄露。这条不是风格问题，是硬边界——
// 所以读取逻辑只认 `registry` 一个键，其余键忽略且永不打印（防止有人把密钥塞进去再被回显）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { UsageError } from "./exit-codes";

/** 环境变量名（CI 约定，需求 §10.3） */
export const REGISTRY_TOKEN_ENV = "OJM_REGISTRY_TOKEN";

export type SourceLevel = "flag" | "project" | "user";

export interface RegistrySource {
	/** 归一化后的仓库地址（去掉尾部 `/`） */
	url: string
	level: SourceLevel
	/** 命中来源的文件（`flag` 没有文件） */
	originFile: string | null
}

export interface ResolveInput {
	/** `--registry` 的值（未给 = undefined） */
	flag?: string
	cwd?: string
	home?: string
	env?: NodeJS.ProcessEnv
}

function ctx(input: ResolveInput): Required<Omit<ResolveInput, "flag">> & { flag?: string } {
	return {
		flag: input.flag,
		cwd: input.cwd ?? process.cwd(),
		home: input.home ?? os.homedir(),
		env: input.env ?? process.env,
	};
}

/** 地址归一 + 形态校验：只收 http(s)，去尾斜杠；空串视为未给 */
export function normalizeRegistryUrl(raw: unknown): string {
	const url = String(raw ?? "").trim().replace(/\/+$/, "");
	if (url === "")
		throw new UsageError("[ojm] --registry 需要一个地址，例如 --registry https://registry.example.com");
	if (!/^https?:\/\/\S+$/i.test(url))
		throw new UsageError(`[ojm] --registry 只接受 http(s) 地址，收到「${url}」（形如 https://registry.example.com）`);
	return url;
}

/** 读 JSON 配置文件；缺失 → null，解析失败 → 人话错误（坏文件不是用法错误，退出码 1） */
function readJsonFile(file: string): Record<string, unknown> | null {
	if (!fs.existsSync(file))
		return null;
	let doc: unknown;
	try {
		doc = JSON.parse(fs.readFileSync(file, "utf-8"));
	}
	catch (e) {
		throw new Error(`[ojm] 配置文件不可解析：${file}（${(e as Error).message}）——修好它，或删掉后重跑`);
	}
	if (doc === null || typeof doc !== "object" || Array.isArray(doc))
		throw new Error(`[ojm] 配置文件顶层须是对象：${file}`);
	return doc as Record<string, unknown>;
}

export function projectConfigPath(cwd: string): string {
	return path.join(cwd, ".ojmrc");
}

export function userConfigPath(home: string): string {
	return path.join(home, ".ojm", "config.json");
}

/**
 * 解析生效的仓库地址；**没配任何源** → null（`config ls` 要把「空着」显示出来，不能算错误）。
 *
 * 但「配了、配坏了」照样抛：非法地址 → UsageError，坏 JSON → Error。
 * 这条分界是 null 与 throw 的全部区别——**绝不把坏配置降级成「未配置」**，
 * 否则 CI 会以为「只是没配」，实际是 `.ojmrc` 被写坏。
 */
export function resolveRegistrySourceOptional(input: ResolveInput = {}): RegistrySource | null {
	const c = ctx(input);
	if (c.flag !== undefined)
		return { url: normalizeRegistryUrl(c.flag), level: "flag", originFile: null };

	const projectFile = projectConfigPath(c.cwd);
	const project = readJsonFile(projectFile);
	if (project?.registry !== undefined)
		return { url: normalizeRegistryUrl(project.registry), level: "project", originFile: projectFile };

	const userFile = userConfigPath(c.home);
	const user = readJsonFile(userFile);
	if (user?.registry !== undefined)
		return { url: normalizeRegistryUrl(user.registry), level: "user", originFile: userFile };

	return null;
}

/**
 * 解析生效的仓库地址。四条路径都不成立 → 用法错误（把三种配法一次说清，别让人试错）。
 * 顺序即权威序：`--registry` 一给就不再读文件（避免「以为覆盖了其实没有」）。
 */
export function resolveRegistrySource(input: ResolveInput = {}): RegistrySource {
	const found = resolveRegistrySourceOptional(input);
	if (found !== null)
		return found;
	throw new UsageError(
		"[ojm] 未指定仓库源：用 --registry <url>，或在工程根写 .ojmrc（{\"registry\":\"https://…\"}），"
		+ "或在 ~/.ojm/config.json 配 registry。本 CLI 不内置缺省源（需求 §10.3），不会替你猜一个仓。",
	);
}

export type CredentialKind = "env" | "store" | "missing";

export interface RegistryCredential {
	kind: CredentialKind
	/** 明文 token（**只在内存里用**；打印一律走 describeCredential） */
	token: string | null
	/** 来源描述：`OJM_REGISTRY_TOKEN` / 用户配置文件路径 / null */
	origin: string | null
}

/** 凭据解析：env > 用户配置（按 origin 分桶）> 缺失。工程级 `.ojmrc` 永不收 token。 */
export function resolveRegistryCredential(source: RegistrySource, input: ResolveInput = {}): RegistryCredential {
	const c = ctx(input);
	const fromEnv = c.env[REGISTRY_TOKEN_ENV]?.trim();
	if (fromEnv)
		return { kind: "env", token: fromEnv, origin: REGISTRY_TOKEN_ENV };

	const userFile = userConfigPath(c.home);
	const user = readJsonFile(userFile);
	const bucket = originOf(source.url);
	const registries = user?.registries;
	if (bucket !== null && registries !== null && typeof registries === "object" && !Array.isArray(registries)) {
		const entry = (registries as Record<string, unknown>)[bucket];
		const token = entry !== null && typeof entry === "object" && !Array.isArray(entry)
			? (entry as Record<string, unknown>).token
			: undefined;
		if (typeof token === "string" && token.trim() !== "")
			return { kind: "store", token: token.trim(), origin: `${userFile}（${bucket}）` };
	}
	return { kind: "missing", token: null, origin: null };
}

/** URL → `origin`（协议+主机+端口）：凭据按源分桶的键 */
export function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	}
	catch {
		return null;
	}
}

/**
 * 凭据的可打印描述：**永不回显 token**。
 * `config ls` 与发布日志都用它——这条纪律是「日志不许泄露凭证」的唯一落点。
 */
export function describeCredential(cred: RegistryCredential): string {
	if (cred.kind === "env")
		return `${REGISTRY_TOKEN_ENV}（已设置）`;
	if (cred.kind === "store")
		return `${cred.origin ?? "用户配置"}（已保存）`;
	return `缺失（设 ${REGISTRY_TOKEN_ENV}，或先 ojm login）`;
}

/** 源级别的可打印描述（`--show-origin` 用） */
export function describeSourceLevel(source: RegistrySource): string {
	if (source.level === "flag")
		return "--registry";
	if (source.level === "project")
		return `.ojmrc${source.originFile === null ? "" : `（${source.originFile}）`}`;
	return `~/.ojm/config.json${source.originFile === null ? "" : `（${source.originFile}）`}`;
}
