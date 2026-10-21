# oj-market CDN 实施计划（phase0 → phase2）

> 日期 2026-10-21 01:30 ｜ 分支 `feat/ojm-market-cdn` ｜ 状态：phase0 进行中
> 上游设计：`docs/plans/2026-10-20-ojm-cdn-market-playground-design.md`（含 round3 spike §11、决策 D-1 / D-2）
> 本计划回答「怎么落地」；「为什么」一律回上游设计，此文不重复论证。

## 1. 范围、既定决策与基线

### 1.1 已定板（设计中已拍定，本计划不再讨论）

- **D-1**：索引从「发布时增量合并」改为「扫描 `cdn/*.tgz` 全量重建」——publish 只落包，`build-index` 重建索引。
- **D-2**：模板**直接发布** `/cdn` 挂载 + `cdn/README.md`，`ojm market setup` **不再改写 mounts**（原 A3 阻断消解）。
- **§3.1.1（round3 阻断）**：`ojm dev` 的 Node server 在 5174，只反代 `/api`；`/cdn` 只在 oj 子进程（9778）上成立。
  → 市场地址**必须是绝对 URL**，且端口由 `config.yaml` 的 `server.port` 推导，禁止硬编码。
- **服从既有契约**：不动 `_platform/market` 任何端点；不动 `--key` 语义（给 `--key` 则 `--id` 必填）。

### 1.2 基线（开工前实测，后续回归以此为尺）

| 项 | 命令 | 结果 |
|---|---|---|
| cli 单元测试 | `vitest run --config packages/cli/vitest.config.ts` | 20 files / **245 passed**, 1 skipped |
| init 白名单守卫 | `vitest run tests/cli/release-manifest.test.ts` | **3 passed**（逐条核对 include 路径在 tarball 内） |
| 工具链 | fnm 内 `node v22.18.0`（本机 PATH 无 node，需显式前置 bin 目录） | 可用 |

## 2. 用户故事（INVEST 自评）

六维自评：`I` 独立 / `N` 可协商 / `V` 有价值 / `E` 可估算 / `S` 足够小 / `T` 可验收。
标记 `✓` 为达标，`△` 为需靠本文其它约束兜住（备注给出兜法）。

| ID | 用户故事 | 阶段 | I | N | V | E | S | T | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| US-1 | 作为**脚手架用户**，`ojm init` 出的新工程默认自带可提交的本地 CDN 目录与挂载，以便我不做任何配置就能往里放分发包 | P0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 边界最小：只加文件与两行配置 |
| US-2 | 作为**方案作者**，我要一条命令把 bundle 产物（`.tgz` + 包级 `.sig`）落进 `cdn/`，以便我能投稿到市场源 | P0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 与 US-3 正交才成立（D-1 的成果：无共享可变索引） |
| US-3 | 作为**CDN 维护者**，我要扫描目录全量重建索引并签名，以便多人各发各的包时不打架 | P0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 见 US-2 备注 |
| US-4 | 作为**站点管理员**，我要一条命令打开市场地址，以便首跑不必手改配置也不必先手工艺融售察觉 must_change 门槛 | P0 | ✓ | ✓ | ✓ | ✓ | △ | ✓ | `S` 偏大（凭据链路）→ 拆 P0-T5 单任务，DOD 钉四个场景 |
| US-5 | 作为**方案作者**，我要离线（不起站点、不装）验包的完整性与签名，以便秒级确认包本身是否有问题 | P1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 结论必须带「非内容安全背书」边界声明 |
| US-6 | 作为**方案作者**，我要在一次性隔离站点里试装，以便确认安装流程正确且不污染我的工程与信任库 | P1 | ✓ | ✓ | ✓ | △ | △ | ✓ | `E/S` 偏大 → 依赖 `bootstrap.ts` 库化；CHECKLIST：隔离资源六项逐项验收 |
| US-7 | 作为**管理者/QA**，我要一条命令跑全套市场操作并拿一张 AC 表，以便一眼看出链路是否在验 | P2 | ✓ | ✓ | ✓ | △ | ✗ | ✓ | `S` 不达标 → **必须拆小**：按 §5 拆成 T10 骨架 / T11 主链路 / T12 neg-* 与报告三个子任务 |

> INVEST 缺口处置：US-4 拆小、US-6 库化后再用、US-7 拆成 P2 三个子任务——三者均已在本计划落到可执行粒度。

## 3. BDD 用例

### 3.1 US-1 新工程自带 CDN

```gherkin
Scenario 1.1 新工程可直接起站（挂载目录存在）
  Given 刚由 ojm init 生成的新工程
  When  直接 oj serve
  Then  进程正常监听（不报 挂载目录 No such file or directory）
   And  cdn/README.md 存在且内容含「本地模拟源 / 生产切法 / 校验口径 / TOFU」四条

Scenario 1.2 挂载内容是可-checkout 的静态产物
  Given 新工程 cdn/ 目录
  When  查看 init.include.yaml 与 release-manifest 测试
  Then  cdn/README.md 在白名单内
   And  所有 *.tgz / *.sig / bundles.yaml 一律不在白名单（产物不进仓）
```

