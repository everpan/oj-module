# market 远端发布与 DB 目录化 + oj-market 模块化 · 计划（v4 收敛版）

- 日期：2026-11-06 19:04（v2 评审修订 19:35，v3 目录 DB 化 20:00，v4 五方评审收敛 20:55；21:30 并入 oj-market 模块化规划为 Phase B——原独立文档 `docs/plans/20261106-2103-oj-market-solution-module.md` 删除，避免多处文档）
- 分支：`feat/market-remote-publish`（基于 `feat/ojm`）
- 需求演进：
  1. `ojm market publish` 需远端推送参数（远端 = oj 模板站点，纯站点无 ojm CLI）
  2. 鉴权采用**签名制**（不经账号口令；企微用户无障碍）
  3. 远端无人跑 build-index → 索引须**转 DB 管理**，发布与展示都从 DB 获取
  4. 目录信息经 **JSON API 暴露**——本站点与远端市场统一走 JSON 协议，不读索引文件

## 变更记录

- **2026-11-06（A4 完成后）**：市场域 api（market/ + cdn/ 两面）自 `_platform` 迁入 `src/oj-market/api/`
  （路由 `/api/oj-market/*`，评估与执行记录见 `docs/plans/20261106-2255-market-api-to-oj-market.md`）；
  本文 `/api/_platform/{market,cdn}` 路径引用已全部改为新路径。表/迁移/安装引擎留 `_platform`。

## 评审记录

### 第一/二轮（2026-11-06，三位专家，v2 已全部采纳）

| 评审方 | 结论 | v2 处置 |
|---|---|---|
| 架构师 | 需修改后落地 | 签名鉴权取代角色鉴权；大文件显式 413；双写 parity 测试；发布对原子性（sig 先 tgz 后，服务端 pair 校验） |
| 工程师 | B1–B3 须补后进 TDD | `createCdnUploadApi(env)` 注入面；X-TENANT-ID 必带；respond() 收口；atomicWriteBytes；测试打法改写 |
| 产品 | 边界成立，凭据通道 + 退出码须补 | 签名制消解凭据问题；半成功态 exitCode 1；文档同步清单 |

### 第三轮（2026-11-06 20:44，五位专家并行评审 v3）

| 评审方 | 结论 | v4 处置（关键项） |
|---|---|---|
| 架构师 | 需修改后落地（1 P0 + 6 P1） | 0003 改 ALTER 演化既有表；删「同事务」改顺序纪律；origin 拼装两路径（siteOrigin 正则拒带路径 URL）；匿名面接线；yank 写端点；退役三栏清单点名；退役判据补 TOFU delta 论证 |
| 工程师 | 3 P0，修后可进 TDD | 表演化 + published_at 系列列保留；yank 端点补定义；yank 语义矛盾消解（清单摘除/详情保留 yanked 条目）；本地发布缺省走上传；上传处理顺序钉死；内存聚合分页 + 排序键；parity 重定义；死代码清单点全（含 `ojm market verify` 去向） |
| 产品 | 1 P0 | 存量回填进任务清单；keygen 凭证通道写明；2×2 兼容矩阵；yank 不动已装；迁移指南内容任务（信任库迁移）；错误文案数据表；文档清单补三处（solution-dev-build-publish.md / devkit 双拷贝 / install 帮助） |
| 安全 | 1 P0 + 5 P1 | yank 签名鉴权；canonical 加 registry_id 段（消解跨站重放）；**服务端重算 sha256 硬约束**；name → 首发 key 所有权绑定；异字节同版本先查库不碰盘（防 CDN 字节持久损坏）；manifest 体积闸 + 入库字段钳制 |
| 运维 | 2 P0 | 表名撞 0002 改 ALTER；站点侧回填命令三用（回填=恢复=对账）；孤儿文件自愈口径；备份/回滚口径；Cache-Control: no-store |

> 四方独立指认同一 P0：**`market_release` 表已在 `0002__market_release.sql` 存在**——v3 原拟「0003 新建同名表」照写必炸（无 IF NOT EXISTS 则迁移失败阻断落锁；有则静默 no-op，新列不存在运行期必炸）。v4 已按全部 findings 修订。

## 关键事实修正（v4 前置）

`market_release` **已存在**（`_platform/migrations/0002__market_release.sql`）：列 `product/version/key_id/sha256/size/published_at/published_at_source/yanked/first_seen_at`，唯一键 `(product, version)`，共享表（`tenant: false`）。活消费方：`market/api.ts` `syncReleases`（读索引补库）、`/market/releases` 端点（发布历史）、oj-market 前端类型。v4 以**演化**取代新建。

