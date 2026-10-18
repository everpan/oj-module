/**
 * oj dev 证书现场签发（设计 D6 / PR0 spike）。
 *
 * oj 的证书校验无任何 config/CLI 绕过开关（devkit 手册 §10），三件套由
 * `ojm init` 按工程现场生成：私钥不随 npm 分发、不跨工程共享密钥对。
 * JWS 为 RS256 紧凑三段，payload 仅含 nbf/exp——oj v0.1.0 实测接受该
 * schema（PR0 spike）；oj 侧 schema 文档化已立项，漂移会在 init 时响亮报错。
 */

import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readOjServerField } from "./oj-config";

/** 默认有效期：3650 天。oj 证书宽限期尽即拒启且无自助续期，短有效期等于时钟炸弹 */
const DEFAULT_DAYS = 3650;

export interface DevCertPaths {
	privateKey: string
	publicKey: string
	cert: string
}

export async function mintDevCert(
	outDir: string,
	opts: { days?: number } = {},
): Promise<DevCertPaths> {
	const days = opts.days ?? DEFAULT_DAYS;
	const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({ nbf: now, exp: now + days * 86400 })).toString("base64url");
	const signingInput = `${header}.${payload}`;
	const signature = crypto
		.createSign("RSA-SHA256")
		.update(signingInput)
		.sign(privateKey)
		.toString("base64url");

	fs.mkdirSync(outDir, { recursive: true });
	const write = (name: string, data: string) => {
		const file = path.join(outDir, name);
		fs.writeFileSync(file, data);
		return file;
	};

	return {
		privateKey: write("private.pem", privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
		publicKey: write("public.pem", publicKey.export({ type: "spki", format: "pem" }).toString()),
		cert: write("cert.jws", `${signingInput}.${signature}\n`),
	};
}

/**
 * dev 起后端前确保开发证书就位：config 声明的 `certificate_path` 文件缺失时现场签发。
 *
 * `ojm init` 产出的工程自带证书，但模板仓库本身也是一个可运行工程（不走 init），
 * 直接 `pnpm dev` 会因 oj 读不到 public.pem 而 fail-fast——故 dev 补这一道。
 * 证书路径相对 config 文件所在目录解析（与 oj 一致）。
 */
export async function ensureDevCert(configPath: string): Promise<boolean> {
	const rel = readOjServerField(configPath, "certificate_path");
	if (!rel)
		return false;
	const certPath = path.resolve(path.dirname(configPath), rel);
	if (fs.existsSync(certPath))
		return false;
	await mintDevCert(path.dirname(certPath));
	return true;
}
