# PR：权威源迁移至 oj `.schema`——oj-module `defineApi` 翻译层退役

> 状态：设计定稿（RFC），待上游 oj 响应后排期
> 来源：2026-10-14 脑暴（defineApi 语义是否下沉 `.schema`）三轮讨论收敛

## 1. 动机

当前契约管线为三层翻译：

```
contract.ts（zod 声明，defineApi）
  → ojm api（evaluate → IR）
    → 前端 client（api.ts + api.schemas.ts，zod）
    → 后端 stub 上的 .schema 行（zod → oj DSL 翻译，emit-oj-schema 降级告警）
    → openapi.yaml / routes.json
```

已识别的负担（按脑暴确认排序）：

1. **双写同步**：改契约要重跑 `ojm api`；接管 stub 后 `.schema` 行不能手滑；漂移依赖 `--check` 兜底。
2. **概念层数**：新人要先学"契约"这层抽象才能写接口；同一校验语义前端 zod、后端 oj DSL 两种语法。
3. **表达力镜像问题**：zod 是超集、oj DSL 是白名单子集，"契约里 oj 表达不了的约束降级告警"与"DSL 写不了 zod 约束"是一体两面。

核心判断：**`.schema` 跟路由+方法天然同处（组级 `.schema` 还可跨端点继承合并，oj v0.1.44+），输入约束零同步；路由↔模块映射 oj 原生可知（manifest + 目录 + routes.js），生成器是 oj 域能力，应长在上游。**

## 2. 目标态架构

```
api/src/<模块>/**/api.ts（oj handler，.schema 为权威源）
  → oj 内省（RouteRow.schema，装配期合并组级/动词级）
    → oj openapi（已有）
    → oj client（新增，上游）：生成 TS client（zod + 类型）到 web/src/<模块>/__client/
```

- **权威源**：handler 文件上的 oj `.schema`（入参三通道 params/query/body + 上游扩展的响应通道）。
- **oj-module 退役**：`defineApi` / `contract.ts` / `evaluate` / `emit-client` / `emit-oj-schema` / `ir` 翻译层整体下线。
- **oj-module 保留**（纯消费侧，与契约位置无关的价值）：
  - scoped request 接线（`createXxxClient(ctx)`，D11 前缀收敛）与错误信封类型；
  - 模块编排（entry/defineModule、i18n 命名空间、keepalive、beforeClose 页签守卫）；
  - `ojm api` 薄语义变更：从"契约生成"变为"client 同步 + handler 对账"（委托 `oj client`，或保留薄封装统一入口）。
- **check 层改造**：route 双向对账失去契约侧后，`artifact-stale`（重生成 diff）天然保证 `__client` 与 handler 同步；"未登记/未实现"对账转为生成器全覆盖性质 + stub 计划（已实现过滤，`handler-scan.ts` 基建复用）。

## 3. 上游 oj RFC（前置依赖，三项）

| # | 诉求 | 理由 |
|---|---|---|
| 1 | `.schema` 响应通道 | oj v0.1.69 仅入参三通道、不校验响应；"输入+输出天然一处"不成立则 oj-module 需私有约定（`.responseSchema`），省掉一个特殊性补回一个 |
| 2 | `oj client` 生成子命令 | `.schema` + 模块清单 → TS/zod client；与 `oj openapi` 同一条内省管线；oj 比 oj-module 反扫 AST 更可靠（RouteRow 是装配期真相） |
| 3 | DSL 表达力对齐 zod 常用子集 | 明确可降级边界（enum/union/array/object/optional/default/format…）；表达不了的约束列清单，宁可写不了也不静默降级 |

上游不接受或排期长 → **维持现状**（contract.ts 管线继续维护），本 PR 文档作为定稿等待，不做半迁移。

## 4. oj-module 变更面

### 4.1 退役清单（BREAKING）

- `@oj-module/runtime/contract` 子路径（`defineApi`、`z`、错误类型）——公开出口，删除属 breaking；`packages/runtime/src/contract/` 目录。
- `packages/cli/src/contract/` 翻译层：`evaluate.ts`、`emit-client.ts`、`emit-oj-schema.ts`、`ir.ts`（`handler-scan.ts`、`check.ts`、`emit-stub.ts`、`run.ts` 改造后保留）。
- 模板与全部示例工程的 `contract.ts` 文件。

### 4.2 迁移路径（存量工程）

一次性迁移命令 `ojm api migrate-to-schema`（TDD）：

1. 读现存 `contract.ts`（最后一次使用 defineApi）→ IR；
2. 把每个端点的入参翻译为 oj DSL 写回对应 handler 的 `.schema`（响应 schema 待上游通道落地后第二轮写入）；
3. 重生成 `__client`（此时来自 `.schema`）并逐字节比对旧 client，差异即翻译丢失面，人工确认清单输出；
4. 删除 `contract.ts`，`ojm api --check` 转新口径。

### 4.3 check 新口径

- `artifact-stale`：`oj client` 重生成 vs 磁盘 diff（不变）。
- `route-not-implemented`：生成物端点 ⊄ handler 表（handler-scan 已有）。
- `route-unregistered`：handler 表 ⊄ 生成物端点（不变）。
- `routes-js-drift`：不变。

## 5. 版本策略

- 用户指示：**每个特性单独 bump 一个版本**。
- 本 PR 含公开子路径删除（`runtime/contract`），按 SemVer 0.x 惯例走 minor breaking：`0.2.0`。
- 上游三项 RFC 若分批落地，oj-module 侧跟随分批：响应通道落地 → 迁移工具（`0.2.0`）；`oj client` 落地 → 翻译层删除（`0.3.0`）——以实际上游节奏为准。

## 6. 任务分解（粗）

1. **oj RFC**：向上游提交 §3 三项（先响应通道，后 client 生成）。
2. **`ojm api migrate-to-schema`**：一次性迁移命令（BDD 文档先行，TDD）。
3. **check 新口径**：`run.ts`/`check.ts` 改造，翻译层删除。
4. **runtime/contract 子路径删除**：出口白名单测试更新。
5. **devkit 文档重写**：契约章节替换为 `.schema` 权威源章节（含场景用例与示例代码）。

## 7. 风险与回退

| 风险 | 缓解 |
|---|---|
| 上游排期长/拒绝 | 维持现状，文档等待；不做半迁移 |
| zod 超集表达力（refine/transform）DSL 无对应 | §3-3 降级清单显式化；迁移命令输出"翻译丢失面"人工确认 |
| 存量工程迁移成本高 | 迁移命令幂等 + dry-run 预览 + 翻译丢失面报告 |
| `__client` 生成质量回归 | 迁移时逐字节比对旧 client，差异 100% 归因后才删 contract.ts |

## 8. 决策记录

- 2026-10-14 脑暴：权威源 `.schema`、生成器归上游 oj、oj-module 退消费侧——三方共识（用户裁定）。
- 2026-10-14 用户指示：每个特性单独 bump 版本。
