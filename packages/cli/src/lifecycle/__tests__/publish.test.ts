// ojm publish spec（P3-5/6/7，REG-CS5 三级化后）：对发布目录的 catalog.yaml + shards/<n>.yaml
// 重算 → 盖章代次时效 → detached .sig 签名写回 → 离线自检。纯 Node 侧（与 ojm sign 同签名
// 原语 lifecycle/sign.ts），验证侧用 verifyCanonical 复核。
//
// 本文件钉死的不变量：
// ① catalog / shard 两种 kind 的签名各自覆盖 (kind, seq)——换 kind 或换代即失配（REG-CS1）；
// ② 分片代次由 catalog 的 `shards` 钉值承载，逐片与盘上 .sig 交叉核对，对不上不替它签字；
// ③ 落盘顺序固定「先分片 → 再 catalog」（catalog 是提交点，红队 F2 半写防线）；
// ④ 索引写入全仓只有 writeIndexFile 一条路径（源码级不变量，grep 可证）。
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as yamlParse } from "yaml";
import { INDEX_TTL_SECONDS, indexCanonical, publishCommand, recomputeIndex, signIndex } from "../../publish";
import { CANON, verifyCanonical } from "../sign";
import { defaultTestKey } from "./helpers";

/** 首代索引夹具：catalog 钉 1 号片（代次 1），分片持一个方案的一个版本 */
const CATALOG = `shards:
  "1": 1
solutions:
  - name: demo-solution
    shards:
      - 1
`;
const SHARD1 = `solutions:
  - name: demo-solution
    latest: 0.1.0
    versions:
      - version: 0.1.0
        file: demo-solution-0.1.0.tgz
`;

let dir: string;
let keyPath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ojm-publish-"));
	writeFileSync(join(dir, "catalog.yaml"), CATALOG);
	mkdirSync(join(dir, "shards"), { recursive: true });
	writeFileSync(join(dir, "shards", "1.yaml"), SHARD1);
	keyPath = join(dir, "key.pem");
	writeFileSync(keyPath, defaultTestKey().privateKeyPem);
});

afterEach(() => {
	// 临时目录由 OS 回收（测试用 tmpdir，无需手动 rm）
});

/** 读回 catalog 正文（解析后的文档） */
function catalogDoc(): Record<string, unknown> {
	return yamlParse(readFileSync(join(dir, "catalog.yaml"), "utf8")) as Record<string, unknown>;
}

/** 读回某个分片的 .sig（JSON） */
function shardSig(no: number): { seq?: unknown, value: string } {
	return JSON.parse(readFileSync(join(dir, "shards", `${no}.yaml.sig`), "utf8"));
}

