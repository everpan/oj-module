# 解决方案 Registry · 阶段性任务计划

- 日期：2026-10-25（v2.2 红队校订：2026-10-25）
- 分支：`feat/ojm`（基线 `e6994b75`）
- 依据：`docs/prd/202610250010-solution-registry-requirements.md`（**v2.2**，需求已拍板 Q1–Q12；
  红队演练见该文 §16）
- 状态：**仅计划，未开工**。阶段内任务全部实现后才做阶段审查，审查通过再写阶段小结。
- 上位约束：`docs/prd/solution/ARCHITECTURE.md`（解决方案不能自建登录端点 / 自管 RBAC 数据）
- 术语：一律按需求文档 **§0.1 术语白话对照** 理解；本文新出现的词都在括号里给一句白话，
  不再造新缩写。

---

## 1. 计划边界

| 在计划内 | 不在计划内 |
|---|---|
| 需求 v2.2 的 **20 条 MVP**（P0-C 8 + P0-R 12） | backlog 明列的 25 条（§6.1/§6.2） |
| 每条需求的子任务、BDD 场景、验收条件 | 详细接口签名与表 DDL（属设计阶段，另出文档） |
| 阶段门禁与阶段小结模板 | §8.2 的两个独立 PR（`--url` 改名、license 展示单独回滚） |

**执行纪律**：阶段内任务按顺序实现，**一个阶段内全部任务完成前不开下一阶段**；阶段末做审查（§6），
审查通过后追加阶段小结（§7），小结随下一次提交入库。

---

## 2. 阶段结构

```
S1 索引可信 ──► S2 分发与撤回 ──► S3 registry 地基 ──► S4 发布链路 ──► S5 消费链路
 CS1 CS2 CS3     CS5 CS4 CS6        R1 R2 R3 R4 R12    R5 R6 R7        R8 R9 R10 R11
 CS7 CS8
```

| 阶段 | 目标（一句话） | 需求 | 前置 |
|---|---|---|---|
| **S1 索引可信** | 索引必须签名、必须新鲜、不能跨仓重放；顺手堵掉「包能撑爆磁盘」和「名字能撞路由」 | REG-CS1 / CS2 / CS3 / **CS7** / **CS8** | 无（可立即开工） |
| **S2 分发与撤回** | 索引能分片能缓存、能撤回单个版本、不再信任伪造 Host | REG-CS5 / CS4 / CS6 | S1（复用验签与 seq） |
| **S3 registry 地基** | 一个装进宿主站点的模块：不建账号，只有 token / 公钥 / 生命周期 / 可自动化 CLI | REG-R1 / R2 / R3 / R4 / R12 | S2（索引格式稳定） |
| **S4 发布链路** | 能按 scope 发布，五查挡住脏包与超大包，索引由 CI 外置签名 | REG-R5 / R6 / R7 | S3 |
| **S5 消费链路** | 能按源安装（且源受控）、能集中吊销、能离线导入与回滚 | REG-R8 / R9 / R10 / R11 | S4 |

**为什么这个顺序**：S1/S2 是**不依赖 registry 存在**的静态仓硬化（`cdn/` 目录就够），
其中 REG-CS6 是**现有安全洞**，与立项无关；S3 之后才需要「装上这个包」。

**S1 为什么塞了 CS7/CS8 两条不相干的**：它们都**不依赖 registry**、都在安装链路上、都是「一条护栏
抵掉一整类事故」，且与索引硬化共享同一批用例夹具（`tests/e2e` 的安装链）。放在 S1 只为省一次
环境搭建，不代表概念上同类。

---

## 3. 通用工程约束（每阶段都必须满足）

> 本节三个词先给一句白话，后面不再解释：
> - **DIP（依赖倒置）**＝代码只认「接口」，不认「从哪来的」。今天从本地目录读、明天从 HTTP 读，调用方不用改。
> - **规范串（canon）**＝签名前把「哪个仓库 + 哪个包 + 哪个版本 + 内容指纹」拼成一行字，签的是这行字。
>   换仓库后这行字变了，签名自然失效——这就是「防跨仓重放」的原理。
> - **stale-while-revalidate**＝缓存还能用时先把旧的给你，同时在后台去取新的。代价是「新数据最多晚 N 秒生效」。

### 3.1 SOLID 落地

| 原则 | 本计划里的具体落点 | 反例（禁止） |
|---|---|---|
| **SRP** | 索引三件事分开：**渲染**（数据→YAML）、**签名**（字节+密钥→sig）、**校验**（字节+sig→bool）。三者互不调用 | 在渲染函数里顺手签名 |
| **OCP** | 索引 schema 带 `schema_version`；新增字段不改读取器分支，改版本适配器 | 在读取处堆 `if (v === 3)` |
| **LSP** | `IndexSource` 接口（`readCatalog/readShard/readArtifact/readRevocations`）的两实现——**本地目录**与**registry API**——可互换，调用方不感知 | 调用方 `if (isLocal) fs.readFile else fetch` |
| **ISP** | 读面拆成 4 个窄接口（catalog / shard / artifact / revocations），不做一个 `getEverything()` | 一个胖接口逼实现方写空方法 |
| **DIP** | 站点侧只依赖 `IndexSource` 抽象；基址推导**只走** `packages/cli/src/market/cdn-layout.ts`（该文件已是单一真相点） | 各处手拼 `${base}/bundles.yaml` |

### 3.2 DRY 落点（附现状实锤）