### 3.2 US-2 publish 落包（数据表格驱动）

```gherkin
Scenario 2.1 落包形态矩阵
  Given 空的 cdn/ 目录
  When  ojm market publish <args>
  Then  cdn/ 下产出物与 outcome 列一致

  | args                                   | outcome                                              |
  | --fixture demo-solution@0.1.0         | 产出 demo-solution-0.1.0.tgz + .tgz.sig，索引不变      |
  | --fixture demo-solution@0.1.0 --rebuild-index | 同上，并顺带重建两份索引                        |
  | 同名同版本重发（字节一致）            | 覆盖即幂等，tgz sha256 不变                            |
  | 同名同版本重发（字节不同）            | 报错并提示需升 version                                 |
  | --real <module>                       | 走真构建后落同一目录（下游完全同上）                    |

Scenario 2.2 签名身份约束
  Given 一次性内存 keypair（隔离场景）
  When  调用 publishCore
  Then  .tgz.sig 的 key_id 与 public_key 对应该 keypair
   And  磁盘上不产生任何 PEM 文件
   And  未读取 ~/.ojm/keys
```

### 3.3 US-3 build-index 扫描重建

```gherkin
Scenario 3.1 重建结果只取决于目录内容
  Given cdn/ 下有 m 个包、每个包 k 个版本
  When  ojm market build-index
  Then  bundles.yaml 中每个包的 versions 数为 k，latest 为该包 semver 最大值
   And  历史版本全部保留（扫描天然不删）
   And  两次连续执行结果字节一致（幂等）

  | tgz_set                              | expected_solutions | expected_latest | expected_versions_count |
  | 空目录                               | 0                  | —               | 0                       |
  | demo@0.1.0                           | 1                  | 0.1.0           | 1                       |
  | demo@0.1.0 + demo@0.2.0              | 1                  | 0.2.0           | 2                       |
  | demo@0.1.0 + other@0.3.0             | 2                  | demo 0.1.0 / other 0.3.0 | 各 1              |
  | 缺内嵌 manifest.yaml 的包            | 报错并跳过该包，人工人话提示                            | —               | —                       |
```

### 3.4 US-4 setup 打开市场地址

```gherkin
Scenario 4.1 首跑 must_change 闭环
  Given seed admin 处于 must_change=1
  When  ojm market setup
  Then  login 探测到 restricted → 改密 → 取得全权 token → PUT sys_setting 成功
   And  写出的值是绝对 URL（端口取自 config 的 server.port）

  | case                    | expected_outcome                                     |
  | happy（受限→改密→成功） | exit 0，市场 URL 已写入                               |
  | 旧口令错误              | 人话报错，不落任何东西                                 |
  | 站点未起                | 人话报错「先 ojm dev」，不落任何东西                    |
  | 改密后 PUT 仍 403       | 人话报错并给出处置建议                                 |
```

### 3.5 US-5 / US-6 / US-7（P1-P2 展开，先钉骨架）

- **US-5 verify**：起不来站点也能验；校验项四类（sha256 / 包级签 / 索引签 / manifest 结构），`--rebuild-check` 比对索引与目录漂移；
  数据维度 `check_item × tamper_type × expected_result`；结论恒带边界声明。
- **US-6 trial**：隔离资源六项（端口 / DB / 密钥 / 凭据 / 信任库 / CDN 目录）逐项断言「与真站点物理隔离」，跑完默认销毁、`--keep` 打销毁清单。
- **US-7 walkthrough**：op 表沿用设计 §3.5；`--only` 单跑、`--keep`、`--strict`；neg-* 按「预期失败命中 = PASS」口径；输出 AC 表 + 汇总行。

## 4. 架构约束（SOLID / DRY）

### 4.1 文件与职责（单一职责边界）

| 文件（`packages/cli/src/market/`） | 职责 | 不得顺手做 |
|---|---|---|
| `layout.ts` | **单一真相**：cdn 目录定位、`/cdn` 基址推导、（可选）索引文件名 | 不做 IO、不签名 |
| `scan.ts` | 读 `.tgz`：gunzip + ustar 读端，提取内嵌 manifest | 不聚合、不写盘 |
| `index-builder.ts` | 聚合 solutions/versions/latest + 归一化 | 不解析 tar、不签名 |
| `publish.ts` | 编排：合成/构建 → tgz → 包级签名 → 落盘 | 不碰索引（D-1） |
| `build-index.ts` | 编排：扫描 → 聚合 → 索引签名 → 写盘 | 不落包 |
| `verify.ts` | 纯本地校验，返回结构化结果 | 不起站点、不装 |
| `bootstrap.ts` | 隔离站点生命周期：`bootstrapIsolatedSite()` 返回 `{ baseUrl, token, cdnDir, cleanup }`，并登记 SIGINT/SIGTERM 防孤儿 | 不含任何 op 断言 |
| `trial.ts` / `walkthrough.ts` | 各自命令编排 | 不重写 login/poll 逻辑，一律走 `site.ts` |
| `ops.ts`（P2） | 单个 op 的 `setup→act→assert→cleanup` 形状 | 不含命令参数解析 |

