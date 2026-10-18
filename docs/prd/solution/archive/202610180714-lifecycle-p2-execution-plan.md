# 方案生命周期 P2 阶段任务计划（可自治执行版）

> 状态：**计划定稿、暂不执行** · 制定于 2026-10-18 07:14 · 基线分支 `feat/ojm`（P1 已 fast-forward 并入，`eba327af`）
> 读者：接手 P2 的执行代理（lead 或实现者）。读完本文即可按序开工，无需回溯会话历史。
> **文档分工（防双真源漂移）**：计划 §4 任务表 = 唯一**状态**跟踪源（状态/开始/耗时就地更新）；SDD 台账 `progress.md` = 唯一**进度/恢复**源；**本文 = 任务级执行细则**（接口契约/BDD 用例/实现要点/纪律），不承载任何状态。

---

## 0. 开工前置（不满足即停，先收尾再开工）

| # | 条件 | 核实方式 |
|---|---|---|
| 1 | P1 集中审查完成：`review-p1-findings.md` 已产出 → 备案池逐条裁决 → 修复波（若有）→ 全绿验收 → `feat/lifecycle-p1` 并入集成分支 | 三证：台账 + `git log` + 报告文件 |
| 2 | G7 承载项就位：P2-15 的任务范围以审查报告裁决为准。**报告未出时 P2-15 标 blocked，不阻塞其余任务**（串行线上它排第 16 位） | 审查报告存在且已裁决 |
| 3 | 分支 `feat/lifecycle-p2` 自**合并后**的集成分支切出（不得自 feat/lifecycle-p1 直接切） | `git log --oneline -1` |
| 4 | 环境自检四绿：`pnpm test`（697 passed+1 skipped）/ `pnpm vitest run --config packages/cli/templates/api/vitest.config.ts`（**433**——428+P1 修复波 5；注意交接文档 `cd packages/cli/templates/api && pnpm test` 已失效，该目录无 package.json，必须从根带 config 跑）/ `pnpm test:cli`（**153**+1 skipped——152+P1 修复波 1）/ `pnpm typecheck` 净 | 全量实跑一遍再开工 |

期门 G1–G8 **已全部有裁决**（计划 §4.1，2026-10-18 收口）：G1 不兼走 URL 挂载、G2 进度采纳/取消转 P3、G3 TOFU 双轨、G4 硬 fail-closed + detached `.sig`、G5 吊销三语义、G6 本仓只出契约与端点、G7 备案池随审查落 P2-15、G8 **授权** oj-market 窗口期最小 UI 消费面（四件范围钉死：TOFU 确认界面、深检报告展示、占位卡两态、自升级提示；窗口结束恢复只读红线）。bootstrap key 已定性：`ojm keygen` **新生成 Ed25519 对**（站点既有 RSA cert 对 / X25519 secrets 对不可复用——算法不符、per-site、已暴露）。

## 1. 全局约束（每个任务隐含，违反即返工）

1. **串行排程**（四方评审 2026-10-18 定，不得并行实现代理）：
   `P2-0 → 1 → 2 → 3 → 6 → 4 → 5 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16`
2. **文件封锁面**：每任务以计划 §4 任务表 Files 列为封锁面，不得口头扩范围。争抢同一文件的相邻任务同一时间只有一个 owner：`types.ts`/`tasks.ts`/`installer.ts`（P2-3/10/13）、`market/api.ts`（P2-2/3/9/11）、`steps/verify.ts`+`state.ts`（P2-3/6）、CLI `site.ts`/`install.ts`/`index.ts`（P2-3/4/12/14）、CLI `trust.ts`（P2-2/3）。
3. **测试基线不得回退**：根套件 697 passed+1 skipped；templates/api **433**；`test:cli` **153**+1 skipped；typecheck 净。lint 触达文件全净（repo 467 warnings 为 pre-existing 基线，新 diff 零交集）。
4. **方法论**：TDD 先红后绿；BDD 场景表（多条件制数据表）；SOLID/DRY 落点逐任务标注（§3 各任务）；DDD 限界上下文见 §1.1。
5. **工程纪律**（全文见交接文档 `202610180030-lifecycle-p1-handover.md` §6，此处列最易违的）：
   - commitlint：subject 中文或**小写英文**开头；每提交尾行 `unix@vip.qq.com ai`
   - 端口：9778 主线冒烟保留（被占则整组 skip 属设计）；其余 9781+ 用完即关
   - isolate 模块级禁 `console.*`（BadResource 毒死调用链）；禁触碰运行时全局（jwt/db/axis 收进函数）
   - 改 `packages/cli/templates/` 必须 rsync → 站点重建 → **重启 oj serve**（本项目最大时间黑洞）
   - exec 白名单三条逐字（`tar -tvzf` / `tar -xzf` / `oj migrate --format json`），argv 不得增删；长命令显式传 `timeoutMs`
   - oj 上游真源 = `../oj-bin` 源码（只读）；oj-market 仓只读（G8 窗口内仅豁免四件 UI 范围）
