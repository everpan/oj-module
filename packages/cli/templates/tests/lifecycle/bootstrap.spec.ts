// BDD：第一方 bootstrap key（P2-12，G3 双轨第一轨）。
// ① 播种机制：信任库文件尚不存在且 key 在场 → 播种一次（market 首装免 TOFU）；
//    key 未回填（null）→ no-op；库文件已存在（含空库 {}）→ 不播种——不与运维吊销对抗（G5）。
// ② 私钥红线钉测：packages/cli 全树（源码 + 模板）零私钥材料——文件名（*.pem/*private*）
//    与 PEM 私钥块实体（header 后跟 ≥100 字符 base64 体；tasks.ts redact 正则与测试假体
//    体长 <100 不误伤）双口径扫描。
// ③ 集成（market-api.spec）：信任库为空 + bootstrapKey 注入 → cdn 安装直达 done 不落 needs_trust。
import type { FsFace } from "../../src/_platform/api/_lifecycle/atomic";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrustStore } from "../../src/_platform/api/_lifecycle/trust";
import { BOOTSTRAP_KEY, seedBootstrapKey } from "../../src/_platform/api/market/bootstrap";

const g = globalThis as any;

const KEY = { key_id: "test.publisher", public_key: "a".repeat(64) };

function nodeFsFace(): FsFace {
	return {
		writeFile: (path, data) => fsp.writeFile(path, data),
		readFile: path => fsp.readFile(path),
		mkdir: (path, opts) => fsp.mkdir(path, opts),
		remove: (path, opts) => fsp.rm(path, opts),
		rename: (oldPath, newPath) => fsp.rename(oldPath, newPath),
		copyFile: (src, dest) => fsp.copyFile(src, dest),
		readdir: path => fsp.readdir(path),
	};
}

let dir: string;

beforeEach(async () => {
	g.fs = nodeFsFace();
	dir = await fsp.mkdtemp(join(tmpdir(), "ojm-bootstrap-"));
});

afterEach(async () => {
	g.fs = undefined;
	await fsp.rm(dir, { recursive: true, force: true });
});

describe("seedBootstrapKey 播种机制（P2-12：G3 双轨第一轨）", () => {
	it("key 在场 + 信任库文件不存在 → 播种一次（get 读回同公钥）", async () => {
		const trustPath = join(dir, "trusted-keys.yaml");
		await seedBootstrapKey(trustPath, KEY);
		expect(await createTrustStore(trustPath).get(KEY.key_id)).toBe(KEY.public_key);
	});

	it("key 为 null（发布时回填前的内置口径）→ no-op，不产生库文件", async () => {
		const trustPath = join(dir, "trusted-keys.yaml");
		await seedBootstrapKey(trustPath, null);
		await expect(fsp.access(trustPath)).rejects.toThrow();
		// 内置常量在回填前必须为 null（模板只带公钥机制、不带任何具体钥——发布时回填真钥）
		expect(BOOTSTRAP_KEY).toBeNull();
	});

	it("信任库文件已存在（含空库 {}）→ 不播种：运维 remove 后不复活（G5）", async () => {
		const trustPath = join(dir, "trusted-keys.yaml");
		// 预置空库（已初始化形态）
		await fsp.writeFile(trustPath, "trusted_keys: {}\n");
		await seedBootstrapKey(trustPath, KEY);
		expect(await createTrustStore(trustPath).get(KEY.key_id)).toBeNull();
		// 预置他 key 库：不播种也不破坏既有内容
		await fsp.writeFile(trustPath, `trusted_keys:\n  other.pub:\n    public_key: "${"b".repeat(64)}"\n    added_at: 1\n`);
		await seedBootstrapKey(trustPath, KEY);
		const store = createTrustStore(trustPath);
		expect(await store.get(KEY.key_id)).toBeNull();
		expect(await store.get("other.pub")).toBe("b".repeat(64));
	});
});

describe("私钥红线钉测（P2-12：packages/cli 全树零私钥材料）", () => {
	const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

	async function* walk(root: string): AsyncGenerator<string> {
		for (const name of await fsp.readdir(root)) {
			// 跳过 node_modules / dist / 点目录（依赖与构建产物）；`config` 是 `ojm dev` 缺证时
			// **现场签发**的开发证书目录（模板 .gitignore 的 `config/*.pem` 已挡住、进不了
			// tarball）。本测试钉的是「源码树里没有私钥材料」，不是本地运行时产物——不跳
			// config 会让模板自身跑过一次 dev 就永久变红（连带 `pnpm pack` 也不会带上它们）。
			if (name === "node_modules" || name === "dist" || name === "config" || name.startsWith(".")) {
				continue;
			}
			const p = join(root, name);
			const st = await fsp.stat(p);
			if (st.isDirectory()) {
				yield* walk(p);
			}
			else {
				yield p;
			}
		}
	}

	it("无 *.pem / *private* 文件；PEM 私钥块 header 后无真实密钥体（≥100 base64 字符）", async () => {
		const offenders: string[] = [];
		for await (const p of walk(CLI_ROOT)) {
			const base = p.split("/").pop() ?? p;
			if (/\.pem$/i.test(base) || /private/i.test(base)) {
				offenders.push(`${p}（文件名命中私钥形态）`);
				continue;
			}
			let text: string;
			try {
				text = new TextDecoder().decode(await fsp.readFile(p));
			}
			catch {
				continue; // 二进制等不可解码文件跳过（文件名口径已覆盖）
			}
			// 私钥块实体：header 后跟 ≥100 字符连续 base64（redact 正则无体、测试假体 16 字符均不命中）
			if (/-----BEGIN [A-Z ]*PRIVATE KEY-----\r?\n?[A-Za-z0-9+/=]{100,}/.test(text)) {
				offenders.push(`${p}（PEM 私钥块实体命中）`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
