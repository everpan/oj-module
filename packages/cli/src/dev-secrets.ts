/**
 * 开发态本地密钥/凭据自动供给（方案 A'，计划 docs/plans/20261103-1700）。
 *
 * 问题：tracked `config.yaml` 是共享模板，但其引用的机器本地密钥
 * （`config/secrets-*.pem` 密封对 + 全部 `ENC[...]` 解密链）不随 git 分发——多名开发者
 * clone 后解不开 → `oj serve` 起不来，且失败信息被吞。
 *
 * 设计（经架构师 + 工程师评审修正）：
 *   - dev 密钥与 tracked prod ENC **解耦**：tracked 里的 `ENC[...]` 仅作 prod 资产，dev 完全忽略。
 *   - 本机密钥 + dev `jwt_secret` 只活在 gitignored 的 `config.local.yaml`，由本模块自动供给。
 *   - `mergeConfigForDev` 把 tracked + local 深合并成 `.ojm-tmp-config.yaml`（gitignored，与
 *     config.yaml 同目录）交给 `oj serve -c`，**绝不写回 tracked**。
 *   - **非 jwt 的 `ENC[...]` 红线**：若 tracked 出现其他解不开的 `ENC[...]`（如 `wecom_enc_key`，
 *     落库加密键），触发清晰报错要求提供真实私钥，**不**自动用 dev 随机密钥重封（防破坏已加密数据）。
 *   - 模板 drift：合并产物每次 `ojm dev` 现合现用，tracked 非密改动自动生效；本机密钥持久于
 *     `config.local.yaml` 重合并时始终套用，模板怎么改都不丢。
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse, stringify } from "yaml";
import { resolveCertDir } from "./layout";
import { resolveOjBin } from "./vendor";

/** `config.local.yaml` 落点（与 config.yaml 同目录，gitignored、可手编辑） */
export function resolveLocalConfigPath(configPath: string): string {
	return path.join(path.dirname(configPath), "config.local.yaml");
}

/** 合并产物落点（与 config.yaml 同目录，`.ojm-tmp-*` 已被模板 .gitignore 忽略） */
export function resolveMergedConfigPath(configPath: string): string {
	return path.join(path.dirname(configPath), ".ojm-tmp-config.yaml");
}

/**
 * 写回护栏（A-4）：合并产物绝不允许写回 tracked config、且必须位于 gitignore 内。
 * 否则哪天密钥被误写回跟踪文件就泄密了。
 */
export function assertOutputNotTracked(trackedConfigPath: string, mergedConfigPath: string): void {
	if (path.resolve(mergedConfigPath) === path.resolve(trackedConfigPath)) {
		throw new Error(
			`[ojm] 内部错误：合并产物路径与 tracked config 相同（${mergedConfigPath}），拒绝写回以免覆盖共享配置。`,
		);
	}
	// `.ojm-tmp-` 前缀已被模板 .gitignore 覆盖（无斜杠 → 任意层级匹配），双重保险
	if (!path.basename(mergedConfigPath).startsWith(".ojm-tmp-")) {
		throw new Error(
			`[ojm] 内部错误：合并产物 ${mergedConfigPath} 未被 .gitignore 的 .ojm-tmp-* 覆盖，拒绝写入以免密钥泄漏。`,
		);
	}
}

/** 用本机私钥试解 `ENC[...]`；能解开返回 true（即使不使用明文也只在内存里） */
function canOpenWith(enc: string, keyPath: string, projectRoot: string): boolean {
	const ojBin = resolveOjBin(projectRoot);
	if (!fs.existsSync(ojBin) || !fs.existsSync(keyPath))
		return false;
	try {
		execFileSync(ojBin, ["secret", "open", "-k", keyPath, enc], { stdio: "pipe" });
		return true;
	}
	catch {
		return false;
	}
}

