# _platform 市场 API 迁移至 oj-market 模块 —— 评估与执行记录

> 起因：用户指令「评估 src/app/api/_platform 中能移到 oj-market 的 api 则迁移到 oj-market，保持模块的内聚」。
> 关联计划：`docs/plans/20261106-1904-market-remote-publish.md`（v4）；本迁移发生在 A4 完成、A5 未开始之间，是 URL 定型的最后窗口。

## 一、评估结论

`_platform` 下三个 api 面：`market/`、`cdn/`、`{contacts,solutions,org}`。

| 面 | 性质 | 消费者 | 结论 |
|---|---|---|---|
| `market/`（install/task/enable/uninstall 族、trust、catalog/detail/yank/releases/history/meta/index） | 市场域（市场控制台是其唯一 UI） | oj-market web、ojm CLI、远端市场 parity | **移** |
| `cdn/`（upload 签名推送） | 市场发布域 | ojm CLI remote-push（A6）、yank 共享验面 | **移** |
| `contacts/`、`solutions/`、`org/` | 平台管理域（组织/方案注册表） | system/app web 多模块 | 留 |
| `_lifecycle/`、`_shared/` | 平台内核（安装引擎/信任 store/服务层） | 全站 + CLI | 留 |

机制可行性（逐项核实，`../oj-bin` 只读核查）：
1. 模块 api 根 = 含 `manifest.yaml` 的目录（module_scan，深度 8 内）；`src/oj-market/api/manifest.yaml` 即注册 api 面，路由 `{base}/{prefix=模块名}/{模块内相对路径}`。
2. 跨模块 import `#/<模块名>/…` + manifest `deps` 声明（notification → _platform 先例；oj build S008 门禁）。
3. 表归属守卫（guard.rs）：模块只能 touch 本模块或 deps 声明模块的表 → oj-market 声明 `deps: [_platform]` 后 market_release/market_history/sys_* 可达。
4. `json.header` 多值响应头存在（json.rs bridge），catalog/detail 的 no-store 不受影响。

## 二、迁移方案

- 文件搬迁（扁平化，去掉冗余 market 段）：
  - `src/app/api/_platform/market/api.ts` → `src/oj-market/api/api.ts`（路由 `/api/oj-market/{install,catalog,…}`）
  - `src/app/api/_platform/market/bootstrap.ts` → `src/oj-market/api/bootstrap.ts`
  - `src/app/api/_platform/market/index-source.ts` → `src/oj-market/api/index-source.ts`（A5 退役，先随迁）
  - `src/app/api/_platform/cdn/api.ts` → `src/oj-market/api/cdn/api.ts`（路由 `/api/oj-market/cdn/upload`）
- 新 `src/oj-market/api/manifest.yaml`：`name: oj-market`，`deps: { _platform: ^0.1.0 }`。
- 表/migrations **留 _platform**：market_release/market_history/reg_source_seq 是 tenant:false 平台共享目录设施，CLI 回填（A7）与站点双写同一真相；迁移表所有权收益小、风险大（卸载保留语义/迁移重放路径）。
- import 改写：被移文件内 `../_lifecycle/*`、`../_shared/*` → `#/_platform/_lifecycle/*`、`#/_platform/_shared/*`；`../cdn/api` → `./cdn/api`。
- `_platform/manifest.yaml` desc 更新（编排面去掉 market）。
- 消费侧跟进：
  - web：`src/oj-market/web/api/defaultClient.ts`（MARKET 常量 + __client 导入）、openapi.json 重生成（`oj openapi --module-root src -b /api`）、`__client` 重生成（`ojm api`）。
  - CLI：9 文件 37 处 `/api/_platform/market/*` → `/api/oj-market/*`（与 A6 汇合，本阶段只改 URL 常量不改语义）。
  - 测试：tests/lifecycle 三个 spec 的 import 路径；vitest 别名（tests 用相对路径，无别名问题）。
- 计划 v4 的路径引用（A6 base URL、A8 anonymous_paths `/api/_platform/cdn/upload`、`/api/_platform/market/catalog*`）改为 `/api/oj-market/*`——A5-A9 按新 URL 落地。

## 三、风险

- `oj openapi`/`ojm api` 再生产物漂移：以再生成 + 全量测试为准；CLI 的 contract 测试（market-client.integration）同步更新。
- tsconfig.paths.json 是 ojm 生成物：加 `#/oj-market/*` 条目（下轮 ojm init/build 会按模块清单重写，保持一致即可）。
- 远端市场 parity（A8）：URL 变化属对外协议变化，随 breaking 说明一并记录（A9 已有 breaking 章节）。

## 四、追加评估：migrations/ 是否随迁（2026-11-07 用户问）

**结论：不迁。** 市场相关迁移（0001 baseline 内的 market_history、0002–0005 market_release 系列）
继续归 `_platform/migrations/`。三条硬理由：

1. **重放连续性（致命）**：oj 迁移按模块键 `_oj_migrations(module, version)` 记账。存量库已在
   `_platform` 键下应用这些迁移——迁到 `src/oj-market/api/migrations/` = 新模块键下「从未应用」，
   升级时全量重放：baseline 的 `CREATE TABLE IF NOT EXISTS` 侥幸幂等，但 0003/0005 的
   `ALTER TABLE ADD COLUMN` 无 IF NOT EXISTS（sqlite 方言不支持）→ **升级即炸**。
   修这条路要加全套守卫/重做编号体系，风险收益完全不称。
2. **依赖方向反转**：`_lifecycle/history.ts`（平台内核）写 market_history（install/enable/uninstall
   审计面）。表归 oj-market 后，内核写表被表归属守卫拦截，或被迫 `_platform deps: [oj-market]`
   ——内核依赖业务模块，分层倒置。
3. **语义定位**：tenant:false 共享目录设施与 users/sys_* 同层（平台层）。api 代码搬迁是无状态
   移动；表/迁移搬迁是对存量库的有状态手术。oj-market 经 manifest `deps: [_platform]` 访问，
   与 notification 消费 users 表同先例。