| 重复 | 证据 | 收敛方式 | 落在哪个阶段 |
|---|---|---|---|
| **版本比较两套** | 索引侧 `market/index-builder.ts:63-76` 只比数值段；安装侧 `_lifecycle/semver.ts:51-61` 是完整 semver | 抽一个 `compareSemver`，两侧都调它 | **S2 前置**（否则 CS5 分片后 latest 会错） |
| 索引基址多次推导 | `cdn-layout.ts` 已有单点，但 `market/api.ts` 仍按 `${base}/bundles.yaml` 手拼 | 读取全走 `IndexSource` | S2 / S5 |
| 错误码两族分散 | 安装侧 `failure-playbook.ts:20-57` 六码；发布侧无 | 统一码表 + 两侧各自渲染 | S4 |
| **体积上限散落（红队 F1）** | 现状三处各自为政：下载侧只有索引 `size` 比对、解压侧**零**守卫、上传侧只算 size 不设上限 | 抽 `_lifecycle/limits.ts` 四个常量，下载/解压/上传**三处共用** | **S1-5**（上传侧到 S4-2 才接，常量先立） |
| **tar 清单解析（红队 F1）** | `tgz-guard.ts` 已经在逐行解析 `tar -tvzf`，只用来判路径/类型 | 顺手在同一次解析里累加体积/条目数，**不新增一次 IO** | S1-5 |

> 版本比较的重复**必须在 S2 第一条任务里修**：分片后每片各自算 latest，两套口径会让
> `1.0.0-10` / `1.0.0-2` 在不同片里排反。

### 3.3 BDD 写法（强制）

每个需求至少 **1 个 Scenario**，写在对应的 `*.spec.ts` 里，先 RED 再实现：

```gherkin
Feature: <一句话能力>
  Scenario: <可观察结果>
    Given <前置状态>
    When  <触发动作>
    Then  <可观察结果>
    And   <不该发生的事>
```

| 约定 | 说明 |
|---|---|
| 用例位置 | 单元/契约：`tests/<module>/<feature>.spec.ts`；端到端：`tests/e2e/<feature>.spec.ts` |
| 可观察性 | 只断言**外部可见**的结果（命令退出码、stdout/`--json`、HTTP 状态、索引字段、装/不装），不断言私有函数 |
| 一场景一断言意图 | 一个 Scenario 只验证一个行为；多条 Then 只能围绕同一意图 |
| 禁止假绿 | 不用 mock 顶替被测对象本身；需要 HTTP 就起真实端口（沿用既有 e2e 栈） |

### 3.4 INVEST 自检（20 条）

| ID | 用户故事（作为…我要…以便…） | I | N | V | E | S | T |
|---|---|---|---|---|---|---|---|
| CS1 | 作为平台管理员，我要索引缺签名就拒装，以便镜像改不了治理面 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS2 | 作为平台管理员，我要拒收 seq 回退的索引，以便旧快照不能复活已 yank 版本 | ✓ | ✓ | ✓ | △ | ✓ | ✓ |
| CS3 | 作为仓库运营，我要规范串带仓库身份，以便包不能搬到别的仓库重放 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS5 | 作为运维，我要索引分片且可缓存，以便出网量不再放大 200 倍 | ✓ | ✓ | ✓ | △ | △ | ✓ |
| CS4 | 作为作者，我要下线单个版本，以便不背着一个坏版本 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS6 | 作为运维，我要相对源不再随 Host 头漂移，以便堵住内网 SSRF | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS7 | 作为平台管理员，我要 `registry`/`oj`/`ojm` 不能被抢注，以便本功能不会自己撞自己 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS8 | 作为运维，我要包体和解压体积有上限，以便发布方决定不了我的磁盘和内存 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R1 | 作为部署者，我要 registry 用站点原有账号，以便不多一套密码 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R2 | 作为作者，我要一个可吊销的上传凭证，以便私钥泄露不等于发布权泄露 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R3 | 作为作者，我要新公钥绑定需二次确认，以便偷到 token 也发不了包 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R4 | 作为作者，我要能轮换/吊销密钥，以便离职与换机不失控 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R12 | 作为 CI，我要退出码/`--json`/`--dry-run`/env token，以便不进交互也能发版 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R5 | 作为作者，我要用 `@acme/demo` 发布，以便同名包不互相污染 | ✓ | ✓ | ✓ | ✓ | △ | ✓ |
| R6 | 作为作者，我要发布前被五查拦下，以便脏包和超大包进不了仓库 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R7 | 作为运维，我要索引在 CI 外置签名，以便签名私钥可离线保管 | ✓ | ✓ | △ | ✓ | ✓ | ✓ |
| R8 | 作为消费平台，我要按可见性固定取数载体，以便私有包不会被匿名下载 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R9 | 作为平台管理员，我要一条命令换源安装，以便跨仓库装包 | ✓ | ✓ | ✓ | ✓ | △ | ✓ |
| R10 | 作为平台管理员，我要吊销清单拉不到或被动过就拒装，以便刹车不会静默失灵 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R11 | 作为内网运维，我要离线导入与本地回滚，以便源挂了还能救 | ✓ | ✓ | ✓ | △ | △ | ✓ |

`△` 说明（诚实标注，不硬凑全绿）：
- **CS2-Estimable △**：seq 状态落点已定为站点侧 DB 表（D1），但仍要新增一张表 + 迁移，估算区间偏大。
- **CS5-Estimable △ / Small △**：分片改造横跨生成器与三处读取方，实际是 3 个小任务拼接。
- **CS5-Valuable △**：价值是成本侧的（省 200 倍带宽），不是新功能。
- **R5-Small △**：scope 目录键与 slug 映射要动发布、索引、安装三处，属中等。
- **R7-Valuable △**：对作者不可见，是运维安全属性。
- **R9-Small △**：含服务端契约升级（API 0.1.0→0.2.0），跨包改动。
- **R11-Estimable/Small △**：离线包格式一旦定错要返工，建议先出 1 页格式草案再排期。
- **CS7 / CS8 全绿的理由**：各只动一处清单 / 一处常量加三处调用，验收可用 `grep` 与用例总数断定，
  **不需要跨包协调**，也**不依赖 registry 是否存在**。

---

## 4. 阶段明细

### S1 索引可信（REG-CS1 / CS2 / CS3 / CS7 / CS8）

#### S1-1 REG-CS1 索引签名强制

