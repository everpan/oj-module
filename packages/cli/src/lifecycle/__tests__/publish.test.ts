// publish 命令 spec（P3-5/6/7）：重算索引 + detached .sig 签名写回 + 离线自检。
// 纯 Node 侧（与 ojm sign 同签名原语 lifecycle/sign.ts），验证侧用 verifyCanonical 复核。
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";
import { indexCanonical, publishCommand, recomputeIndex, signIndex } from "../../publish";
import { verifyCanonical } from "../sign";
import { defaultTestKey } from "./helpers";

const BUNDLES = `solutions:
  - name: demo-solution
    latest: 0.1.0
    versions:
      - version: 0.1.0
        file: demo-solution-0.1.0.tgz
`;
const MANIFESTS = `- name: demo-solution
  version: 0.1.0
  author: acme
  changelog: initial
`;

let dir: string;
let keyPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ojm-publish-"));
	writeFileSync(join(dir, "bundles.yaml"), BUNDLES);
	writeFileSync(join(dir, "manifests.yaml"), MANIFESTS);
	keyPath = join(dir, "key.pem");
	writeFileSync(keyPath, defaultTestKey().privateKeyPem);
});

afterEach(() => {
	// 临时目录由 OS 回收（测试用 tmpdir，无需手动 rm）
});

describe("ojm publish 索引重算 + 签名（P3-5/6/7）", () => {
	it("重算两份索引并产出 detached .sig，签名可被 verifyCanonical 复核通过", () => {
		const res = publishCommand(dir, { key: keyPath, id: "test.publisher" });
		expect(existsSync(res.bundlesSigPath)).toBe(true);
		expect(existsSync(res.manifestsSigPath)).toBe(true);
		expect(res.keyId).toBe("test.publisher");

		const bundlesText = readFileSync(res.bundlesPath, "utf8");
		const manifestsText = readFileSync(res.manifestsPath, "utf8");
		const bundlesSig = JSON.parse(readFileSync(res.bundlesSigPath, "utf8"));
		const manifestsSig = JSON.parse(readFileSync(res.manifestsSigPath, "utf8"));

		expect(bundlesSig.alg).toBe("Ed25519");
		expect(bundlesSig.key_id).toBe("test.publisher");
		expect(bundlesSig.canon).toBe("v1");
		// REG-CS1/CS2：签名覆盖代次——`.sig` 与索引正文各带 seq 且相等
		expect(bundlesSig.seq).toBe(1);
		expect(manifestsSig.seq).toBe(1);
		expect(yamlParse(bundlesText).seq).toBe(1);
		expect(verifyCanonical(res.publicKeyHex, indexCanonical("bundles", bundlesSig.seq, bundlesText), bundlesSig.value)).toBe(true);
		expect(verifyCanonical(res.publicKeyHex, indexCanonical("manifests", manifestsSig.seq, manifestsText), manifestsSig.value)).toBe(true);
		// 换代即失效（防「新总目录 + 旧分册」被拼起来用）
		expect(verifyCanonical(res.publicKeyHex, indexCanonical("bundles", 2, bundlesText), bundlesSig.value)).toBe(false);
	});

	it("--check 离线自检通过（checkPassed === true）", () => {
		const res = publishCommand(dir, { key: keyPath, id: "test.publisher", check: true });
		expect(res.checkPassed).toBe(true);
	});

	it("重算使索引确定性化（同内容重排后 sha256 稳定可签）", () => {
		const a = recomputeIndex("x: 1\ny: 2\n");
		const b = recomputeIndex("y: 2\nx: 1\n");
		expect(a).toBe(b);
		// 重算文本可被 signIndex 正常签出六字段（含 seq）
		const sig = signIndex("bundles", 7, a, defaultTestKey().privateKeyPem, "test.publisher");
		expect(sig.seq).toBe(7);
		expect(verifyCanonical(defaultTestKey().publicKeyHex, indexCanonical("bundles", 7, a), sig.value)).toBe(true);
	});

	it("缺索引文件 → 抛错（不发半成品 .sig）", () => {
		unlinkSync(join(dir, "bundles.yaml"));
		expect(() => publishCommand(dir, { key: keyPath, id: "test.publisher" })).toThrow(/须含 bundles\.yaml 与 manifests\.yaml/);
	});

	it("私钥缺失 → 抛错（fail-closed，不静默）", () => {
		expect(() => publishCommand(dir, { key: join(dir, "nope.pem"), id: "test.publisher" })).toThrow(/私钥文件不存在/);
	});
});