### 4.2 SOLID 映射

| 原则 | 落到本期的具体形状 |
|---|---|
| **S** | 上表每文件一职责；`publish` 与 `build-index` 彻底分离（D-1 的直接后果） |
| **O** | `publishCore({privateKeyPem,keyId,…})` 让「文件身份 / 内存身份」两种来源无需改 CLI 面；`bootstrapIsolatedSite()` 同时服务 trial 与 walkthrough |
| **L** | 无继承层次；命令层组合函数而非继承 |
| **I** | 选项接口细分：`SigningIdentity` / `CdnLayout` / `SiteCredentials` 各自独立，命令层组装 |
| **D** | 依赖倒置以便测试：命令依赖可注入的 fetch/site 客户端（对齐 `market/api.ts` 里 env 注入先例），不直接进程内 new |

### 4.3 DRY：单一真相表与禁令清单

| 真相 | 唯一出处 | 其它地方一律引用 |
|---|---|---|
| cdn 目录位置 / CDN 基址 | `market/layout.ts` | 所有命令；**禁止**任何地方硬编码 9778 或 `../cdn` 字面量 |
| 打包字节 | `createDeterministicTgz`（既有） | 禁止自研 tar |
| 包级 / 索引级签名 | `lifecycle/sign.ts` + `publish.ts`（既有 `indexCanonical`/`signIndex`） | 禁止重写 crypto |
| 站点调用四件套 | `site.ts` 的 `resolveSite/login/callApi/pollTask` | 禁止裸 fetch 调 `_platform` |
| 一次性密钥 | `fixtures/sig/gen-signed-fixtures.mjs` 的 seed 派生手法 | 禁止再落 PEM 到磁盘 |
| 测试夹具 | `lifecycle/__tests__/fixtures/sig/*`（good/bad/unknown 三态） | 禁止再造一套假包 |

**依赖方向红线**：market 命令面全在 cli 包内；**不得** import `templates/**` 任何源文件（否则违反 A6，这也是 D-2 之所以成立的原因之一——`insertAnchor` 在模板侧）。

## 5. 阶段、任务与 DOD

> 每阶段纪律：**先把本阶段所有任务实现完，再做一次统一审查**（代码 + 单测 + 回归 + typecheck/lint），最后写阶段小结。

### phase0 —— CDN 基建与主链路（Task 1–6）

- **T1** 模板自带 `cdn/` 与 `/cdn` 挂载（D-2）：`templates/cdn/README.md`、`api/config.yaml` 增挂载、`init.include.yaml` 增 `cdn/README.md`
- **T2** `market/layout.ts`：CDN 目录与基址单一真相（含单元测试）
- **T3** `publishCore` 抽取（`publish.ts` 内部化）+ `ojm market publish`（fixture + 落包 + 包级签名）
- **T4** `ojm market build-index`（`scan.ts` + `index-builder.ts` + 命令）
- **T5** `ojm market setup`（must_change 闭环 + 写绝对 URL）
- **T6** 端到端：模板仓跑通 index 出卡片 → install 十阶段 → curl 冒烟（字节一致 / 404）
- **DOD**：`publish.test.ts` / `deterministic-tar.test.ts` 等既有测试无回归；新增 `market/*.test.ts` 通过；cli 全套 + release-manifest 净；P0-T6 手工链路通过。

### phase1 —— 开发者环境（Task 7–9）

- **T7** `ojm market verify`（离线：sha256 / 包级签 / 索引签 / 结构 + `--rebuild-check` 漂移比对 + 边界声明）
- **T8** `market/bootstrap.ts` 隔离站点库（端口 / 证书 / DB / 一次性密钥 / 一次性凭据 / 隔离信任库 + cleanup + SIGINT 防孤儿）
- **T9** `ojm market trial`（跑一次完整安装并报阶段结果，默认销毁隔离根）
- **DOD**：隔离资源六项逐项断言；`--keep` 打销毁清单；私钥不落盘有测试守着。

### phase2 —— 全套操作模拟（Task 10–12）

