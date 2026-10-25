// `--json` 输出契约（REG-R12）：stdout 只放**一份**可解析的 JSON，人话改走 stderr。
//
// 信封字段固定（CI 靠字段分支，不解析文案）：
//   ok       boolean   成功与否（与退出码 0/1 一一对应；用法错误=2 时 stdout 可能为空）
//   command  string    命令名（`publish` / `config ls`）——一条流水线里多个 ojm 调用靠它归因
//   code     string    稳定错误码（成功恒为 `"ok"`；失败是 `index_generation_mismatch` 这类机器码）
//   message  string    人话（可以改，不该被程序依赖）
//   data     object    命令专属载荷（成功时的结果；失败时为 null）
//
// 为什么不把「人话行」也塞进 JSON 数组：它们会随文案改动而变，混进机器通道等于让 CI 依赖文案。
// 所以 `--json` 下人类提示统一走 stderr——终端里照样看得见，管道里却不会污染 stdout。
//
// 稳定性纪律（验收「`--json` 输出稳定字段」）：本文件导出的字段名即契约，
// 加字段可以、改名/删字段必须当成破坏性变更（下游有 schema 断言）。

export interface CliEnvelope<T> {
	ok: boolean
	command: string
	code: string
	message: string
	data: T | null
}

export const OK_CODE = "ok";

export function okEnvelope<T>(command: string, data: T, message = OK_CODE): CliEnvelope<T> {
	return { ok: true, command, code: OK_CODE, message, data };
}

export function failEnvelope(command: string, code: string, message: string): CliEnvelope<never> {
	return { ok: false, command, code, message, data: null };
}

export interface EmitIo {
	/** `--json`：stdout 只放信封，人话改走 stderr */
	json?: boolean
}

/** 命令的一次输出计划：机器通道（信封）+ 人类通道（逐行） */
export interface EmitPlan<T> {
	command: string
	/** 机器码（成功 = `"ok"`） */
	code?: string
	message?: string
	data: T | null
	/** 人类可读行（不带 `[ojm]` 前缀的由调用方自己带；空数组 = 没有可读输出） */
	human?: string[]
}

export interface EmitStreams {
	out: (line: string) => void
	err: (line: string) => void
}

const DEFAULT_STREAMS: EmitStreams = {
	out: line => console.log(line),
	err: line => console.error(line),
};

/**
 * 按模式输出：人类通道恒发（json 下改 stderr），机器通道仅在 `--json` 下发。
 * 信封**单行** JSON——多行也能解析，但单行让 `jq -r` 与逐行 grep 都省事。
 */
export function emit<T>(plan: EmitPlan<T>, io: EmitIo = {}, streams: EmitStreams = DEFAULT_STREAMS): CliEnvelope<T | null> {
	const code = plan.code ?? OK_CODE;
	const message = plan.message ?? (code === OK_CODE ? "ok" : "");
	// 失败分支的 data 恒为 null：命令没跑完，半份载荷比没有更危险
	const envelope: CliEnvelope<T | null> = code === OK_CODE
		? okEnvelope<T | null>(plan.command, plan.data, message)
		: failEnvelope(plan.command, code, message);
	const human = plan.human ?? [];
	if (io.json) {
		for (const line of human)
			streams.err(line);
		streams.out(JSON.stringify(envelope));
		return envelope;
	}
	for (const line of human)
		streams.out(line);
	return envelope;
}
