// 出厂即装触发（支柱三，2026-11-07）：服务端 isolate 无 setTimeout（wecom/client.ts
// 同结论）、oj boot 有 2s 看门狗（安装全程不可在 boot 内跑）——随站 bundle 收敛只能
// riding 首个编排 API 请求（index 端点「对账即服务」）。「市场方案默认安装好」要求
// 零首装仪式：ojm dev / ojm preview 后端就绪后由 CLI 侧 fire-and-forget 触发一次
// （login → GET index）。安装在服务端完成（含 DB 注册面），CLI 无法替代；
// 收敛幂等（已对齐即全 skip）。失败一律吞咽不抛——不阻断 dev/preview 启动，
// 留给首个真实请求或下次启动再对账。

export interface FactoryConvergeOptions {
	/** oj 后端端口 */
	port: number
	/** api 挂载前缀（跟随 config 的 mounts:；缺省 /api） */
	apiBase?: string
	host?: string
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
		const login = await f(`${base}${apiBase}/auth/login`, {
			method: "POST",
			headers: { "content-type": "application/json", "X-TENANT-ID": "default" },
			body: JSON.stringify({ username: "superadmin", password: "aA123456" }),
		});
		if (!login.ok)
			throw new Error(`login HTTP ${login.status}`);
		const envelope = await login.json() as { code?: unknown, data?: { access_token?: unknown } };
		if (envelope.code !== 0 || typeof envelope.data?.access_token !== "string")
			throw new Error("login 信封异常（code≠0 或缺 access_token）");
		const index = await f(`${base}${apiBase}/oj-market/index`, {
			headers: { "authorization": `Bearer ${envelope.data.access_token}`, "X-TENANT-ID": "default" },
		});
		if (!index.ok)
			throw new Error(`index HTTP ${index.status}`);
		log("[ojm] 出厂对账已触发（随站 bundle 收敛 riding index，幂等）");
	}
	catch (error) {
		// 吞咽：登录节流/后端半就绪/网络错都不该阻断 dev/preview——下次对账再试
		log(`[ojm] 出厂对账触发失败（不阻断启动，下次对账再试）：${error instanceof Error ? error.message : String(error)}`);
	}
}
