# 评审 T10：ojm api 代码生成迁移（contract.ts / defineApi → openapi.json + handler `.schema` + `.response`）

> 范围：T7 系列（T7b 退役 zod/defineApi 翻译层、T7c playground-oj 迁移、T7d 0.1.20 锁版+重建 shell-dist、
> T7e 文档、oj 上游需求文档化 + playground-oj 类型修复），以及 **oj 0.1.72/0.1.73 发布后的阻塞解除轮**
> （`.response` 平级迁移、playground-oj 重跑、framework-verification-playbook 全链路演练）。
> 视角：架构 / 工程 / 安全。结论：**可发布 0.1.20；2 项 oj 上游需求已由 oj v0.1.72/v0.1.73 实现并完成 ojm 侧同步；
> 多文件拆分仍暂缓。**

> **更新记录（2026-10-15 晚轮）**：初评时 2 项 oj 上游需求「待提交」、`--check` 漂移「功能性阻塞」——
> oj v0.1.72（平级 `.response`）与 v0.1.73（`del`→`delete` 归一）发布后均已解除：模板 + playground-oj
> 全部 handler 迁到 `.schema`（入参）+ 平级 `.response`（出参），`openapi.json` 干净再生、`--check`
> 零漂移、`ojm api` 幂等；`MIN_OJ_VERSION` 门禁抬到 0.1.73；framework playbook 全链路演练通过
> （详见该文档「最近一次基线」）。下文本文中标注「待提交/阻塞」的条目以本注记为准。

## 1. 架构视角

**正向**
- 单一权威源收敛到位：旧「`contract.ts`（defineApi + zod）→ evaluate → IR → emit」翻译层已删除；
  新流水线 `oj openapi`（oj 内省 handler `.route`/`.schema`）→ `openapi.json`（OpenAPI 3.1）→ `irFromOpenapi`
  → `emitClient` / `emitStub` / `emitMock` / `emitZodFromJsonSchema`。契约落点即路由（handler 上），无第二份真源。
- 关注点分离清晰：oj 拥有「路由发现 + OpenAPI 生成」，ojm 拥有「client/stub/mock 发射」。`openapi.json` 是干净边界。
- 信封语义一致：响应恒为 `{code,msg,data}`，由 `openapi_cmd.rs::envelope_schema` 外裹，下游 client 类型稳定。
- 版本锁步有 gate：`cli + runtime` 同版（0.1.20），`shell-dist/versions.json` 被 `package-guards` + `cli-build`
  读取，跨包不一致会在 CI 拦下（本会话已修 stale 0.1.18→0.1.20）。

**风险 / 待决**
- 与 oj 输出形状强耦合：`x-oj-response-enforced`、`operationId` 派生规则（`path_method`）、`del` 方法键等
  都是 oj 的约定。oj 改这些，ojm 必须同步。 mitigation：已把 2 项 oj 行为差异文档化为上游需求
  （见 `docs/migration/oj-requirement-*.md`），待 oj 实现后回归。
- `.schema` 必须带 `response` 才能产出带类型 client（oj 仅在 `.schema.response` 读响应）。「`.schema` 不含 response」
  的设计目标当前不可达，已文档化为上游需求 `oj-requirement-response-outside-schema.md`，暂缓。
- 多文件拆分（handler 逻辑 / `.schema` / `.route` 分文件）经原型验证不可行：oj loader 对导入
  `@oj-module/runtime` 报「escapes project root api/src」，且独立 schema 文件导入不稳定。故 inline
  `.schema`/`.route` 是当前唯一被稳定内省的形态。多文件方案暂缓。

## 2. 工程视角

**正向**
- 测试全绿：`tests/cli`（含 contract-emit-client / -stub 快照）、`tests/runtime`、`tests/contract` 全部通过
  （本会话复核 212 passed / 34 files）。先前失败的 `z.string().enum` 快照、`amount: 0` 断言、`template/init`
  的 openapi.json 缺失与 contract.ts 删除断言均已修正。
- playground-oj 5 个 `contract.ts` 已删除，handler 改 `.schema`，5 个 `__client` 已重生成；`api/src/auth` / `web`
  的 `__client` 是既有真实模块（非多余）。