- **T10** `installRaw` 抽取 + walkthrough 骨架（preflight 五项 / AC 表 / 汇总行 / artifacts）
- **T11** 主链路 op（index / install / reinstall / upgrade / rollback / enable / disable / verify / history / uninstall）
- **T12** neg-*（tamper / nosig / badindex / stranger / evil）+ 信任库快照 diff + revoke + 失败文案表 + 报告白黑名单
  - **口径收敛（交接文档 §8）**：本期只做 6 个 op——`upgrade` / `rollback` / `neg-tamper` / `neg-nosig` / `neg-badindex` / `neg-stranger`；
    「evil / 信任库快照 diff / revoke / 失败文案表 / 报告白黑名单」不在交接范围内，留后续。
  - **支撑改动**：fixture 迁移阶梯——`0.2.0` 起（minor ≥ 2）多一段 `0002__more.sql`，
    让「升级真的多走一段迁移、账本 head 能真超前」，upgrade/rollback 才有可断言的物理差异。
  - **BDD 用例**（op 即场景，`--only` 单跑；neg-* 篡改文件在 `finally` 回抄原始字节，不重签）：

| 场景 | Given | When | Then |
|---|---|---|---|
| upgrade | 隔离站点已装 `demo-solution@0.1.0`（账本 head=1） | 发布 `0.2.0`（含 `0001+0002`）重建索引并安装 | `done`；索引 `installed=0.2.0` 且 `available` 含两版；`api/dist` 下 0.1.0/0.2.0 版本目录共存（旧版不 prune）；两版 `0001__init.sql` 逐字节一致 |
| rollback | 已装 `0.2.0`（账本 head=2） | 再装 `0.1.0`（包内最大 seq=1 < head=2） | `failed` 且 `stage=migrating`（禁降版拦截）；`api/dist` 内容快照零变化（0.1.0 目录是前序合法安装产物，不能拿「目录不存在」当断言）；索引 `installed` 仍为 `0.2.0` |
| neg-tamper | CDN 已索引 `demo-solution@9.9.9` | 翻转 tgz 一个字节后安装该版本 | `failed` 且 `stage=verifying`（sha256 与索引不符，C2-29）；`api/dist/<name>-9.9.9` 不存在（零落盘） |
| neg-nosig | `9.9.9` 的 `.tgz.sig` 被删除并重建索引 | 安装 `9.9.9` | `failed` 且失败信息含 `sig_missing`（G4 硬 fail-closed） |
| neg-badindex | `bundles.yaml` 被追加字节（签名失配） | 发起安装 | 安装 POST 即被拒（502，信息含「签名校验失败」，G4 fail-closed），任务都未创建 |
| neg-stranger | `9.9.9` 被**未登记 key** 重签并重建索引 | 安装 `9.9.9` | 首装 `needs_trust`（unknown_key）→ trust confirm → 重装 `done` |

  - **op 顺序约束**：upgrade 须在 head ≤ 1 时跑（0.1.0 之后）；rollback 依赖 upgrade 之后的 head=2；
    故顺序为 `… enable / verify / history → upgrade → rollback → uninstall → neg-*`。
    uninstall op 改为「查索引实际 installed 版本再断言目录清除」，不再钉死 `ctx.version`。
  - **neg-* 用 `9.9.9`**：与主链路版本完全隔离，互不残留；每个 neg op 自建前置（发布→篡改→重建索引），
    finally 里删 `9.9.9` 包并重铺索引。
  - **T12 收尾批（2026-10-21 第二轮，消灭遗留风险项）**——原清单余量 5 项 + pitfall 10 修复：

| 场景 | Given | When | Then |
|---|---|---|---|
| neg-evil | 手造 zip-slip tgz（成员 `../evil.sql`，file 源 multipart 上传） | 发起安装 | 安装 POST 即 400（信息含 `zip-slip`，R1 list→validate→extract 三步范式拒在解包前），任务未创建 |
| neg-stranger 收尾 | 首装 needs_trust → confirm → 重装 done（既有断言） | cleanup 显式 `DELETE /market/trust/key?key_id=stranger.publisher` | `{revoked}`；op 前后 `GET /market/trust` key 集合快照 diff 相等（陌生 key 无残留，F3） |
| 失败文案表 | `market/failure-playbook.ts` 双段式（成因一句 + 下一步一句） | 报告渲染文案表 | 每个 neg 场景的预期失败码都有条目（traceability 单测守着） |
| 报告白黑名单 | 白名单（key_id/指纹/task_id/sha256/AC 表）可落盘；黑名单（token/jwt/PEM/口令）禁落盘 | walkthrough 收尾写 `logs/walkthrough-<ts>.md` | 写盘前过黑名单脱敏（单测：注入 token/PEM 被掩码） |
| pitfall 10 修复 | `_oj_migrations` 是 oj journal 内建表（复合 PK module+version），未进模块 schema → `db.table` 被元数据校验拒 → `journalHeadOf` 恒 null | `_platform/schema.yaml` + `manifest.yaml` 声明 `_oj_migrations`（列与真表对齐） | 深检 `ledger.stale` 误报消失；P3-11 宿主层预锁 guard 真正生效（rollback 不再走到 oj migrate 才拦） |

  - **构造器纪律**：用户裁定查询一律走 `db.table` 构造器（多库可移植），故 pitfall 10 走 schema 声明而非 raw SQL。
