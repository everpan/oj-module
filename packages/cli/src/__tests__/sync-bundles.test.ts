/**
 * sync-bundles.mjs（prepack 随站 bundle 收编闸门）的 canon 版本守卫。
 *
 * 2026-11-13 回归复盘：0.2.91 随站 oj-market-0.2.7.tgz.sig 是 canon "v1"
 * （发布签名步骤误用全局旧 ojm 0.2.25，其签名器恒产 v1），而站点 verify
 * （REG-CS3）对 canon !== "v2" 一律 canon_stale 拒装。当时的 prepack 漂移
 * 闸门只比对版本号、不校 .sig 的 canon 字段，v1 sig 畅通无阻随包出站。
 *
 * 本守卫把「收编的 .sig 必须 canon v2」钉成发布闸门：脚本对 v1 sig 拒收
 * （exit 1），对 v2 sig 放行（exit 0 且 bundles 落位）。fixture 树在 tmp 里
 * 现造（脚本 cliRoot 锚定自身位置，拷进临时目录即可隔离跑），签名用测试
 * 内生成的临时 Ed25519 密钥——私钥永不出 ~/.ojm/keys 的纪律不受影响。
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(cliRoot, "scripts", "sync-bundles.mjs");

/** 造一棵隔离的 cliRoot：scripts/sync-bundles.mjs + templates/{dist,src} fixture */
function makeFixture(canon: string, withRegistryId: boolean): string {
	const root = mkdtempSync(join(tmpdir(), "sync-bundles-"));
	mkdirSync(join(root, "scripts"), { recursive: true });
	cpSync(SCRIPT, join(root, "scripts", "sync-bundles.mjs"));
	const dist = join(root, "templates", "dist");
	const src = join(root, "templates", "src", "demo");
	mkdirSync(dist, { recursive: true });
	mkdirSync(src, { recursive: true });
	writeFileSync(join(src, "solution.yaml"), "name: demo\nversion: 1.0.0\n");
	writeFileSync(join(dist, "demo-1.0.0.tgz"), "fake-tgz-bytes");
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const pubHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
	const sig: Record<string, string> = {
		alg: "Ed25519",
		key_id: "fixture.key",
		public_key: pubHex,
		value: nodeSign(null, Buffer.from("fixture-canonical"), privateKey).toString("base64"),
		canon,
	};
	if (withRegistryId)
		sig.registry_id = "oj-registry";
	writeFileSync(join(dist, "demo-1.0.0.tgz.sig"), `${JSON.stringify(sig, null, "\t")}\n`);
	return root;
}

function runScript(root: string): { code: number, output: string } {
	try {
		const output = execFileSync(process.execPath, [join(root, "scripts", "sync-bundles.mjs")], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		return { code: 0, output };
	}
	catch (e) {
		const err = e as { status?: number, stdout?: string, stderr?: string };
		return { code: err.status ?? -1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
	}
}

describe("sync-bundles prepack 闸门：收编的 .sig 必须 canon v2（REG-CS3）", () => {
	it("canon v1 的 .sig 拒收：exit 1 且给出重签处置提示", () => {
		const root = makeFixture("v1", false);
		const { code, output } = runScript(root);
		rmSync(root, { recursive: true, force: true });
		expect(code, output).toBe(1);
		expect(output).toContain("canon");
		expect(output).toContain("重签");
	});

	it("canon v2 的 .sig 放行：exit 0 且 bundles 收编落位", () => {
		const root = makeFixture("v2", true);
		const result = runScript(root);
		expect(result.code, result.output).toBe(0);
		expect(readFileSync(join(root, "shell-dist", "bundles", "demo-1.0.0.tgz.sig"), "utf-8")).toContain("\"canon\": \"v2\"");
		rmSync(root, { recursive: true, force: true });
	});
});
