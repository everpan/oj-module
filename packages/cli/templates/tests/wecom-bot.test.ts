// L1 回归（oj test 收集，*.test.ts）：企微普通模式 MCP 代理 + 服务凭据有效期契约。
//
// 覆盖方案 §9 P5 中可在本仓、进程内、不依赖真企微的部分：
//   ② 代理自守卫：缺 Bearer → 401；tools/call 缺 X-WeCom-User-Id → 400（fail-closed）。
//   ⑨ obo 换签失败映射为 JSON-RPC error（HTTP 200，不破坏 MCP 帧）：
//        - 40310 未绑定员工；
//        - 40312 非 svc 凭据（用 access token 代员工换签，被 roles 双查拦下）；
//        - 40311 已吊销（svc jti 被删，网关 fail-closed 直拒 403，不进 handler）。
//   ⑪ ttl_days 契约：0 → 长期固定 90d；>0 → 对应天数；>90 → 被 schema 拒（400）。
//
// 不在本自动化的部分（属放行门交接 / 真企微联调）：
//   - initialize/ping/tools/list 经发现身份直转 /api/mcp 的透传（200 帧）：/api/mcp 是 oj 内置
//     Streamable-HTTP 端点，进程内 bridge.call + arrayBuffer 会挂在 SSE 流上，无法在 oj test
//     稳定断言；K4/K3（握手逐 method / 202 空体 / 406·415 信封）同理，留真机验证。
//
// 鉴权约束：config 开启 require_signed_claim（强绑定），svc token 入站 /wecom-bot/mcp 须带
// X-TENANT-ID 等于其 claims.tenant；该 tenant 由签发者（l1tester）access token claim 推导，
// 故测试统一从 L1 登录 token 解 claims.tenant 回填 X-TENANT-ID（不臆测 "default"）。
// 网关另要求 /wecom-bot/mcp 具 write scope，故 svc token 须签 write 档。
//
// 登录账号：fixtures 的 l1tester（superadmin，满足 assertSystemAdmin）。
// 运行：oj test --module-root src -c config.yaml

const L1 = { username: "l1tester", password: "l1test1234" };
const DAY = 86400;

/** 从 access token 解出其 claims.tenant（svc token 的 tenant 由同一 claim 推导，强绑定对照源）。 */
function decodeTenant(token: string): string {
	try {
		// JWT payload 是 base64url（含 - / _），atob 只认标准 base64，需先转义并补齐 padding。
		const part = token.split(".")[1] ?? "";
		const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
		const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
		const dec = JSON.parse(atob(pad));
		return dec?.claims?.tenant ?? dec?.tenant ?? "default";
	}
	catch {
		return "default";
	}
}

/**
 * 运行时能力前置：换签用例必须走 bridge.call（进程内 dispatch），该全局自 **oj 0.1.131** 才有。
 *
 * 低于该版本时 handler 调用即抛，HTTP 落到 500——只看 "expected 200 but got 500" 看不出根因，
 * 所以先点名：失败信息本身就是答案（§11 U9：@oj-bin/oj npm latest 仍 0.1.130）。
 */
function requireBridge(): void {
	if (typeof bridge !== "object") {
		throw new TypeError(
			"wecom-bot 代理的 tools/call 依赖 oj >= 0.1.131 的 bridge.call（进程内 dispatch）；"
			+ `当前 runtime 的 typeof bridge = ${typeof bridge}（0.1.130 无此全局）——`
			+ "先 ojm vendor v0.1.131+ 再跑本组用例（手册 §11 U9）",
		);
	}
}

async function loginAsL1(): Promise<{ token: string, tenant: string }> {
	const token = await client.login(L1.username, L1.password);
	return { token, tenant: decodeTenant(token) };
}

/**
 * 以 l1tester 签一张本租户 svc token（方案 §4.1 自助形态），返回 jti、明文 Bearer 与同源 tenant。
 *  网关强校验：/wecom-bot/mcp 要求 write scope（机器人代用户执行 tools/call 属写面）。
 */