- **DOD**：每条 op 支持 `--only` 单跑；neg-* 按预期失败口径计分；`--strict` 首败即停。

## 6. 分支、提交与验证命令

- 分支：`feat/ojm-market-cdn`（已建，自 `feat/ojm` 迁出）
- 提交：conventional commit；**不顺便提交** `package.json` / `pnpm-lock.yaml`（非本期改动）
- 验证：

```bash
export PATH='/Users/ever/Library/Application Support/fnm/node-versions/v22.18.0/installation/bin':$PATH
cd <repo> && node node_modules/vitest/vitest.mjs run --config packages/cli/vitest.config.ts   # cli 全套
node node_modules/vitest/vitest.mjs run tests/cli/release-manifest.test.ts                    # init 白名单守卫
```

## 7. 任务状态

| 任务 | 主题 | 状态 | 产出 |
|---|---|---|---|
| T1 | 模板自带 cdn/ 与 /cdn 挂载 | ✅ 完成 | `templates/cdn/README.md`、`api/config.yaml` 增挂载、`init.include.yaml` 收 README、`templates/.gitignore` 拦产物；release-manifest 守卫通过 |
| T2 | CDN 布局与基址单一真相 | ✅ 完成 | `market/cdn-layout.ts`（目录/前缀/基址全部取自 config）+ 8 条用例 |
| T3 | market publish（落包） | ✅ 完成 | `market/fixture.ts` + `market/publish.ts`；复用 `signCommand`（新增内存 PEM 通道）+ `createDeterministicTgz`；6 条用例 |
| T4 | market build-index | ✅ 完成 | `market/scan.ts`（ustar 读端）+ `index-builder.ts` + `build-index.ts`；7 条用例 |
| T5 | market setup | ✅ 完成 | `market/setup.ts`（must_change 闭环 + 绝对地址）+ `market/command.ts` 接入 `ojm market <sub>`；4 条用例 |
| T6 | 端到端验证 | ✅ 完成 | 真宿主（端口 9785）跑通：publish → build-index → setup → market/index 出卡片 → install 十阶段全 ok |
| T7 | market verify 离线验包 | ✅ 完成 | market/verify.ts：四类校验分列（完整性 / 包级签 / 索引签 / manifest 结构）+ --rebuild-index 漂移检出；结论恒带边界声明；已接入 ojm market verify 与 usage |
| T8 | market/bootstrap.ts 隔离站点库 | ✅ 完成 | `market/bootstrap.ts`：空闲端口 / 一次性 DB / 内存发布方密钥（seed 派生，不落 PEM）/ 种子凭据 / 隔离信任库 / 隔离 CDN；`SIGINT/SIGTERM` 防孤儿；cleanup 幂等；11 条隔离断言 |
| T9 | market trial 隔离试装 | ✅ 完成 | `market/trial.ts` + `ojm market trial`：隔离站点内 setup（首登改密）→ 安装 → needs_trust 自动确认 → 重试 → 11 段全 ok，跑完即毁；实测 12s |
| T10 | walkthrough 骨架 | ✅ 完成 | `market/walkthrough.ts`：op 注册表 + `setup→act→assert→cleanup` + AC 表 + 汇总行 + `--only/--strict/--keep` |
| T11 | 主链路 op | ✅ 完成 | index / install / reinstall / enable / disable / verify / history / uninstall（8 项，实测 7 PASS + enable 含双向） |
| T12 | neg-* 与升级回滚 | ✅ 完成（含余量收口） | walkthrough 14 op 全 PASS：upgrade / rollback / neg-tamper / neg-nosig / neg-badindex / neg-stranger（revoke + 信任库快照 diff）/ neg-evil（zip-slip）；failure-playbook 文案表 + 报告白黑名单（`logs/walkthrough-<ts>.md` 脱敏落盘）；fixture 迁移阶梯 + evil tgz；pitfall 10 修复（`_oj_migrations` 进 `_platform` schema/manifest） |

## 8. 阶段小结

### phase1（T7–T9）已完成 —— 2026-10-21 07:50

**交付**：`ojm market verify`（离线验包）、`market/bootstrap.ts`（隔离站点库）、`ojm market trial`
（隔离试装，11 段全 ok ≈12s）。phase1 的净效果：任何人拿到一个方案包，都能在**不碰自己工程**
的前提下，12 秒内判定「能不能装、哪一段挂」。

**关键过程**

1. **T7 校验分四类而非一类**：完整性（sha）、包级签（信任锚）、索引签（完整性层）、manifest 结构
   分开列——语义不同的东西混成一个 `ok` 会让失败无从定位。
