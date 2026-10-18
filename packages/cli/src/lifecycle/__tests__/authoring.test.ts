// BDD：`ojm keygen` / `ojm sign`（P2-4 作者工具链，Ed25519 自备版 stopgap）。
// 上游 PR 合入 `oj secret keygen --alg ed25519` 后，这两个命令将收敛为壳调用（计划台账已记）。
// 私钥红线 / 命名空间 / 离线自检 / detached .sig 五字段为本次覆盖重点。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_KEY_ID, isValidKeyId, keygenCommand, parseKeygenArgs } from "../../keygen";
import { parseSignArgs, signCommand } from "../../sign";
import { readPrivateKeyPem } from "../keygen";
import { fingerprintOfPublicKey, signCanonical as signCanonicalLocal, verifyCanonical } from "../sign";

const tmp = path.join(os.tmpdir(), `ojm-authoring-${Date.now()}-${Math.random().toString(36).slice(2)}`);

beforeEach(() => {
	fs.mkdirSync(tmp, { recursive: true });
});
afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ojm keygen 参数解析 + key_id 命名空间（C2-37）", () => {
	it("parseKeygenArgs：--id/--out 值式消费 + --yes 独立", () => {
		expect(parseKeygenArgs(["--id", "acme.market", "--out", "./k", "--yes"]))
			.toEqual({ id: "acme.market", out: "./k", yes: true });
	});
	it("isValidKeyId：<publisher>.<id> 合法 / 裸名·大写·空非法", () => {
		expect(isValidKeyId("acme.market")).toBe(true);
		expect(isValidKeyId("acme.dev.key-1")).toBe(true);
		expect(isValidKeyId("local")).toBe(false);
		expect(isValidKeyId("Acme.Market")).toBe(false);
		expect(isValidKeyId("")).toBe(false);
	});
});

describe("ojm keygen 命令体（Ed25519 落盘 + 私钥红线）", () => {
	it("缺省 key_id=local.dev，五产物齐全且私钥 0600、公钥 64hex、指纹一致", () => {
		const r = keygenCommand({ cwd: tmp });
		expect(r.keyId).toBe(DEFAULT_KEY_ID);
		expect(r.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
		expect(r.fingerprint).toBe(fingerprintOfPublicKey(r.publicKeyHex));
		expect(fs.statSync(r.privateKeyPath).mode & 0o777).toBe(0o600);
		expect(fs.readFileSync(r.publicKeyPath, "utf8").trim()).toBe(r.publicKeyHex);
	});

	it("落盘私钥可还原并用于签验（证明是 Ed25519 而非 X25519）", () => {
		const r = keygenCommand({ cwd: tmp });
		const pem = readPrivateKeyPem(r.privateKeyPath);
		const canon = `demo@0.1.0:${"0".repeat(64)}`;
		const sig = signCanonicalLocal(pem, canon);
		expect(verifyCanonical(r.publicKeyHex, canon, sig)).toBe(true);
	});

	it("工程树内落盘无 --yes → 抛「私钥入仓」拒绝", () => {
		expect(() => keygenCommand({ out: "./keys", cwd: tmp })).toThrow(/私钥入仓/);
	});
	it("工程树内落盘带 --yes → 放行", () => {
		const r = keygenCommand({ out: "./keys", yes: true, cwd: tmp });
		expect(fs.existsSync(r.privateKeyPath)).toBe(true);
	});
	it("非法 key_id 命名空间 → 直接拒（C2-37）", () => {
		expect(() => keygenCommand({ id: "local", cwd: tmp })).toThrow(/key_id 命名空间非法/);
	});
});

describe("ojm sign 参数解析", () => {
	it("parseSignArgs：位置参数 + --id/--key 值式消费 + --check 独立", () => {
		expect(parseSignArgs(["pkg.tgz", "--id", "acme.market", "--key", "k.pem", "--check"]))
			.toEqual({ positionals: ["pkg.tgz"], id: "acme.market", key: "k.pem", check: true });
	});
});

describe("ojm sign 命令体（detached .sig，G4 载体）", () => {
	const TGZ = path.join(tmp, "demo-solution-0.1.0.tgz");

	beforeEach(() => {
		fs.writeFileSync(TGZ, "demo-archive-bytes\n");
	});

	it("签名产出 .sig 五字段（alg/key_id/public_key/value/canon），且 verifyCanonical 通过", () => {
		const kp = keygenCommand({ id: "acme.market", out: path.join(tmp, "k"), yes: true, cwd: tmp });
		const r = signCommand(TGZ, { id: "acme.market", key: kp.privateKeyPath });
		const sig = JSON.parse(fs.readFileSync(r.sigPath, "utf8"));
		expect(sig.alg).toBe("Ed25519");
		expect(sig.key_id).toBe("acme.market");
		expect(sig.public_key).toBe(kp.publicKeyHex);
		expect(sig.canon).toBe("v1");
		expect(verifyCanonical(sig.public_key, r.canonical, sig.value)).toBe(true);
	});

	it("--check 离线自检：真签名通过（checkPassed=true）；--key+--id 自定义位置", () => {
		const kp = keygenCommand({ id: "acme.market", out: path.join(tmp, "k"), yes: true, cwd: tmp });
		const r = signCommand(TGZ, { id: "acme.market", key: kp.privateKeyPath, check: true });
		expect(r.checkPassed).toBe(true);
	});

	it("缺 --id 且未给 --key → 拒绝并指引先 keygen", () => {
		expect(() => signCommand(TGZ, {})).toThrow(/缺少签名身份/);
	});
	it("非法 key_id 命名空间 → 拒绝（C2-37）", () => {
		const kp = keygenCommand({ id: "acme.market", out: path.join(tmp, "k"), yes: true, cwd: tmp });
		expect(() => signCommand(TGZ, { id: "local", key: kp.privateKeyPath })).toThrow(/key_id 命名空间非法/);
	});
	it("非 .tgz 目标 → 拒绝", () => {
		const kp = keygenCommand({ id: "acme.market", out: path.join(tmp, "k"), yes: true, cwd: tmp });
		expect(() => signCommand(path.join(tmp, "x.zip"), { id: "acme.market", key: kp.privateKeyPath }))
			.toThrow(/\.tgz/);
	});
});