## 现状与目标形态

| 层 | 现状 | v4 目标 |
|---|---|---|
| 包字节（tgz/.sig） | cdn/ 目录，oj 静态挂载 | **不动**——安装下载链路零改动 |
| 市场目录（catalog.yaml / shards / 代次 / 索引签名） | 静态文件派生物，须 `build-index` 重建 | **既有 `market_release` 表扩列演化为真源** + **JSON API 单协议**；`build-index`/索引签名/代次/source-seq 时效机器**退役** |
| 目录消费（市场卡片 / 发布历史 / 安装解析） | `readIndexSnapshot` 拉 catalog.yaml+shards 文件并验签 | 本站直读 DB 合成同一 JSON shape；远端市场走 HTTP——**契约 shape 统一**（单协议指 shape，非传输），喂既有 parse 管线 |

退役判据（v4 补强）：索引签名（G4）防的是「静态索引文件被换」。旧世界 CDN 写权限者无法伪造索引签名 → 无法引入新发布身份；新世界 DB 行只能经受信钥门禁（TrustStore）的上传端点写出，DB 写权限 ≈ 主机级攻破（超出威胁模型），bootstrap key 播种照旧——完整性锚从「索引签名」移交「TrustStore 门禁的写通道」，可接受。包级签名（.tgz 验签 + 安装侧 TOFU）**不变**。

## 方案 v4

### 一、DB 目录（模板侧表演化，非新建）

- `0003__market_catalog.sql`（+ .mysql/.pg 三方言，ALTER 先例照 notification 0002）：对既有 `market_release` **ALTER 扩列** `sig_alg/sig_value/sig_public_key/manifest`；列名沿用 `product`（不改 `name`，免动 releases 端点与 oj-market 类型）；`published_at` 两列保留，上传写入行 `published_at_source='upload'`；syncReleases 时代旧行新列为 NULL，由回填命令 upsert 补齐（见 §六）。
- **name 所有权**（安全）：`product` → 首发 key_id 绑定不可改（复用 trust.ts「首次绑定不可改」C2-38 纪律）；后续上传 key_id 不符 → 409；换主 = 站点 superadmin 操作。

### 二、上传端点（v2 骨架 + v4 四处收紧）

`POST /api/oj-market/cdn/upload?name=<file>`：

- 签名鉴权：canonical **`cdn-upload:<registry_id>:<name>:<sha256>`**（v4 加首段 registry_id = 站点身份，消解跨站重放；与本站包级签名 REG-CS3 canonical 首段对齐）；X-OJM-Key-Id + X-OJM-Signature 头、TrustStore + verifyEd25519、无角色检查、文件名白名单、大文件显式 413。
- **硬约束：sha256 一律取服务端从实收 tgz 字节重算值重构 canonical 验签，禁止取 .sig 声明值**（防签名-字节重绑；「换字节 → 401」的实现口径）。站内重放（无 timestamp/nonce）因内容哈希绑定退化为同字节幂等，无实害——不引入时间戳，此推理写入测试注释。
- 校验序：先验 X-OJM 头（403 fail-fast）→ 再消费 body（413 由 `MAX_PACKAGE_BYTES`；部署文档要求反代 body cap 兜底——端点层是收完再拒）。
- **处理顺序（钉死）**：查库比对（同 name+version：同字节 → 幂等 200 并补缺文件〔自愈〕；异字节 → 409 **不碰盘**，防「文件先被换、DB 后拒」的字节持久损坏）→ staging 解包抽 manifest（复用 `manifestOfUpload` 移入 `_lifecycle`；validate 与 extract 之间加 `checkTarVolumeLimits` 体积闸〔REG-CS8 三限〕；`manifest.name/version` 与上传文件名逐字一致；summary ≤200 / description ≤2000 等入库钳制）→ 原子落盘（临时名 + rename）→ `db.tx` 写行（唯一键并发仲裁，撞键重读比对 sha256 定幂等/冲突）→ 任一步失败 CDN 零痕迹。
  - 注：FS+DB 无同事务，「同事务」措辞作废——`db.tx` 只包 DB 段（uninstall.ts:27 先例）；中断靠同字节重传自愈。