/**
 * 本机密钥对是否可用：公私钥文件都在，且 seal→open 往返自洽（公钥能封、私钥能解）。
 * 用于自愈（E-3 + A' 自动 rekey）：若上次的密钥文件残缺/被改坏（如半截 pem），
 * 直接删了重 keygen，而不是拿着坏文件去 seal 失败。返回 false 时调用方应删除后重生成。
 */
function keyPairUsable(keysDir: string, projectRoot: string): boolean {
	const privateKey = path.join(keysDir, "secrets-private.pem");
	const publicKey = path.join(keysDir, "secrets-public.pem");
	const ojBin = resolveOjBin(projectRoot);
	if (!fs.existsSync(ojBin) || !fs.existsSync(privateKey) || !fs.existsSync(publicKey))
		return false;
	try {
		const probe = execFileSync(ojBin, ["secret", "seal", "-k", publicKey], {
			input: "__ojm_probe__",
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (!probe.startsWith("ENC["))
			return false;
		execFileSync(ojBin, ["secret", "open", "-k", privateKey, probe], { stdio: "pipe" });
		return true;
	}
	catch {
		return false;
	}
}

/** 递归扫出配置树里所有 `ENC[...]` 字符串值，返回其 JSON pointer 路径集合 */
function findEncValues(node: unknown, pointer = "", out: Map<string, string> = new Map()): Map<string, string> {
	if (typeof node === "string") {
		if (/^ENC\[/.test(node))
			out.set(pointer, node);
	}
	else if (Array.isArray(node)) {
		node.forEach((item, i) => findEncValues(item, `${pointer}/${i}`, out));
	}
	else if (node && typeof node === "object") {
		for (const [k, v] of Object.entries(node))
			findEncValues(v, pointer ? `${pointer}/${k}` : `/${k}`, out);
	}
	return out;
}

export interface DevSecretsDeps {
	/** 注入 oj 二进制路径（测试） */
	ojBin?: string
	/** 注入随机 jwt_secret 生成器（测试可固定） */
	randomHex?: (bytes: number) => string
	/** 注入日志（测试） */
	log?: (msg: string) => void
}

/**
 * 供给本机开发密钥与 dev `jwt_secret`（A-1）：
 *   - `config/secrets-{private,public}.pem` 缺失 → `oj secret keygen`（幂等：存在即跳过）。
 *   - `config.local.yaml` 的 `auth.jwt_secret` 缺失/解不开 → 生成随机 32 字节 hex →
 *     `oj secret seal` 成 `ENC[...]`，连同 `secrets:` 段写入 `config.local.yaml`。
 * 不写 tracked config。返回最终 local config 对象。
 */
export function provisionDevSecrets(
	projectRoot: string,
	configPath: string,
	deps: DevSecretsDeps = {},
): Record<string, unknown> {
	const log = deps.log ?? ((msg: string) => console.log(msg));
	const ojBin = deps.ojBin ?? resolveOjBin(projectRoot);
	const randomHex = deps.randomHex ?? ((bytes: number) => crypto.randomBytes(bytes).toString("hex"));
	const keysDir = resolveCertDir(projectRoot);
	const privateKey = path.join(keysDir, "secrets-private.pem");
	const publicKey = path.join(keysDir, "secrets-public.pem");

	// 1) 密封密钥对（幂等：存在且可用即跳过，避免每次 dev 重启换新密钥致已签发会话失效，E-3）。
	//    若文件存在但残缺/被改坏（seal→open 往返不过）→ 视为不可用，删了重 keygen（A' 自动 rekey）。
	let provisionedKey = false;
	const keyUsable = fs.existsSync(privateKey) && fs.existsSync(publicKey) && keyPairUsable(keysDir, projectRoot);
	if (!keyUsable) {
		if (!fs.existsSync(ojBin))
			throw new Error(`[ojm] 未找到 oj 二进制（${ojBin}），无法生成开发密钥。请先运行 ojm vendor。`);
		for (const f of [privateKey, publicKey]) {
			if (fs.existsSync(f))
				fs.rmSync(f);
		}
		fs.mkdirSync(keysDir, { recursive: true });
		execFileSync(ojBin, ["secret", "keygen", "--out-dir", keysDir], { stdio: "pipe" });
		provisionedKey = true;
	}

	// 2) 读/建 config.local.yaml
	const localPath = resolveLocalConfigPath(configPath);
	let local: Record<string, unknown> = {};
	if (fs.existsSync(localPath)) {
		try {
			local = (parse(fs.readFileSync(localPath, "utf-8")) as Record<string, unknown>) ?? {};
		}
		catch {
			local = {};
		}
	}
	const auth = (local.auth as Record<string, unknown> | undefined) ?? {};
	const existingJwt = typeof auth.jwt_secret === "string" ? auth.jwt_secret : "";

	// 3) dev jwt_secret：缺失或本机密钥解不开 → 重新生成并 seal（仅 jwt，可随意轮换）
	const jwtOk = existingJwt.startsWith("ENC[") && canOpenWith(existingJwt, privateKey, projectRoot);
	let jwtSecretEnc = existingJwt;
	if (!jwtOk) {
		if (!fs.existsSync(ojBin))
			throw new Error(`[ojm] 未找到 oj 二进制（${ojBin}），无法密封 jwt_secret。请先运行 ojm vendor。`);
		const plain = randomHex(32);
		const sealed = execFileSync(ojBin, ["secret", "seal", "-k", publicKey], {
			input: plain,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (!sealed.startsWith("ENC["))
			throw new Error("[ojm] oj secret seal 未返回 ENC[...]，开发密钥供给失败。");
		jwtSecretEnc = sealed;
	}

	// 4) 写回 config.local.yaml（仅 dev 覆盖 + dev 密钥；不碰 tracked）
	const nextLocal: Record<string, unknown> = { ...local };
	nextLocal.auth = { ...auth, jwt_secret: jwtSecretEnc };
	nextLocal.secrets = {
		private_key_path: "./config/secrets-private.pem",
		public_key_path: "./config/secrets-public.pem",
	};
	fs.writeFileSync(localPath, stringify(nextLocal));

	if (provisionedKey)
		log("[ojm] 已生成本机开发密钥：config/secrets-{private,public}.pem");
	if (!jwtOk)
		log("[ojm] 已生成本机开发 jwt_secret（密封于 config.local.yaml，git 不跟踪）。");

	return nextLocal;
}

/**
 * 红线（A-2）：tracked 里出现**非 jwt** 的 `ENC[...]` 且本机密钥解不开 → 清晰报错，
 * 要求提供真实私钥；绝不自动用 dev 随机密钥重封（会破坏已加密落库数据）。
 */
export function checkNoUnopenableSharedEnc(
	projectRoot: string,
	configPath: string,
	_deps: DevSecretsDeps = {},
): void {
	const keysDir = resolveCertDir(projectRoot);
	const privateKey = path.join(keysDir, "secrets-private.pem");
	if (!fs.existsSync(configPath) || !fs.existsSync(privateKey))
		return; // 无 tracked 或无本机密钥时不查（密钥缺失由 provision/red-line 别处兜底）
	let doc: unknown;
	try {
		doc = parse(fs.readFileSync(configPath, "utf-8"));
	}
	catch {
		return;
	}
	const encValues = findEncValues(doc);
	for (const [pointer, enc] of encValues) {
		if (pointer === "/auth/jwt_secret")
			continue; // jwt 由 dev 自行供给，忽略 tracked 的 prod ENC
		if (!canOpenWith(enc, privateKey, projectRoot)) {
			throw new Error(
				`[ojm] 配置中 ${pointer} 是 ENC[...] 密文，但本机没有能解开的私钥（config/secrets-private.pem）。\n`
				+ "        该密文通常由团队用真实密钥密封（如落库加密键 wecom_enc_key），dev 不会用随机密钥重封——否则会破坏已加密数据。\n"
				+ "        请向团队获取对应私钥放到 config/secrets-private.pem，或在 config.local.yaml 里覆盖该字段为可解密的明文/ENC 后重试。",
			);
		}
	}
}

/** 纯函数深合并（local 覆盖 tracked；数组整体替换，不 concat） */
export function deepMerge(tracked: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = Array.isArray(tracked) ? [...(tracked as unknown[])] as unknown as Record<string, unknown> : { ...tracked };
	for (const [k, v] of Object.entries(local)) {
		const base = (out as Record<string, unknown>)[k];
		if (
			v && typeof v === "object" && !Array.isArray(v)
			&& base && typeof base === "object" && !Array.isArray(base)
		) {
			(out as Record<string, unknown>)[k] = deepMerge(base as Record<string, unknown>, v as Record<string, unknown>);
		}
		else {
			(out as Record<string, unknown>)[k] = v;
		}
	}
	return out;
}

export interface MergeDeps extends DevSecretsDeps {
	/** 注入供给逻辑（测试可替换为无 oj 的桩） */
	provision?: (projectRoot: string, configPath: string, d: DevSecretsDeps) => Record<string, unknown>
	/** 注入红线检查（测试可替换为 no-op） */
	redLine?: (projectRoot: string, configPath: string, d: DevSecretsDeps) => void
	/** 注入合并落点（测试可改） */
	mergedPath?: (configPath: string) => string
	/** 额外注入派生产物 vars 段的键值（如出厂收敛 token；只进 gitignored 产物，绝不写回 tracked/local） */
	extraVars?: Record<string, string>
}

/**
 * dev 配置就绪 + 合并：供给本机密钥、红线校验、深合并 tracked + local → `.ojm-tmp-config.yaml`。
 * 返回合并产物路径，供 `oj serve -c` 使用。幂等（密钥/secret 存在即跳过）。
 */
export function mergeConfigForDev(
	projectRoot: string,
	configPath: string,
	deps: MergeDeps = {},
): string {
	const provision = deps.provision ?? provisionDevSecrets;
	const redLine = deps.redLine ?? checkNoUnopenableSharedEnc;
	const mergedPath = deps.mergedPath ?? ((cp: string) => resolveMergedConfigPath(cp));

	// 必须先 provision 再 red-line：首次 clone 本机密钥尚不存在，provision 会先生成
	// 本地密钥对；之后 red-line 才能拿本机私钥去校验 tracked 里的非 jwt ENC[...]，
	// 否则红线会在「无密钥可校验」时直接 early-return，把打不开的共享密文漏过去
	// （正是方案 A' 要解决的「启动失败被吞」根因之一）。
	provision(projectRoot, configPath, deps);
	redLine(projectRoot, configPath, deps);

	let trackedDoc: Record<string, unknown> = {};
	if (fs.existsSync(configPath)) {
		try {
			trackedDoc = (parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>) ?? {};
		}
		catch (error) {
			throw new Error(`[ojm] ${configPath} 解析失败（不是合法 YAML）：${(error as Error).message}`);
		}
	}
	// provision 已把本机密钥/jwt 写入 config.local.yaml；此处读回参与合并
	const localDoc = readLocal(projectRoot, configPath);
	const merged = deepMerge(trackedDoc, localDoc);
	if (deps.extraVars) {
		const vars = (merged.vars ?? {}) as Record<string, unknown>;
		merged.vars = { ...vars, ...deps.extraVars };
	}

	const outPath = mergedPath(configPath);
	assertOutputNotTracked(configPath, outPath);
	fs.writeFileSync(outPath, stringify(merged));
	return outPath;
}

/** 读 config.local.yaml（不存在/解析失败 → 空对象） */
function readLocal(projectRoot: string, configPath: string): Record<string, unknown> {
	const localPath = resolveLocalConfigPath(configPath);
	if (!fs.existsSync(localPath))
		return {};
	try {
		return (parse(fs.readFileSync(localPath, "utf-8")) as Record<string, unknown>) ?? {};
	}
	catch {
		return {};
	}
}
