# 解决方案 Registry · 阶段性任务计划

- 日期：2026-10-25
- 分支：`feat/ojm`（基线 `e6994b75`）
- 依据：`docs/prd/202610250010-solution-registry-requirements.md`（v2.1，需求已拍板 Q1–Q6 / Q12）
- 状态：**仅计划，未开工**。阶段内任务全部实现后才做阶段审查，审查通过再写阶段小结。
- 上位约束：`docs/prd/solution/ARCHITECTURE.md`（解决方案不能自建登录端点 / 自管 RBAC 数据）

---

## 1. 计划边界

| 在计划内 | 不在计划内 |
|---|---|
| 需求 v2.1 的 18 条 MVP（P0-C 6 + P0-R 12） | backlog 明列的 26 条（§6.1/§6.2） |
| 每条需求的子任务、BDD 场景、验收条件 | 详细接口签名与表 DDL（属设计阶段，另出文档） |
| 阶段门禁与阶段小结模板 | §8.2 的两个独立 PR（`--url` 改名、license 展示单独回滚） |

**执行纪律**：阶段内任务按顺序实现，**一个阶段内全部任务完成前不开下一阶段**；阶段末做审查（§6），
审查通过后追加阶段小结（§7），小结随下一次提交入库。

---

## 2. 阶段结构

```
S1 索引可信 ──► S2 分发与撤回 ──► S3 registry 地基 ──► S4 发布链路 ──► S5 消费链路
   CS1 CS2 CS3     CS5 CS4 CS6        R1 R2 R3 R4 R12    R5 R6 R7        R8 R9 R10 R11
```

| 阶段 | 目标（一句话） | 需求 | 前置 |
|---|---|---|---|
| **S1 索引可信** | 索引必须签名、必须新鲜、不能跨仓重放 | REG-CS1 / CS2 / CS3 | 无（可立即开工） |
| **S2 分发与撤回** | 索引能分片能缓存、能撤回单个版本、不再信任伪造 Host | REG-CS5 / CS4 / CS6 | S1（复用验签与 seq） |
| **S3 registry 地基** | 一个装进宿主站点的模块：不建账号，只有 token / 公钥 / 生命周期 / 可自动化 CLI | REG-R1 / R2 / R3 / R4 / R12 | S2（索引格式稳定） |
| **S4 发布链路** | 能按 scope 发布，四查挡住脏包，索引由 CI 外置签名 | REG-R5 / R6 / R7 | S3 |
| **S5 消费链路** | 能按源安装、能集中吊销、能离线导入与回滚 | REG-R8 / R9 / R10 / R11 | S4 |

**为什么这个顺序**：S1/S2 是**不依赖 registry 存在**的静态仓硬化（`cdn/` 目录就够），
其中 REG-CS6 是**现有安全洞**，与立项无关；S3 之后才需要"装上这个包"。

---

## 3. 通用工程约束（每阶段都必须满足）

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

### 3.4 INVEST 自检（18 条）

