# ojm CLI 反常识行为修正（cac 全面化收尾）

- 日期：2026-10-23 09:37
- 分支：fix/ojm-cli-ux-quirks
- 状态：已完成（2026-10-23 09:55）

## 需求

上一期（20261023-0848-ojm-cac-bilingual）全面 cac 化后遗留的用户可见反常识行为，本期修正：

1. **未知命令 + `--help`**：`ojm nope --help` / `ojm help nope` 打顶层帮助退 0——未知命令应报「未知命令」exit 1（重构前语义）。
2. **cac 未知选项报错未本地化**：`ojm build --foo` 抛英文裸 `Unknown option `--foo``（无 `[ojm]` 前缀、无修复指引）。
3. **`command:*` 误判的判定方式**：现靠 `cli.options.help` 过滤（workaround），改为按「首位置参数是否已知命令」判定——`ojm market verify --help`（首参 market 已知）不误判，`ojm nope --help`（首参未知）正确报错。

非目标：cac 库自身的内部实现（outputHelp 走 console.log、variadic 语法点在前）是上游行为，仅在工作区绕过，不改库。

## 方案

- usage.ts：导出 `isKnownCommand(name)`（COMMANDS 首段匹配）。
- cli.ts：导出 `unknownCommandResult(cmd, lang, helpRequested)`（纯函数：help 形态 →  localized 错误行 exit 1；否则 → 顶层帮助 exit 1）与 `localizeCacError(error, lang)`（Unknown option 模式 → 双语人话，带 `--help` 指引）。
- index.ts：command:* 处理器改用 isKnownCommand 判定；兜底打印/退出走 unknownCommandResult；顶层 catch 经 localizeCacError。

## 测试用例（BDD，TDD 先红）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 已知命令判定 | isKnownCommand("market")/("trust")/("nope") | 调用 | true/true/false |
| help 形态未知命令 | unknownCommandResult("nope", lang, true) | zh/en | `[ojm] 未知命令：nope` / `[ojm] Unknown command: nope`，code 1 |
| 非 help 未知命令 | unknownCommandResult("nope", lang, false) | 调用 | 顶层帮助全文，code 1 |
| 未知选项本地化 zh | localizeCacError(Error("Unknown option \`--foo\`"), "zh-CN") | 调用 | message 含「未知选项：--foo」与 `--help` 指引，带 [ojm] 前缀 |
| 未知选项本地化 en | 同上 en-US | 调用 | 含 "Unknown option: --foo" |
| 非匹配错误原样 | 其他 Error | 调用 | 引用不变（同一实例） |

二进制冒烟（手动）：`ojm nope --help`/`ojm help nope` exit 1 报未知命令；`ojm build --foo` 中文人话报错；`ojm market verify --help` 仍正常单命令帮助 exit 0；`ojm nope`/`ojm`（裸）保持 exit 1/0。

## 任务

- [x] 建分支 fix/ojm-cli-ux-quirks
- [x] TDD：cli.test.ts 增加上表用例（先红 5 个）
- [x] 实现 isKnownCommand / unknownCommandResult / localizeCacError + index.ts 接线
- [x] 全量测试（cli 409 通过、根 tests/cli 379 通过）+ lint + typecheck + 二进制冒烟
- [x] 更新本文档状态与总结

## 问题记录

1. **冒烟抓出显示回归（cac 化遗留）**：renderGroupBody 对凡有 subs 的条目一律按子命令展开，trust 子命令没写 short 时兜底取详解首行——索引出现 `ojm trust ls  ojm trust ls [key_id 前缀?]` 复读。对策：trust 四个子命令补 short（与 market 一致），加回归断言。说明 subs 展开依赖 short，缺 short 的兜底行为不好看但可接受。

## 总结

本阶段修正 cac 全面化后的三处用户可见反常识行为：未知命令 + help 形态恢复「未知命令」exit 1（`unknownCommandResult`，双语）；cac 英文裸 `Unknown option` 报错本地化为人话并带 `--help` 指引（`localizeCacError`）；`command:*` 误判从 `options.help` 过滤改为按「首位置参数是否已知命令」判定（`isKnownCommand`，语义更稳）。另修复冒烟暴露的 trust 子命令索引复读 bug。关键过程：先写 5 个红用例 → 实现 → 二进制冒烟发现并修复 trust 显示回归 → 全量回归。耗时约 20 分钟。
