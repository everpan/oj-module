# ojm 全面 cac 驱动 + 双语帮助

- 日期：2026-10-23 08:48
- 分支：refactor/ojm-cac-bilingual
- 状态：已完成（2026-10-23 09:40）

## 需求

在上一期（分组帮助，refactor/ojm-help-cac 已并入 feat/ojm）基础上：

1. **全面改为 cac 驱动命令**：dispatch 从 `index.ts` 的手写 switch + 自研 parse\*Args 解析，迁到 cac 的 command/option/action 注册模型。
2. **双语帮助**：帮助文本支持 zh-CN / en-US。

## 非目标（明确不做）

- 命令执行期输出（[ojm] 日志、错误文案）不双语——只双语**帮助/用法**文本；执行输出双语是独立大 sweep。
- 不改任何 handler 真逻辑（initProject/buildBundle/trustCommand/marketCommand/runOjSubcommand 等签名不动）。
- `ojm install --locale`（站点侧终态文案语言）语义不变，与 CLI 帮助语言无关。
- 不引入 node-gettext 等 i18n 框架：帮助文本量小，注册表内联双语字段即可（DRY：单注册表同时供 cac 注册与帮助渲染）。

## 关键事实（探查结论）

1. **cac 子命令只按第一个位置参数匹配**（`isMatched(parsed.args[0])`，实测 `remote add origin` 命中父命令 `remote`）。因此 `market`/`trust` 注册为父命令（`market [sub] [rest...]`），子命令在 action 内分发给既有 `marketCommand`/`trustCommand`——**详情文案按 `cli.args[0]`（子命令名）经 help 回调注入**。
2. **cac outputHelp 只走 console.log**：help 回调可改 section 列表，顶层分组帮助与 per-command Details 注入都在回调里完成。
3. **mri 可选值选项**（`--bundle [name]`）：裸 `--bundle` 得到 `""`，`--bundle name` 与 `--bundle=name` 得到字符串——action 里 `bundle !== undefined` 即开关，`"" ` 视为无名称。
4. 自研解析器里**仅两处内嵌校验**需搬入 action：`parseNewArgs` 的 `--layout container|none`、`parseVendorArgs` 的 tag 正则与 v 前缀规范化；其余 parse\*Args 均为纯解析，由 cac 取代后删除。
5. `src/index.ts` 无其他 import 方（纯 bin 入口）；`marketUsage()` 仅 `runMarket` 自用，可删除。
6. eslint 强制依赖入 catalog（cac 已入，本期无新依赖）。

## 语言决议

`resolveLang()`：显式 `OJM_LANG=zh-CN|en-US` > `LANG`/`LC_ALL`/`LC_MESSAGES` 前缀 `en` → en-US（大小写不敏感）> 缺省 zh-CN。单次调用进程内恒定，帮助渲染时固化。

## 方案

### 模块结构

```
src/usage.ts     → 双语帮助注册表 + 渲染：
                   Lang/resolveLang、HELP_GROUPS(bilingual)、COMMANDS(bilingual:
                   name/syntax/zh/en/options/detail/examples/subs)、
                   usageText(lang)、commandHelpText(cli 构建辅助)
src/cli.ts       → buildCli(projectRoot, lang): CAC —— 遍历 COMMANDS 注册 command/option/
                   example + action（action 内 switch key 调既有 handler，保持 lazy import）、
                   help 回调（顶层分组渲染 + Details/subs 注入）、command:* 兜底
src/index.ts     → 瘦入口：resolveLang → help 词形 shim（ojm help <cmd> → <cmd> --help）→
                   --version 早退 → buildCli().parse() → 裸 ojm 打帮助 exit 0
src/args.ts      → 删除（parse*Args 由 cac 取代；两处校验搬入 cli.ts action）
src/market/command.ts → 删 marketUsage()（bare ojm market 由 registry detail 双语渲染）
```

### 行为保持契约（与重构前一致）

| 场景 | 行为 |
| --- | --- |
| 裸 `ojm` | 顶层分组帮助，exit 0 |
| `ojm <未知>` | 顶层分组帮助，exit 1 |
| `ojm --version` / `-V` | 裸版本号（与 ojm info 同源），exit 0 |
| `ojm help [cmd [sub]]` | 等价 `<cmd> --help`；无 cmd → 顶层帮助 |
| `ojm <cmd> --help` | 帮助输出，action 不执行，exit 0 |
| `ojm market`（无子命令） | market 用法 + 子命令说明，exit 0 |
| oj 透传五命令 | 参数原样转发（allowUnknownOptions），自动补 -c |

### 任务

