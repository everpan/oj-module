import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT, TEMPLATE_DIR } from "../helpers/paths";

/**
 * U2：流式响应类型回归（tsc 实证）。
 *
 * 探针文件 templates/src/typecheck-probes/stream-handlers.ts 覆盖
 * json.stream({ fileName, disposition }) + write(string)/write(Uint8Array)
 * 与 json.sse 的同签名 opts——它随 `typecheck:api`（tsc -p src/tsconfig.json）
 * 编译；global.d.ts 一旦退回到旧签名（缺 fileName/disposition、write 只收 string），
 * 本条用例即红。oj 运行时按入参类型分发字节/文本通道（见 devkit api-manual
 * json.stream 条目），探针用的每个形态均为运行时合法用法。
 * CI 不跑 templates 的 typecheck 脚本，故在此显式拉起 tsc。
 */
/* eslint-disable test/prefer-lowercase-title -- U2 是需求编号锚点，保留大写 */

const tscBin = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsc");

describe("U2：模板 global.d.ts 流式类型与 oj devkit 对齐", () => {
	it("typecheck:api 对文本流 + 二进制流探针零报错", () => {
		expect(() =>
			execFileSync(tscBin, ["--noEmit", "-p", "src/tsconfig.json"], { cwd: TEMPLATE_DIR, stdio: "pipe" }),
		).not.toThrow();
	});
});
