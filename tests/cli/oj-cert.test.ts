import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mintDevCert } from "../../packages/cli/src/oj-cert";

/**
 * D6 / PR0：oj dev 证书现场签发工具。
 *
 * oj 证书无任何绕过开关（devkit 手册 §10），三件套必须在 `ojm init` 时
 * 按工程现场生成：私钥不随 npm 分发、不跨工程共享密钥对。
 * 这里锁三件事：JWS 结构（RS256 紧凑三段 + exp/nbf）、PEM 格式、签名可验。
 */
describe("mintDevCert", () => {
	it("签发三件套：RS256 JWS（exp+nbf）+ SPKI 公钥 + PKCS#8 私钥，且公钥可验签", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oj-cert-"));
		const paths = await mintDevCert(dir, { days: 3650 });

		expect(fs.existsSync(paths.privateKey)).toBe(true);
		expect(fs.existsSync(paths.publicKey)).toBe(true);
		expect(fs.existsSync(paths.cert)).toBe(true);

		const jws = fs.readFileSync(paths.cert, "utf-8").trim();
		const [h, p, s] = jws.split(".");
		expect(h).toBeTruthy();
		expect(p).toBeTruthy();
		expect(s).toBeTruthy();

		const header = JSON.parse(Buffer.from(h!, "base64url").toString());
		expect(header.alg).toBe("RS256");

		const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
		const days = (payload.exp - payload.nbf) / 86400;
		expect(days).toBeGreaterThan(3649);

		const pub = fs.readFileSync(paths.publicKey, "utf-8");
		expect(pub).toContain("BEGIN PUBLIC KEY");
		const priv = fs.readFileSync(paths.privateKey, "utf-8");
		expect(priv).toContain("PRIVATE KEY");

		const verified = crypto
			.createVerify("RSA-SHA256")
			.update(`${h}.${p}`)
			.verify(pub, Buffer.from(s!, "base64url"));
		expect(verified).toBe(true);
	});

	it("outDir 不存在时自动创建；默认 days=3650", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "oj-cert-root-"));
		const dir = path.join(root, "api/config");
		const paths = await mintDevCert(dir);
		const payload = JSON.parse(
			Buffer.from(fs.readFileSync(paths.cert, "utf-8").trim().split(".")[1]!, "base64url").toString(),
		);
		expect((payload.exp - payload.nbf) / 86400).toBeGreaterThan(3649);
		expect(fs.existsSync(path.join(dir, "cert.jws"))).toBe(true);
	});
});