- [x] 建分支 refactor/ojm-cac-bilingual
- [x] TDD：usage.test.ts 重写（resolveLang / 双语 usageText / 分组兼容）+ cli.test.ts 新增（dispatch 契约）
- [x] 实现 usage.ts 双语注册表
- [x] 实现 cli.ts（buildCli）+ 瘦 index.ts
- [x] 删除 args.ts、marketUsage、runMarket、parseKeygen/Sign/PublishArgs 及配套测试用例
- [x] 全量测试（cli 403 通过、根 tests/cli 379 通过）+ lint + typecheck 全绿
- [x] 更新本文档状态与总结

## 测试用例（BDD）

### 语言决议

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 显式优先 | OJM_LANG=en-US，LANG=zh_CN.UTF-8 | resolveLang | en-US |
| 系统 locale 探测 | 无 OJM_LANG，LANG=en_US.UTF-8 | resolveLang | en-US |
| 缺省中文 | 均无 | resolveLang | zh-CN |
| 非法值回退 | OJM_LANG=fr | resolveLang | zh-CN |

### 双语帮助

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 中文分组头 | usageText("zh-CN") | 检查 | 含「工程脚手架:」等 7 个中文分组头 |
| 英文分组头 | usageText("en-US") | 检查 | 含 "Project scaffolding:" 等 7 个英文分组头 |
| 命令双语一致 | 两种语言 | 检查 | 均含全部命令语法行（ojm init [dir] 等） |
| 单命令帮助双语 | commandHelpText("build", "zh-CN"/"en-US") | 检查 | zh 含「构建后端」，en 含 "Build backend" |

### dispatch 契约（cli.test.ts，console 捕获 + 退出码断言）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 帮助不执行 action | `market setup --help` | parse | 输出帮助，不触发 setup（无 CDN 目录产生） |
| 未知命令 | `nope` | parse | 打印帮助，exit 1 |
| help 词形 | `help build` | parse | 等价 `build --help` |
| new 布局校验 | `new x --layout bogus` | parse | 抛「--layout 只接受 container \| none」 |
| vendor tag 校验 | `vendor notatag` | parse | 抛「非法版本号」 |
| merge 位置参数 | `merge out.json in1.json in2.json`（缺文件） | parse | 报错提及 in1.json（验证 variadic 映射） |
| build bundle 值 | `build --bundle demo` | 桩 | bundleName="demo" 传入 buildBundle（vi.mock 验证） |

## 问题记录

1. **cac 嵌套子命令匹配只认首个位置参数**（反常识，cac README 未明说）：`market setup` 注册父命令 `market [sub] [...rest]` + action 内分发给既有 `marketCommand`；per-sub 帮助文案靠 help 回调按 `cli.args[0]` 注入。实测验证。
2. **cac variadic 语法是 `[...rest]`（点在前）**，写 `[rest...]` 被当普通参数且静默吞多余位置参数——反直觉且无报错。实测定位（`Command.args` metadata 里 `variadic:false`）。
3. **cac `--help` 后会 unsetMatchedCommand 再发 `command:*`**（源码顺序如此）：`ojm market verify --help` 曾误判未知命令叠打顶层帮助并以 1 退出。对策：index.ts 事件处理器按 `cli.options.help` 过滤。已加回归测试（不叠「oj 子命令透传」分组）。
4. **cac outputHelp 只走 console.log**（同上一期）：回调捕获 + console 静默模式沿用到 renderGroupBody。
5. **vitest 下 dynamic import 解析需数百毫秒**：cli.test.ts 的 run() 用 vi.waitUntil 条件轮询拍平异步链；vi.mock 在测试体内拦不到 dynamic import，须 vi.hoisted 顶层注册。
6. **`pnpm typecheck` 默认堆 OOM**（基线既有，非本次引入）：`NODE_OPTIONS=--max-old-space-size=8192` 通过。

## 行为变化（相对重构前，均经评估可接受）

- `ojm <cmd> --unknown-flag`：旧被自研解析器静默忽略，新被 cac 显式拒绝——更严格，属改进。
- `ojm nope --help`（未知命令+help）：旧报「未知命令」exit 1，新打顶层帮助 exit 0。
- `ojm build --version`：旧当普通 build 忽略，新被 cac 拒绝——更严格。
- 自研 parse*Args（args.ts 及 keygen/sign/publish 内 3 个）全部删除，解析归 cac；new 的 F8「多余位置参数显式拒绝」守卫保留在 cli.ts action（`new [name] [...extra]`），vendor tag 正则+规范化保留在 action，均有测试。

## 总结

本阶段将 ojm 的 dispatch 从手写 switch + 7 个自研 parse*Args 全面迁到 cac（command/option/action），帮助文本实现 zh-CN / en-US 双语（单注册表同时供 cac 注册与渲染消费）。关键过程：先写 resolveLang/双语/分组测试（红）→ 实现 usage.ts 注册表 + cli.ts buildCli + 瘦 index.ts（绿）→ 清理测试文件中的解析器用例 → 真实二进制冒烟抓出 `--help` 后 command:* 误判 bug 并修复加回归测试。耗时约 50 分钟（含两轮全量测试与双语翻译）。
