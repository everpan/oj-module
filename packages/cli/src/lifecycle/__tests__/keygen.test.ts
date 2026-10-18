// 密钥工具 spec（P2-1）：生成 / PEM 加载 / 与 sign.ts 的接续。
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPair, readPrivateKeyPem } from "../keygen";
import { exportRawPublicKeyHex, signCanonical, verifyCanonical } from "../sign";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "ojm-keygen-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("generateKeyPair（P2-1）", () => {
	it("ed25519 32B raw 公钥 hex + PKCS#8 PEM；两次生成不同 key", () => {
		const a = generateKeyPair();
		const b = generateKeyPair();
		expect(a.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
		expect(b.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
		expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
		expect(a.privateKeyPem).toContain("PRIVATE KEY");
	});

	it("生成 key 与 sign.ts 往返：export/sign/verify 全通", () => {
		const kp = generateKeyPair();
		expect(exportRawPublicKeyHex(kp.privateKeyPem)).toBe(kp.publicKeyHex);
		const sig = signCanonical(kp.privateKeyPem, `demo-solution@0.1.0:${"0".repeat(64)}`);
		expect(verifyCanonical(kp.publicKeyHex, `demo-solution@0.1.0:${"0".repeat(64)}`, sig)).toBe(true);
	});

	it("pem 落盘 0600 后可读回（keygen 文件落点的前置面；命令接线属 P2-4）", () => {
		const kp = generateKeyPair();
		const file = path.join(dir, "test.publisher.pem");
		writeFileSync(file, kp.privateKeyPem, { mode: 0o600 });
		const loaded = readPrivateKeyPem(file);
		expect(exportRawPublicKeyHex(loaded)).toBe(kp.publicKeyHex);
	});
});

describe("readPrivateKeyPem fail-closed", () => {
	it("不存在 → 可读错误（不静默）", () => {
		expect(() => readPrivateKeyPem(path.join(dir, "nope.pem"))).toThrow(/私钥文件读取失败/);
	});

	it("非 PEM 内容 → 可读错误", () => {
		const file = path.join(dir, "bad.pem");
		writeFileSync(file, "not a pem");
		expect(() => readPrivateKeyPem(file)).toThrow(/不是合法 PEM 私钥文件/);
	});

	it("buffer 形态 pem 亦可（调用方直传 readFileSync 产物的场景）", () => {
		const kp = generateKeyPair();
		const file = path.join(dir, "k.pem");
		writeFileSync(file, Buffer.from(kp.privateKeyPem));
		expect(readPrivateKeyPem(file)).toBe(kp.privateKeyPem);
	});
});
