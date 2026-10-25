// 退出码契约（REG-R12）：0 成功 / 1 业务失败 / 2 用法错误。
//
// 为什么要三档而不是「非零即失败」：CI 里这两类失败的处置完全不同——
//   · 1 = 命令跑通了、但业务说不（包不存在、签名不符、站点拒绝）→ 看输出修数据；
//   · 2 = 命令根本没跑（选项拼错、必需参数缺失、互斥选项同时给）→ 改脚本。
// 混在 1 里，CI 只能靠解析人话文案来分辨，而文案是会改的。
//
// 三类例外的边界（`exitCodeOf`）：
//   · `UsageError` → 2（本文件显式构造的「用法」类错误，含 cac 的未知选项/未知命令）；
//   · 其余一切 Error → 1（业务失败；未预期异常也归这里，不假装是用法问题）；
//   · 成功 → 0（调用方不显式设置，进程自然退 0）。
//
// 纪律：只有**能指出改哪一行命令行**的错误才配 `UsageError`。拿不准就归 1——
// 把业务失败误判成 2 会让 CI 去改脚本，比反过来更难查。

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

/** 用法错误：消息必须是「怎么改命令行」的人话（含正确语法） */
export class UsageError extends Error {
	readonly exitCode = EXIT_USAGE;

	constructor(message: string) {
		super(message);
		this.name = "UsageError";
	}
}

/** 错误 → 退出码（`reportCliError` 与 index.ts 的兜底共用这一个判定） */
export function exitCodeOf(error: unknown): number {
	return error instanceof UsageError ? EXIT_USAGE : EXIT_FAILURE;
}
