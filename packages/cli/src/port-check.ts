import net from "node:net";

/**
 * 探测某端口是否已被占用（即有进程在监听）。
 *
 * 用于 `ojm dev` 启动前的后端端口预检：若 oj 的目标端口已被（通常是上次未正常
 * 退出、遗留的）oj 孤儿进程占据，提前给出清晰提示并禁止启动，避免 oj 健康检查
 * 超时后才以晦涩信息失败。
 *
 * 探测方式：本进程尝试在该端口上 `listen`——
 *   - `EADDRINUSE` → 端口已被占用，返回 true；
 *   - 绑定成功 → 端口空闲，立即释放并返回 false；
 *   - 其它错误（如权限）→ 无法确认占用，保守返回 false（宁可放行，不让带病禁止）。
 *
 * 不用「TCP connect 探活」：某些环境下连向空闲端口的连接会被静默丢弃（既不 RST 也
 * 不 SYN-ACK），导致探测挂起并以「保守判占用」告终，从而误杀每一次 ojm dev 启动。
 * bind 探测同步返回，绝不挂起。
 */
export function isPortOccupied(port: number, host = "127.0.0.1"): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = net.createServer();
		let settled = false;
		const done = (occupied: boolean) => {
			if (settled)
				return;
			settled = true;
			resolve(occupied);
		};
		probe.once("error", (err: NodeJS.ErrnoException) => {
			// EADDRINUSE = 端口确被占用；其余（EACCES 等）无法确认，保守放行
			done(err.code === "EADDRINUSE");
		});
		probe.listen(port, host, () => {
			// 能绑定说明空闲：立即释放后返回 false
			probe.close(() => done(false));
		});
	});
}