**子任务**
1. 删掉 `market/verify.ts:142-143` 的「缺失容忍 → ok」分支，改为 `signature=mismatch/missing`。
2. 安装前置（`market/api.ts` 取索引处）增加索引验签，失败即拒装并给可执行下一步。
3. 过渡期：保留一个版本的 `warn`，下一个版本转硬（**不留永久开关**）。
4. **同代校验（红队 F2）**：签名覆盖 `(kind, seq)` 而不只是文件字节；`catalog` / `shard` /
   `revocations` 三份文件各带 `seq`，读方先取 catalog 的 `seq`，再要求所取分片与清单的 `seq`
   相等，不等即拒。**白话说**：不允许把「今年的总目录」和「去年的分册」拼起来用。

**BDD**
```gherkin
Scenario: 索引没有 .sig 时安装被拒
  Given 一个只有 manifests.yaml 没有 manifests.yaml.sig 的源
  When  执行 ojm install demo@1.0.0
  Then  退出码为 1
  And   输出包含「索引签名缺失」与「如何补签」两步提示
  And   没有发生任何网络下载

Scenario: 总目录与分册不是同一代
  Given 源上 catalog.yaml 的 seq=7
  And   它指向的分册 shards/2.yaml 的 seq=6（上一次没写完）
  When  执行 ojm install demo@1.0.0
  Then  退出码为 1，错误码 index_generation_mismatch
  And   提示「源正在重建索引，请稍后重试」而不是「索引被篡改」
```

**验收条件**
- [ ] 代码中不存在「索引签名缺失 → 通过」的路径（可用 `grep` 断言该分支已删）
- [ ] `.sig` 存在但字节被改 → 拒装，错误码可区分 `missing` / `mismatch`
- [ ] 离线 `ojm market verify` 与站点安装**同一判定**，不出现一个拒一个放
- [ ] **跨文件不同代 → 必拒**，且错误码与「签名不符」区分开（前者是运维事故，后者是安全事件）
- [ ] 无新增配置开关

#### S1-2 REG-CS2 索引新鲜度

**子任务**
1. 索引 schema 增 `seq`（单调）、`issued_at`、`expires_at`；生成器按源维护单调计数。
2. **站点侧 DB 表 `reg_source_seq(source_url, max_seq, updated_at)`** 记录「每个源见过的最大 seq」
   （D1 已定：受害者是站点，记录点就在站点；CLI/API 一致）。
3. 回退即拒；`latest` 单调不降。

**BDD**
```gherkin
Scenario: 源返回更旧的索引
  Given 客户端上次从该源读到 seq=5
  When  同源这次返回 seq=3
  Then  安装被拒，错误码 index_stale
  And   提示指向「源可能被回放/镜像落后」
```

**验收条件**
- [ ] 同 seq 重复拉取幂等放行（不误伤正常重复请求）
- [ ] `expires_at` 过期 + 拉不到新索引 → 按 §5.3 降级口径（缓存窗口内继续，过期拒）
- [ ] 索引回退与吊销回退**分别**有用例（两条通道语义不同）
- [ ] 客户端状态文件损坏时 fail-closed 而非静默重置

#### S1-3 REG-CS3 规范串 v2

**子任务**
1. 规范串改 `<registry_id>:<slug>@<version>:<sha256>`（发号方：`publish.ts:40-43` 同处）。
2. 验签侧**校验 `canon` 字段**（现状 `market/verify.ts:111-123` 不校验）。
3. 旧格式 `.sig` 的处置：**不兼容**，报「规范串版本过旧，请用当前 ojm 重签」。

**BDD**
```gherkin
Scenario: 包被搬到另一个仓库
  Given registry A 签发的 tgz + .sig（canon 含 registry A 身份）
  When  把同一对文件放进 registry B 的 cdn 并安装
  Then  验签失败，错误码 canon_mismatch
  And   不尝试「回退到旧规范串」
```

**验收条件**
- [ ] `canon` 缺失或与当前算法不符 → 拒（不默认通过）
- [ ] 同仓同包正常验签通过（回归）
- [ ] 拒装文案能区分 `canon_mismatch` / `signature_mismatch`

#### S1-4 REG-CS7 保留名扩项（红队 F5）

> 白话说：`registry`、`oj`、`ojm` 这三个名字以后**不许别人拿去当方案名**。因为方案的路由前缀默认
> 等于它的名字，谁先叫 `registry`，谁就把本功能的 `/api/registry/*` 占了——自己撞自己。

**子任务**
1. `packages/cli/src/manifest-contract.ts:36` 的 `RESERVED_NAMES` 增加 `oj`、`ojm`、`registry`。
2. 确认调用面**共用这一份清单**（发布期 `ojm build`/validate 与安装期 `preflight C2-01`），
   不允许出现第二份硬编码。
3. 报错文案给替代名建议（例：`meta-registry`、`oj-registry`），而不是只说「非法」。
4. 回归：现有 8 个第一方方案名与新清单无交集（`market` 已在旧清单里）。

**BDD**
```gherkin
Scenario: 方案名撞上保留名
  Given 一个 manifest 的 name 为 registry
  When  执行 ojm build --bundle
  Then  构建失败，退出码 1
  And   输出包含「registry 为保留名」与两个替代名建议

Scenario: 装一个已经打好的保留名包
  Given 一个 name=ojm 的 tgz（构建期尚未加这条校验的旧包）
  When  在站点上安装它
  Then  安装预检拒绝（C2-01），错误码 reserved_name
  And   不产生任何解压写入
```

**验收条件**
- [ ] `RESERVED_NAMES` 在全仓只有一处定义（`grep -c` 可证）
- [ ] 构建期与安装期**都**拒（两处调用点各一条用例）
- [ ] `oj` / `ojm` / `registry` 三个名各有用例，不是只测一个
- [ ] 现有 8 个方案安装回归全绿（无误伤）

#### S1-5 REG-CS8 包体与解压体积闸门（红队 F1）

> 白话说：现在**没有任何体积上限**——发布方给你一个 1MB 的文件，解开能是 1TB，服务器磁盘就满了；
> 下载还是「先把整个包读进内存，再检查大小」，等于先中毒再验毒。这条要加三道闸，并且四个上限
> 值全仓只写一处，上传侧（S4-2）复用同一份。

