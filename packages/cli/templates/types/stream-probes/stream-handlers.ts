// U2 类型回归探针：钉住 global.d.ts 的流式响应类型与 oj 运行时/devkit 对齐。
//
// 本文件**不是路由**（oj 只认 `api.ts`/`ws.ts` 为端点），也不是 src/ 下的模块
// （ojm api --check 要求 src/<dir> 至少一侧是模块，不能放 src 内）；放在 types/
// 是因为 api 侧 tsconfig（src/tsconfig.json）已 include "../types" 而 web 侧没有——
// 恰好只被 typecheck:api 覆盖（见根 tests/cli/typecheck-coverage.test.ts 的并/交不变量）。
// global.d.ts 的
// stream/sse opts 或 StreamWriter.write 一旦被改回旧签名（缺 fileName/disposition、
// write 不收 Uint8Array），本文件即产生 TS 错误。tests/templates/ 下的
// stream-types 用例负责在 CI 里真正跑这次 tsc。
// 探针刻意同时覆盖：文本流（string 通道）与二进制流（Uint8Array 字节通道）。

// 文本流：CSV 导出——status/contentType/fileName/disposition 全量使用
export function probeTextStream(): void {
	const writer = json.stream({ status: 200, contentType: "text/csv", fileName: "report.csv", disposition: "attachment" });
	writer.write("a,b\n");
	writer.write("1,2\n");
	writer.end();
}

// 二进制流：附件下载——非 ASCII 文件名 + 字节通道
export function probeBinaryStream(bytes: Uint8Array): void {
	const writer = json.stream({ contentType: "application/octet-stream", fileName: "导出.zip" });
	writer.write(bytes);
	writer.end();
}

// 内联展示 + SSE 的 fileName/disposition 透传（oj devkit 同签名）
export function probeInlineAndSse(): void {
	json.stream({ contentType: "image/png", fileName: "图.png", disposition: "inline" }).end();
	const sse = json.sse({ heartbeatSecs: 5, fileName: "events.txt", disposition: "attachment" });
	sse.write("tick");
	sse.end();
}
