import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	checkNoUnopenableSharedEnc,
	mergeConfigForDev,
	provisionDevSecrets,
	resolveLocalConfigPath,
	resolveMergedConfigPath,
} from "../../packages/cli/src/dev-secrets";
import { rekeyCommand } from "../../packages/cli/src/rekey";

/**
 * 方案 A' 开发态本地密钥/凭据自动供给：G1–G3 / G6 / G7 + rekey 回归。
 * 不依赖真 oj 二进制，用同款桩 oj（secret keygen/seal/open，密钥不配对即解密失败）
 * 落本工程 bin/oj，路由给 resolveOjBin。
 */

const FIXTURE_ROOT = path.join(process.cwd(), ".tmp-dev-secrets-fx");

function writeStubOj(root: string): void {
	const binDir = path.join(root, "bin");
	fs.mkdirSync(binDir, { recursive: true });
	fs.writeFileSync(path.join(binDir, "oj"), [
		"#!/usr/bin/env node",
		"import fs from \"node:fs\";",
		"import crypto from \"node:crypto\";",
		"const argv = process.argv.slice(2);",
		"if (argv[0] !== \"secret\") process.exit(0);",
		"const sub = argv[1];",
		"if (sub === \"keygen\") {",
		"\tconst dir = argv[argv.indexOf(\"--out-dir\") + 1];",
		"\tconst { privateKey, publicKey } = crypto.generateKeyPairSync(\"ed25519\");",
		"\tfs.writeFileSync(dir + \"/secrets-private.pem\", privateKey.export({ type: \"pkcs8\", format: \"pem\" }));",
		"\tfs.writeFileSync(dir + \"/secrets-public.pem\", publicKey.export({ type: \"spki\", format: \"pem\" }));",
		"\tprocess.exit(0);",
		"}",
		"const pub = argv[argv.indexOf(\"-k\") + 1];",
		"const key = crypto.createHash(\"sha256\").update(fs.readFileSync(pub)).digest();",
		"if (sub === \"seal\") {",
		"\tconst plain = fs.readFileSync(0, \"utf-8\");",
		"\tconst nonce = crypto.randomBytes(12);",
		"\tconst cipher = crypto.createCipheriv(\"aes-256-gcm\", key, nonce);",
		"\tconst ct = Buffer.concat([cipher.update(plain, \"utf-8\"), cipher.final()]);",
		"\tconst tag = cipher.getAuthTag();",
		"\tprocess.stdout.write(\"ENC[\" + Buffer.concat([nonce, tag, ct]).toString(\"base64\") + \"]\");",
		"\tprocess.exit(0);",
		"}",
		"// open：从私钥反推公钥，与 seal 的派生密钥保持一致；密钥不配对则 GCM 验签失败",
		"const privPem = fs.readFileSync(pub);",
		"const pubPem = crypto.createPublicKey(crypto.createPrivateKey(privPem)).export({ type: \"spki\", format: \"pem\" });",
		"const key2 = crypto.createHash(\"sha256\").update(pubPem).digest();",
		"const enc = argv[argv.length - 1];",
		"const raw = Buffer.from(enc.slice(4, -1), \"base64\");",
		"const nonce = raw.subarray(0, 12); const tag = raw.subarray(12, 28); const ct = raw.subarray(28);",
		"try { const d = crypto.createDecipheriv(\"aes-256-gcm\", key2, nonce); d.setAuthTag(tag); d.update(ct); d.final(); process.exit(0); }",
		"catch { process.stderr.write(\"open failed\\n\"); process.exit(1); }",
		"",
	].join("\n"));
	fs.chmodSync(path.join(binDir, "oj"), 0o755);
}

/**
 * 用桩 oj 密封一段明文，返回 ENC[...]（默认用工程内自动生成的密钥对不行——
 *  这里需要一把「外部 keyX」来模拟 tracked 模板里用团队真实密钥封的密文
 */