| ID | 用户故事（作为…我要…以便…） | I | N | V | E | S | T |
|---|---|---|---|---|---|---|---|
| CS1 | 作为平台管理员，我要索引缺签名就拒装，以便镜像改不了治理面 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS2 | 作为平台管理员，我要拒收 seq 回退的索引，以便旧快照不能复活已 yank 版本 | ✓ | ✓ | ✓ | △ | ✓ | ✓ |
| CS3 | 作为仓库运营，我要规范串带仓库身份，以便包不能搬到别的仓库重放 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS5 | 作为运维，我要索引分片且可缓存，以便出网量不再放大 200 倍 | ✓ | ✓ | ✓ | △ | △ | ✓ |
| CS4 | 作为作者，我要下线单个版本，以便不背着一个坏版本 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CS6 | 作为运维，我要相对源不再随 Host 头漂移，以便堵住内网 SSRF | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R1 | 作为部署者，我要 registry 用站点原有账号，以便不多一套密码 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R2 | 作为作者，我要一个可吊销的上传凭证，以便私钥泄露不等于发布权泄露 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R3 | 作为作者，我要新公钥绑定需二次确认，以便偷到 token 也发不了包 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R4 | 作为作者，我要能轮换/吊销密钥，以便离职与换机不失控 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R12 | 作为 CI，我要退出码/`--json`/`--dry-run`/env token，以便不进交互也能发版 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R5 | 作为作者，我要用 `@acme/demo` 发布，以便同名包不互相污染 | ✓ | ✓ | ✓ | ✓ | △ | ✓ |
| R6 | 作为作者，我要发布前被四查拦下，以便脏包进不了仓库 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R7 | 作为运维，我要索引在 CI 外置签名，以便签名私钥可离线保管 | ✓ | ✓ | △ | ✓ | ✓ | ✓ |
| R8 | 作为消费平台，我要从模块 API 或 `/cdn` 二选一取索引，以便不用新加挂载 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R9 | 作为平台管理员，我要一条命令换源安装，以便跨仓库装包 | ✓ | ✓ | ✓ | ✓ | △ | ✓ |
| R10 | 作为平台管理员，我要吊销清单拉不到就拒装，以便安全通道不静默失效 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| R11 | 作为内网运维，我要离线导入与本地回滚，以便源挂了还能救 | ✓ | ✓ | ✓ | △ | △ | ✓ |

`△` 说明（诚实标注，不硬凑全绿）：
- **CS2-Estimable △**：seq 状态落点已定为站点侧 DB 表（D1），但仍要新增一张表 + 迁移，估算区间偏大。
- **CS5-Estimable △ / Small △**：分片改造横跨生成器与三处读取方，实际是 3 个小任务拼接。
- **CS5-Valuable △**：价值是成本侧的（省 200 倍带宽），不是新功能。
- **R5-Small △**：scope 目录键与 slug 映射要动发布、索引、安装三处，属中等。
- **R7-Valuable △**：对作者不可见，是运维安全属性。
- **R9-Small △**：含服务端契约升级（API 0.1.0→0.2.0），跨包改动。
- **R11-Estimable/Small △**：离线包格式一旦定错要返工，建议先出 1 页格式草案再排期。

---

## 4. 阶段明细

### S1 索引可信（REG-CS1 / CS2 / CS3）

#### S1-1 REG-CS1 索引签名强制

**子任务**
1. 删掉 `market/verify.ts:142-143` 的「缺失容忍 → ok」分支，改为 `signature=mismatch/missing`。
2. 安装前置（`market/api.ts` 取索引处）增加索引验签，失败即拒装并给可执行下一步。
3. 过渡期：保留一个版本的 `warn`，下一个版本转硬（**不留永久开关**）。

**BDD**
```gherkin
Scenario: 索引没有 .sig 时安装被拒
  Given 一个只有 manifests.yaml 没有 manifests.yaml.sig 的源
  When  执行 ojm install demo@1.0.0
  Then  退出码为 1
  And   输出包含「索引签名缺失」与「如何补签」两步提示
  And   没有发生任何网络下载
```

**验收条件**
- [ ] 代码中不存在「索引签名缺失 → 通过」的路径（可用 `grep` 断言该分支已删）
- [ ] `.sig` 存在但字节被改 → 拒装，错误码可区分 `missing` / `mismatch`
- [ ] 离线 `ojm market verify` 与站点安装**同一判定**，不出现一个拒一个放
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
```

**验收条件**
- [ ] 单片体积实测 ≤1.5MB（目标 1.2MB）
- [ ] 一次安装的索引请求数 ≤ 1 catalog + 1 shard
- [ ] 单次索引构建的峰值内存有实测记录（isolate 上限 256MB，留 2.5 倍余量）
- [ ] 缓存头只在读面出现，写入面不受影响

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

#### S4-2 REG-R6 上传发布四查

**子任务**：token 授权 → scope 内 active key → 包级验签 → 版本冲突（同 sha256 幂等放行且不清除 yanked/revoked）。

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
```

**验收条件**
- [ ] 四查每一条都有独立用例，且错误码可区分
- [ ] 幂等重发**不复活** yanked/revoked 状态（回归）
- [ ] 上传链路不整包进内存（大包用例）

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