- 匿名面：模板 config.yaml `auth.anonymous_paths` 增加 `/api/oj-market/cdn/upload`（restart_pending 冻结段，重启生效，发版说明提醒）。
- `createCdnUploadApi(env)` 注入面、respond() 收口、pair 约束（sig 先 tgz 后、sig 五字段合法）——v2 原样保留。限速按 key_id（rateLimit 基建现成）。

### 三、目录 JSON API（匿名可读，分页）

- `GET /api/oj-market/catalog?page=&size=` → `{ api_version, page, size, total, truncated, items: [{ product, latest, publisher(key_id), versions_count, summary? }] }`（page/size 回显 + truncated 截断标记——PageResult 站点惯例，通用分页器直用）。page/size 复用 `pageArgs`（非法值**收敛**不报错、size 钳位，站点既有惯例；默认 size=20）；排序键钉死 `published_at desc, product asc`（防翻页重复/丢条目）；规模小 → 全量行 JS 聚合（`compareVersions` 已有）+ 内存分页，latest 由 API 计算（未 yanked 的 semver max，非存储列——`index_latest_regressed` 守卫自然消失）；**清单不含 yanked 行**；`Cache-Control: no-store`（防中间代理缓存陈旧目录）；`api_version` 字段给契约演进留逃生门。
- `GET /api/oj-market/catalog/detail?name=<name>[&version=]` → `{ product, latest, versions: [Form B 条目] }`。**详情保留 yanked 条目（`yanked:true`）**——安装侧「精确版本拒装 409 人话」依赖条目可见 + yanked 标记，清单摘除/详情保留分离保全两侧语义；versions 按 semver 降序；`archive.file` 正名校验留在服务端组表处。
- `POST /api/oj-market/yank`（v4 新增）：body `{ product, version, reason? }` + X-OJM-Key-Id/Signature，canonical **`market-yank:<registry_id>:<product>:<version>`**，TrustStore 校验；授权：key_id 须匹配该行 key_id（不符 403）、版本不存在 404、重复 yank 幂等 200；by/reason 审计落 `market_history`；恢复（unyank）同模型。superadmin 管理通道可覆盖/换主。
- 匿名面：`auth.anonymous_paths` 增加 `/api/oj-market/catalog*`（同 §二重启口径）。
- 错误文案卫生：匿名读端点（catalog/detail）的 message 不得含路径/SQL/内部拓扑——`failWith` 现状原样透传 err.message（respond.ts:7-14），而 trust.ts 等既有文案内嵌 fs 路径，勿照搬。
- origin 拼装（v4 修正）：`siteOrigin` 正则不接受带路径绝对 URL，不可直接复用——绝对基址**剥尾部 `/cdn` 得 origin**（剥不出 → 503 指向设置项）；相对基址走 `requireCanonicalOrigin`。两条路径进数据表用例。远端消费侧拼 `{origin}/api/oj-market/catalog...`。

### 四、消费侧改造（`market/api.ts`）

- 「单协议」= 契约 shape 统一：本站消费**直读 DB** 合成同一 JSON shape（省自环 fetch/canonical origin/匿名面三重依赖），远端市场走 HTTP。
- 市场卡片：`indexBody` 改分页数据源（卡片 UI 加翻页，展示字段不变）；本地 installed/enabled/trust_state 的 join 留在站点消费侧（目录 API 直出纯目录字段；v4 后本地发布必经上传、遗留包经回填入 DB，本地独有集合为空，不再有本地⊕远端分页外拼接）。
- 安装解析：按 name 取详情 → Form B 条目（含包地址/sha256/签名）→ 下载、包级验签、解包**一行不动**（既有 installer 测试锚）；yanked 精确版本 409 人话语义保留。
- 包字节仍从 `<cdnBase>/<file>` 静态拉（不变）。

### 五、CLI（packages/cli）

- `market/remote-push.ts`（v2 成果保留）：签名推送、sig→tgz 顺序、错误映射、半成功 exitCode 1；`ojm market publish` **缺省即走上传端点**（本地-only 落盘模式退役——DB 模式下本地落盘 = 市场不可见）。
- `ojm market yank` 改调 POST yank（`--id` + 重建索引约束消失，参数面同步 usage.ts）；yank **不动已装方案**，仅目录摘除并阻断新装/升级（对标 trust revoke 先例）。
- `ojm market verify`：退役索引验签/漂移面（generationCheck/driftOf/declaredHashes）；**包级验签保留**。
- `ojm market build-index` / `yank-ledger` 文件面退役（DB 行取代）。
- 发布者密钥旅程：签名身份**沿用 `ojm keygen --credential` 凭证兑换通道**（key_id 由站点按「产品名.用户名」下发），写进发布文档——403 的 trust add 指引前提是手上已有 key_id。
- `registry-export.ts` 不受影响（另一套 registry 文件面，非市场目录），明示留档。
- `market trial` / fixture：DB 模式下试车/夹具的目录来源改 seed `market_release`（站点内部通道，不走上传签名面），实施期核对 trial.ts/fixture.ts 的索引依赖面并随退役清单处置；cdn/ 从此只是字节仓库。

