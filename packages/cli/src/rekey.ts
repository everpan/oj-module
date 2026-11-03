import type { DevSecretsDeps } from "./dev-secrets";
/**
 * `ojm rekey` —— 重新生成开发态本机密钥并重封 dev jwt_secret（方案 A' 第 8 点）。
 *
 * 只动 gitignored 的 `config/secrets-*.pem` 与 `config.local.yaml` 里的 dev 覆盖，
 * **绝不**触碰 tracked `config.yaml`（prod 路径零改动，A-3 不变量）。
 *
 * 典型场景：
 *   - 本机 dev 密钥对被人误删/改坏，`ojm dev` 因 jws/ENC 解不开起不来 → `ojm rekey` 重生。
 *   - 想让本机 jwt_secret 轮换（dev 可随意轮换，无外部密文依赖）。
 * 之后 `ojm dev` 会用新密钥自动重合并重起；无需手改任何 tracked 文件。
 */
import fs from "node:fs";
import path from "node:path";
import { provisionDevSecrets, resolveLocalConfigPath } from "./dev-secrets";
import { resolveCertDir, resolveConfigPath } from "./layout";

export interface RekeyResult {
	/** 重生后的 `config.local.yaml` 路径 */
	localPath: string
	/** 是否真正重新生成了密钥对（已存在且可用则 rekey 只重封 jwt，不重生成） */
	regeneratedKey: boolean
}

export interface RekeyDeps extends DevSecretsDeps {}

/**
 * 重新供给开发态本机密钥：删除旧 `secrets-*.pem` → `provisionDevSecrets` 因缺失而重生成，
 * 并跟着重封 jwt_secret 写入 `config.local.yaml`。返回落点信息。
 */
export function rekeyCommand(projectRoot: string, deps: RekeyDeps = {}): RekeyResult {
	const configPath = resolveConfigPath(projectRoot);
	if (!fs.existsSync(configPath))
		throw new Error(`[ojm] 未找到 config.yaml（${configPath}），无法 rekey。请确认当前目录是 ojm 工程。`);

	const keysDir = resolveCertDir(projectRoot);
	const privateKey = path.join(keysDir, "secrets-private.pem");
	const publicKey = path.join(keysDir, "secrets-public.pem");
	const hadKey = fs.existsSync(privateKey) || fs.existsSync(publicKey);
	// 强制重生：先删旧的，provisionDevSecrets 见缺失即 keygen（A' 自动 rekey 的同一入口）
	for (const f of [privateKey, publicKey]) {
		if (fs.existsSync(f))
			fs.rmSync(f);
	}

	provisionDevSecrets(projectRoot, configPath, deps);
	return {
		localPath: resolveLocalConfigPath(configPath),
		regeneratedKey: hadKey,
	};
}