2. **T8 隔离六项逐条断言**：端口/DB/密钥/凭据/信任库/CDN 各查文件系统与派生 config，不靠口头约定。
   发布方密钥走「公开 seed → SHA-256 → PKCS#8 DER」派生（照 `fixtures/sig` 手法），私钥只在内存。
3. **T8 起站形态踩过一次**：隔离站点最初以 `--api-path src`（dev 形态）起站，装好的模块落在
   `api/dist` 不被发现，smoke 404 → 改为 `oj build` + `--api-path dist` + `platform.root: dist`。
4. **T9 一个真实时序坑**：`anonymous_paths` 在装配期读取，安装器刚注册的匿名端点在 smoke 段 401。
   隔离站点预置被测方案的探活路径（与 `bootstrap-host.mjs` 同手法），让 trial 验的是安装机制本身。
5. **T9 撞到接口口径**：`POST market/install` 返回 `{task_id}` 而非 `{id}`——已按真实响应修正。

**统一审查**

| 项 | 结果 |
|---|---|
| cli 单元测试 | 289 passed / 1 skipped（phase0 271 → +18） |
| 真链路 | `market trial` 实测：preflight→…→audit 11 段全 `ok`，`--keep` 现场保留与销毁清单正确 |
| typecheck / eslint | 净 |

### phase2（T10–T11）部分完成 —— 2026-10-21 08:20

**交付**：`ojm market walkthrough` —— 隔离站点上跑主链路 8 项操作（index / install / reinstall /
enable / disable / verify / history / uninstall），出 AC 表；`--only` 单跑、`--strict` 首败即停。

**实测**：`全部通过（7 项）：7 PASS / 0 FAIL`；`--only enable` 单跑亦 PASS（原子性成立）。

**过程发现**

1. 深检会**逐条探活前端路由**：隔离站点最初没有 web 挂载，`/demo-solution` 类路径 404 → 被判定
   anomaly。给隔离站点加一个最小 SPA 壳（一个 index.html + `spa: true`）后归零。
2. 深检的 `ledger.stale` 是**存量误报**：`journalHeadOf` 走 `db.table("_oj_migrations")`，该表未在
   模块 `schema.yaml` 声明 → 元数据校验拒 → null → 判「落后」。已在 playbook §9 记账，walkthrough
   的 verify 项因此断言「报告结构完整」而非裁决。
3. `POST market/install` 返回 `{task_id}`（非 `{id}`）——trial/walkthrough 均按真实响应取值。

**未完成（明确余量）**：T12 的 neg-*（tamper / nosig / badindex / stranger）与 upgrade / rollback。
骨架已就位（op 注册表 + 逐 op 前置换装），补 op 即用。

### phase2（T12）已完成 —— 2026-10-21 08:45

**交付**：`ojm market walkthrough` 补齐 6 个 op——主链路 `upgrade`（0.1.0→0.2.0）/ `rollback`
（账本超前拦截），负向 `neg-tamper`（包体篡改）/ `neg-nosig`（缺签名）/ `neg-badindex`（索引篡改）/
`neg-stranger`（未登记 key TOFU 闭环）。全套 13 项实测 **13 PASS / 0 FAIL**，`--only` 单跑原子性成立。

**关键过程**

1. **fixture 迁移阶梯**：`0.2.0` 起（minor ≥ 2）多一段 `0002__more.sql`——upgrade 真的多走一段迁移，
   rollback 才有「包内最大 seq < 账本 head」可拦（OJ-9）。同版本输出恒定的确定性不破。
2. **rollback 的「零落盘」断言踩了自己一脚**：`api/dist/<name>-0.1.0` 是前序 op 的**合法产物**，
   「目录不存在」断言必然误报。改为安装前后 `api/dist` 目录清单快照比对——「零副作用」的正确定义是
   **本次操作不改变任何既有产物**，不是「目标目录不存在」。
3. **存量版本脱节（反常规：门禁与模板能力假设两张皮）**：模板 `solution-perms.ts` 依赖 oj v0.1.81 的
   `startswith` 操作键，而 `MIN_OJ_VERSION` 还停在 0.1.73、本机 vendored oj 是 0.1.80——卸载方案时
   权限级联清理抛 `unknown variant startswith`，事务回滚 fail-closed。修复：`MIN_OJ_VERSION` 抬到
   0.1.81（vendor.test 硬编码字面量同步改为引用常量）+ 重 vendor v0.1.84（根与 templates 两处）。
4. **P3-11 预锁 guard 仍未触发**（oj 0.1.84 下实测）：`ledgerHeadOf = journalHeadOf` 受 pitfall 10
   之限（`_oj_migrations` 未进 schema → null → 跳过预锁），实际由 oj migrate 的 `rollbackGuard`
   事后拦截（exit 1 → failed@migrating）。op 断言 `failed@migrating` 两种拦截路径均成立，
   但若将来要单独验「宿主层预锁零 exec」，须先解 pitfall 10。