**子任务**
1. 新建 `packages/cli/templates/src/_platform/api/_lifecycle/limits.ts`，导出四个常量与一句用途注释：
   `MAX_PACKAGE_BYTES` / `MAX_UNPACKED_BYTES` / `MAX_ENTRIES` / `MAX_SINGLE_ENTRY_BYTES`
   （**数值待 §11-3 确认**，先按建议值 50MB / 200MB / 5000 / 50MB 落地，改一处即可调）。
2. `steps/download.ts`：**在 `fetch` 之前**用签名索引声明的 `archive.size` 比对上限，超限直接拒，
   不发请求（省带宽也省内存）。
3. `tgz-guard.ts` 扩展 `validateTarListing`：它已经在逐行解析 `tar -tvzf` 清单，顺手累加
   **未压缩总体积**、**条目数**、**单条目最大体积**，超限即拒（**不新增一次 IO，这是 DRY 的关键**）。
4. `steps/extract.ts`：解压后复核 staging 实际占用，超出声明上限说明清单被绕过，拒并清场。
5. 常量对外导出，供 S4-2 的上传侧复用（同一份数字，两个方向）。

**BDD**
```gherkin
Scenario: 签名索引声明的包体超上限
  Given 索引声明 demo@1.0.0 的 archive.size 为 300MB
  When  执行 ojm install demo@1.0.0
  Then  退出码为 1，错误码 package_too_large
  And   没有发出任何 tgz 下载请求

Scenario: 解压膨胀超上限（解压炸弹）
  Given 一个 1MB 的 tgz，其 tar 清单里单个成员声明 2GB
  When  执行安装到 extracting 阶段
  Then  解压被拒，错误码 unpacked_too_large
  And   暂存目录已清空，磁盘占用回到安装前

Scenario: 条目数超上限
  Given 一个 tar 清单含 6000 个成员
  When  解压预检
  Then  拒绝，错误码 too_many_entries
```

**验收条件**
- [ ] 四个上限常量在全仓只有一处定义，上传侧与下载侧**引用同一变量**
- [ ] 下载闸发生在 `fetch` **之前**（用例断言「超限时 fetch 未被调用」）
- [ ] 体积检查复用已有 tar 清单，**不额外跑一次 `tar`**（可用调用计数断言）
- [ ] 解压后复核存在（模拟「清单谎报」的用例）
- [ ] DoS 回归用例入库（1MB→超大 的伪造清单，用文本造，不真占磁盘）

---

### S2 分发与撤回（REG-CS5 / CS4 / CS6）

#### S2-0 前置重构：版本比较单点（DRY，无独立需求 ID）

**子任务**：把 `market/index-builder.ts:63-76` 与 `_lifecycle/semver.ts:51-61` 合成一个
`compareSemver`，两侧改为调用；**先补用例再改**（`1.0.0-10` vs `1.0.0-2`、`1.0.0` vs `1.0.0-rc.1`）。

**验收条件**
- [ ] 全仓只有一处 semver 比较实现（`grep` 可证）
- [ ] 新增用例覆盖预发布序与构建元数据
- [ ] 现有安装路径用例全绿（无行为漂移）

#### S2-1 REG-CS5 索引三级化 + 缓存

**子任务**
1. `catalog.yaml` 生成（包名 → 分片号，无版本明细）。
2. `shards/<n>.yaml` 生成，每片 ≤2000 版本；**装箱策略**（D3 已定）：按版本数累加到 2000 开新片，
   catalog 记 `slug → shard`；已有包尽量不换片，只有超限才重排。
3. 读取器切到 `IndexSource`（DIP），本地目录与 HTTP 两实现。
4. 缓存头：`ETag` + `Cache-Control: max-age=60, stale-while-revalidate=60`（Q8 定，yank 最坏 120s）；
   `If-None-Match` → 304。**开工前先用日志量一轮「谁在拉索引」**，再决定是否调大 TTL。
5. 生成器与读取器**同期切换**，不保留单文件双读。
6. **原子落盘（红队 F2）**：每个文件先写 `<name>.tmp.<pid>.<rand>`，再 `rename` 覆盖；
   **顺序固定为「先分片 → 再 catalog」**（catalog 是提交点）。`.` 前缀或非 `.yaml` 后缀的临时文件
   一律不被读取器当索引。**白话说**：不能出现「总目录已经指向新分册、新分册还没写完」的中间态。

**BDD**
```gherkin
Scenario: 版本数超过阈值时自动分片
  Given 2500 个版本、1 个包
  When  重建索引
  Then  生成 2 个 shard 且每片 ≤2000 条
  And   catalog.yaml 指向该包所在片
  And   装该包只请求 1 个 shard（不请求另一片）

Scenario: 重复拉取走 304
  Given 客户端已缓存某 shard 的 ETag
  When  带 If-None-Match 再请求
  Then  返回 304 且不重传正文

Scenario: 写索引中途被打断
  Given 重建索引在写完 shard、还没写 catalog 时进程被杀
  When  客户端此时来拉索引
  Then  看到的仍是上一代（catalog 未更新），安装正常
  And   磁盘上不残留可被当作索引读取的半文件
```

**验收条件**
- [ ] 单片体积实测 ≤1.5MB（目标 1.2MB）
- [ ] 一次安装的索引请求数 ≤ 1 catalog + 1 shard
- [ ] 单次索引构建的峰值内存有实测记录（isolate 上限 256MB，留 2.5 倍余量）
- [ ] 缓存头只在读面出现，写入面不受影响
- [ ] **无 `writeFileSync` 直写索引**（`grep` 可证：只有 tmp+rename 一条路径）
- [ ] 半写场景有回归用例（模拟写完 shard 后抛错）

#### S2-2 REG-CS4 yank

**子任务**
1. 索引字段 `yanked`（含 `yanked_at`）；`latest` 计算跳过 yanked。
2. CLI `ojm market yank <name>@<version>`（本地形态，registry 上线后复用同一语义）。
3. 安装侧遇到 yanked 精确版本 → 拒；已装实例不受影响。

**BDD**
```gherkin
Scenario: yank 后新装被拒、已装不受影响
  Given 站点已安装 demo@1.0.0
  When  执行 ojm market yank demo@1.0.0
  And   再次安装 demo@1.0.0
  Then  第二次安装被拒（版本已下线）
  And   已安装的 demo 仍可用
```