- 类型修复：本会话补 `UploadedFileMeta.key/url`（大文件 blob 路径）对齐 devkit 版；`NotificationItem.link` 放宽为
  `string | null`（通知数据确可为 null），并重建 runtime `dist`。playground-oj `tsc --noEmit` 现 0 错误。
- 死代码清理：移除多文件原型遗留的 `withSchema`（source + dist），`contract/index.ts` 仅保留
  `errors` / `ScopedRequestLike` / `z` / `ContractApiError`。

**风险 / 待决**
- **`openapi.json` 漂移（功能性阻塞）**：oj v0.1.71 把 `del` 动词写成非法 OpenAPI 键 `"del"`
  （应在 serve 侧已做的 `del`↔`DELETE` 归一漏到 openapi 生成）。playground-oj 目前手工把 `del`→`delete`、
  并把 `operationId` 改成 snake_case 才可用，导致 `oj openapi --check` 必漂移。需 oj 修
  `oj-requirement-delete-method-key.md` 后重跑 openapi 生成。在 oj 修复前，`--check` 门禁对 playground-oj 不成立。
- `operationId` 派生为 `path_method`（如 `demo_todos_get`），与手工 snake_case（`get_todo_list`）不同源；
  若要求 `--check` 干净，需统一为 oj 派生式或 oj 提供显式 operationId 覆盖位（本会话未单列需求，可在 del 需求合并评估）。
- 文档版本号多处标「待核实」，规避与 0.1.20 冲突的 0.2.0/0.3.0 字面，正确。

## 3. 安全视角

**正向**
- `x-oj-response-enforced: false` 作为免责标记写进产物：明确「response 是声明、运行期不校验」，并警示下游
  **不得**把它当脱敏 / 裁剪边界（按声明裁字段是字段级越权的伪保证）。这个边界声明是正确且必要的安全姿态。
- 溯源标记无信息泄露：`x-oj-file` 用相对 api 根 + 正斜杠归一（Windows 反斜杠归一），产物不带绝对路径
  （防本机路径泄露、跨机不可比）。
- operationId 唯一性 fail-fast：派生重复（如 `/user/profile` 与 `/user-profile` 都派生 `user_profile_get`）
  直接报错，防下游 client 符号静默互相覆盖（命名冲突 = 隐蔽功能丢失）。
- 路径参数双向交叉校验：`.schema.params` 与路由 pattern 必须一致（声明了 pattern 没有的、或 pattern 有却没声明的
  都 fail-fast），避免「契约」与「URL」两份真源、未声明参数不受约束（潜在越权 / 绕过）。
- 入参三通道（params/query/body）在 `.schema` 内合并、response 走整体覆盖（不并入参那套必填并集），
  语义正确（响应是动词各不相同的，组级必填被继承会假称返回不存在的必填项）。

**风险 / 待决**
- `x-oj-response-enforced: false` 文案已足够，但下游 `__client` 发射端是否真的「不裁字段」需 emit 层复核
  （本会话未逐行审 emitClient 的 response 透传；建议 T10 后补一项 emit 层断言测试：response 声明含的字段原样透传，
  不被 ojm 裁剪）。
- 大文件 blob `key` 路径（`meta.key` 非空走 `blob.get`，否则 `http.file(0)`）已在 `upload/api.ts` 注释 + 类型补全，
  避免「只写一种路径」在放开体积时 500——属实现层防御，良好。

## 4. 结论与后续

- **可发布 0.1.20**：核心迁移完成、测试绿、类型绿、版本 gate 修复。
- **需提交 oj 的 2 项上游需求**（用户手动提交，oj 实现后 ojm 同步）：
  1. `oj-requirement-response-outside-schema.md` —— `.schema` 之外可声明 response。
  2. `oj-requirement-delete-method-key.md` —— `del` 归一为 `delete`（解 `--check` 漂移）。
- **暂缓**：`.schema` 去 response（等需求 1）、handler/`.schema`/`.route` 多文件拆分（oj loader 不支持）。
- **T10 后补强（建议）**：emit 层对 response 字段原样透传的断言测试；oj 修 del 后 playground-oj 重跑 `oj openapi --check`。