async function issueSvc(ttlDays?: number, scopes: string[] = ["write"]): Promise<{ jti: string, bearer: string, tenant: string }> {
	const { token, tenant } = await loginAsL1();
	const r = await client.post("/system/service-token", {
		headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ name: `wecom-bot-p5-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, scopes, ttl_days: ttlDays }),
	});
	expect(r.status).toBe(200);
	const data = JSON.parse(r.body).data as { jti: string, token: string };
	return { jti: data.jti, bearer: `Bearer ${data.token}`, tenant };
}

/** 吊销一张 svc token（删登记行 = 核销真相源；最长 30s 全网失效）。 */
async function revokeSvc(jti: string): Promise<void> {
	const { token } = await loginAsL1();
	const r = await client.del(`/system/service-token?jti=${encodeURIComponent(jti)}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(r.status).toBe(200);
}

// 共享一张 svc token（懒初始化，仅首测签发一次）：避免单 run 内反复签发触发网关
// SvcGate 对多 token 的态/登录节流，导致后签的 token 偶发 "revoked or unverifiable"。
let _svc: Promise<{ jti: string, bearer: string, tenant: string }> | null = null;
function sharedSvc(): Promise<{ jti: string, bearer: string, tenant: string }> {
	if (!_svc)
		_svc = issueSvc(0);
	return _svc;
}

describe("wecom-bot 代理：自守卫（fail-closed）", () => {
	it("缺 Bearer → 401", async () => {
		const r = await client.post("/wecom-bot/mcp", {
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
		});
		expect(r.status).toBe(401);
	});

	it("tools/call 缺 X-WeCom-User-Id → 400（唯一强制按用户身份的方法）", async () => {
		const { bearer, tenant } = await sharedSvc();
		const r = await client.post("/wecom-bot/mcp", {
			headers: { "Authorization": bearer, "Content-Type": "application/json", "X-TENANT-ID": tenant },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x", arguments: {} } }),
		});
		expect(r.status).toBe(400);
	});
});

describe("wecom-bot 代理：obo 换签失败映射为 JSON-RPC error（方案 §4.3#6）", () => {
	it("未绑定员工 → 40310 映射（HTTP 200，帧不破）", async () => {
		requireBridge();
		const { bearer, tenant } = await sharedSvc();
		const r = await client.post("/wecom-bot/mcp", {
			headers: { "Authorization": bearer, "Content-Type": "application/json", "X-TENANT-ID": tenant, "X-WeCom-User-Id": "E_P5_UNBOUND_999" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "x", arguments: {} } }),
		});
		expect(r.status).toBe(200); // 映射而非透传 500 信封
		const body = JSON.parse(r.body);
		expect(body.jsonrpc).toBe("2.0");
		expect(body.id).toBe(7);
		expect(body.error).toBeTruthy();
		expect(body.error.code).toBe(-32000);
		expect(String(body.error.message)).toContain("40310");
	});

	it("非 svc 凭据（access token 代员工换签）→ 40312 映射（HTTP 200，帧不破）", async () => {
		requireBridge();
		const { token } = await loginAsL1();
		const r = await client.post("/wecom-bot/mcp", {
			headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "X-WeCom-User-Id": "E_P5_ANYSVC_1" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "x", arguments: {} } }),
		});
		expect(r.status).toBe(200);
		const body = JSON.parse(r.body);
		expect(body.jsonrpc).toBe("2.0");
		expect(body.id).toBe(8);
		expect(body.error).toBeTruthy();
		expect(body.error.code).toBe(-32000);
		expect(String(body.error.message)).toContain("40312");
	});

	it("已吊销 svc（jti 被删）→ 网关 fail-closed 直拒 403（不进 handler）", async () => {
		const { bearer, tenant, jti } = await issueSvc(0);
		await revokeSvc(jti);
		const r = await client.post("/wecom-bot/mcp", {
			headers: { "Authorization": bearer, "Content-Type": "application/json", "X-TENANT-ID": tenant, "X-WeCom-User-Id": "E_P5_REVOKED_1" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "x", arguments: {} } }),
		});
		expect(r.status).toBe(403); // 吊销即失效，网关层拦下
	});
});