### 六、存量回填与灾备（v4 新增）

- **站点侧扫描命令三用（回填=恢复=对账）**：扫 cdn/ 存量 tgz → 内嵌 manifest 抽取（同一抽取管线）+ 旁车 .sig（key_id/签名可验签恢复）→ upsert `market_release`；幂等可重入；无 CLI 依赖（远端纯站点可用）。0003 迁移随站点升级自动应用（同 0002 机制），**回填在迁移后**执行。
- 触发口径二选一（实现期定）：升级惰性（首次读目录表空且遗留索引可读时导入，syncReleases 先例）或 superadmin 一次性命令/端点；设计取扫描命令本体（兼灾备恢复与对账）。
- 备份口径：DB 备份 = 目录真源快照；恢复后跑扫描对齐 cdn/（R14 迁移前置备份仅覆盖 sqlite，发版说明注明）。
- 回滚口径：遗留文件索引不清 → 旧版本可回滚；升级后经新端点上传的包回滚后须人工跑旧 CLI `build-index` 收编；v3+ 期间 yank 只写 DB 行，回滚后 yanked 版本复活窗口在发版说明明示。
- 孤儿面：孤儿 tgz（有文件无行）由扫描命令补行自愈 + 同字节重传幂等自愈；孤儿 .sig（sig 先行 tgz 未至）静态残留**容忍**（须受信 key 才能制造），不加 GC。
- 观测：发布成败写 `market_history`（action=publish），排障不只剩访问日志。

### 兼容与退役（breaking，需用户确认）

**2×2 版本兼容矩阵**（lockstep 只锁 CLI↔宿主；远端站点版本用户自运维，不受保护）：

| | 旧站点（文件索引） | 新站点（DB 目录） |
|---|---|---|
| 旧 CLI | 现状 | **静默陈旧**（最危险）：catalog.yaml 残留使旧 CLI 停在升级瞬间快照，新包不可见——升级时顺手删除站点 catalog.yaml/shards 使旧 CLI **显式报错**而非半工作 |
| 新 CLI | catalog API 404 → 人话错误「站点版本过旧」+ 迁移指南链接 | 目标态 |

- `framework.market_cdn_url` 指向**纯静态 OSS 桶**的模式退出支持（发版说明 + 迁移指南）。
- **迁移指南**（docs/migration/ 命名先例）内容任务：检测方法（CLI 探测 catalog API 404 → 人话错误）；步骤（搭 oj 模板站点 → 0003 迁移 → 回填 → **信任库 `.solutions/trusted-keys.yaml` 迁移与 key_id 延续**——key_id 断则全部包验签崩，指南最重一句）；错误文案样例。

### 退役-改写-保留清单（v4 点名，不留双尸）

- **退役**：CLI `build-index.ts`/`index-builder.ts`/`sharding.ts`/`yank-ledger.ts`、`verify.ts` 索引面、usage.ts 文案；站点 `fetchIndex`/`verifyIndexSig`/`indexCanonical`/`indexSeqOfText`/`indexTimesOfText`/`parseCatalog`/`parseShard`/`readIndexSnapshot`/`syncReleases`/`archivePublishedAt`/`guardCatalogFreshness`/`etagCache`、`index-source.ts` 整模块、`source-seq.ts` + `reg_source_seq` 表；测试 market-api.spec 的 REG-CS1/REG-CS2/REG-CS5/releases-sync describe 块、build-index/yank-ledger/verify 索引面测试。
- **改写**：`/market/releases` 端点改读上传写入行（发布历史页数据源延续，同表零迁移）；`ojm market yank` 调 API；market-api.spec 增 v4 场景。
- **保留**：cdn/ 字节与静态挂载、包级验签/安装侧 TOFU/信任库全套、installer 解包、`registry-export.ts`、releases 端点壳（数据源换）。

## 任务清单（BDD · Phase A：远端发布与 DB 目录化）