**验收条件**
- [ ] yank 后 `latest` 不再指向该版本
- [ ] 重复 yank 幂等；对不存在的版本报明确错误
- [ ] 审计留痕（谁、何时、为何）

#### S2-3 REG-CS6 Host 头 SSRF（现有洞，可提前单独做）

**子任务**
1. `_platform/api/_shared/site-facade.ts:16-34` 停止用请求头 `host` / `x-forwarded-proto` 补全绝对 URL；
   改用站点配置的 canonical origin。
2. 非法/缺失配置 → 明确报错，不回落请求头。
3. 相对源 `/cdn` 的自供形态仍可用（回归）。

**BDD**
```gherkin
Scenario: 伪造 Host 头不能牵引出站
  Given 站点配置的 canonical origin 为 http://127.0.0.1:5174
  When  带 Host: 169.254.169.254 请求一个相对源
  Then  实际请求仍发往配置的 origin
  And   响应不含来自 169.254.169.254 的内容
```

**验收条件**
- [ ] 全仓不存在用请求头拼绝对 URL 的路径（`grep` 可证）
- [ ] 自供（`market_cdn_url=/cdn`）场景回归通过
- [ ] 配置缺失时报错文案指向具体设置项

---

### S3 registry 地基（REG-R1 / R2 / R3 / R4 / R12）

#### S3-1 REG-R1 复用宿主（负需求）

**子任务**
1. 建 registry 包骨架：manifest（slug 名、`permissions: registry.publish / registry.admin`、routes 相对声明、migrations）。
2. 明确**不写**：账号表、登录端点、token 签发、角色表。

**BDD**
```gherkin
Scenario: registry 包内没有第二套账号
  Given registry 包的源码树
  When  检索建号、登录、签发相关调用
  Then  结果为 0 处
  And   包内没有任何 users/roles 表定义
```

**验收条件**
- [ ] 结构守卫用例（读包内 manifest + 源码）钉死「零账号表、零登录端点」
- [ ] 安装后能用宿主账号登录并访问 registry 页面
- [ ] 卸载后路由与权限绑定被摘干净（业务数据保留）

#### S3-2 REG-R2 发布 token

**子任务**：token 生成（只存哈希）、按账号×scope 绑定、`origin` 字段防跨源重放、过期与单条吊销、`last_used_at`。

**BDD**
```gherkin
Scenario: 用别的源的 token 打本站
  Given 一个绑定在 registry A 的 token
  When  拿它向 registry B 上传
  Then  返回 401 且不落任何包
```

**验收条件**
- [ ] 库里不出现明文 token（只有哈希）
- [ ] 过期 / 吊销后立即失效（无需重启）
- [ ] 审计记录 token_id（凭证失窃可枚举受影响版本）

#### S3-3 REG-R3 公钥注册 + 二次确认

**子任务**：提交公钥 → `pending` → 二次确认（邮件/控制台）→ `active`；24h 冷却期内不可用于发布；注册与启用各发一次通知。

**BDD**
```gherkin
Scenario: 冷却期内不能用新 key 发版
  Given 一把刚确认但仍在 24h 冷却期内的公钥
  When  用它签名的包尝试发布
  Then  发布被拒，错误码 key_cooling
```

**验收条件**
- [ ] 「偷到 token 立刻注册新 key 发毒包」的攻击路径被冷却期挡住（用例覆盖）
- [ ] 确认动作有独立审计
- [ ] 绑定后公钥不可改（改 = 新建 key）

#### S3-4 REG-R4 key 生命周期

**子任务**：`retire`（不收新发布、仍验旧包）、`revoke`（阻断新装 + 进集中清单）；吊销带 `severity`；
与站点本地 `trust revoke` 的关系写清（本地可更严不可更松）。
**Q9 已定**：`retire` 只挡新装；`malicious` → **强告警 + 提供「一键禁用」入口，不自动执行**。

**BDD**
```gherkin
Scenario: revoke 后旧包不再可装
  Given 一把已 revoke 的发布 key 签过的包
  When  新平台尝试安装
  Then  拒装并提示 key 已吊销
  And   已装实例不受影响（G5 维持，等 Q9 拍板再议例外）
```

**验收条件**
- [ ] retire 与 revoke 行为可区分（前者只挡发布）
- [ ] 吊销清单可导出且带 `seq`

#### S3-5 REG-R12 CLI 自动化契约

**子任务**：退出码三档（0 成功 / 1 业务失败 / 2 用法错误）、`--json`、`--dry-run`、`OJM_REGISTRY_TOKEN`、`config ls --show-origin`。
**Q7 已定**：`uninstall` **不接** `--registry`，只在输出里打印「该包来自 X」；帮助文本说明「卸载不涉及仓库」。

**BDD**
```gherkin
Scenario: CI 用 env token 发布不交互
  Given 环境变量 OJM_REGISTRY_TOKEN 已设置、无本地凭据文件
  When  执行 ojm publish --json --dry-run
  Then  退出码 0 且 stdout 是可解析 JSON
  And   没有发生任何上传
```

**验收条件**
- [ ] 每个新命令都有 0/1/2 三档退出码用例
- [ ] `--json` 输出稳定字段（有 schema 断言，不做快照全量比对）
- [ ] `--dry-run` 全程零写入（用只读文件系统或断言无副作用）

---

### S4 发布链路（REG-R5 / R6 / R7）

#### S4-1 REG-R5 scope 目录 + slug 映射

**子任务**：`reg_scope` / `reg_package(slug 唯一)` / `reg_scope_grant`（布尔业务授权，**不写框架 RBAC 表**）；
发布时 `@acme/demo` → 物理 `acme-demo`；同名不同 scope → 发布期即报冲突并给替代名。

**BDD**
```gherkin
Scenario: 两个组织发布同名包
  Given scope @acme 与 @beta 都发布 demo
  When  两者都用 @<scope>/demo
  Then  第二个被拒，提示物理名冲突并给出候选名
  And   已发布的那个索引不变
```

