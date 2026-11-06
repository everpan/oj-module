/**
 * `ojm market publish` 远端推送（A6）：签名推送 + sig→tgz 顺序 + 错误映射数据表 + 半成功幂等指引。
 *
 * fetch 全 mock：不断真站点、不真推。签名侧用真 Ed25519（generateKeyPair）——
 * 断言推交流程构造的 canonical 可被服务端口径（实收字节重算 sha256）复算验过。
 */

import type { RemotePublishResult } from "../remote-push";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPair } from "../../lifecycle/keygen";
import { verifyCanonical } from "../../lifecycle/sign";
import { discoverMarket, remotePublish, remoteYank } from "../remote-push";

interface RecordedCall {
	url: string
	method: string
	keyId: string
	signature: string
	bytes: Uint8Array
}

/** fetch mock：按 URL 分发响应，记录调用序（sig→tgz 顺序断言用） */
function mockFetch(handler: (call: RecordedCall) => { status: number, body: unknown }) {
	const calls: RecordedCall[] = [];
	const fn = async (input: unknown, init?: { method?: string, headers?: Record<string, string>, body?: unknown }) => {
		const url = String(input);
		const headers = init?.headers ?? {};
		const form = init?.body as FormData | undefined;
		const file = typeof form?.get === "function" ? form.get("file") as Blob | null : null;
		const call: RecordedCall = {
			url,
			method: init?.method ?? "GET",
			keyId: headers["x-ojm-key-id"] ?? "",
			signature: headers["x-ojm-signature"] ?? "",
			bytes: file != null
				? new Uint8Array(await file.arrayBuffer())
				: typeof init?.body === "string" ? new TextEncoder().encode(init.body) : new Uint8Array(),
		};
		calls.push(call);
		const r = handler(call);
		return new Response(JSON.stringify({ code: r.status === 200 ? 0 : r.status, msg: r.status === 200 ? "ok" : String((r.body as { message?: string }).message ?? "err"), data: r.status === 200 ? r.body : undefined }), { status: r.status });
	};
	return { fn: fn as typeof fetch, calls };
}

const SITE = "http://127.0.0.1:9778";

let root: string;
let kp: ReturnType<typeof generateKeyPair>;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "ojm-remote-push-"));
	kp = generateKeyPair();
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("discoverMarket（catalog 探测：registry_id 发现 + 旧站点人话）", () => {
	it("200 + registry_id → 解析出站点身份", async () => {
		const { fn } = mockFetch(() => ({ status: 200, body: { api_version: "v1", registry_id: "site.registry" } }));
		const d = await discoverMarket(fn, SITE);
		expect(d.registryId).toBe("site.registry");
		expect(d.apiVersion).toBe("v1");
	});

	it("registry_id = null → 人话报错指向 vars.registry_id（推送canonical首段必需）", async () => {
		const { fn } = mockFetch(() => ({ status: 200, body: { api_version: "v1", registry_id: null } }));
		await expect(discoverMarket(fn, SITE)).rejects.toThrow(/registry_id/);
	});

	it("catalog API 404 → 「站点版本过旧」人话 + 迁移指南指向（2×2 矩阵新 CLI×旧站点格）", async () => {
		const { fn } = mockFetch(() => ({ status: 404, body: { message: "not found" } }));
		await expect(discoverMarket(fn, SITE)).rejects.toThrow(/版本过旧/);
	});

	it("网络层失败 → 人话（不抛原生 fetch 错）", async () => {
		const fn = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
		await expect(discoverMarket(fn, SITE)).rejects.toThrow(/连不上|无法访问|fetch failed/);
	});
});

describe("remotePublish（签名推送：sig→tgz 顺序 + canonical 口径）", () => {
	it("先推 .sig 旁车再推 tgz（pair 约束：sig 先 tgz 后）；canonical 按实收字节重算口径可验签", async () => {
		const { fn, calls } = mockFetch(() => ({ status: 200, body: { api_version: "v1", registry_id: "site.registry" } }));
		const r: RemotePublishResult = await remotePublish({
			projectRoot: root,
			fixture: "demo-solution@0.1.0",
			siteUrl: SITE,
			id: "test.publisher",
			privateKeyPem: kp.privateKeyPem,
			registryId: "pub.registry",
			fetchFn: fn,
		});
		expect(calls).toHaveLength(3); // catalog 探测 + sig + tgz
		expect(calls[0]!.url).toBe(`${SITE}/api/oj-market/catalog?page=1&size=1`);
		expect(calls[1]!.url).toContain("/api/oj-market/cdn/upload?name=");
		expect(calls[1]!.url).toContain(encodeURIComponent(".tgz.sig"));
		expect(calls[2]!.url).toContain(encodeURIComponent(".tgz"));
		expect(calls[2]!.url).not.toContain(".sig");
		// 每请求签名 canonical = cdn-upload:<站点 registry_id>:<文件名>:<实收字节 sha256>（服务端重算口径）
		for (const call of calls.slice(1)) {
			const file = decodeURIComponent(call.url.split("name=")[1]!);
			const sha256 = createHash("sha256").update(call.bytes).digest("hex");
			const canonical = `cdn-upload:site.registry:${file}:${sha256}`;
			expect(call.keyId).toBe("test.publisher");
			expect(verifyCanonical(kp.publicKeyHex, canonical, call.signature)).toBe(true);
		}
		// 包内 manifest 与文件名一致（服务端 400 钳制的前置自检面）
		expect(r.name).toBe("demo-solution");
		expect(r.version).toBe("0.1.0");
		expect(r.registryId).toBe("site.registry");
		expect(r.keyId).toBe("test.publisher");
	});

	it("缺 --site-url 且环境变量无 → 人话报错（不猜默认站点）", async () => {
		const { fn } = mockFetch(() => ({ status: 200, body: {} }));
		const old = process.env.OJM_SITE_URL;
		delete process.env.OJM_SITE_URL;
		try {
			await expect(remotePublish({ projectRoot: root, id: "test.publisher", privateKeyPem: kp.privateKeyPem, registryId: "pub.registry", fetchFn: fn }))
				.rejects
				.toThrow(/--site-url/);
		}
		finally {
			if (old !== undefined)
				process.env.OJM_SITE_URL = old;
		}
	});
});