### 特性：签名推送（v2 保留 + v4 收紧）
- [x] 信任库成员 + 有效签名（canonical 含 registry_id）→ 200；未信任 key → 403（附 trust add 指引）；换字节 → 401（**服务端重算 sha256** 断言：sig 声明值与实收字节不符拒签）；registry_id 不符（跨站重放）→ 401
- [x] name 所有权数据表：非首发 key 推既有 name 新版本 → 409；首发 key 正常
- [x] 非法文件名数据表 → 400；路径逃逸 fail-closed；大文件 413；头先验 fail-fast（无头大 body → 403 不消费 body）；限速按 key_id 生效断言
- [x] pair 约束：tgz 无 sig → 409；sig 五字段非法 → 400；同字节幂等（含补缺文件自愈）/ 异字节 409 **不碰盘**（数据表含并发撞键仲裁）
- [x] manifest：体积闸（解压炸弹）→ 413；坏 manifest → 400 零落盘；入库字段钳制数据表（summary/description/name/version 逐字一致）
- [x] CLI：sig→tgz 顺序、origin 校验表、**错误文案数据表**（401/403/409→bump version/半成功→「重跑本命令幂等补齐」）、exitCode 1

### 特性：DB 目录 + 分页 JSON API（v4）
- [x] 0003 迁移三方言 ALTER 成功；既有行不破坏（releases 端点照常读）
- [x] **场景：pair 完成写行**：tgz+sig 齐 → market_release 行落库（product+version 唯一，published_at_source='upload'）；旧行 NULL 列由回填补齐；发布成败审计落 `market_history`（action=publish）
- [x] **场景：manifest 抽取**：行内 manifest = 包内嵌抽取物（坏包被 pair 挡在库外）
- [x] **场景：清单分页**：25 包 `?page=2&size=10` → 第 11–20 条 + total=25；非法 page/size 收敛（pageArgs 口径，数据表）；排序稳定断言（同 published_at 按 product 升序）；清单不含 yanked
- [x] 市场卡片翻页 UI：`indexBody` 接分页数据源 + 翻页控件（展示字段不变，§四）
- [x] **场景：单包详情**：versions 全量含 `yanked:true` 条目；未知 name → 404；`?version=` 过滤；latest = 未 yanked 的 semver max
- [x] **场景：安装链路照旧**：详情拿到包地址 → 下载/包级验签/解包原流程零改动（既有 installer 测试锚）；yanked 精确版本 409 人话语义保留
- [x] **场景：yank 端点**：签名 + key 匹配 → 200（清单即摘除、详情标 yanked）；key 不符 403；未知版本 404；重复幂等 200；by/reason 审计落 market_history；unyank 恢复同模型；CLI 错误映射/exitCode 对齐
- [x] **场景：origin 拼装数据表**：绝对基址剥 `/cdn`；相对基址走 canonical_origin；剥不出 → 503 指向设置项
- [x] **场景：匿名接线**：anonymous_paths 放行断言（catalog 两条 GET、upload）+ 重启生效口径
- [x] **场景：parity（v4 重定义）**：CLI 推送响应（sha256/size/key_id）↔ DB 行 ↔ detail API 三方一致
- [x] **场景：回填命令**：cdn/ 存量扫描 → upsert 落库（幂等重入，重复跑行数不变）；灾备演练：清表 → 扫描恢复（数据表：含 .sig 缺失行的降级）

### 发版与文档
- [x] breaking 说明（纯静态市场源退出 + 2×2 矩阵 + 回滚口径 + 匿名面重启生效）+ 迁移指南（含信任库迁移）+ usage/help 同步 + `docs/guides/solution-dev-build-publish.md` + devkit 手册**双份拷贝**（docs/devkit/ 与 packages/cli/devkit/）+ failure-playbook 错误文案

## 风险与开放问题

- 分页/缓存口径已定（内存分页 + no-store）；SQL 真分页留待规模信号。**明确不做**：搜索/过滤/排序参数、包删除语义、detail 分页（版本极多的 name 留观察）。
- key_id/summary 经匿名 API 公网可枚举：接受（key_id 本为公开 CDN 文件内容）。
- yank 授权精细度（如协作者多 key）当前按「行 key_id 单一绑定」，多发布方协作留开放问题。
- 撤销 key：**不回收 catalog 存量行**（G5 口径——不动已装/已发布），detail 已带 key_id 供消费侧自行比对此站信任库（IndexRow.trust_state 先例）。
- （v2 已列）oj 真机冒烟点：multipart+query schema 校验行为。

