# 修复：templates 构建「缺方案契约」警告 + preview host 提示

- 日期：2026-11-06 17:42
- 分支：`fix/ojm-builtin-preview-host`（基于 `feat/ojm`）
- 来源：手工执行 `packages/cli/templates` 下 `pnpm build` / `pnpm preview` 的反馈

## 背景与现象

1. `pnpm build`（`ojm build`）末尾输出两条警告：
   `⚠️ 模块 app@0.1.0 缺方案契约（src/app/solution.yaml），不会被打包`、`oj-market` 同理。
2. `pnpm preview`（`ojm preview`）：修改 host 地址后，启动提示仍打印 `http://localhost:<port>`。

## 原因分析

### 问题 1：缺方案契约警告

- `summarizeBuiltSolutions`（`packages/cli/src/bundle.ts:384`）在构建末尾点名「非内置且无契约的已构建模块」。
- 「内置模块」名单的唯一真源是 `src/.ojm-builtin.json`，由 `ojm init` 从 `init.include.yaml` 白名单派生生成（`builtin.ts:87 writeBuiltinList`）。
- `packages/cli/templates` 本身就是脚手架源工程（module-root 布局，`src/app`、`src/oj-market` 均为 init 白名单收录的自带模块），但该文件从未在 templates 里生成过——`readBuiltinModules` 文件缺失 → 空名单 → `app`/`oj-market` 被误判为「缺契约的用户模块」。
- 判定：`app`/`oj-market` 是框架自带（随脚手架分发），应进内置名单，警告属误报。

### 问题 2：preview host 提示

- `ojm preview` 使用的配置：工程根 `config.yaml`（module-root 布局下即 `packages/cli/templates/config.yaml`）；`config.local.yaml` 不参与 serve/preview（仅 dev 期密钥本地覆写）。
- 端口取 `server.port`（默认 9778），**绑定 host 由 oj 自己读 `server.host`**——改 config 里的 host 是生效的。
- 但启动提示是硬编码：`preview.ts` 打印 `http://127.0.0.1:${oj.port}` 与 `http://localhost:${oj.port}`，从不读 `server.host`，所以「改了 host 仍提示 localhost」。
- 次要缺陷：`oj.ts:121` 健康轮询 URL 也硬编码 `127.0.0.1`——若 host 改为非回环地址（如局域网 IP），轮询将永不就绪。通配地址（`0.0.0.0`/`::`）回环探测仍可用，无需特殊处理之外的行为。

## 修复方案

| # | 修改 | 说明 |
|---|------|------|
| 1 | 新增 `packages/cli/templates/src/.ojm-builtin.json` | 内容 = `deriveBuiltinModules(init.include.yaml)` 的派生结果（9 个模块），格式与 `writeBuiltinList` 产物一致 |
| 2 | 新增 `packages/cli/src/__tests__/templates-builtin-list.test.ts` | 漂移守卫：内置名单必须与 `init.include.yaml` 派生结果一致，防双写漂移 |
| 3 | `packages/cli/src/preview.ts` | 启动提示改读派生 config 的 `server.host`（缺省回环），不再硬编码 localhost |
| 4 | `packages/cli/src/oj.ts` | 抽出 `healthHostOf(host)`：非通配 host 用于健康轮询，通配/缺省回退 `127.0.0.1`；附单测 |

明确不做：`dev.ts:268` 的「开发服务器已启动：http://localhost:…」同样硬编码，但 dev 场景 host 恒为回环（模板 config 注释钉死 127.0.0.1），本次不改。

## 任务清单（BDD）

### 特性：templates 自带模块名单（问题 1）

- [x] **场景：builtin 名单与白名单派生一致** —— 给定 `init.include.yaml`，`deriveBuiltinModules` 结果与 `src/.ojm-builtin.json` 的 modules 完全一致（数据表：9 个模块名逐一相等）
- [x] **场景：构建不再误报** —— `pnpm build` 末尾无「缺方案契约」警告，`app`/`oj-market` 归入「框架自带模块」折叠

### 特性：preview host 提示（问题 2）

- [x] **场景：config 配置非默认 host** —— 给定 `server.host: 0.0.0.0`，启动提示打印该 host
- [x] **场景：config 未配 host** —— 缺省回退 `127.0.0.1`
- [x] **场景：健康轮询跟随 host** —— 给定局域网 IP，轮询目标为该 IP；给定通配地址，回退回环

## 问题记录（反常规/反常识）

- 脚手架源工程自身也要持有一份 `.ojm-builtin.json`：`ojm init` 只给「目标工程」生成，templates 作为源从未被 init 指向自己，名单文件因此缺席——同类「源即产物」工程需注意。
- **补录名单文件会顺带打开脚手架完整性门禁**（`guardEnabled` = 文件存在即开关）：门禁对「工程即 templates 自身」的比较无意义（基线 == 自身，白名单外 demo-only 文件在 extra 轴必误报），需显式放行——单改名单文件会让 `ojm build` 从「警告」退化为「直接拒绝构建」，两类症状要一起修。

## 总结

两项修复均完成并验证（2026-11-06 17:42–17:50，约 8 分钟）：

1. **缺方案契约误报**：补录 `packages/cli/templates/src/.ojm-builtin.json`（9 个模块，派生自 `init.include.yaml`），`ojm build` 末尾警告消除，`app`/`oj-market` 归入「框架自带模块 2 份已构建」折叠行。配套：
   - `scaffold-guard.ts`：`collectDefaultModuleDrift` 对「工程即 cli 包内 templates 自身」直接放行（基线==自身，且 demo-only 文件在 extra 轴必误报）；
   - 新增漂移守卫测试 `templates-builtin-list.test.ts`（4 用例：名单==白名单派生、覆盖 app/oj-market、文件名约定、自身放行）。
2. **preview host 提示**：`preview.ts` 启动两行提示改读派生 config 的 `server.host`（缺省回环）；`oj.ts` 健康轮询经新导出 `healthHostOf` 跟随配置 host（通配 `0.0.0.0`/`::` 回退 127.0.0.1），否则改绑局域网 IP 后轮询永不就绪。新增 `oj-health-host.test.ts`（6 用例）。
   - **preview 配置口径**（答复用户疑问）：`ojm preview` 只读工程根 `config.yaml` 的 `server.host`/`server.port`（`config.local.yaml` 不参与 serve/preview，仅 dev 期密钥覆写；`.ojm-preview.yaml` 是运行时派生临时产物）。

关键过程：问题 1 表面是「缺文件」，补文件后触发第二层门禁失败（工程==基线自比较），根因是门禁开关与名单文件耦合；问题 2 表面是「提示不改」，实际是提示硬编码 + 健康轮询硬编码两处。

验证：`pnpm build`（templates）无警告；preview 冒烟（127.0.0.1 与临时改 0.0.0.0 两种 host）提示正确、派生 config 退出即清理；cli 相关测试 83 用例全过（含新增 10 用例）；`pnpm lint`/`pnpm typecheck` 干净（3 个 login.tsx 警告为存量）。