describe("ojm publish 索引重算 + 签名（P3-5/6/7，REG-CS5 三级化）", () => {
	it("重算 catalog 与分片并产出 detached .sig，两种 kind 各自可被 verifyCanonical 复核通过", () => {
		const res = publishCommand(dir, { key: keyPath, id: "test.publisher" });
		expect(existsSync(res.catalogSigPath)).toBe(true);
		expect(res.shardPaths).toEqual([join(dir, "shards", "1.yaml")]);
		expect(res.shardSigPaths).toEqual([join(dir, "shards", "1.yaml.sig")]);
		expect(res.keyId).toBe("test.publisher");

		const catalogText = readFileSync(res.catalogPath, "utf8");
		const shard1Text = readFileSync(res.shardPaths[0]!, "utf8");
		const catalogSig = JSON.parse(readFileSync(res.catalogSigPath, "utf8"));
		const sig1 = shardSig(1);

		expect(catalogSig.alg).toBe("Ed25519");
		expect(catalogSig.key_id).toBe("test.publisher");
		expect(catalogSig.canon).toBe(CANON);
		// REG-CS1/CS2：签名覆盖代次——`.sig` 与 catalog 正文各带 seq 且相等；分片代次 = catalog 钉值
		expect(catalogSig.seq).toBe(1);
		expect(sig1.seq).toBe(1);
		expect(catalogDoc().seq).toBe(1);
		// 时效盖进 catalog 正文并由签名锁定（REG-CS2）：有效期 = 全仓唯一的 INDEX_TTL_SECONDS
		const times = catalogDoc() as { issued_at?: unknown, expires_at?: unknown };
		expect(typeof times.issued_at).toBe("number");
		expect(times.expires_at as number - (times.issued_at as number)).toBe(INDEX_TTL_SECONDS);
		// 两种 kind 分别验过（规范串首段就是 kind）
		expect(verifyCanonical(res.publicKeyHex, indexCanonical("catalog", 1, catalogText), catalogSig.value)).toBe(true);
		expect(verifyCanonical(res.publicKeyHex, indexCanonical("shard", 1, shard1Text), sig1.value)).toBe(true);
	});

	it("换代即失效、换 kind 即失效（REG-CS1：签名锁定 (kind, seq)，两代拼不起来）", () => {
		const res = publishCommand(dir, { key: keyPath, id: "test.publisher" });
		const catalogText = readFileSync(res.catalogPath, "utf8");
		const shard1Text = readFileSync(res.shardPaths[0]!, "utf8");
		const catalogSig = JSON.parse(readFileSync(res.catalogSigPath, "utf8"));
		const sig1 = shardSig(1);

		// 换代：同一份正文谎称第 2 代 → 验不过（防「新总目录 + 旧分册」被拼起来用，红队 F2）
		expect(verifyCanonical(res.publicKeyHex, indexCanonical("catalog", 2, catalogText), catalogSig.value)).toBe(false);
		// 换 kind：分片签名不能当 catalog 签名用，反之亦然
		expect(verifyCanonical(res.publicKeyHex, indexCanonical("catalog", 1, shard1Text), sig1.value)).toBe(false);
		expect(verifyCanonical(res.publicKeyHex, indexCanonical("shard", 1, catalogText), catalogSig.value)).toBe(false);
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
		const sig = signIndex("catalog", 7, a, defaultTestKey().privateKeyPem, "test.publisher");
		expect(sig.seq).toBe(7);
		expect(verifyCanonical(defaultTestKey().publicKeyHex, indexCanonical("catalog", 7, a), sig.value)).toBe(true);
	});

	it("补签沿用既有的代次与时效（catalog seq 2 + 分片钉 5：重签不改时效语义）", () => {
		// 第二代索引：catalog 顶层 seq=2、时效是一代签发时刻盖的；1 号片钉第 5 代且盘上 .sig 就是第 5 代
		writeFileSync(join(dir, "catalog.yaml"), `seq: 2\nissued_at: 1000\nexpires_at: ${1000 + INDEX_TTL_SECONDS}\n${CATALOG.replace(/shards:\n {2}"1": 1/, "shards:\n  \"1\": 5")}`);
		writeFileSync(join(dir, "shards", "1.yaml.sig"), `${JSON.stringify(signIndex("shard", 5, recomputeIndex(SHARD1), defaultTestKey().privateKeyPem, "test.publisher"), null, 2)}\n`);

		const res = publishCommand(dir, { key: keyPath, id: "test.publisher" });
		const catalogSig = JSON.parse(readFileSync(res.catalogSigPath, "utf8"));
		expect(catalogSig.seq).toBe(2); // 代次沿用，不重置
		expect(shardSig(1).seq).toBe(5); // 分片代次跟 catalog 钉值，不跟 catalog seq
		const times = catalogDoc() as { issued_at?: unknown, expires_at?: unknown };
		expect(times.issued_at).toBe(1000); // 重签不改时效
		expect(times.expires_at).toBe(1000 + INDEX_TTL_SECONDS);
	});

	it("同内容重复 publish 字节一致（Ed25519 确定性签名 + 键序归一化）", () => {
		const first = publishCommand(dir, { key: keyPath, id: "test.publisher" });
		const catalogA = readFileSync(first.catalogPath);
		const sigA = readFileSync(first.catalogSigPath);
		const shardA = readFileSync(first.shardPaths[0]!);
		const shardSigA = readFileSync(first.shardSigPaths[0]!);

		const second = publishCommand(dir, { key: keyPath, id: "test.publisher" });
		expect(readFileSync(second.catalogPath)).toEqual(catalogA);
		expect(readFileSync(second.catalogSigPath)).toEqual(sigA);
		expect(readFileSync(second.shardPaths[0]!)).toEqual(shardA);
		expect(readFileSync(second.shardSigPaths[0]!)).toEqual(shardSigA);
	});

	it("缺 catalog.yaml → 抛错（不发半成品 .sig）", () => {
		unlinkSync(join(dir, "catalog.yaml"));
		expect(() => publishCommand(dir, { key: keyPath, id: "test.publisher" })).toThrow(/须含 catalog\.yaml/);
	});

	it("catalog 钉了 shards/2.yaml 但文件不存在 → 抛错（钉引用与盘上内容对不上就不签）", () => {
		writeFileSync(join(dir, "catalog.yaml"), "shards:\n  \"1\": 1\n  \"2\": 1\nsolutions:\n  - name: demo-solution\n    shards:\n      - 1\n      - 2\n");
		expect(() => publishCommand(dir, { key: keyPath, id: "test.publisher" })).toThrow(/catalog 钉了 shards\/2\.yaml 但文件不存在/);
	});

	it("分片 .sig 代次与 catalog 钉值不符 → index_generation_mismatch，且什么都不写", () => {
		// 盘上 1 号片签的是第 1 代，catalog 却钉第 2 代——中间态（源正在重建 / 索引被手改）
		writeFileSync(join(dir, "shards", "1.yaml.sig"), `${JSON.stringify(signIndex("shard", 1, recomputeIndex(SHARD1), defaultTestKey().privateKeyPem, "test.publisher"), null, 2)}\n`);
		writeFileSync(join(dir, "catalog.yaml"), CATALOG.replace("\"1\": 1", "\"1\": 2"));
		const catalogBefore = readFileSync(join(dir, "catalog.yaml"));
		const shardBefore = readFileSync(join(dir, "shards", "1.yaml"));

		expect(() => publishCommand(dir, { key: keyPath, id: "test.publisher" })).toThrow(/index_generation_mismatch/);
		// fail-closed 的完整性：拒签时盘上一个字节都没动（没有半代索引落盘）
		expect(readFileSync(join(dir, "catalog.yaml"))).toEqual(catalogBefore);
		expect(readFileSync(join(dir, "shards", "1.yaml"))).toEqual(shardBefore);
		expect(existsSync(join(dir, "catalog.yaml.sig"))).toBe(false);
		expect(existsSync(join(dir, "shards", "1.yaml.sig"))).toBe(true); // 旧签名原样保留（本来就对不上，不擦除证据）
	});

	it("分片 .sig 不可解析 → 抛错（无法核对代次，拒签）", () => {
		writeFileSync(join(dir, "shards", "1.yaml.sig"), "{ not json");
		expect(() => publishCommand(dir, { key: keyPath, id: "test.publisher" })).toThrow(/不可解析/);
	});

	it("私钥缺失 → 抛错（fail-closed，不静默）", () => {
		expect(() => publishCommand(dir, { key: join(dir, "nope.pem"), id: "test.publisher" })).toThrow(/私钥文件不存在/);
	});

	it("原子落盘顺序固定「先分片 → 再 catalog」（catalog 是提交点，红队 F2 半写防线）", () => {
		// 两片夹具：1 号片未签名（首签）、2 号片已有旧签名（补签）
		writeFileSync(join(dir, "shards", "2.yaml"), SHARD1.replace("0.1.0", "0.2.0"));
		writeFileSync(join(dir, "catalog.yaml"), "shards:\n  \"1\": 1\n  \"2\": 4\nsolutions:\n  - name: demo-solution\n    shards:\n      - 1\n      - 2\n");
		writeFileSync(join(dir, "shards", "2.yaml.sig"), `${JSON.stringify(signIndex("shard", 4, recomputeIndex(readFileSync(join(dir, "shards", "2.yaml"), "utf8")), defaultTestKey().privateKeyPem, "test.publisher"), null, 2)}\n`);

		const landed: string[] = [];
		const origRename = fs.renameSync.bind(fs);
		const spy = vi.spyOn(fs, "renameSync").mockImplementation(((...args: Parameters<typeof fs.renameSync>) => {
			landed.push(join(String(args[0])).split("/").pop()!.replace(/\.tmp\..*$/, "")); // 记录落盘目标名（剥掉 tmp 后缀）
			return origRename(...args);
		}) as typeof fs.renameSync);
		try {
			publishCommand(dir, { key: keyPath, id: "test.publisher" });
		}
		finally {
			spy.mockRestore();
		}
		// 全部分片（正文 + 签名）落完后才落 catalog（正文 + 签名）——catalog 一变即新代生效，
		// 它钉的片必须早已在盘上；顺序反了就会开出「catalog 钉了不存在的片」的窗口
		expect(landed).toEqual(["1.yaml", "1.yaml.sig", "2.yaml", "2.yaml.sig", "catalog.yaml", "catalog.yaml.sig"]);
	});

	it("索引写入只有 writeIndexFile 一条路径（源码级不变量，grep 可证）", () => {
		const srcOf = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
		const countOf = (text: string, re: RegExp) => text.split("\n").filter(line => re.test(line)).length;
		// 生成侧：publish.ts 里唯一的 fs.writeFileSync 就在 writeIndexFile 体内（tmp+rename）；
		// build-index.ts 零直写——索引文件全部经唯一写入口
		expect(countOf(srcOf("../../publish.ts"), /fs\.writeFileSync/)).toBe(1);
		expect(countOf(srcOf("../../publish.ts"), /appendFileSync/)).toBe(0);
		expect(countOf(srcOf("../../market/build-index.ts"), /fs\.writeFileSync|writeFileSync\(/)).toBe(0);
		expect(countOf(srcOf("../../market/build-index.ts"), /appendFileSync/)).toBe(0);
		// 全仓其余直写只剩 walkthrough 的负向演练：往 catalog 追加重码标记（drill 本身），
		// 且回抄恢复走 writeIndexFile——除这一行 deliberate tamper 外没有第二个索引直写点
		const walkthrough = srcOf("../../market/walkthrough.ts");
		expect(countOf(walkthrough, /appendFileSync/)).toBe(1);
		expect(countOf(walkthrough, /# tampered/)).toBe(1);
		expect(countOf(walkthrough, /writeIndexFile\(catalog/)).toBe(1);
	});
});