## 衍生规划（Phase B）：oj-market 独立解决方案模块化

> 定位与顺序红线：Phase A 落地后进行——市场 UI 须先成为纯 JSON API 消费者（catalog/detail/yank/签名推送全走 HTTP）方可拆分。实施期另起 `feat/market-solution-module` 分支（基于落地后的 `feat/ojm`）。

### 决策记录（2026-11-06 21:00–21:22）

| # | 问题 | 拍板 |
|---|---|---|
| 1 | 引导悖论（无市场 UI 谁装市场） | 市场内置（随站点分发，不从远端自举）；出厂**未装**，superadmin 手动首装（21:12）；`ojm init --yes` 自动化路径主动补充（21:14，`--yes` = 已授权无人值守，与手动分路径并存） |
| 2 | R29 第一方纪律（第三方不得仿照 `/api/_platform/*` 调用面） | 红线不变随包迁移：包 manifest/README 标注第一方专用 |
| 3 | 自更新（市场经自己升级自己） | 21:20 拍板**双轨**：随站 bundle 收敛（平台轨）+ **按常规 solution 包对 oj-market 发包并升级**（市场轨，已装站点 superadmin 经市场升级，与普通包无异）——推翻此前「不做」初判 |
| 4 | 权限面 | 保持 **superadmin 门禁**（沿用 R9），不新增 `platform.market.*` 权限点 |

**可行性核实**（三点）：solution 体系已支持携带前端——安装器 `deploy-web` 把包内 `web/` 产物部署到 `<dist>/modules/<name>/<version>/` 并原子 upsert `modules.json`（D13：读者永不见半截 JSON，损坏拒 upsert），shell 按 `name/entry/peerRuntime/css/integrity` 动态装载；安装编排端点在**平台后端**（`POST /api/oj-market/install`，superadmin，R9，交 `runInstall` 状态机 + `/install/cancel`；bootstrap key 播种免首装 TOFU）——市场 UI 拆走后仍在；挂点只读核查 `../oj-bin`（21:16）——安装全管线模板侧进程内执行（migrate 走 `exec.run(["oj","migrate",--format,json,-d,dir,module])` 白名单契约，S1-6 实测），**init 期无 dist 无 DB、同步安装不可行** → 收敛锚定**站点启动段**（与 `migrate_on_start` / `reconcile()` 同段，每次启动幂等对账），**oj 二进制零改动、无跨仓发版**。

### 方案（Phase B）

1. **包形态**：`oj-market` 第一方 solution 包——manifest（module=oj-market + routes decl）+ `web/` 产物；**无 DB 迁移**（catalog/release 等表属平台，不随包）。DRY：零新机制，复用 installer 十阶段、deploy-web、trust store、`req.reinstall` 幂等语义。
2. **安装入口（市场外）**：shell `system` 域新增极简「方案安装」入口（superadmin 门禁），接线既有安装编排 API——市场未装/已卸载时唯一手动安装面；市场在位时其自身 InstallDialog 照旧。
3. **卸载**：市场 UI 支持自卸载（superadmin），确认文案警示「卸载后仅可经系统管理入口重装」；卸载**不动**其他已装方案、`market_release` 行、cdn/ 字节（平台数据归平台）。
4. **R29**：见决策记录 #2。
5. **`ojm init --yes` 主动补充（平台轨）**：脚手架完成后将随站 oj-market 包纳入启动收敛——规则**上拉不下拉**：未装 → 装；bundle 版本 > 已装 → 升级（reinstall 语义）；bundle ≤ 已装 → **跳过**（bundle < 已装 = 用户经市场轨升过，不降级——对齐 rollbackGuard 禁降版红线 OJ-9）；安装失败 → **降级不阻断建站**（warning + superadmin 手动面兜底）。终态：站点首次可用时市场已在；bundle 随站升级后下次启动自动收敛（不追平市场轨升出的更高版本）。
6. **常规包轨（市场轨，已装站点）**：oj-market 新版本走**标准发布流程**发包——`ojm market publish` / Phase A 签名推送进 cdn/ + `market_release`；`oj-market` 名字由平台 key 首发锁定（name 所有权直接复用：非平台 key 发 oj-market → 409）；已装站点 superadmin 经市场 UI 像升级任何 solution 一样升级它（安装器升级/回滚语义既有；peerRuntime 版本校验沿用 module loader）。双轨版本关系：市场版本 ≥ 出厂 bundle（bundle 是基线非上限）；**版本基线 0.2.0 起**（21:22 拍板）。

