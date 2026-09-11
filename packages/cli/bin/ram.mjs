#!/usr/bin/env node

// 弃用别名（设计 §7 R1）：命令 `ram` 已更名为 `ojm`。本 shim 让存量工程
// scripts 里的 `ram dev` 平滑可用——打印更名警告后原地转发到 ojm 入口，
// 下个 major 移除。诊断输出走 stderr，不污染子命令 stdout。
console.warn("[ojm] ⚠️ 命令 `ram` 已更名为 `ojm`，本别名将在下个 major 移除；请把 scripts 中的 ram 改为 ojm。");
await import("./ojm.mjs");
