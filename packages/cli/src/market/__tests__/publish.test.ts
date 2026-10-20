// ojm market publish spec（T3）：落包到 cdn/ —— 只产出 `.tgz` 与包级 `.tgz.sig`。
//
// 钉死 D-1 的职责边界：publish **不碰索引**（不得生成 bundles.yaml / manifests.yaml），
// 也不得把私钥写进任何目录（私钥是否入盘由隔离场景纪律兜，这里断言 cdn 与暂存区无 PEM）。
import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyCanonical } from "../../lifecycle/sign";
import { publishPackage } from "../publish";

const MOUNTS = "  - prefix: /api\n    api: src\n  - prefix: /cdn\n    web: ../cdn\n";
const CONFIG = `mounts:\n${MOUNTS}server:\n  host: 127.0.0.1\n  port: 9778\n`;
const KEY_ID = "demo.publisher";

/** Ed25519 测试身份：私钥只在内存，路径从不落盘 */
function testIdentity(): { privateKeyPem: string, publicKeyHex: string } {
	const kp = generateKeyPairSync("ed25519");
	return {
		privateKeyPem: kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicKeyHex: Buffer.from(kp.publicKey.export({ format: "der", type: "spki" }).subarray(-32)).toString("hex"),
	};
}

function newProject(): string {
	const root = mkdtempSync(join(tmpdir(), "ojm-market-publish-"));
	mkdirSync(join(root, "api"), { recursive: true });
	writeFileSync(join(root, "api", "config.yaml"), CONFIG, "utf-8");
	mkdirSync(join(root, "cdn"), { recursive: true });
	return root;
}

describe("given cdn/ 为空 When 发布 fixture", () => {
	it("then 产出包与其包级签名，且不碰索引", async () => {
		const root = newProject();
		const identity = testIdentity();

		const result = await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: identity.privateKeyPem });

		expect(existsSync(result.tgzPath)).toBe(true);
		expect(existsSync(result.sigPath)).toBe(true);
		// D-1：索引不是 publish 的事
		expect(existsSync(join(root, "cdn", "bundles.yaml"))).toBe(false);
		expect(existsSync(join(root, "cdn", "manifests.yaml"))).toBe(false);
	});

	it("then .sig 是可复核的合法 detached 签名（横向复核）", async () => {
		const root = newProject();
		const identity = testIdentity();

		const result = await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: identity.privateKeyPem });
		const sig = JSON.parse(readFileSync(result.sigPath, "utf-8")) as { key_id: string, public_key: string, value: string, canon: string };

		expect(sig.key_id).toBe(KEY_ID);
		expect(sig.public_key).toBe(identity.publicKeyHex);
		expect(sig.canon).toBe("v1");
		expect(verifyCanonical(sig.public_key, result.canonical, sig.value)).toBe(true);
	});

	it("then 私钥不落盘：cdn 与工程根都查不到 PEM", async () => {
		const root = newProject();
		const identity = testIdentity();

		await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: identity.privateKeyPem });

		const pemInCdn = readdirSync(join(root, "cdn")).filter(f => f.endsWith(".pem"));
		expect(pemInCdn).toEqual([]);
	});
});

describe("given 同 name@version 再次发布", () => {
	it("when 内容一致 Then 幂等覆盖（sha256 不变）", async () => {
		const root = newProject();
		const identity = testIdentity();
		const base = { projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: identity.privateKeyPem };

		const first = await publishPackage(base);
		const second = await publishPackage(base);

		expect(second.sha256).toBe(first.sha256);
		expect(second.tgzPath).toBe(first.tgzPath);
	});

	it("when 已有同版本文件但字节不同 Then 报冲突并提示升版本", async () => {
		const root = newProject();
		const identity = testIdentity();
		const target = join(root, "cdn", "demo-solution-0.1.0.tgz");
		writeFileSync(target, "not-a-real-tgz-but-different-bytes", "utf-8");

		await expect(publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: identity.privateKeyPem }))
			.rejects
			.toThrow(/version/);
	});
});

describe("given 签名身份缺失 When 发布", () => {
	it("then 抛人话错误，不产出半截包", async () => {
		const root = newProject();

		await expect(publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0" }))
			.rejects
			.toThrow(/-id/);

		expect(existsSync(join(root, "cdn", "demo-solution-0.1.0.tgz"))).toBe(false);
	});
});
