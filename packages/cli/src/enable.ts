// ojm enable/disable（P1-13，D8）：生命周期开关瘦客户端——POST /api/_platform/market/enable
// 触发站点侧 setEnabled 四处同写（锁/sidecar/route/modules.json，D12）。本地零状态，纯转发。
import process from "node:process";
import { callApi, login, resolveSite } from "./site";

export interface EnableOptions {
	siteUrl?: string
	user?: string
	pass?: string
	/** 测试注入；缺省 globalThis.fetch */
	fetchFn?: typeof fetch
}

/**
 * 启用/禁用命令体：登录 → POST enable {name, enabled} → 打印服务端人话 message。
 * ok:false = 域逻辑拒绝（未装/空锁拒启/版本目录缺失），打印 message 并置 exitCode 1。
 */
export async function setEnabledCommand(name: string, enabled: boolean, opts: EnableOptions = {}): Promise<void> {
	if (name.trim() === "")
		throw new Error("[ojm] 用法：ojm enable|disable <name>——name 为已安装方案名");
	const fetchFn = opts.fetchFn ?? globalThis.fetch;
	const { base, user, pass } = resolveSite(opts);
	const token = await login(fetchFn, base, user, pass);
	const result = await callApi<{ ok: boolean, message: string }>(fetchFn, base, token, "POST", "/api/_platform/market/enable", { name: name.trim(), enabled });
	console.log(`[ojm] ${result.message}`);
	if (!result.ok)
		process.exitCode = 1;
}