5. **neg-* 隔离纪律**：四个负向 op 统一用 `9.9.9` 版本，与主链路零交集；篡改文件（tgz / .sig /
   bundles.yaml）在 `finally` 里**回抄原始字节**（不重签），随后摘包 + 重铺索引，后续 op 不受残留影响。

**统一审查**

| 项 | 结果 |
|---|---|
| cli 单元测试 | 292 passed / 1 skipped（+3：fixture 迁移阶梯） |
| 守卫套件 | release-manifest / devkit-docs / package-guards / vendor / info-oj / init 共 64 passed（修复 MIN_OJ_VERSION 抬版后的 3 条硬编码断言） |
| typecheck / eslint | 净 |
| 真链路 | walkthrough 全套 13 项 **13 PASS / 0 FAIL**；`--only upgrade/rollback/neg-tamper/neg-stranger` 单跑各 PASS（原子性成立）；**耗时 ≈40 分钟**（含两轮全量 e2e 与 vendored oj 升级） |

**遗留（不在交接范围）**：无——T12 原清单余量（evil / 信任库快照 diff / revoke / 失败文案表 /
报告白黑名单）已于同日第二轮全部收口（见上方「T12 收尾批」用例表），风险项清零。

### phase2（T12 收尾批）已完成 —— 2026-10-21 09:00

**交付**：消灭全部遗留风险项——① pitfall 10 修复（`_oj_migrations` 声明进 `_platform`
schema.yaml + manifest.yaml，构造器路线，不修 raw SQL）；② neg-evil op（手造 zip-slip tgz，
file 源上传即 400）；③ neg-stranger 收尾（显式 revoke + 信任库快照 diff 为空）；④ 失败文案表
（`failure-playbook.ts` 双段式，traceability 单测）；⑤ 报告白黑名单（脱敏落盘
`logs/walkthrough-<ts>.md`）。最终演练：**14 项 14 PASS / 0 FAIL**。

**关键过程**

1. **pitfall 10 根因实证**：用 `--keep` 隔离站点 + `node:sqlite` 直查——`_oj_migrations`
   表与数据都在（demo-solution head=1），纯是 `db.table` 元数据校验拒。修复后深检 ledger
   项零误报，但 verify op 旧断言「checks 非空」当场露馅：**它一直寄生在误报上**（checks 是
   问题清单，全绿站点恒为空）。已改为断言报告结构（ok/checks/advise 字段）。
2. **「零落盘」断言第二次踩坑**（rollback 踩过一次、neg-evil 又踩）：`9.9.9` 目录是
   neg-stranger 的合法安装产物——正确口径始终是「操作前后 dist 清单快照零变化」。
3. **构造器纪律**（用户裁定）：查询一律 `db.table` 构造器、不用 `db.query` raw SQL；
   同理 cli 侧压缩用 `node:zlib`（与 `deterministic-tar.ts` 同范式），模板（oj 运行时，
   无 node 环境）侧才走 exec tar。
4. MIN_OJ_VERSION 0.1.73 → 0.1.81（首轮已抬），本轮配套重 vendor oj v0.1.84 两处。

**统一审查**：cli 单测 297 passed（+5）/ 守卫 64 passed / typecheck / eslint 净 /
最终演练 14 PASS。**耗时 ≈25 分钟**。playbook §7.4 重写为主链路 + 负向双轨检查点，
新增 2026-10-21 第二次基线。


### phase0（T1–T6）已完成 —— 2026-10-21 03:15

**交付**：模板自带可用的本地 CDN；`ojm market setup / publish / build-index` 三条子命令可用；
真宿主上端到端跑通「落包 → 重建索引 → 打开市场 → 出卡片 → 安装十阶段全 ok」。

**关键过程**

1. **T1 顺手把 D-2 钉死**：目录 + 挂载 + 白名单 + 忽略规则四件套一起改，`release-manifest`
   （真的跑一次 `pnpm pack`）证明 README 进了 tarball——这条守卫比人眼可靠。
2. **T2 先建单一真相再写命令**：`cdn-layout.ts` 把「目录 / 前缀 / 基址」三个取值收在一处，
   并写死「不许硬编码端口/主机/路径」的用例（改 config 即变结果）。这是 §3.1.1 dev 陷阱的兜底。
3. **T3 复用优先于新写**：包级签名没有另起炉灶，而是给既有 `ojm sign` 加了内存 PEM 通道
   （`--key` 语义零变更），隔离场景的「私钥不落盘」因此有了落脚点。
4. **T4 索引是派生产物**：扫描目录全量重建；包级 `.sig` 侧车会被读成 Form B `archive.signature`
   （见 §9.2——不这么做安装器直接 `sig_missing`）。
5. **T6 用真宿主验收**：`scripts/verify-solution-smoke/bootstrap-host.mjs` 自举出一个宿主工程
   （端口 9785），全程用真 `oj serve` + 真 DB + 真凭据跑，不用 mock。

