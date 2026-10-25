// ojm uninstall（P1-15a，缺口 B）：卸载瘦客户端——POST /api/_platform/market/uninstall
// 触发站点侧 runUninstall 四处同删（锁/sidecar/sys_solution_route/modules.json + 权限级联）。
// 本地零状态，纯转发（enable.ts 同款）；operator 由站点侧按登录用户反查，CLI 不传。
//
// REG-R12 / Q7：**不接 `--registry`**。卸载是站点侧操作——包已经在站点上了，
// 「从哪个仓库来」既不影响删除范围也不影响权限级联；接一个读了不用的 flag，
// 只会让人以为「指定源就只卸那个源的包」。所以看到 `--registry` 一律报错（exit 2），
// 并顺带把「该包来自本站点」讲明白。
import process from "node:process";
import { UsageError } from "./exit-codes";
import { callApi, login, resolveSite } from "./site";

export interface UninstallOptions {
	url?: string
	user?: string
	pass?: string
	/** 仅为**拒绝**而存在（Q7）：给了即用法错误，不读、不传、不影响结果 */
	registry?: string
	/** 测试注入；缺省 globalThis.fetch */
	fetchFn?: typeof fetch
}

/**
 * 卸载命令体：登录 → POST uninstall {name} → 打印服务端人话 message。
 * ok:false = 域逻辑拒绝（未装/空锁拒启），打印 message 并置 exitCode 1。
 */
export async function uninstallCommand(name: string, opts: UninstallOptions = {}): Promise<void> {
	// 先拦 --registry：还没联网就该失败，且要说清「为什么这个 flag 不存在」
	if (opts.registry !== undefined)
		throw new UsageError("[ojm] uninstall 不接 --registry：卸载不涉及仓库源——包已经在站点上，来源不影响删除范围（去掉 --registry 即可）");
	if (name.trim() === "")
		throw new UsageError("[ojm] 用法：ojm uninstall <name>——name 为已安装方案名");
	const fetchFn = opts.fetchFn ?? globalThis.fetch;
	const { base, user, pass } = resolveSite(opts);
	const token = await login(fetchFn, base, user, pass);
	console.log(`[ojm] 该包来自站点 ${base} 的已装清单（卸载不涉及仓库源）`);
	const result = await callApi<{ ok: boolean, message: string }>(fetchFn, base, token, "POST", "/api/_platform/market/uninstall", { name: name.trim() });
	console.log(`[ojm] ${result.message}`);
	if (!result.ok)
		process.exitCode = 1;
}