describe("service-token：ttl_days 有效期契约（方案 §4.1 Q-B）", () => {
	it("ttl_days=0 → 长期固定 90d；ttl_days=30 → 30d", async () => {
		const a = await issueSvc(0);
		const b = await issueSvc(30);
		const { token } = await loginAsL1();
		const listR = await client.get("/system/service-token", { headers: { Authorization: `Bearer ${token}` } });
		expect(listR.status).toBe(200);
		const rows = JSON.parse(listR.body).data as Array<{ jti: string, created_at: number, expires_at: number }>;
		const ra = rows.find(r => r.jti === a.jti);
		const rb = rows.find(r => r.jti === b.jti);
		expect(ra).toBeTruthy();
		expect(rb).toBeTruthy();
		expect(ra!.expires_at - ra!.created_at).toBe(90 * DAY);
		expect(rb!.expires_at - rb!.created_at).toBe(30 * DAY);
	});

	it("ttl_days=91 → 超过上限 90 被 schema 拒（400）", async () => {
		const { token } = await loginAsL1();
		const r = await client.post("/system/service-token", {
			headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ name: "over-cap", scopes: ["read"], ttl_days: 91 }),
		});
		expect(r.status).toBe(400);
	});

	it("同名重复签发 → 旧行翻 superseded，每 (租户,name) 至多一行 active（轮换语义）", async () => {
		const name = `dup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const { token } = await loginAsL1();
		const issue = async (): Promise<string> => {
			const r = await client.post("/system/service-token", {
				headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ name, scopes: ["write"], ttl_days: 30 }),
			});
			expect(r.status).toBe(200);
			return (JSON.parse(r.body).data as { jti: string }).jti;
		};
		const jti1 = await issue();
		const jti2 = await issue();
		const listR = await client.get("/system/service-token", { headers: { Authorization: `Bearer ${token}` } });
		expect(listR.status).toBe(200);
		const rows = (JSON.parse(listR.body).data as Array<{ jti: string, name: string, status: string }>)
			.filter(r => r.name === name);
		// 两行都在（旧行不删，翻为 superseded），但 active 仅一行且是最新的 jti2。
		expect(rows.length).toBe(2);
		expect(rows.filter(r => r.status === "active").length).toBe(1);
		expect(rows.find(r => r.status === "active")!.jti).toBe(jti2);
		expect(jti1 === jti2).toBe(false); // 两次签发必得不同 jti（expect 无 .not 扩展）
	});
});

describe("bot-cleanup：租户级资源回收（卸载入口）", () => {
	it("confirm 非 true → 400；confirm=true → 清空三表、返回行数且幂等", async () => {
		const { token } = await loginAsL1();
		const auth = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
		// 造数：至少一张凭据 + 一条绑定（cleanup 之前先确认它们存在）。
		const { jti } = await issueSvc(30);
		const bindR = await client.post("/system/bot-binding", {
			headers: auth,
			body: JSON.stringify({ provider: "wecom", external_sub: "E_P5_CLEANUP_1", user_id: "1" }),
		});
		expect(bindR.status).toBe(200);
		const before = JSON.parse((await client.get("/system/service-token", { headers: auth })).body).data as Array<{ jti: string }>;
		expect(before.some(r => r.jti === jti)).toBe(true);

		// 防误触：缺 confirm / confirm=false 都被 schema 拒（恒 true 单值 enum）。
		const noConfirm = await client.post("/system/bot-cleanup", { headers: auth, body: JSON.stringify({}) });
		expect(noConfirm.status).toBe(400);
		const falseConfirm = await client.post("/system/bot-cleanup", { headers: auth, body: JSON.stringify({ confirm: false }) });
		expect(falseConfirm.status).toBe(400);

		// 正常清理：三表计数均为数字，且凭据/绑定清空。
		const r = await client.post("/system/bot-cleanup", { headers: auth, body: JSON.stringify({ confirm: true }) });
		expect(r.status).toBe(200);
		const d = JSON.parse(r.body).data as { svc_tokens: number, bindings: number, audit_rows: number };
		expect(typeof d.svc_tokens).toBe("number");
		expect(d.svc_tokens >= 1).toBe(true);
		expect(d.bindings >= 1).toBe(true);
		expect(typeof d.audit_rows).toBe("number");
		const after = JSON.parse((await client.get("/system/service-token", { headers: auth })).body).data as unknown[];
		expect(after.length).toBe(0);
		const bindAfter = JSON.parse((await client.get("/system/bot-binding", { headers: auth })).body).data as unknown[];
		expect(bindAfter.length).toBe(0);

		// 幂等：再调一次全 0（清空不是一次性令牌）。
		const r2 = await client.post("/system/bot-cleanup", { headers: auth, body: JSON.stringify({ confirm: true }) });
		expect(r2.status).toBe(200);
		const d2 = JSON.parse(r2.body).data as { svc_tokens: number, bindings: number, audit_rows: number };
		expect(d2.svc_tokens).toBe(0);
		expect(d2.bindings).toBe(0);
		expect(d2.audit_rows).toBe(0);
	});
});
