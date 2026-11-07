# 上游需求草案：安装方案时执行其 seed.sql（seed 随装随灌）

> 状态：**待上游裁决**（2026-11-07 起草）。
> 本仓关联：`docs/prd/framework-verification-playbook.md` §11 **U7**（本条即 U7 的正式化提案）、
> §7.7 第三轮演练记录（drill3，2026-11-07 实锤）。
> 前置约定：seed 幂等已由 `oj check` S006 强制（`INSERT OR IGNORE` / `ON CONFLICT` /
> `ON DUPLICATE KEY`），方言选择已由 oj `0.1.121` 落地（U1 提案）——本文不改这两个前提。

## 1. 结论

请 oj 内核提供**按模块触发的 seed 重放入口**，并允许安装编排（本仓 `_lifecycle` 安装器的
migrating 段之后）对新装模块调用一次。效果：方案安装完成即数据就绪，与业界安装器预期一致
（迁移 + seed 同属安装的 schema 初始化段，不应一条随装、一条等冷启动）。

两选一均可，验收口径相同（§5）：

- **方案 A（推荐）**：新增子命令 `oj seed <module>`（与 `oj migrate <module>` 同形态：
  `-d <dir>` / `--module-root` / `-c <config>` / `--format json`），只重放指定模块的
  seed.sql。安装器 migrating 段后顺序调用 `oj migrate … && oj seed …`。
- **方案 B**：`oj serve` 热重载编排（reload 请求携带「新装模块清单」）在复用后端
  （`reused=true`）路径上，对清单内模块执行一次 seed 重放；旧模块不重放（保持
  「热更不灌库」的既有纪律）。

方案 A 改动面小（seed 逻辑已有，缺的是命令入口与单模块粒度），且把「何时灌」的决策权
留在调用方；方案 B 需要 reload 协议扩展。下文以 A 为主线。

## 2. 痛点：安装完成 ≠ 数据就绪（2026-11-07 drill3 实锤）

books 方案（带 `seed.sql`，3 行种子数据）经市场按名安装，安装器两段式终态 done、
state.yaml `enabled: true`：

1. **迁移随装生效**：migrating 段显式执行 `oj migrate --format json -d dist/api books-0.1.4`
   （`packages/cli/templates/src/app/_platform/_lifecycle/steps/migrate.ts:67`），
   `_oj_migrations` 即时写入新段，新表立即可查。
2. **seed 不灌**：起服路径上 seed 重放被 `reused` 门控挡死——
   `oj-bin/oj/src/app.rs:2037-2042`：

   ```rust
   // 种子重放（P0）：各 api 树的模块 seed.sql（§8-1）。热更复用时不重放
   // （种子是一次性初始化，重载不应再灌库，§5 ②）。
   if !reused {
       for (tdir, _) in &trees {
           crate::seed::replay_all(...).await?;
       }
   }
   ```

   安装 API 触发的热重载 `reused=true` → seed 整体跳过；必须**冷启动**一次
   （`ojm preview` 重启）才看到 `seed ok module="books-0.1.4"`、`books_books` 3 行。

3. **期间方案页数据面为空**：`/api/books/list` 返回 0 行，前端 Table 空态——
   用户视角「安装成功但功能没数据」，与「安装完成即应可用」的直觉相悖。
   排查成本高：HTTP 全绿、安装 done、只有「下次重启后数据突然出现」这一怪象。

`!reused` 门控的本意是「热更不应重灌既有模块的种子」，这个纪律**本身正确**——
问题只在于它没有给「新装模块」留例外。一次性初始化的语义应绑定**模块首次进入该库**，
而不是**进程首次启动**。

## 3. 现状取证

| 位置 | 行为 | 缺口 |
| --- | --- | --- |
| `oj/src/app.rs:2038` `replay_all` | 仅 `!reused` 时全量重放 | 无单模块、无按需入口 |
| `oj/src/seed.rs:190` `collect()` | 按 api 树收集全部模块 seed | 支持按模块过滤即可复用 |
| `oj/src/args.rs` | 无 `seed` 子命令 | 方案 A 的新增面 |
| `_lifecycle/steps/migrate.ts` | migrating 段逐字 `oj migrate … -d <dir> <module>` | seed 段挂同形态命令即可 |
| 安装器 stage 序列 | 10 阶段含 migrating，无 seeding 段 | 方案 A 落地后本仓加 seeding 段 |

seed 的执行机制（收集 → 方言选文件 → `translate_insert` → 逐语句 exec）无需任何改动，
缺的只是「按模块、按时刻」的触发面。

## 4. 行为契约（方案 A）

### 4.1 命令形态

```
oj seed [OPTIONS] <module…>     # 一个或多个模块；缺省 = 全部（与 migrate 一致）
  -c, --config <CONFIG>         # 同 migrate
  -d, --dir <DIR>              # 同 migrate（dist 版本目录名 <module>-<version> 亦同）
      --module-root <DIR>       # 同 migrate
      --db <DB>                 # 同 migrate
      --format json             # 同 migrate：stdout 恰一行 {"results":[…]}
```

### 4.2 语义

- **只灌指定模块**；模块无 seed → 成功 no-op（不是错误，多数业务模块没有 seed）。
- **幂等前提不变**：不改写、不跳过 S006 约束过的语句，重复执行靠作者幂等
  （与冷启动重放同一机制，风险面零新增）。
- 日志与冷启动一致：`seed ok module=<m> file=<f> dialect=<d> stmts=<n>`。
- 失败行为对齐 migrate：非零退出 + stderr 人话；`--format json` 错误脱敏一行。

### 4.3 安装器调用点（本仓侧，待 oj 落地后实施）

`_lifecycle` 安装器在 migrating 段成功后新增 seeding 段（stage 序列 10→11），
对本次安装/升级的目标模块执行 `oj seed -d <dist api root> <module>-<version>`；
失败语义与 migrating 一致（可重试、备份不重复做）。

## 5. 验收口径

1. 装一个带 seed 的方案，**不重启**，`select count(*)` 即得种子行；
2. 重复执行 `oj seed <module>` 行数不翻倍（幂等）；
3. 无 seed 的模块执行 `oj seed` 成功 no-op、零日志噪音；
4. 热重载（`reused=true`）后**旧模块**种子不被重灌（既有纪律不回归）；
5. 安装任务终态语义不变：两段式终态下 retry 覆盖 seeding 段。

## 6. 临时绕行（本仓文档口径，上游落地前）

演练/验收带 seed 的方案时，安装后重启一次宿主（冷启动触发全量重放），并以
`seed ok module="<name>-<version>"` 日志 + 行数断言为准（playbook §7.7 第三轮即此口径）。
