# market 远端发布与 DB 目录化 · v3（评审 + 共创收敛版）

- 日期：2026-11-06 19:04（v2 评审修订 19:35，v3 目录 DB 化 20:00）
- 分支：`feat/market-remote-publish`（基于 `feat/ojm`）
- 需求演进：
  1. `ojm market publish` 需远端推送参数（远端 = oj 模板站点，纯站点无 ojm CLI）
  2. 鉴权采用**签名制**（不经账号口令；企微用户无障碍）
  3. 远端无人跑 build-index → 索引须**转 DB 管理**，发布与展示都从 DB 获取
  4. 目录信息经 **JSON API 暴露**——本站点与远端市场统一走 JSON 协议，不读索引文件

## 评审记录（2026-11-06，三位专家评审，v2 已全部采纳）

| 评审方 | 结论 | v2 处置 |
|---|---|---|
| 架构师 | 需修改后落地 | 签名鉴权取代角色鉴权；大文件显式 413；双写 parity 测试；发布对原子性（sig 先 tgz 后，服务端 pair 校验） |
| 工程师 | B1–B3 须补后进 TDD | `createCdnUploadApi(env)` 注入面；X-TENANT-ID 必带；respond() 收口；atomicWriteBytes；测试打法改写 |
| 产品 | 边界成立，凭据通道 + 退出码须补 | 签名制消解凭据问题；半成功态 exitCode 1；文档同步清单 |

v3 变更：目录存储从「静态文件派生物」改为「DB 真源 + JSON API 单协议」，三条专家意见在 v3 继续有效（鉴权/原子性/工程惯例均不变）。

## 现状与目标形态

| 层 | 现状 | v3 目标 |
|---|---|---|
| 包字节（tgz/.sig） | cdn/ 目录，oj 静态挂载 | **不动**——安装下载链路零改动 |
| 市场目录（catalog.yaml / shards / 代次 / yank 账本） | 静态文件派生物，须 `build-index` 重建 | **DB 真源**（`market_release` 表）+ **JSON API 单协议**；`build-index`/索引签名/代次时效机器**退役** |
| 目录消费（市场卡片 / 发布历史 / 安装解析） | `readIndexSnapshot` 拉 catalog.yaml+shards 文件并验签 | 拉**市场站点的 JSON API**（本站点或远端同一协议），合成同样的 IndexSnapshot 喂既有 parse 管线 |

退役判据：索引签名（G4）防的是「静态索引文件被换」；JSON 由权威 API 直出 DB 后，篡改面=站点 DB 本身，签名完整性锚失去保护对象。包级签名（.tgz 验签 + 信任库 TOFU）**不变**——装的字节仍逐包验。

## 方案 v3

### 一、DB 目录（templates）

- 新迁移 `0003__market_catalog.sql`（+ .mysql/.pg 三方言，照 0002 纪律）：`market_release` 表——`name`+`version` 唯一、sha256、size、key_id、signature（alg/value/public_key 三列或 JSON 列）、manifest（Form B 条目内嵌 manifest 抽取物）、yanked、created_at。
- 写入点 = 上传端点 pair 完成时（tgz 落盘 + 验签通过 + 同名 sig 存在）同事务写行；manifest 抽取复用 installer 解包能力。

### 二、上传端点（v2 设计原样保留）

`POST /api/_platform/cdn/upload?name=<file>`：签名鉴权（canonical `cdn-upload:<name>:<sha256>`，X-OJM-Key-Id + X-OJM-Signature 头，TrustStore + verifyEd25519，无角色检查）、文件名白名单、pair 原子性（sig 先 tgz 后，收 tgz 强制 sig 已存在且五字段合法）、大文件显式 413、`createCdnUploadApi(env)` 注入面、respond() 收口、同字节幂等/异字节 409。

### 三、目录 JSON API（新增，匿名可读，**分页**）

- `GET /api/_platform/market/catalog?page=<n>&size=<n>` → `{ total, items: [{ name, latest, publisher(key_id), versions_count, summary? }] }`——卡片清单分页视图（用户指定：清单分页、依然卡片展示）。
- `GET /api/_platform/market/catalog/detail?name=<name>` → `{ name, latest, versions: [Form B 条目] }`——安装解析用（**安装获取到包地址即可，下载/验签/解包流程照旧**）。
- 远端消费侧拼 URL：`{origin}/api/_platform/market/catalog...`（origin 取自 `framework.market_cdn_url` 站点根；相对 `/cdn` 同源补全——REG-CS6 canonical origin 纪律沿用）。

