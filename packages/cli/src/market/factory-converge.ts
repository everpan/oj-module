// 出厂即装触发（支柱三，2026-11-07；2026-11-10 token 化）：服务端 isolate 无 setTimeout（wecom/client.ts
// 同结论）、oj boot 有 2s 看门狗（安装全程不可在 boot 内跑）——随站 bundle 收敛只能
// riding 首个编排 API 请求。「市场方案默认安装好」要求零首装仪式：ojm dev / ojm preview
// 后端就绪后由 CLI 侧 fire-and-forget 触发一次 POST /oj-market/converge（头
// x-ojm-converge-token；token 由调用方启动时随机生成并经派生 config vars.ojm_converge_token
// 注入服务端——替代早期账密登录：密码被改则登录 401 被吞咽，零首装仪式静默失效）。
// 安装在服务端完成（含 DB 注册面），CLI 无法替代；收敛幂等（已对齐即全 skip）。
// 失败一律吞咽不抛——不阻断 dev/preview 启动，留给首个真实请求或下次启动再对账。

export interface FactoryConvergeOptions {
	/** oj 后端端口 */
	port: number
	/** api 挂载前缀（跟随 config 的 mounts:；缺省 /api） */
	apiBase?: string
	host?: string
	/** 一次性收敛令牌（启动时随机生成；与服务端 vars.ojm_converge_token 同值） */
	token: string
	/** 测试注入 fetch；缺省全局 fetch */
	fetchImpl?: typeof fetch
	/** 观测日志（缺省静默） */
	log?: (msg: string) => void
}

export async function triggerFactoryConverge(opts: FactoryConvergeOptions): Promise<void> {
	const apiBase = (opts.apiBase ?? "/api").replace(/\/+$/, "");
	const base = `http://${opts.host ?? "127.0.0.1"}:${opts.port}`;
	const f = opts.fetchImpl ?? fetch;
	const log = opts.log ?? (() => {});
	try {
		// 强绑定（require_signed_claim: true）：converge 是无 token 匿名链路（已列
		// tenant.anonymous_paths），CLI 侧持有型证明走 x-ojm-converge-token；若再带
		// X-TENANT-ID 而无匹配 signed claim 会被 403。故不注租户头——与运行时
		// isTenantlessApi 对 /oj-market/converge 的豁免对齐，后端按匿名路径自行决租户。
		const res = await f(`${base}${apiBase}/oj-market/converge`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-ojm-converge-token": opts.token },
		});
		if (!res.ok)
			throw new Error(`converge HTTP ${res.status}`);
		log("[ojm] 出厂对账已触发（随站 bundle 收敛 riding converge，幂等）");
	}
	catch (error) {
		// 吞咽：后端半就绪/网络错/端点 404（生产形态无 token var）都不该阻断 dev/preview——下次对账再试
		log(`[ojm] 出厂对账触发失败（不阻断启动，下次对账再试）：${error instanceof Error ? error.message : String(error)}`);
	}
}
