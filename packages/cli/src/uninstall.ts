// ojm uninstall（P1-15a，缺口 B）：卸载瘦客户端——POST /api/_platform/market/uninstall
// 触发站点侧 runUninstall 四处同删（锁/sidecar/sys_solution_route/modules.json + 权限级联）。
// 本地零状态，纯转发（enable.ts 同款）；operator 由站点侧按登录用户反查，CLI 不传。
import process from "node:process";
import { callApi, login, resolveSite } from "./site";

export interface UninstallOptions {
	url?: string
	user?: string
	pass?: string
	/** 测试注入；缺省 globalThis.fetch */
	fetchFn?: typeof fetch
}

/**
 * 卸载命令体：登录 → POST uninstall {name} → 打印服务端人话 message。
 * ok:false = 域逻辑拒绝（未装/空锁拒启），打印 message 并置 exitCode 1。
 */
export async function uninstallCommand(name: string, opts: UninstallOptions = {}): Promise<void> {
	if (name.trim() === "")
		throw new Error("[ojm] 用法：ojm uninstall <name>——name 为已安装方案名");
	const fetchFn = opts.fetchFn ?? globalThis.fetch;
	const { base, user, pass } = resolveSite(opts);
	const token = await login(fetchFn, base, user, pass);
	const result = await callApi<{ ok: boolean, message: string }>(fetchFn, base, token, "POST", "/api/_platform/market/uninstall", { name: name.trim() });
	console.log(`[ojm] ${result.message}`);
	if (!result.ok)
		process.exitCode = 1;
}