6. **fail-closed 红线**（G4）：缺签名/验签不过/格式错一律拒装零落盘，**无任何逃生门开关**（禁 `solution_allow_unsigned` 类配置）。
7. **审计口径**（P2-5 落定，全期遵守）：`auditOp`（框架 oplog）为唯一审计真源；`market_history` 属市场方案自带表、可被第三方读写，仅作展示面（可抵赖）。**P1-15a 已把 recordHistory 接进 install/uninstall 终态——该接线是设计意图，任何任务不得以「唯一真源」字面清除它**。

### 1.1 DDD 限界上下文与统一语言

**上下文映射**（新增代码按此归位，跨上下文只经接口/注入面，不直引内部）：

| 限界上下文 | 目录（templates/api/src/_platform/ 下） | 聚合根 | 对外接口 |
|---|---|---|---|
| 安装生命周期 | `_lifecycle/`（installer/steps/lock/state/atomic） | TaskRecord（任务账本）+ solution sidecar 条目 | `runInstall` / `runUninstall` / `setEnabled` |
| 信任 | `_lifecycle/trust.ts`（P2-2 新建） | 信任库（trusted-keys.yaml：key_id→publicKey） | `createTrustStore()` 工厂 + market/trust 端点 + `ojm trust` |
| 市场目录 | `market/api.ts` | IndexRow / TaskRecord 的市场消费视图 | market/* 端点族 |
| 深检 | `_lifecycle/verify-checks.ts` + `verify-report.ts`（P2-7/8 新建）+ `solutions/api.ts` 端点 | VerifyReport（时间序留存） | POST/GET solutions/verify* |
| 任务治理 | `_lifecycle/tasks.ts` | TaskRecord 生命周期（KEEP/超时/redact） | 任务读取/轮询端点 |

**共享内核**：`_lifecycle/types.ts`（StageResult/TaskStatus/TaskRecord/SolutionEntry——P2-3/6/10 依次扩展，串行下由持锁任务独占修改）。
**防腐层（ACL）**：宿主能力一律走注入面，isolate 代码不直 touch 原生——`fsFace`（fs jail）、`ExecFace`（exec 白名单，P2-13 增 `opts.onStdout`）、**CryptoFace（P2-3 增 `verifyEd25519`，与既有 `sha256Hex` 同口径：原语不可得 = 拒装）**、`db`（参数化 exec/query）。

**统一语言**（写码/写文案/写测试用词以此为准）：

| 术语 | 定义 | 定义处 |
|---|---|---|
| detached 签名 | 侧车文件 `<name>-<version>.tgz.sig`，字段 `alg`/`key_id`/`public_key`/`value`/`canon` | 契约 v1.2（P2-0） |
| 规范串 | 签名输入 `canonicalString(name, version, sha256)`，格式以契约 C2-29 逐字为准 | P2-0 定稿 → P2-1 实现 |
| 指纹 | `sha256Hex(publicKey)` 全 64 hex，UI 分组展示 | P2-0 |
| 六码 | `sig_missing`/`sig_alg`/`sig_key`/`tampered`/`unknown_key`/`sig_format` | P2-3 |
| `needs_trust` | 第五终态：未知 key_id 待人工指纹确认（staging 不清场） | P2-3 |
| TOFU | Trust On First Use：未知 key 首次装由人确认指纹后入库 | G3 双轨 |
| 吊销 | 从信任库移除 key_id：只阻断新装/升级，不动已装方案 | G5 |
| `trust_state` | 方案当前发布方 key 状态：`trusted`/`untrusted`/`absent` | P2-8/P2-11 |
| 深检 | 部署后核验四项（可达/RBAC/设置/账本），不触 exec | D3/P2-7 |

## 2. 任务序列总览

| 串行位 | 任务 | 一句话交付 | 关键产出接口（下游消费） |
|---|---|---|---|
| 1 | P2-0 | 契约 v1.2 + 签名载体裁决 + 签名链三夹具 | 规范串格式、`.sig` 字段表、六码语义表、夹具三枚 |
| 2 | P2-1 | 签名纯函数 + 密钥工具 + 测试密钥与 helper | `canonicalString`/`signCanonical`/`exportRawPublicKeyHex`/`signedArchiveFor` |
| 3 | P2-2 | 宿主信任库 + 运维面 + 路径红线 spike | `createTrustStore()`；GET/POST/DELETE market/trust*；`ojm trust ls/add/revoke` |
| 4 | P2-3 | verify 段验签 + TOFU 终态（fail-closed） | 六码、`needs_trust`、`TaskRecord.trust`、POST market/trust{task_id}、`ojm trust confirm` |
| 5 | P2-6 | 切换前复验含验签 | sidecar `SolutionEntry.archive{sha256,signature,key_id}`；吊销/启用双语义 |
| 6 | P2-4 | `ojm keygen`/`ojm sign` + 入包红线 | 作者签名工具链；`.sig` 自动探测上传 |
| 7 | P2-5 | 失败文案 + 审计 + 脱敏 | 六码双语 reasonKey；redact 增 PEM 规则 |
| 8 | P2-7 | 深检四项 + 端点（不触 exec） | POST solutions/verify?name=；diff*Rows 纯函数 |
| 9 | P2-8 | 深检报告结构 + 留存 + 可信性项 | VerifyReport 结构；保留 N=10；GET verify/last |
| 10 | P2-9 | `peerPlatform` 预检强制 + meta 语义 | 0.x 版本口径；pair-pin 测试 |
| 11 | P2-10 | TaskRecord `schemaVersion` + 兼容 | 缺省回填 1；旧消费面兼容 |
| 12 | P2-11 | IndexRow 扩展 + 索引投毒加固 | `available[]`/`changelog`/`trust_state`；file 逐字 + size 比对 |
| 13 | P2-12 | 引导装 market + bootstrap key + 占位卡两态 | 模板内置第一方 key；三态占位卡 |
| 14 | P2-13 | 任务治理核查 + onStdout 进度 | ExecFace.onStdout；appliedSeq 存续证明 |
| 15 | P2-14 | 文档包与真源同步 | devkit 两章节；openapi/__client/init 三处同步 |
| 16 | P2-15 | G7 备案池承载（范围=审查裁决） | 随裁决 |
| 17 | P2-16 | e2e 扩展 + 真机走查 + 夹具全量改造 | AC-P2-1~17 终验 |

## 3. 任务详规

> 每任务通用收尾（不再逐条重复）：① `git add -A && git commit`（消息 conventional + 尾行署名）；② 计划 §4 任务表状态行回填（状态/开始/耗时）；③ 台账追加一行（commit + 测试数字 + 备案→集中审查）；④ 报告文件 `task-P2-N-report.md` 落 SDD 工作区。TDD 步骤一律「先写用例跑红 → 最小实现跑绿 → 全量基线复跑」。

### P2-0 契约 v1.2 增补 + 签名载体裁决

- **目标**：把 G3/G4/G5 全部裁决固化为契约条文 + 双端共用夹具，后续 16 个任务的验收锚点。
- **Files**：`docs/prd/solution/202610171254-lifecycle-manifest-contract.md`（v1.1→v1.2，append-only 记变更表）；`packages/cli/src/lifecycle/__tests__/fixtures/`（签名链三枚**提交为产物**：`demo-solution-0.2.0.tgz` + `.sig`（已签）/ 同 tgz + `.bad.sig`（篡改：value 改一字节）/ 同 tgz + `.unknown.sig`（未知 key 签名））；教学文档 §坑表补签名坑；devkit 提纲补「签名与信任」骨架。
- **产出（下游逐字消费）**：
  1. 规范串格式定义表（`canonicalString(name, version, sha256)` 拼接式**逐字**——P2-1 照抄实现，禁止自造分隔符）；
  2. `.sig` 字段表：`alg`（恒 `"Ed25519"`）/`key_id`/`public_key`（hex 64 必填）/`value`（标准 base64）/`canon`（规范串版本标记）；
  3. 六码语义表（每码：触发条件 + 双语文案 key + retryable 恒 false）；
  4. `key_id` 命名空间规则：`<publisher>.<id>` 全小写，禁裸通用名（`default`/`test`/单段）；违反归 `sig_format`；
  5. 首次绑定不可改条款；老 Form B 缺 `public_key` = 拒装 + 迁移指引（契约 append-only 的**明写例外**）；
  6. IndexRow 扩展字段表（`available[]`/`changelog`/`trust_state`/`publisher`）；深检报告 item 结构（`id`/`severity`/`subject`/`advise_key`）；
  7. 切换前复验口径（升级/回滚=完整验签；enable=放行+告警）。
- **BDD 验收**：
  - Scenario: 双端三同一。Given 三枚夹具被 CLI 面与 templates 面测试分别加载，When 各自计算规范串/指纹/验签，Then 两侧结果逐字一致（规范串字面、指纹 64 hex、verify 布尔）。
  - 夹具双端可达性若不成立：允许在 `fixtures/` 旁提交生成脚本 `gen-signed-fixtures.mjs`，templates 测试运行生成器到 tmp 再断言；**生成逻辑禁止写两处（DRY）**。
- **原则落点**：ISP（契约分节：签名/信任/深检/目录各一节，消费方只读所需节）；DRY（夹具双端共用）。

### P2-1 签名纯函数 + 密钥工具 + 测试密钥与 helper

- **消费**：P2-0 规范串格式逐字、夹具三枚。
- **Files**：`packages/cli/src/lifecycle/sign.ts`、`packages/cli/src/lifecycle/keygen.ts`、`__tests__/sign.spec.ts`、`__tests__/keygen.spec.ts`、共享测试密钥（生成后提交，仅测试用）。
- **产出接口（P2-3/4/12/16 消费）**：
  ```ts
  canonicalString(name: string, version: string, sha256: string): string
  generateKeyPair(): { publicKeyHex: string; privateKeyPem: string }   // ed25519, 32B raw
  signCanonical(privateKeyPem: string, canonical: string): string      // 标准 base64
  exportRawPublicKeyHex(privateKeyPem: string): string                 // 32B raw hex
  verifyCanonical(publicKeyHex: string, canonical: string, sigB64: string): boolean
  // __tests__/helpers.ts: signedArchiveFor(bytes, name, version, {key?}) → {tgz, sig, keyId, fingerprint}
  signedArchiveFor(...)   // 测试运行时算摘要与签名，替代硬编码常量
  ```
- **BDD 验收**：
  | Scenario | Given | When | Then |
  |---|---|---|---|
  | 规范串逐字 | P2-0 格式表 | canonicalString("demo","0.1.0",<64hex>) | 输出与契约示例逐字相等 |
  | 签验往返 | 任意 key | sign → verifyCanonical | true；篡改 canonical 一字符 → false |
  | Node 对拍 | 同上 | Node `crypto.verify(null, canonical, key, sig)` | 与 verifyCanonical 结果一致 |
  | 确定性 | 同一 canonical 签两次 | 比对 | Ed25519 确定性，签名相同 |
  | 编码面 | value/base64url 变体、PEM 公钥、64hex 以外长度 | 输入 verifyCanonical | 严格拒（helper 不做归一） |
- **原则落点**：SRP（sign 与 keygen 分文件）；DIP（不 touch Node crypto 以外依赖，便于 templates 面同构复用语义）。

### P2-2 宿主信任库 + 可操作面 + 路径红线 spike

- **消费**：P2-1 的 key 工具（测试生成多 key）。
- **Files**：`templates/api/src/_platform/_lifecycle/trust.ts`；`market/api.ts`（三个运维端点）；CLI `packages/cli/src/trust.ts` + `index.ts`（挂子命令）；spec：`templates/api/tests/lifecycle/trust.spec.ts`。
- **产出接口**：
  ```ts
  // _lifecycle/trust.ts —— 工厂 + 注入面，模块级零全局触碰（空沙箱红线）
  createTrustStore(path: string, opts: { fsFace: FsFace }): {
    list(): Promise<Array<{ key_id: string; public_key: string; added_at: number }>>;
    get(keyId: string): Promise<string | null>;            // publicKey hex
    add(keyId: string, publicKeyHex: string, o?: { operator?: string | null }): Promise<"added" | "exists_same">;
    remove(keyId: string, o?: { operator?: string | null }): Promise<boolean>;  // 移除即吊销
  }
  // 存储形制：.solutions/trusted-keys.yaml，key_id → {public_key, added_at}；原子写（D13）+ .bak
  // 端点（均 superadmin，R9）：GET  /api/_platform/market/trust        （列表）
  //                           POST /api/_platform/market/trust/key     {key_id, public_key}
  //                           DELETE /api/_platform/market/trust/key   {key_id}
  // CLI：ojm trust ls / add <key_id> <pubkey_hex> / revoke <key_id>
  ```
- **BDD 验收**：
  | Scenario | Given | When | Then |
  |---|---|---|---|
  | 空库 | 新建库 | list/get | 空数组/null，不报错 |
  | 损坏可读报错 | yaml 写入垃圾 | list | 人话错误（含文件路径 + 修法指引），不半截数据 |
  | .bak 恢复 | 主文件损坏、.bak 完好 | 读 | 自动回落 .bak 并告警（或明确报「用 .bak 恢复」指引——二选一钉死并在 spec 断言） |
  | 多 key 共存 | add 两个 key_id | list | 两条都在（轮换过渡期形态） |
  | 首次绑定不可改 | key_id=A 已绑 K1 | add(A, K2) | 拒：独立错误（`trust_bound_mismatch`），K1 不动 |
  | 同 key 幂等 | add(A, K1) 两次 | 第二次 | 返回 `exists_same` 不报错 |
  | 移除即吊销 | remove(A) | get(A) | null；审计留痕（action=`solution.trust.revoke`，记 operator） |
  | 并发读不见半截 | 原子写中 | 并发 list | 永远读到完整旧版或完整新版 |
  | **路径红线 spike** | 真机：装一个普通方案模块 | 该模块尝试写 `modules/.solutions/trusted-keys.yaml` | **两种结论都合法**：能写 → 记红线 + 钉回归用例 + 转 P3/上游需求（`platform.trusted_paths` 候选）；不能写 → 记「jail 天然隔离」结案。结论必须落台账 |
- **原则落点**：DIP（fsFace 注入）；DRY（原子写复用 `atomic.ts`；audit 复用 `auditOp`）；安全（运维端点 superadmin 门禁 + 变更全审计）。

### P2-3 verify 段验签 + TOFU 终态（P2 最重任务）

- **消费**：P2-1 sign/verify 函数；P2-2 信任库；CryptoFace 注入口径。
- **Files**：`steps/verify.ts`、`types.ts`、`installer.ts`、`market/api.ts`、CLI `trust.ts`（加 confirm）/`site.ts`/`install.ts`；spec：`__tests__/`（CLI 面）+ templates 侧 verify/TOFU spec。
- **结构校验序**（全部前置原语调用，逐条短路）：`alg==="Ed25519"` → `key_id` 命名空间合法 → `public_key` 严格 `^[0-9a-f]{64}$` → `value` 严格标准 base64（含 `-`/`_` 即 `sig_format`，**禁 base64url 归一**）→ 规范串 → 信任库比对 → `verifyEd25519`。
- **产出（终态与消费面四处同改，漏一处即旧消费面误显成功）**：
  ```ts
  // types.ts
  type SigCode = "sig_missing" | "sig_alg" | "sig_key" | "tampered" | "unknown_key" | "sig_format";
  StageResult 增 code?: SigCode; needsTrust?: boolean; trust?: { key_id: string; fingerprint: string };
  TaskStatus 增 "needs_trust";   // 第五终态
  TaskRecord 增 trust?: { key_id: string; fingerprint: string }; schemaVersion 不在本任务（P2-10）
  // installer.ts 遍历器：needs_trust 处置一处（OCP）——staging 不清场（file 源须重传、CDN 源重试自动重下）
  // market/api.ts：POST /api/_platform/market/trust  body 仅 {task_id}（superadmin）
  //   服务端自任务记录重取公钥 → 与确认指纹逐字比对 → 信任库 add（只允许新增，撞绑定即拒）
  // CLI：ojm trust confirm --task <task_id>（先展示指纹再调端点，防「确认 A 落 B」）；renderOutcome：除 done 外一律非成功
  ```
- **BDD 验收（多条件数据表，逐码一行）**：
  | 输入态 | 期望 code | 零解压 | 零落盘 | retryable |
  |---|---|---|---|---|
  | 无 `.sig` / Form B 无 signature | `sig_missing` | ✓ | ✓ | false |
  | `alg: "ed25519"`（小写）/ 未知枚举 | `sig_alg` | ✓ | ✓ | false |
  | key_id 命名空间违规 / 已信任但公钥不一致 | `sig_key` | ✓ | ✓ | false |
  | value 篡改（verify=false） | `tampered` | ✓ | ✓ | false |
  | value 含 `-`/`_`、public_key 非 64hex、value 非标准 base64 | `sig_format` | ✓ | ✓ | false |
  | 未知 key_id（其余全合法） | `unknown_key` → `needs_trust` | ✓（停在 verifying 前） | staging 留存 | — |
  | 已信任 + 验签过 | 通过进入 extracting | — | — | — |
  - Scenario: TOFU 全链。未知 key 装 → `needs_trust` + `TaskRecord.trust` 有指纹 → `ojm trust confirm --task` 确认 → 重试可装；拒绝不装；同 key_id 换公钥的包确认时被拒（`trust_bound_mismatch`）。
  - Scenario: 双层语义分码。`verifyEd25519` 抛错（格式类，`verifyEd25519: ` 前缀，isolate 内 try/catch 转 `sig_format`）vs 返回 false（`tampered`）——**同拒装但分码**。
  - Scenario: 混淆代理。构造任务记录 trust.fingerprint=A、实际公钥 B → confirm 端点逐字比对失败 → 409，信任库零变化。
  - Scenario: 旧消费面。800ms 轮询 UI / `renderOutcome` 遇 `needs_trust` → 显示「待信任确认」（非成功态、非失败崩溃）。
- **原则落点**：LSP（needs_trust 是 TaskStatus 合法成员，一切 switch 需穷尽）；fail-closed（原语不可得=拒装，同 sha256Hex 口径）；OCP（installer 遍历器一处处置）。
- **派发注意**：本任务 6 文件为 P2 最重，报告契约要细（六码逐码附测试证据）；isolate 异常消息带上下文进任务记录（禁 console）。

### P2-6 切换前复验含验签（D11③，四方评审阻塞项）

- **消费**：P2-3 六码与信任库；既有 `setEnabled` 四处同写。
- **Files**：`state.ts`（`SolutionEntry` 增 `archive?: {sha256, signature, key_id}`——随安装落，作复验真源）、`types.ts`、`installer.ts`；spec。
- **语义（G5 细化，与 D11③ 调和）**：升级/回滚/降级 = 重新取包 → **完整验签**，key 已吊销即拒；enable（原版本恢复）不算新装 → 放行 + 显著告警 + 审计 + 深检标 `untrusted`（P2-8 消费）。
- **BDD 验收**：
  | Scenario | Given | When | Then |
  |---|---|---|---|
  | 吊销后升级拒 | key R 已吊销；方案 v1 用 R 签的新包 | 升级 | 拒（`unknown_key`→needs_trust 路径，不再放行旧信任） |
  | 吊销后 enable 放行 | 同上 key；方案已装已禁用 | enable | 成功 + 告警文案 + 审计 + sidecar 标 `untrusted` |
  | sha 不符硬拒 | 重取包 sha ≠ sidecar.archive.sha256 | 切换 | 拒，六码 `tampered` |
  | sidecar 缺 archive（P1 时代安装） | 旧条目无 archive 字段 | enable | 放行 +「无验签真源（旧版安装）」告警；升级走完整验签 |
  | 夹具覆盖 | 吊销 → 禁用 → 启用序列 | 三步 | 终态如上两行口径 |
- **原则落点**：DIP（复验走与安装同一 verify 函数，禁止第二套实现——DRY）；安全（告警走结构化字段不被脱敏吞）。

### P2-4 CLI `ojm keygen` / `ojm sign`（作者工具链）

- **消费**：P2-1 keygen/sign 纯函数；P2-0 `.sig` 字段表。
- **Files**：`packages/cli/src/{keygen,sign,install,bundle,index,usage}.ts`；CLI spec。
- **产出**：`ojm keygen [--id <publisher.id>] [--out <dir>]`（默认 `~/.ojm/keys/<id>`，`--out` 落工程树内即**警告并要求确认**）；`ojm sign <tgz> [--key <pem>] [--check]`（产出同目录 `.sig`；`--check` 离线自检验签，作者不必靠宿主装失败发现签错）；`ojm install <tgz>` 自动探测同目录 `.sig` 随 multipart 上传（缺签即被宿主 G4 拒，CLI 人话转述六码）；`ojm build --bundle` 增入包红线：`*.pem`/`*.key`/`.env` 拒绝入包（与 modules.json 禁入包同款），只出包不签名。
- **BDD 验收**：参数解析表；`.sig` 五字段齐备且与包匹配；签名确定性（同 key 同包两次 → 同 `.sig`）；红线（工程树放 test.key 后 bundle → 包内无该文件且退出码非 0 或明确排除告警——二选一钉死）；私钥落点（缺省路径正确、`--out` 工程树警告触发）。

### P2-5 失败文案 + 审计 + 脱敏

- **消费**：P2-3 六码；既有 locales/redact/auditOp。
- **Files**：`tasks.ts`、`installer.ts`、templates locales（zh/en）、CLI `install.ts`；spec。
- **要点**：`lifecycle.stage.verifying.<code>` 与 `lifecycle.trust.*` 六码**双语全**（R28/C2-25：缺 key 即测试红）；**渲染层 fail-fast 测试**——测实际渲染输出含人话，不测「key 存在」（现状假绿）；`error.reason` 改走 reasonKey（英文用户不再读到服务端中文串）；`auditOp` 唯一真源，记 key_id+指纹+operator（**不可得记 `unknown` 并告警，禁静默 null**）；`redact` 增 PEM/`private_key` 规则；**钉双向用例**：私钥类必被脱敏、`key_id`+指纹必**不**被脱敏（走结构化字段不进 message）。
- **BDD 验收**：双语 key 齐备（渲染实测）；redact 双向断言表；审计字段表（action/module/target/detail.level）；CLI 渲染含六码人话与指纹分组展示。

### P2-7 深检后端四项 + 端点（全程不触 exec）

- **Files**：`solutions/api.ts`、`_lifecycle/verify-checks.ts`；spec。
- **端点**：`POST /api/_platform/solutions/verify?name=`（**query 取参**，模板 http 面无路径段先例，照 `contacts/detail?id=`；同步修订设计 §4.2 的 `:name` 口径）。admin 可用（非 superadmin——深检是读面核验；若有争议在派发时按 R9 论证定夺，默认 admin）。
- **四项**（纯函数优先）：
  1. 路由可达：复用 `withSiteOrigin` 拼绝对 URL 逐路由探活；**声明了 `required_permission` 的路由遇 403 → 标「未以目标身份验证，未校验」，不判通过**（防 RBAC 缺失假绿）；2xx/401/403 判可达、404/5xx 判异常。
  2. RBAC 完整性：路由声明的权限点 ↔ `sys_permission`/`sys_role` 实有（`diffPermRows`）。
  3. 设置项完整性：方案 settings 定义 ↔ `sys_setting`（**只比 key/存在性/定义列，永不报值**；secret 走既有掩码读取面）（`diffSettingRows`）。
  4. 迁移账本：`db.query _oj_migrations` + 复用 `journalHeadOf`（**DRY**；禁 `oj migrate --format json`——执行语义需新 exec 模板且违反 R9 论证）（`diffLedger`）。
- **SSRF 钉（每条一个测试）**：route path 永不出站（拼 URL 前白名单校验 scheme/host 恒为本站）；`host`/`x-forwarded-proto` 头清洗；禁跟随重定向。
- **BDD 验收**：四项各一过例一异例（数据表）；端点门 401/403/404（未装方案名）；SSRF 三钉。

### P2-8 深检报告结构 + 留存 + 可信性项

- **消费**：P2-7 四项输出；P2-6 的 sidecar `untrusted` 标。
- **Files**：`solutions/api.ts`、`_lifecycle/verify-report.ts`；spec。
- **要点**：item = `{id, severity, subject, advise_key}`（双语可读可行动——「管理员看得见但不知怎么做」即不合格）；**增「发布方 key 状态」项**（`trusted`/`untrusted`/`absent`——G5 吊销后已装方案继续运行却无人知晓的补位）；报告落 `.solutions/verify-reports/` 时间序保留 **N=10**（与 U2 GC 统一「时间序保留 + 触发点」一份口径）；`GET /api/_platform/solutions/verify/last?name=`；i18n 项本仓只下发待查 key 清单，前端执行判 oj-market（G8 已授权），缺执行**降级「未校验」不阻断**。
- **BDD 验收**：报告结构快照；第 11 份挤掉第 1 份；last 读取；报告文件损坏不炸端点；降级项出现且 severity 合理；**设值不进报告**（含 secret 场景钉）。

### P2-9 `peerPlatform` 预检强制 + `/market/meta` 语义

- **Files**：`steps/preflight.ts`、`market/api.ts`；spec。
- **要点**：`API_VERSION` 定 major/minor 语义并**钉 0.x 口径（0.x 下 minor 不同 = 不兼容，`^` 语义随之定义：`^0.2.0` 仅匹配 0.2.x）**；**pair-pin 测试**防 `API_VERSION`（`market/api.ts:31`）与模块 manifest 版本手工镜像漂移；preflight 增 `peerPlatform` 规则（真源注入，算子集同 C2-09：精确/`>=`/`^`）；明确 meta 消费方（CLI 预检/人工）且安装器对包内声明与宿主 `API_VERSION` 静态比对。
- **BDD 验收（数据表）**：兼容过 / 不兼容拒+可读升级指引 / 三算子各一例（重点 `^0.2.0` vs `0.3.0` 拒）/ pair-pin 红绿（手改版本号测试必红）。

### P2-10 TaskRecord `schemaVersion` + 新终态兼容

- **Files**：`types.ts`、`tasks.ts`、CLI `site.ts`；spec。
- **要点**：`TaskRecord.schemaVersion` 缺省回填 `1`（读旧记录不炸）；升版纪律写入 types 注释（加字段=minor 兼容、改语义=major 且读方须降级提示：不认识的高版本 → 人话提示 + 不误渲染成功）；旧消费面（800ms 轮询、`renderOutcome`）在 `needs_trust` 下不炸（与 P2-3 的四处同改呼应，此处补旧记录兼容面）。
- **BDD 验收**：无 schemaVersion 的旧记录读出回填 1；schemaVersion=99 → 降级提示且非成功态；轮询消费面用例过。

### P2-11 IndexRow 扩展 + 索引投毒加固

- **Files**：`market/api.ts`、`steps/download.ts`；spec。
- **要点**：IndexRow 增 `available[]`（CDN 版本列表——回滚候选不止本站已装旧版，P1-15b 边界收口）、`changelog`（C2-08）、`trust_state`、`publisher/key_id`；**`operator` 回落 history 行**（挂卡片行是历史动作语义错位）；**`archive.file` 收紧 `<name>-<version>.tgz` 逐字**（现正则过弱，CDN 篡改索引可拼宿主他文件路径）+ **下载后立即比 `archive.size`**；索引本身未签名——低成本加固落本任务，索引签名归 P3-U3（期门已留痕）；`Cache-Control: no-cache` 不变（R15）。
- **BDD 验收**：聚合字段齐（含 CDN 不可达时 `available` 降级为空数组不炸）；`archive.file` 邪例表（`../`、绝对路径、异名、异版本 → 拒）；size 不符拒；no-cache 头断言。

### P2-12 引导装 market + bootstrap key + 占位卡两态

- **消费**：P2-1 keygen（**发布时由用户执行 `ojm keygen`/`ojm sign`，私钥永不出 `~/.ojm/keys/`**）；P2-4 工具链。
- **Files**：CLI `install.ts`/`usage.ts`、templates 内置第一方 `publicKey`+`key_id`、`web/system` 占位卡；spec。
- **要点**：模板内置第一方 key（免 TOFU，G3 双轨第一轨）；发布流程写进 devkit（P2-14 引用）：用户 keygen → 签 oj-market 首发包 → 公钥随模板发布；占位引导卡两态（未装 → `ojm install market` 指引；被拒 → 「未通过签名校验」+ TOFU/联系发布方指引，双语 R26）；市场自升级提示随 G8 授权在 oj-market 实施（主线出契约）。
- **BDD 验收**：bootstrap key 生效（market 包首装跳过 TOFU 直接过验签）；未装/已装/被拒三态渲染；引导文案双语；**模板内只有公钥**（全仓 grep 私钥 pattern 零命中——钉成测试）。

### P2-13 任务治理核查 + onStdout 进度

- **Files**：`tasks.ts`、`installer.ts`、`steps/migrate.ts`、`steps/extract.ts`；spec。
- **要点**：① 逐条回归核实既有治理（TASK_KEEP 10/超时 failed/`redact`/`sweepTimedOut`）**真被 installer 调用**——报告附调用点证据表，不被调用的钉修；② `onStdout` **必须在回调内自累积字节缓冲并跨块拼接**——devkit 明示带回调时 `exec.run` 不再返回整段 stdout，否则 `parseMigrateOutput` 拿不到 JSON、`appliedSeq` 丢失、禁降版守卫与 `reconcile` floor 失效（迁移输出恰一行非行对齐）；③ `ExecFace` 先扩 `opts.onStdout`；④ feature-detect `exec.spawn` **双路径均用例**；⑤ 取消安装（`h.kill()`）维持转 P3（G2），本任务只做进度。
- **BDD 验收**：有/无 spawn 双路径全绿；**断言 `appliedSeq` 仍在**（跨 chunk 拼接后解析成功）；进度字段不破坏既有轮询消费面；治理核查表齐。

### P2-14 文档包与真源同步

- **Files**：`docs/devkit/manual.md`、三视角指南（202610171354）、教学文档（202610172100）、`templates/openapi.json`、`web/src/_platform/__client/api.ts`、init 测试；spec。
- **要点**：devkit「打包与分发」正式章节（P1-11 承诺未落地）+「签名与信任」章节（含发布流程：keygen→sign→install 与 bootstrap key 流转）；三视角指南交付期更新（其 §3.3 已向管理员承诺尚不存在的深检按钮——本期兑现后改 truthful）；教学文档 §6 主路径改 `build --bundle` → `sign` → `install` + 八坑表补签名坑；**`openapi.json` + `__client` + init 测试三处同步**，并裁决 `market/*` 全族补登——`export default createMarketApi(...)` 是 CallExpression，handler-scan 不认，`ojm api --check` 的 route-unregistered 守卫对市场面失效：**修 handler-scan 认 CallExpression（优先）或显式豁免留痕（次选），二选一钉死写进报告**。
- **BDD 验收**：文档存在性断言；`ojm api --check` 全绿；init 测试过（三处同步的机械证明）。

### P2-15 G7 备案池承载（范围=集中审查裁决）

- **范围来源**：`review-p1-findings.md` 中「defer-P2」裁决条目，就地在计划 §4.1 G7 行补录后展开为本任务 Files/Test。
- **已知候选**（裁决后增删）：P1-14 组级 `label_key` 缺口、P1-12 `task?id=` 形态校准、P1-9 完整 modules.json 条目透传、P1-6 `archive.size` 未比（若 P2-11 已覆盖则销项）、P1-5 version 严于契约字面回调、**`GET /market/index` 每次刷帧触发 `reconcile` 写状态（含摘锁）且对账依赖可能被 GC 的任务记录**——建议改显式触发/只读报告。
- **红线**：审查报告未出 → 本任务 blocked，不得凭记忆补条目（以台账+报告双源为准）。

### P2-16 P2 端到端 + 真机走查 + 夹具全量改造

- **前置**：宿主重建（templates 改动 rsync → 重建 → **重启 oj serve**）；端口 9778 保留、其余 9781+。
- **Files**：`scripts/lifecycle-e2e.mjs`（扩展）、`scripts/lifecycle-walkthrough.mjs`（扩 P2 断言）、夹具改造清单执行。
- **要点**：e2e 从干净库起跑，扩签名链三态（未签名拒/篡改拒/TOFU 确认后过）+ 深检 + 握手 + 索引；真机 AC0-7 扩 P2 断言（**未签名装不上 / 篡改包不落盘 / TOFU 确认 / 吊销后拒升级**）；AC 逐条标注 auto/manual（AC 表「断言方式」列）；**夹具签名改造清单全量执行**（P2-1 `signedArchiveFor()` 替换 ~25 处硬编码常量夹具——改一处跑一处，禁大爆炸后一次跑）；基线终验：根 697+1skip / templates **433+新增** / cli 153+1skip / typecheck 净。
- **BDD 验收**：AC-P2-1~17 对照表逐条勾；四门数字落报告。

## 4. 阶段收尾（所有任务完成后执行一次，用户常设指令）

1. **集中审查**：区间 = `<feat/lifecycle-p2 切出点>..HEAD` 全量 diff；评审包照 SDD `scripts/review-package` 生成；备案池 = 本期各任务台账「备案→集中审查」条目逐条裁决（fix / ratify 留痕 / defer-P3）；审查模型用最强可用（opus 先例）。
2. **修复波**：按 findings 派发修复（一轮为主，参照 P1 惯例），scoped 复审。
3. **全绿验收**：四门基线 + AC-P2-1~17 逐条对照 + G8 四件 UI 范围验收（oj-market 侧）。
4. **§7 P2 阶段小结**（计划文档，照 P0/P1 格式）：关键过程 / 方法论落地（评审拦下什么）/ 遗留（接受保留清单）/ 上游对账。模板字段：起止时间、总耗时、commits 数、任务 17/17、AC 17/17、三条阻塞的解决记录。
5. **DoD**：AC-P2-1~17 全绿 + 未签名装不上/签名不符不落盘真机演示 + 集中评审合并 + §7 小结。

## 5. 附：派发 prompt 模板（执行 lead 用）

```
你是 P2 任务 <N> 的实现者。先读以下三件，再动手：
1. 任务 brief：.superpowers/sdd/202610171207-solution-lifecycle-implementation-plan/task-P2-<N>-brief.md
   （由 scripts/task-brief 生成；其内容以本文档 §3 P2-<N> 详规 + 计划 §4 任务表行为准）
2. 上游接口：本文档 §3 前序任务的「产出接口」（只依赖列出的，不得臆测）
3. 全局约束：本文档 §1（基线/纪律/fail-closed/审计口径）

要求：TDD 先红后绿；Files 封锁面不得越界；commit 消息 conventional + 尾行 unix@vip.qq.com ai；
完成后报告：status(DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED) + commits + 测试数字 + CONCERNS。
发现计划冲突 → 停下报告，不得自行改道。
```

——完。执行顺序、接口、用例、纪律已闭合；开工唯一闸门是 §0-1（P1 集中审查收尾合并）。