**验收条件**
- [ ] 物理名恒满足 `^[a-z][a-z0-9-]{0,63}$`（发布前置断言）
- [ ] 目录键与物理名映射表可查（`ojm view` 能同时显示两者）
- [ ] 未引入任何角色层级表

#### S4-2 REG-R6 上传发布五查

> 白话说：一次上传要被问五个问题——**你有上传证吗（token）→ 这把签名钥匙登记在这个门牌下吗
> → 这包真是这把钥匙签的吗 → 这个版本是不是已经有了（同内容就放过）→ 这包是不是太大**。
> 第五问是红队补的：不问的话，一个 200MB 的包能把 256MB 的沙箱直接打爆。

**子任务**：① token 授权 → ② scope 内 active key → ③ 包级验签 → ④ 版本冲突（同 sha256 幂等放行
且不清除 yanked/revoked）→ ⑤ **体积上限**：按 `content-length` **在读入内存前**拒（413），
常量复用 S1-5 导出的 `MAX_PACKAGE_BYTES`。

**BDD**
```gherkin
Scenario: 用不属于本 scope 的 key 发版
  Given scope @acme 下没有任何 active key 匹配该签名
  When  上传 tgz + sig
  Then  返回 403 且包不落库

Scenario: 重发已 yank 的同版本
  Given demo@1.0.0 已被 yank
  When  用相同 sha256 重发 1.0.0
  Then  幂等放行但版本仍是 yanked

Scenario: 包体超过上限
  Given 一个 content-length 声明的 300MB 上传
  When  上传 tgz
  Then  返回 413 package_too_large
  And   包体没有被读入内存（用内存峰值断言或分块计数断言）
```

**验收条件**
- [ ] 五查每一条都有独立用例，且错误码可区分
- [ ] 幂等重发**不复活** yanked/revoked 状态（回归）
- [ ] 上传链路不整包进内存（大包用例）
- [ ] 体积上限与下载侧**共用同一常量**（不是两个数字）

#### S4-3 REG-R7 索引生成 + 外置签名

**子任务**：DB 为真相 + 单写者串行；按分片增量重渲染；导出未签索引 → `ojm registry sign` → 回传校验公钥一致 → 发布到读面。

**BDD**
```gherkin
Scenario: 回传的签名与登记的索引公钥不符
  Given registry 登记的索引公钥为 K1
  When  回传一个用 K2 签的索引签名
  Then  拒绝发布到读面，错误码 index_key_mismatch
  And   读面仍服务上一版索引
```

**验收条件**
- [ ] 并发发布不产生交叉写坏（串行化用例）
- [ ] 增量渲染只重画受影响分片（断言未受影响的 shard 字节不变）
- [ ] 签名私钥不出现在任何运行时路径（不在服务端可用）

---

### S5 消费链路（REG-R8 / R9 / R10 / R11）

#### S5-1 REG-R8 读面双载体

> 白话说：包有两条路发出去——**站点自己的 API**（能判权、但整块读进内存），或**站点已有的静态
> 目录 `/cdn`**（快、但谁都能下）。v2.1 让运维按性能挑，红队认为这是个**会泄漏的选项**：
> 私有站点一旦选了静态，私有包就等于公开。所以改成**按可见性锁死**，不给挑。

**子任务**
1. 新增配置 `registry.visibility`（`private` 默认 / `public`），**决定载体**，不是可选偏好：
   - `private`：只走模块 API；检测到包或索引被写进公共 `/cdn` → **启动自检 fail loud**（不是警告）。
   - `public`：允许写 `/cdn`，也可继续用模块 API。
2. 模块 API 侧：`ETag` / 缓存头 / `Range` / 不经预签名；两形态文件格式一致。
3. 容量约束：模块 API 的**单包上限与并发预算**写进配置（复用 S1-5 的 `MAX_PACKAGE_BYTES`）；
   `private` 下超过上限的包**明确报错不可装**，不进入内存再 OOM。
4. **开工前 1 小时 spike**（D4）：实测 `blob.get` 是否可流式/可分段。
   - 可流式 → 上限可放宽，`Range` 自然支持；
   - 不可流式 → 维持整块读，上限按堆内存反算（256MB ÷ 并发数 × 安全系数）。

**BDD**
```gherkin
Scenario: 同一份索引两种载体内容一致
  Given registry 产出一版索引
  When  分别从模块 API 与 /cdn 挂载取回
  Then  两者字节一致（或仅 ETag 不同）

Scenario: 私有站点把包写进公共静态目录
  Given registry.visibility = private
  And   站点存在 /cdn → ./cdn 的静态挂载
  When  发布一个包并尝试落到该目录
  Then  发布失败，错误码 static_carrier_forbidden
  And   启动日志已提前报出该配置冲突（fail loud）

Scenario: 私有站点安装超过单包上限的包
  Given registry.visibility = private 且 MAX_PACKAGE_BYTES=50MB
  And   索引声明某包为 80MB
  When  执行 ojm install
  Then  退出码 1，提示「私有载体单包上限 50MB，请改用 public 载体或减小包体」
```

**验收条件**
- [ ] 载体**不可由运维随意切换**：`private` 下静态载体被代码拒绝（有用例）
- [ ] 配置冲突在**启动**时暴露，不等第一次发布才发现
- [ ] 不新增 `mounts`
- [ ] tgz 下载支持 `Range`（断点续传用例）；不支持时给出明确降级说明而不是静默全量重传
- [ ] 单包上限与 S1-5/S4-2 是**同一个常量**

#### S5-2 REG-R9 install 源切换

> 白话说：`ojm install` 多一个「从哪个仓库装」的开关。三件事必须同时做对，
> 否则「加个开关」会变成「开个后门」：**旧站点要明确说不支持**、**源要在白名单里**、
> **白名单里的源也不能把你转到内网去**。

**子任务**
1. `/api/_platform/market/install` 增 `registry` 字段并校验站点白名单；`API_VERSION` 0.1.0→0.2.0；
   旧站点明确报错（不静默降级）。