### 四、消费侧改造（`market/api.ts`）

- 原 `readIndexSnapshot` 全量视图按用途拆两条读（分页清单 / 单包详情），各自合成既有结构喂下游：
  - 市场卡片：`indexBody` 改分页数据源（卡片 UI 加翻页，展示字段不变）；
  - 安装解析：按 name 取详情 → 得 Form B 条目（含包地址/sha256/签名）→ 后续下载、包级验签、解包**一行不动**。
- 代次/时效/ETag 校验随文件模式一并退役（DB 读一致性）。
- 包字节仍从 `<cdnBase>/<file>` 静态拉（不变）。

### 五、发布写库（用户口径：上传包成功，然后入库基本信息）

上传端点 pair 完成（tgz 落盘 + 验签通过 + 同名 sig 合法）→ **同事务写 `market_release` 行**：name/version（唯一）、sha256、size、key_id、signature 三列、manifest 抽取物、created_at。

### 五、CLI（packages/cli）

- v2 成果保留：`market/remote-push.ts`（签名推送、sig→tgz 顺序、错误映射、exitCode 1）、`--remote` 旗标。
- `market build-index` / `yank-ledger` 文件面：**退役**（DB 行取代）。`ojm market yank` 改调远端/本地 API（DB 行更新）。
- 文档同步：usage.ts、publish-walkthrough.md、SKILL.md、README。

### 兼容与退役（breaking，需用户确认）

- `framework.market_cdn_url` 指向**纯静态 OSS 桶**（无 oj 运行时）的模式失去目录来源 → 退出支持，写进发版说明与迁移指南（市场源必须升级为 oj 模板站点）。
- 既有文件索引（catalog.yaml/shards/.sig）在升级后不再被读取；不要求清理（静态文件留着无害）。

## 任务清单（BDD，v3）

### 特性：签名推送（v2，不变）
- [ ] 信任库成员 + 有效签名 → 200；未信任 key → 403（附 trust add 指引）；换字节 → 401
- [ ] 非法文件名数据表 → 400；路径逃逸 fail-closed；大文件 413
- [ ] pair 约束：tgz 无 sig → 409；sig 五字段非法 → 400；同字节幂等 / 异字节 409
- [ ] CLI：sig→tgz 顺序、origin 校验表、错误映射、半成功态 exitCode 1

### 特性：DB 目录 + 分页 JSON API（v3 新增）
- [ ] **场景：pair 完成写库**：given tgz+sig 齐 when 上传 then market_release 行落库（name+version 唯一，冲突 409）
- [ ] **场景：manifest 抽取**：行内 manifest = 包内嵌 manifest 抽取物（坏包被 pair 校验挡在库外）
- [ ] **场景：清单分页**：given 库内 25 包 when `?page=2&size=10` then 返回第 11–20 条 + total=25；page/size 越界与非法值 400/收敛（数据表）
- [ ] **场景：单包详情**：given name when detail then 出 versions 全量（Form B 条目含包地址）；未知 name → 404
- [ ] **场景：安装链路照旧**：详情拿到包地址 → 下载/包级验签/解包原流程不改动（用既有 installer 测试锚）
- [ ] **场景：yank**：yank 后清单与详情即不含该版本（安装侧精确版本拒装语义保留）
- [ ] **场景：CLI↔服务端 CDN 目录 parity**（v2 遗留项，照收）

### 发版与文档
- [ ] breaking 说明（纯静态市场源退出）+ devkit 手册同步 + usage/help 同步

## 风险与开放问题

- catalog JSON 全量视图随库增长变大：当前规模（模板站点方案数）无虞；量大时再加分页/缓存，不过度设计。
- 遗留文件索引模式的 `guardCatalogFreshness`/ETag 机器在 JSON 分支下线后成为死代码——建议随 v3 一并删除（含其测试），不留双尸。
- oj 真机冒烟点（v2 已列）：multipart+query schema 校验行为。

## 总结

（实施后填写）