原则自检：**INVEST**——仅依赖 Phase A 的 JSON API 契约，Negotiable 点（安装入口落点、CLI 兜底）入开放问题；**DRY**——零新安装机制全复用，本段不重复 Phase A 内容只引用；**SOLID**——市场 UI 依赖 `_platform` JSON API 稳定契约而非平台内部实现，包边界单一职责（纯前端装载面，无迁移无后端）。

### BDD 特性与场景（Phase B，实施期落 Vitest）

**特性 1：市场包随站分发与 superadmin 安装**

- 场景：出厂未装（交互式 init 路径）：given 新站点经**交互式** init 初始化 when 访问 `/oj-market` then 404（`sys_solution_route` 无行）、菜单无市场项、system 域可见「方案安装」入口
- 场景：superadmin 安装：given 平台 key 签名的 oj-market 包 when 安装 then 十阶段成功 → `modules.json` 有条目 + `sys_solution_route` 注册 + `/oj-market` 可访问
- 场景：权限门（数据表）：

  | 角色 | 调 `POST /market/install` | 期望 |
  |---|---|---|
  | superadmin | 安装 | 200 + 任务 id |
  | 普通管理员 | 安装 | 403 |
  | 普通用户 | 安装 | 403 |
  | 匿名 | 安装 | 401 |

- 场景：验签 fail-closed：given 包被篡改（平台 key 验签不过）when 安装 then 拒装，`modules/` 与 `modules.json` 零痕迹
- 场景：重复安装：同版本 → 幂等 200（reinstall 语义）；异版本 → 升级路径
- 场景：modules.json 损坏：given 清单损坏 when deploy-web upsert then 拒绝（D13 红线，既有行为锚定成用例）
- 场景：`ojm init --yes` 主动补充（数据表；收敛执行于启动段对账，幂等）：

  | 站点状态 | bundle 版本 | 启动收敛行为 |
  |---|---|---|
  | 未装 | v1 | 安装 v1 |
  | 已装 v1 | v2 | 升级至 v2 |
  | 已装 v2 | v2 | 跳过（幂等） |
  | 已装 v3（市场轨升的） | v2 | **保留 v3 不降级**（rollbackGuard OJ-9 同源） |

- 场景：init --yes 安装失败降级：given 安装失败 when `init --yes` then 建站不失败（warning 上报，superadmin 手动面兜底）
- 场景：交互式 init 不动：无 `--yes` 时零安装动作（保持手动口径）

**特性 2：市场自卸载与重装闭环**

- 场景：superadmin 卸载：given 市场已装 when 卸载 then UI/路由消失；其他已装方案、`market_release`、cdn/ 字节零变动
- 场景：卸载后重装：given 市场已卸载 when system 入口重装 then 回到可用态（bootstrap key 已播种，免 TOFU 摩擦）
- 场景：安装中断：given 安装进行中被取消/失败 when 清理 then 无半成品残留（installer 既有清理语义锚定）

**特性 3：契约回归（静态口径）**

- 场景：市场 UI 调用面不变：拆分后 UI 仍消费 `/api/oj-market/*`（A4→A5 间已完成市场 api 自 _platform 迁入 oj-market 模块，既有 market-api 测试面全量回归为锚）
- 文档任务：包 README + manifest 标注 R29 第一方专用（无运行时用例）

**特性 4：常规包轨（已装站点按普通包对 oj-market 发包并升级）**

- 场景：标准发包：given 平台 key when 对 oj-market 发 v3（Phase A 签名推送）then cdn/ 字节 + `market_release` 行落库 + 市场卡片可见（与普通包无异）
- 场景：name 所有权：given 非平台 key 的受信 key when 发 `oj-market` 任意版本 then 409（首发绑定规则）
- 场景：市场内升级：given 已装 v2 站点 when superadmin 经市场升级 oj-market → v3 then 安装器升级语义完成（升级/reload/回滚既有），启动收敛不再下拉（数据表第 4 行）
- 场景：运行中自升级：given 市场正被使用 when 升级自身 then 沿用 installer 升级路径（失败回退既有语义），前端模块热替换后**页面 reload** 语义实施期补

### 任务清单（Phase B，**暂不执行**；待 Phase A 落地）

阶段 0（规划，已完成）：

