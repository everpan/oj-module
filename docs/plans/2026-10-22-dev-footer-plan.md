# ojm dev 快捷键提示常驻底栏 — 计划

日期：2026-10-22 · 分支：`feat/ojm-dev-footer`（并入 `feat/ojm`）

## 需求

`ojm dev` 启动时打印一次快捷键提示（`r 热更新 · h 帮助 · c 清屏 · o 打开浏览器 · q 退出`），
随后被构建/oj 后端日志顶出屏幕。目标：提示常驻终端最底行，滚动日志在其上方滚动。

## 方案

终端 DECSTBM 滚动区（scroll region）：

1. 将滚动区设为 `1..rows-1`（`\x1b[1;{rows-1}r`），末行留给提示。
2. 光标移至末行写提示（先 `\x1b[2K` 清行），再把光标移回滚动区底行。
3. 之后本进程 `console.log` 与 oj 子进程透传（均经 `process.stdout.write`）只在滚动区内滚动，
   末行提示由终端保持，无需逐条重绘。
4. `c` 清屏从 `\x1Bc`（RIS，会复位滚动区）改为 `\x1b[2J`（ED，保留滚动区）+ 重绘提示。
5. `SIGWINCH` 时按新行数重建滚动区并重绘提示。
6. 清理（server close / 进程退出）时恢复全屏滚动区 `\x1b[r`，避免 shell 提示符落进半截区域。

非 TTY（keymap 强制开但 stdout 被管道、或行数 <3）时 `pinFooter` 返回 `undefined`，
回退为原来的 `console.log` 一次性打印，行为不变。

## 涉及代码

- `packages/cli/src/dev.ts`：新增 `pinFooter()`；`devServer` 快捷键提示改走底栏；`setupDevKeymap` 增加可选 `clearScreen` 注入（默认仍 `\x1Bc`，测试兼容）。
- `tests/cli/dev-keymap.test.ts`：新增 `pinFooter` 用例。

## BDD 用例

### pinFooter（TTY 常驻底栏）

| # | 场景 | Given | When | Then |
|---|------|-------|------|------|
| F1 | TTY 初始化 | stdout 为 TTY（rows=24） | 调用 `pinFooter(text)` | 输出含 `\x1b[1;23r`（滚动区）与末行 `\x1b[24;1H` 渲染的 text |
| F2 | 非 TTY 回退 | `isTTY=false` | 调用 `pinFooter(text)` | 返回 `undefined`，不产生任何输出 |
| F3 | 行数不足 | `isTTY=true` 但 `rows=2` | 调用 | 返回 `undefined`（末行无空间，不折腾） |
| F4 | 清屏保区 | 已 pin | 调用 `clear()` | 输出 `\x1b[2J`（非 `\x1Bc`）并重绘末行提示 |
| F5 | 尺寸变化 | 已 pin | 触发 SIGWINCH（rows 24→40） | 重设滚动区 `\x1b[1;39r` 并重绘 |
| F6 | 清理还原 | 已 pin | 调用 `stop()` | 输出 `\x1b[r` 恢复全屏滚动区 |

### setupDevKeymap（既有行为回归）

| # | 场景 | Then |
|---|------|------|
| K1 | 注入 `clearScreen` 后按 `c` | 调用注入的 `clearScreen`，不再直接写 `\x1Bc` |
| K2 | 未注入（默认）按 `c` | 仍写 `\x1Bc`（原测试不变） |

## 任务

- [x] 文档（本文件）
- [x] TDD：`pinFooter` 用例 F1–F6 + K1（先红后绿）
- [x] 实现：`pinFooter` + `devServer` 接线 + `clearScreen` 注入
- [x] `pnpm test`、`pnpm lint`、`pnpm typecheck` 全绿（tests/cli 384 用例仅 1 个既有失败：`devkit-docs.test.ts` 教学文档代号检查，干净树上同样失败，与本改动无关；typecheck 报错 `index.ts:204` 亦为既有）
- [x] 合并回 `feat/ojm`，更新任务状态与总结

## 总结

本阶段关键过程：滚动区方案（DECSTBM）一次设定后由终端保持末行，无需逐条重绘日志，
是本需求的最小完整实现——比「拦截 process.stdout.write 逐条重画底栏」少一个数量级的代码与边界。
`c` 清屏从 RIS（`\x1Bc`）改为 ED（`\x1b[2J`）是方案的关键约束：RIS 会复位滚动区。
耗时：阅读现状约 5 分钟，文档 10 分钟，TDD 用例 + 实现约 25 分钟，验证与合并约 10 分钟。
问题记录：无反常规/反常识项。