2. **归一层只放 CLI（D5 已定）**：`@acme/demo` → `acme-demo` 在 CLI 完成；服务端**只认 slug**，
   收到含 `@` 或 `/` 的名字直接 400（否则绕过 CLI 打 API 就能传两种形态，物理名与目录键混淆）。
3. **升版反噬（F4）**：`preflight` 的 `C2-11` 对「host `0.2.x` + 声明 `^0.1.x`」给**专属迁移提示**
   （「请把 peerPlatform 改成 `>=0.1.0`」），并在发版说明写清；本仓 8 个方案无 `peerPlatform`，不受影响。
4. **重定向 SSRF（F7）**：站点拉源时**禁止跨源重定向**，`3xx` 目标不在白名单即拒；
   同一源的 307/308 允许（保留方法），但目标仍需过白名单。

**BDD**
```gherkin
Scenario: 旧站点明确拒绝指定仓库
  Given 一个 API_VERSION=0.1.0 的站点
  When  执行 ojm install demo@1 --registry https://r.example.com
  Then  退出码 1 且提示「站点版本过低，不支持指定仓库」
  And   不静默改用站点自带源

Scenario: 源不在白名单
  Given 站点白名单只有 https://r.example.com
  When  用 --registry https://evil.example.com 安装
  Then  返回 403 并提示去站点设置添加该源

Scenario: 白名单源把请求转到内网
  Given 白名单含 https://r.example.com，且它会 302 到 http://169.254.169.254/
  When  安装该源上的包
  Then  拒绝，错误码 cross_origin_redirect
  And   不发起对内网地址的请求

Scenario: 服务端收到目录键形态的名字
  Given 请求体 name = "@acme/demo"
  When  调用 install API
  Then  返回 400 invalid_physical_name（服务端只认 slug）
```

**验收条件**
- [ ] 白名单校验在**服务端**（CLI 侧校验不算）
- [ ] 相对源 `/cdn` 自供场景回归通过
- [ ] 归一逻辑只存在于 CLI 一处（`grep` 可证），服务端有「收到 `@` 即 400」的用例
- [ ] 跨源重定向有拒绝用例，同源 307 有放行用例
- [ ] `peerPlatform: ^0.1.0` 的包在 0.2.0 站点上报**专属迁移文案**（不是笼统「不满足」）
- [ ] 契约变更写进 `openapi.json` ↔ `__client` ↔ `init.test.ts` 三处同步（见既有工作流）

#### S5-3 REG-R10 集中吊销 + fail-closed

> 白话说：黑名单是唯一的刹车。v2.1 只写了「拉不到就拒装」，漏了一种更简单绕过：
> **把黑名单换成一份合法的空文件**——「拉到了，内容是空的」，于是刹车静默失灵。
> 因此黑名单必须**盖章（签名）+ 带代次（seq）**，和索引一个待遇。

**子任务**
1. `revocations.yaml`（**60s 缓存，不设 stale 窗口**）+ **同名 `.sig`**；**空清单也必须签**。
2. 清单带 `seq`；客户端记录每源最大 `seq`，**回退即拒**（与索引同一套机制，代码复用 S1-2）。
3. 安装前拉取，命中拒装；拉取失败 fail-closed；同时修 `installer.ts:886-891`、`:915-918`
   的 fail-open 先例。
4. 索引不可达（缓存内继续装）与吊销不可达（拒装）**行为不同**，日志要能一眼分开。

**BDD**
```gherkin
Scenario: 吊销清单拉不到
  Given 站点配置了 registry 源但吊销清单端点不可达
  When  安装任意包
  Then  拒装，错误码 revocations_unreachable
  And   不按「没有吊销」处理

Scenario: 吊销清单被换成空文件
  Given 客户端上次读到 seq=12 且含 3 条吊销
  When  同源这次返回 seq=12 但内容为空且签名有效
  Then  拒装，错误码 revocations_not_monotonic
  And   提示「清单被回退或被替换，请联系仓库管理员」

Scenario: 空清单首次拉取
  Given 一个从未有过吊销、清单已签名且 seq=1 的源
  When  安装任意包
  Then  正常放行（不误伤「真的没有黑名单」）
```

**验收条件**
- [ ] 索引不可达（缓存内继续）与吊销不可达（拒装）行为**不同**，各有用例
- [ ] 本地 revoke 与集中吊销叠加（本地更严可生效）
- [ ] 无签名 / 签名不符 / seq 回退 / 内容缩水，四种情形**各一个错误码**
- [ ] 空清单与「清单被清空」用 `seq` 区分，有用例证明不会误伤前者
- [ ] 无「跳过吊销检查」的隐藏开关

#### S5-4 REG-R11 离线导入 + 离线回滚

**子任务**：离线包 = **目录格式，结构与 `cdn/` 完全一致**（D2 已定，复用既有布局与校验器，零新格式）：
tgz + sig + 索引切片 + catalog + revocations，含 `seq` 与签名；`ojm registry import <dir>`；回滚走本地版本目录。

**BDD**
```gherkin
Scenario: 源整体不可用时回滚
  Given 站点已装 demo@2.0.0，本地保留 1.0.0 版本目录
  And   registry 完全不可达
  When  回滚到 1.0.0
  Then  回滚成功
  And   全程没有网络请求
```

**验收条件**
- [ ] 离线包 `seq` 低于本地已知值 → 拒导入
- [ ] 离线包签名可验（复用 CS1/CS3 同一套判定）
- [ ] 回滚不依赖 registry（用例断言零请求）

---

## 5. 阶段门禁（每个阶段结束前必须全绿）

| # | 门禁 | 判定方式 |
|---|---|---|
| G1 | 阶段内每个需求都有 BDD 用例且**先 RED 后 GREEN** | 提交记录里能看到红→绿两步（或测试文件里保留失败快照说明） |
| G2 | 全量单测 / e2e 无新增失败、无 skip 新增 | `pnpm test` + e2e 全跑，基线对比 |
| G3 | 无新增 lint / 类型错误 | eslint + `tsc --noEmit`（注意用 `--max-old-space-size=8192`） |
| G4 | 阶段内没有顺手实现 backlog 项或独立 PR | 逐条对照 §8.2 清单 |
| G5 | 行为变更写进 `CHANGELOG.md`（含用户可见的影响面） | 人工核对 |
| G6 | 版本与契约同步（涉及 API 时：`openapi.json` / `__client` / `init.test.ts`） | 既有守卫用例通过 |
| G7 | **安全护栏必须有「攻击者视角」的负向用例**（超限、不同代、跨源重定向、空黑名单） | 每道护栏至少 1 条「故意使坏」的用例，且用例名能看出攻击意图 |