**统一审查**（实现全部完成后一次性做）

| 项 | 结果 |
|---|---|
| cli 单元测试 | 271 passed / 1 skipped（基线 245；本期 +26） |
| init 白名单守卫 | 3 passed |
| typecheck（`tsc --noEmit`） | 净 |
| eslint（本期改动面）| 净（修复 3 处风格问题：箭头函数 `as` 需括号、缩进、单语句行） |
| 真链路 e2e | install 十阶段 `preflight→smoke` 全 ok，status=done |

**耗时**：约 1 小时 45 分（含 spike 遗留的 toolchain 排查：`fnm` 内 node v22.18.0 需显式前置 bin 目录）。

## 9. 编码期发现（追加）

> 按 CLAUDE.md 要求，把实现过程中撞到的「反常规 / 反直觉 / 与既有约定不符」的点记下来。

### 9.1 存量脚本已经把大半条链路做过一遍（DRY 提醒）

`scripts/verify-solution-smoke/` 下的 `bootstrap-host.mjs`（自举宿主）、`make-solution.mjs`（造签名包）、
`setup-cdn.mjs`（建 CDN + 登记发布方 + 设 market url）已经覆盖了本期大半功能，只是形态是脚本。
本期未改动它们（避免回归），但**phase1 的 `bootstrap.ts` 应当从这里提库**，而不是重写——
`market/fixture.ts` 已是照 `make-solution.mjs` 的已验证形状实现的第一处「提库」。

### 9.2 反直觉：包级侧车 `.sig` 不参与安装判定，只认 Form B

安装器 `verifying` 段只看 `manifests.yaml` 里的 `archive.signature`（Form B）。
CDN 目录里摆着 `<tgz>.sig` 侧车**不够**，索引不带过去就是 `sig_missing` 硬 fail-closed。
→ `build-index` 必须把侧车读进索引（本期已修，T6 实测前撞过一次）。

### 9.3 曾反直觉、现已移除：desc 必须等于 summary（C2-31 等值校验）

**原状**：包内 `api/<mod>/manifest.yaml` 的 `desc` 若与方案清单 `summary` 一字之差，
安装器 `extracting` 段直接拒装（双端：`templates/.../steps/extract.ts` 与 `cli/src/bundle.ts`）。
fixture 最初两边各写各的，T6 实测撞到过一次。

**处置（2026-10-21，用户拍板「去掉此规则」）**：等值校验**两端一并移除**。
理由：那是「构建期映射」的产物被当成了安装期契约，而 desc 只是模块描述文本、不是安全边界，
保留它意味着 fixture 与手写包只要描述差一个字就整包装不上——校验成本远高于它拦下的风险。
保留的两项：`summary` 必填（C2-04）、`desc` 必填非空（oj 启动装配面）。

**同步改动**：extract.ts 纯函数 + 接线注释、bundle.ts 分层核对、`steps-fs.spec.ts` 两条断言改为放行、
`bundle.test.ts` 一条改为放行、`market/verify.ts` 该项改为「desc 非空」、fixture 不再绑定两者。

**回归口径**：`packages/cli/templates/api` 的整套 spec 在本机跑不起来
（大量 `db.table is not a function`——缺 oj 运行期全局桩，与本次改动无关）。
故只跑了直接相关的 `tests/lifecycle/steps-fs.spec.ts`：43 passed。
**完整回归须在能起 oj 运行期桩的环境里补跑。**

### 9.4 oj 挂载目录缺失 = 启动 fail-fast，且相对路径按 cwd 解析

`oj serve` 启动时校验挂载目录（`mounts[N]: 挂载目录 …: No such file or directory`）；
并且 `api: src` 这类相对路径**按 cwd 解析**而不是 config 所在目录——所以必须从 `api/` 目录起服务
（`run.mjs` 也是这么做的）。这两条决定了 D-2「目录必须随模板发布」不是洁癖而是硬要求。

### 9.5 模板仓跑 dev 的前置：`ojm vendor`（二进制不随仓库分发）

`pnpm --filter @oj-module/template-demo dev` 会一路构建完本地模块、生成 `modules.json`，然后死在：

> [ojm] 无法启动 oj（…/packages/cli/templates/bin/oj）：spawn … ENOENT

因为 `bin/` 在 `templates/.gitignore` 里——oj 二进制**不随仓库分发**，需在模板目录跑一次
`pnpm ojm vendor`（经 npm 包 `@oj-bin/oj`，本机落到 v0.1.84）。装好后同一条命令即通：
dev server 5174 + oj 子进程 9778，`/api/health` 200、`/cdn/bundles.yaml` 干净 404。
已把 ENOENT 报错改成人话（`packages/cli/src/oj.ts` spawn error 分支附「跑一次 ojm vendor」指引）。