- [x] 可行性核实（solution 体系/deploy-web/安装编排/`../oj-bin` 挂点）
- [x] 四次拍板（安装模型/出厂态/init --yes/常规包轨双轨 + 版本基线）
- [x] 设计与 BDD 用例编制（本段，21:30 并入本计划）

阶段 1（实施）：

- [ ] T1 打包：oj-market 构建为 solution 包（复用 ojm build 产物形态 + 平台签名）+ 随站点产物分发落位 + 版本 bump 至 **0.2.0**（entry.ts 现值 0.1.0）
- [ ] T2 shell 改造：摘除 `app/web/entry.ts` 静态 import；出厂未装态（空态菜单/路由缺省行为）
- [ ] T3 安装入口：shell system 域「方案安装」接线既有 `POST /market/install`（superadmin）
- [ ] T3b `ojm init --yes` 接线：包落位 + 意图标记（init 侧）；启动段对账收敛实现（模板侧，与 reconcile/migrate_on_start 同段定着锚行）+ 上拉不下拉规则 + 失败降级
- [ ] T3c 常规包轨：标准发包流程验证（平台 key + name 所有权 409）+ 市场内升级 + 启动收敛不降级 + 运行中自升级 reload 语义用例
- [ ] T4 BDD 用例落地：特性 1/2 场景进 installer/market-api spec；特性 3 回归锚
- [ ] T5 文档同步：devkit 手册双拷贝、usage、README、R29 标注

### 风险与开放问题（Phase B）

- 开放问题：安装入口是否再留 `ojm` CLI 端命令兜底（无浏览器场景）——INVEST 允许推迟，实施期定。
- spec 隐含失败面（无用例直击，实施期补）：站点升级期间 `modules.json` 与包版本错窗；双 superadmin 会话并发安装（R17 同名互斥已有，锚定用例）；出厂未装时首屏对「无方案管理能力」的引导文案。
- ~~ojm/oj 二进制边界~~（已消解，21:16 核查）：遗留实施期验证——启动段具体锚行（reconcile 调用链与 `migrate_on_start` 时序，收敛须排在其后）；bundle 包在脚手架工程内的落位目录与进 dist 的构建接线。init --yes 安装失败**降级不阻断**口径如需改 fail-fast，实施前复核。
- 双轨版本漂移（市场 v3 / bundle v2 长期共存）为**正常态**：启动对账只上拉；降级唯一入口 = 站点回滚（rollbackGuard 已禁降版迁移）。运行中升级自身的前端热替换窗口是剩余边角（reload 语义，T3c 锚定）。

**Phase B 规划小结**：耗时约 45 分钟（20:40–21:22 规划 + 21:30 并入本计划），四次拍板 + 两轮核实，代码零改动；如有异议随时修订本段。

## 总结

**Phase A 已按 v4 口径全部落地**（任务清单 A1–A9 全勾），Phase B（方案化改造）按计划暂不执行。

- **关键过程**：计划编制 11-06 19:04 起；实施 11-07 00:42–02:21，7 个提交
  （514c260e0 → 22b19a82f），主线为 catalog/registry_id 发现面（A6）→ 签名推送与
  yank API 化、索引面 CLI 侧整建制退役（A6）→ parity 三方一致用例（A6 收尾）→
  根套件残留清零（别名/验面抽取/client 接线/白名单，a8de24367）→ 站点侧回填端点
  三用（A7）→ 匿名面双列接线（A8）→ breaking 说明/迁移指南/发版材料（A9）。
  全程 TDD：BDD 用例先行（backfill.spec 9 例、anonymous-wiring.spec 3 例、
  parity/market-api 回归锚），每个 RED→GREEN 留痕；实施中 ruled 10 项（触发口径取
  superadmin 端点、`**` 一条覆盖、openapi 生成物原样入库、devkit 单真源同步等），
  反常识发现 2 项（manifestOfUpload staging 常量 upload.tgz、assertSuperAdmin 匿名亦 403）
  均已记入 ledger 与文档。
- **终态验证**：根套件 939 passed | 1 skipped（940）；cli 套件 638 passed | 1 skipped（639）；
  templates 套件 1118/1118；packages/cli 与 templates 双 tsc 零错；ojm init --yes →
  ojm build 冒烟工程全链路绿。三个测试套件 + 双 typecheck 为 Phase A 完成判据，全过。
- **耗时**：实施约 1 小时 40 分（00:42–02:21），加计划编制与收尾验证合计约 3 小时；
  文档改写（迁移指南/devkit 双拷贝/CHANGELOG/walkthrough）占收尾段约 1/3。