**子任务**：**A 优先（站点 `/cdn` 静态）、B 兜底（模块 API 转发）**，C 预签名否决（D4 已定）。
模块 API 侧：`ETag` / 缓存头 / `Range` / 不经预签名；两形态文件格式一致。
**开工前 1 小时 spike**：实测 `blob.get` 是否流式——非流式则 B 只对大包拒绝并明确报错。

**BDD**
```gherkin
Scenario: 同一份索引两种载体内容一致
  Given registry 产出一版索引
  When  分别从模块 API 与 /cdn 挂载取回
  Then  两者字节一致（或仅 ETag 不同）
```

**验收条件**
- [ ] 切换载体只改 `market_cdn_url`，无需改其他配置
- [ ] 不新增 `mounts`
- [ ] tgz 下载支持 `Range`（断点续传用例）

#### S5-2 REG-R9 install 源切换

**子任务**：`/api/_platform/market/install` 增 `registry` 字段并校验站点白名单；`API_VERSION` 0.1.0→0.2.0；旧站点明确报错；CLI 把 `@acme/demo` 归一为 `acme-demo`。

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
```

**验收条件**
- [ ] 白名单校验在**服务端**（CLI 侧校验不算）
- [ ] 相对源 `/cdn` 自供场景回归通过
- [ ] 契约变更写进 `openapi.json` ↔ `__client` ↔ `init.test.ts` 三处同步（见既有工作流）

#### S5-3 REG-R10 集中吊销 + fail-closed

**子任务**：`revocations.yaml`（60s 缓存）；安装前拉取，命中拒装；拉取失败 fail-closed；同时修 `installer.ts:886-891`、`:915-918` 的 fail-open 先例。

**BDD**
```gherkin
Scenario: 吊销清单拉不到
  Given 站点配置了 registry 源但吊销清单端点不可达
  When  安装任意包
  Then  拒装，错误码 revocations_unreachable
  And   不按「没有吊销」处理
```

**验收条件**
- [ ] 索引不可达（缓存内继续）与吊销不可达（拒装）行为**不同**，各有用例
- [ ] 本地 revoke 与集中吊销叠加（本地更严可生效）
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

---

## 6. 阶段审查（阶段末一次，不拆碎）

审查清单（按序，逐条给结论，不给「还行」）：

1. **需求覆盖**：本阶段需求 ID 全在？有没有做多、做少？
2. **验收条件**：每条都勾得出证据（命令/测试名/行号）？
3. **SOLID/DRY**：§3.1/§3.2 的落点是否达成？新增重复有没有？
4. **BDD 质量**：场景是否只断言可观察行为？有没有为了绿而放宽断言？
5. **回归面**：受影响的旧行为有哪些？逐条说明为什么安全。
6. **遗留与风险**：新发现的坑、被推迟的决定、下一个阶段的前置。
7. **结论**：通过 / 有条件通过（列条件）/ 不通过（列返工项）。

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

### 8.1 已裁定的取舍（2026-10-25，Q7–Q11 + D1–D4 全部确立）

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
| D4 tgz 服务 | **A 静态优先 + B 模块 API 兜底**，C 预签名否决；先做流式 spike | S5-1 |

### 8.2 独立 PR 清单（不进 MVP 阶段序列）

| PR | 内容 | 为什么单列 |
|---|---|---|
| P-1 | `--url` 硬切改名为 `--site`（5 个命令 + 测试 + 文档 + 发版说明） | 是既有契约变更，与 registry 功能无关；混在一起会让回归面无法归因 |
| P-2 | license 展示（市场卡片 + 安装确认页） | 依赖 manifest 字段，与 R8 读面一起做但可单独回滚 |

**纪律**：这两个 PR 各自独立可回滚；不得夹在阶段提交里。

### 8.3 变更规则

- 阶段内**不加需求**；发现必须做的，记到 §8.4 并等阶段审查时决定插入哪个阶段。
- 需求文档（v2.1）内容变更须单独提交，并在本计划顶部更新「依据」的提交号。

### 8.4 追加区（执行期记录）

| 日期 | 来源 | 内容 | 处置 |
|---|---|---|---|
| — | — | — | — |