> G7 是红队演练（需求 §16）的直接产物：这轮的 8 个真问题里有 5 个是「正向用例全绿但使坏就破」，
> 光靠 happy path 测不出来。

---

## 6. 阶段审查（阶段末一次，不拆碎）

审查清单（按序，逐条给结论，不给「还行」）：

1. **需求覆盖**：本阶段需求 ID 全在？有没有做多、做少？
2. **验收条件**：每条都勾得出证据（命令/测试名/行号）？
3. **SOLID/DRY**：§3.1/§3.2 的落点是否达成？新增重复有没有？
4. **BDD 质量**：场景是否只断言可观察行为？有没有为了绿而放宽断言？
5. **回归面**：受影响的旧行为有哪些？逐条说明为什么安全。
6. **攻击面**（G7）：本阶段新增的每道护栏，有没有一条**故意使坏**的用例？没有就当作没做。
7. **遗留与风险**：新发现的坑、被推迟的决定、下一个阶段的前置。
8. **结论**：通过 / 有条件通过（列条件）/ 不通过（列返工项）。

---

## 7. 阶段小结模板（审查通过后追加）

```markdown
### S<N> 小结（YYYY-MM-DD）

- 交付：<需求 ID 列表> + <改动的关键文件>
- BDD：<新增用例数> / <覆盖的需求 ID>
- 偏离计划：<无 或 逐条说明原因>
- 留下的债：<无 或 逐条 + 触发条件>
- 下阶段前置：<无 或 逐条>
- 审查结论：通过 / 有条件通过（条件：…）
```

---

## 8. 变更控制与已定取舍

### 8.1 已裁定的取舍（2026-10-25：Q7–Q11 + D1–D4；同日红队追加 D5–D6）

| 项 | 裁定 | 在计划里的落点 |
|---|---|---|
| Q7 `uninstall` 接 `--registry` | **不接**；输出打印「该包来自 X」 | S3-5 |
| Q8 索引缓存 TTL | **60 / 60**（yank 最坏 120s）；先量一轮再决定是否调大 | S2-1 |
| Q9 G5 恶意例外 | **分级**：`retire` 只挡新装，`malicious` 强告警 + 一键禁用入口（**不自动**） | S3-4 |
| Q10 I7 与 license | **只推 license**（进 P0-R 随 R8）；I7 留 P1 | S5-1 附项 |
| Q11 `--url` → `--site` | **硬切改名、不加别名**，作**独立 PR** | 见 §8.2 |
| D1 seq 落点 | **站点侧 DB 表 `reg_source_seq`** | S1-2 |
| D2 离线包格式 | **目录，结构与 `cdn/` 一致** | S5-4 |
| D3 分片键 | **装箱**（累加到 2000 开新片，catalog 记映射） | S2-1 |
| **D4 修订** tgz 服务 | ~~静态优先 + 模块 API 兜底~~ → **由 `registry.visibility` 决定**（私有只能走模块 API）；先做流式 spike | S5-1 |
| **D5 新增** `@scope/name` → slug 归一 | **只在 CLI 做**；服务端只认 slug，收到 `@`/`/` 即 400 | S5-2 |
| **D6 新增** 体积上限常量落点 | 单文件 `_lifecycle/limits.ts` 导出四个常量，**下载/解压/上传三处共用**；数值待定（建议 50MB / 200MB / 5000 / 50MB） | S1-5、S4-2、S5-1 |

> D4 为什么改：v2.1 把「静态 / 模块 API」当性能偏好让运维挑，但 `/cdn` 是**无鉴权目录**，
> 挑错就等于把私有包公开，而且没有声音。改成「可见性决定载体」后，运维**没有挑错的机会**。
> 代价写在需求 §8 决策 5 里：私有 + 大包只能靠内网，单包上限被 256MB 堆硬约束。

### 8.2 独立 PR 清单（不进 MVP 阶段序列）

| PR | 内容 | 为什么单列 |
|---|---|---|
| P-1 | `--url` 硬切改名为 `--site`（5 个命令 + 测试 + 文档 + 发版说明） | 是既有契约变更，与 registry 功能无关；混在一起会让回归面无法归因 |
| P-2 | license 展示（市场卡片 + 安装确认页） | 依赖 manifest 字段，与 R8 读面一起做但可单独回滚 |

**纪律**：这两个 PR 各自独立可回滚；不得夹在阶段提交里。

### 8.3 变更规则

- 阶段内**不加需求**；发现必须做的，记到 §8.4 并等阶段审查时决定插入哪个阶段。
- 需求文档（v2.2）内容变更须单独提交，并在本计划顶部更新「依据」的提交号。
- 红队/安全类发现**例外**：若属于「现有链路的真实漏洞」（如 F1 解压无上限、F7 跨源重定向），
  可不等阶段审查，直接在当前阶段内补，但必须同时补 §8.4 与负向用例（G7）。

### 8.4 追加区（执行期记录）

| 日期 | 来源 | 内容 | 处置 |
|---|---|---|---|
| 2026-10-25 | 红队对抗演练（需求 §16） | 8 个真问题：F1 体积无上限、F2 索引非原子/不同代、F3 黑名单可清空、F4 升版反噬、F5 保留名缺项、F6 私有包可静态公开、F7 跨源重定向、F8 模块 API 大包 OOM | **8 条全部已就地改需求**（CS1/CS5/CS7/CS8/R6/R8/R9/R10 + 决策 5）；计划侧落进 S1-1/S1-4/S1-5/S2-1/S4-2/S5-1/S5-2/S5-3；新增门禁 G7 |