function sealWithExternalKey(root: string, plain: string): string {
	const tmp = fs.mkdtempSync(path.join(FIXTURE_ROOT, "ext-key-"));
	execFileSync(path.join(root, "bin", "oj"), ["secret", "keygen", "--out-dir", tmp], { stdio: "pipe" });
	return execFileSync(path.join(root, "bin", "oj"), ["secret", "seal", "-k", path.join(tmp, "secrets-public.pem")], {
		input: plain,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function makeFixture(layout: "module-root" | "legacy"): { root: string, configPath: string } {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, `ds-${layout}-`));
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
	writeStubOj(root);
	const configPath = layout === "module-root"
		? path.join(root, "config.yaml")
		: path.join(root, "api/config.yaml");
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	return { root, configPath };
}

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("开发态本地密钥供给（方案 A'）", () => {
	it("首次 clone 无密钥（G1）：自动生成密钥 + 写 config.local.yaml + 合并；tracked config.yaml 字节未变", async () => {
		const { root, configPath } = makeFixture("module-root");
		const tracked = "auth:\n  jwt_secret: \"prod-enc-placeholder\"\napp:\n  title: Demo\n";
		fs.writeFileSync(configPath, tracked);
		const before = fs.readFileSync(configPath);

		const mergedPath = mergeConfigForDev(root, configPath);
		// tracked 未被改动
		expect(fs.readFileSync(configPath).equals(before)).toBe(true);
		// 合并产物：dev 的 jwt_secret（ENC）覆盖 prod 占位，且带 secrets 段
		const merged = fs.readFileSync(mergedPath, "utf-8");
		expect(merged).toMatch(/jwt_secret:\s*ENC\[/);
		expect(merged).toMatch(/secrets:/);
		expect(merged).toMatch(/private_key_path:\s*\.\/config\/secrets-private\.pem/);
		// config.local.yaml 落点（gitignored）
		const localPath = resolveLocalConfigPath(configPath);
		expect(fs.existsSync(localPath)).toBe(true);
	});

	it("二次启动幂等（G2）：密钥存在即跳过不重生成，jwt_secret 不变（已签发会话不失效）", async () => {
		const { root, configPath } = makeFixture("module-root");
		fs.writeFileSync(configPath, "auth:\n  jwt_secret: \"prod\"\n");

		mergeConfigForDev(root, configPath);
		const local1 = fs.readFileSync(resolveLocalConfigPath(configPath), "utf-8");
		const key1 = fs.readFileSync(path.join(root, "config", "secrets-private.pem"));

		mergeConfigForDev(root, configPath);
		const local2 = fs.readFileSync(resolveLocalConfigPath(configPath), "utf-8");
		const key2 = fs.readFileSync(path.join(root, "config", "secrets-private.pem"));
		// jwt_secret（ENC 串）与私钥内容均不变
		expect(local2).toBe(local1);
		expect(key2.equals(key1)).toBe(true);
	});

	it("红线不被破（G3）：tracked 出现本机解不开的非 jwt ENC（wecom_enc_key）→ 清晰报错、不重封、不写回 tracked", async () => {
		const { root, configPath } = makeFixture("module-root");
		// 用外部 keyX 封一个 wecom_enc_key，本机只会生成 keyY → 解不开
		const enc = sealWithExternalKey(root, "permanent_code_secret");
		fs.writeFileSync(configPath, `auth:\n  jwt_secret: "prod"\nwecom_enc_key: ${enc}\n`);
		const before = fs.readFileSync(configPath);

		expect(() => mergeConfigForDev(root, configPath)).toThrowError(/wecom_enc_key/);
		// tracked 未被动
		expect(fs.readFileSync(configPath).equals(before)).toBe(true);
	});

	it("历史 api/ 布局（G6）：config.local.yaml 与 .ojm-tmp-config.yaml 与 config.yaml 同目录 co-locate", async () => {
		const { root, configPath } = makeFixture("legacy");
		fs.writeFileSync(configPath, "auth:\n  jwt_secret: \"prod\"\n");
		const mergedPath = mergeConfigForDev(root, configPath);

		const localPath = resolveLocalConfigPath(configPath);
		const expectedMerged = resolveMergedConfigPath(configPath);
		expect(localPath).toBe(path.join(root, "api/config.local.yaml"));
		expect(mergedPath).toBe(expectedMerged);
		expect(path.dirname(localPath)).toBe(path.dirname(configPath));
		expect(fs.existsSync(localPath)).toBe(true);
		// 密钥落在 api/config/（与 config.yaml 同级 config 目录）
		expect(fs.existsSync(path.join(root, "api/config/secrets-private.pem"))).toBe(true);
	});

	it("模板变更自动重合并（drift，G7）：非密字段跟模板更新、本机 jwt 密钥不变；新增打不开的共享 ENC 触发红线", async () => {
		const { root, configPath } = makeFixture("module-root");
		fs.writeFileSync(configPath, "auth:\n  jwt_secret: \"prod\"\nfeature_flag: 1\n");
		mergeConfigForDev(root, configPath);
		const localJwt = (fs.readFileSync(resolveLocalConfigPath(configPath), "utf-8")).match(/jwt_secret:\s*(ENC\[[^\]]*\])/)?.[1];

		// 团队更新模板：feature_flag 改值（模拟 drift）
		fs.writeFileSync(configPath, "auth:\n  jwt_secret: \"prod\"\nfeature_flag: 2\n");
		const mergedPath = mergeConfigForDev(root, configPath);
		const merged = fs.readFileSync(mergedPath, "utf-8");
		expect(merged).toMatch(/feature_flag:\s*2/); // 模板变更生效
		const mergedJwt = merged.match(/jwt_secret:\s*(ENC\[[^\]]*\])/)?.[1];
		expect(mergedJwt).toBe(localJwt); // 本机 jwt 不变

		// 模板新增一个用外部密钥封的共享 ENC → 重合并时触发红线
		const enc = sealWithExternalKey(root, "new-secret");
		fs.writeFileSync(configPath, `auth:\n  jwt_secret: "prod"\nfeature_flag: 2\nother_shared: ${enc}\n`);
		expect(() => mergeConfigForDev(root, configPath)).toThrowError(/other_shared/);
	});

	it("rekey：删除本机密钥并重生成，jwt_secret 随之轮换；tracked 不动", async () => {
		const { root, configPath } = makeFixture("module-root");
		fs.writeFileSync(configPath, "auth:\n  jwt_secret: \"prod\"\n");
		mergeConfigForDev(root, configPath);
		const before = fs.readFileSync(configPath);
		const oldJwt = (fs.readFileSync(resolveLocalConfigPath(configPath), "utf-8")).match(/jwt_secret:\s*(ENC\[[^\]]*\])/)?.[1];

		const result = rekeyCommand(root);
		expect(fs.readFileSync(configPath).equals(before)).toBe(true); // tracked 零改动
		const newLocal = fs.readFileSync(result.localPath, "utf-8");
		const newJwt = newLocal.match(/jwt_secret:\s*(ENC\[[^\]]*\])/)?.[1];
		expect(newJwt).not.toBe(oldJwt); // jwt 已轮换
		expect(newLocal).toMatch(/secrets:/);
	});

	it("checkNoUnopenableSharedEnc 对 jwt 之外的 ENC 抛错；jwt 本身忽略（dev 自供给）", () => {
		const { root, configPath } = makeFixture("module-root");
		// 先落一份合法 tracked config（让 resolveCertDir 稳定指向 config/），再供给本机密钥
		fs.writeFileSync(configPath, "auth:\n  jwt_secret: \"prod\"\n");
		provisionDevSecrets(root, configPath);
		// 放一个外部密钥封的共享 ENC（本机私钥解不开）
		const enc = sealWithExternalKey(root, "x");
		fs.writeFileSync(configPath, `auth:\n  jwt_secret: ${enc}\nwecom: ${enc}\n`);
		// jwt 的 ENC 也是外部密钥封的，但红线跳过 /auth/jwt_secret → 仅 wecom 触发
		expect(() => checkNoUnopenableSharedEnc(root, configPath)).toThrowError(/wecom/);
	});
});