describe("remotePublish 错误映射数据表（401/403/409/413 + 半成功幂等指引）", () => {
	async function pushWith(status: number, message: string, failAt: "sig" | "tgz" = "tgz") {
		const { fn } = mockFetch(call => (call.url.includes("/cdn/upload") && (failAt === "sig") === call.url.includes(".sig")
			? { status, body: { message } }
			: { status: 200, body: { api_version: "v1", registry_id: "site.registry" } }));
		return await remotePublish({
			projectRoot: root,
			fixture: "demo-solution@0.1.0",
			siteUrl: SITE,
			id: "test.publisher",
			privateKeyPem: kp.privateKeyPem,
			registryId: "pub.registry",
			fetchFn: fn,
		});
	}

	it.each([
		[401, "签名验签失败：服务端按实收字节重算 sha256 重构 canonical 验签——字节被换、registry 身份不符或签名无效，已拒（401）", /签名验签失败/],
		[403, "发布 key「test.publisher」不在本站点信任库——请站点 superadmin 经市场信任确认（或 ojm trust add）入录后重试", /信任库/],
		[409, "「demo-solution@0.1.0」已存在且字节不一致——同一版本号只允许一份字节，请升 version 重发", /升 version/],
		[413, "上传体积超过上限", /体积|413/],
	] as const)("%i → 人话映射（含下一步指引）", async (status, message, pattern) => {
		await expect(pushWith(status, message)).rejects.toThrow(pattern);
	});

	it("sig 已推、tgz 被拒（半成功）→ 错误文案含「重跑本命令幂等补齐」", async () => {
		await expect(pushWith(409, "「demo-solution@0.1.0」已存在且字节不一致——同一版本号只允许一份字节", "tgz"))
			.rejects
			.toThrow(/重跑本命令幂等补齐/);
	});

	describe("remoteYank（签名下线：market-yank canonical + 发布者授权面）", () => {
		it("canonical = market-yank:<站点 registry>:<product>:<version> 可验签；body 携带 reason/by/restore", async () => {
			const { fn, calls } = mockFetch(call => (call.url.includes("/cdn/upload")
				? { status: 404, body: { message: "n/a" } }
				: call.url.includes("/yank")
					? { status: 200, body: { ok: true, product: "demo-solution", version: "0.1.0", yanked: true } }
					: { status: 200, body: { api_version: "v1", registry_id: "site.registry" } }));
			const r = await remoteYank({
				siteUrl: SITE,
				name: "demo-solution",
				version: "0.1.0",
				reason: "有严重缺陷",
				by: "release-ops",
				id: "test.publisher",
				privateKeyPem: kp.privateKeyPem,
				fetchFn: fn,
			});
			expect(calls).toHaveLength(2); // catalog 探测 + yank POST
			const yank = calls[1]!;
			expect(yank.url).toBe(`${SITE}/api/oj-market/yank`);
			expect(yank.method).toBe("POST");
			expect(verifyCanonical(kp.publicKeyHex, "market-yank:site.registry:demo-solution:0.1.0", yank.signature)).toBe(true);
			const body = JSON.parse(new TextDecoder().decode(yank.bytes)) as Record<string, unknown>;
			expect(body).toMatchObject({ product: "demo-solution", version: "0.1.0", reason: "有严重缺陷", by: "release-ops" });
			expect(body.restore).toBeUndefined();
			expect(r).toMatchObject({ product: "demo-solution", version: "0.1.0", yanked: true });
		});

		it("restore 形态 body 带 restore:true；服务端 403（非发布者）→ 人话透出", async () => {
			const { fn } = mockFetch(call => (call.url.includes("/yank")
				? { status: 403, body: { message: "key「test.publisher」不是「demo-solution@0.1.0」的发布者" } }
				: { status: 200, body: { api_version: "v1", registry_id: "site.registry" } }));
			await expect(remoteYank({
				siteUrl: SITE,
				name: "demo-solution",
				version: "0.1.0",
				restore: true,
				id: "test.publisher",
				privateKeyPem: kp.privateKeyPem,
				fetchFn: fn,
			})).rejects.toThrow(/发布者/);
		});
	});

	it("幂等重入：服务端返回 idempotent → 视为成功不重抛", async () => {
		const { fn, calls } = mockFetch(call => (call.url.includes("/cdn/upload")
			? { status: 200, body: { ok: true, idempotent: true } }
			: { status: 200, body: { api_version: "v1", registry_id: "site.registry" } }));
		await remotePublish({
			projectRoot: root,
			fixture: "demo-solution@0.1.0",
			siteUrl: SITE,
			id: "test.publisher",
			privateKeyPem: kp.privateKeyPem,
			registryId: "pub.registry",
			fetchFn: fn,
		});
		expect(calls).toHaveLength(3);
	});
});
