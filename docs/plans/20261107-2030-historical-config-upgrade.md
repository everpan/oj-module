# 历史工程配置的检验与自动升级（配置契约 / Config Contract）设计提案

> 日期：2026-11-07　状态：提案（未实施）　分支：`feat/ojm`
> 触发场景：`/data/oj/wecom1107`（`pnpm dlx @oj-module/cli@0.2.73 init wecom1107 --yes`）改配置后方案市场菜单缺失 / 403 的排查复盘。

## 1. 背景与问题

### 1.1 现状：配置「生成即冻结」

- `ojm init` 是 `copyIfAbsent`，已有文件永不覆盖；`usage.ts` 明写 *"re-runs only fill missing files; existing files are never overwritten"*、`--yes` 说明里 *"your own modules and project config are untouched"*。
- `ojm init --yes` 的恢复范围只有 `src/app`、`src/oj-market`（`scaffold-guard.ts:32` 的 `PROTECTED_ROOTS`），`ojm build` 前的 `assertDefaultModulesUntouched`（`scaffold-guard.ts:165`）也只校验源码树。
- `init.include.yaml` 里 `config.yaml` 只是**新建时拷入**的条目（`:48`）；模板 config 一旦演进，没有任何通道流向已生成工程。
- 文档已承认现状：`docs/prd/framework-verification-playbook.md:1127`「旧工程升级须手工补模板 config 双授权（exec grant + platform.modules）——**无自动迁移**」。

### 1.2 由此产生的静默漂移

0.2.73「出厂即装」策略（`docs/plans/20261107-1150-market-factory-install.md`）要求模板 config 具备市场线四项授权：

| 契约项 | 缺失后果 |
|---|---|
| `platform.modules` 含 `oj-market` | 收敛安装到 reloading 段 `NotCapable` |
| `platform.exec.oj-market.allow` | 安装器 tar / migrate 命令 `NotCapable` |
| `auth/tenant.anonymous_paths` 含 oj-market 三条 | 市场匿名面 401 |
| `tenant.shared_allow` 含 `market_release` / `publish_credential` | 启动 warn、租户列校验误生效 |

历史工程升级 CLI 后这些项**不报错、不告警**，直到用户发现菜单没了。

### 1.3 两个放大因素

1. **派生配置在 CLI 视野外**：真实部署常手写 `config-release.yaml`（`platform.root: dist/api`、mysql、`0.0.0.0:5174` 等），CLI 只认 `config.yaml` / `config.local.yaml`。
2. **升级不止配置**：出厂即装的收敛由 `ojm dev` / `ojm preview` 在后端就绪后 CLI 侧触发（`market/factory-converge.ts:21` → `dev.ts:158` / `preview.ts:128` 的 `login → GET /api/oj-market/index`）；纯 `oj serve` 手写部署会绕过，配置补齐也不会自动安装。

### 1.4 目标

把「让用户知道该改哪些配置」变成「CLI 自己按契约校验 + 幂等补齐」，用户升级动作不变（仍是升级后跑一次 `ojm init --yes`），零新增心智负担。

**非目标**：不改 oj 的 config 解析语义；不改 C2-xx fail-closed 与验签/信任状态机；不改市场轨升级路径。

## 2. 可复用的现成件（不重写轮子）

| 文件 | 能力 |
|---|---|
| `packages/cli/src/oj-config.ts:16` | 真 YAML 解析读 config（流式写法 / 引号 / 注释 / 锚点都不破坏） |
| `templates/src/app/api/_platform/_lifecycle/text-edit.ts:40,60` | `ensureReloadApi` / `appendAnonymousPaths`：锚点插入、保注释、幂等的**文本手术**（`installer.ts:397` 有调用范例） |
| `packages/cli/src/scaffold-guard.ts:74,165,179` | drift 三类报告 + fail-fast + 「处置：`ojm init --yes`」人话文案 |
| `packages/cli/src/init.ts` / `usage.ts` | `ojm init --yes` 恢复入口（用户已有习惯） |
| `packages/cli/src/preview-config.ts` | 派生配置生成面（能拿到本次实际生效的 config 路径） |
| `packages/cli/src/market/factory-converge.ts:21` | 出厂对账触发（`login → GET index`） |
| `packages/cli/src/versions.ts:120` | `checkSharedVersions` 版本一致性校验范式 |
| `src/.ojm-builtin.json`（`scaffold-guard.ts:81`） | 工程声明「内置模块概念」的开关，可顺便记契约版本水印 |

## 3. 方案方向（可组合）

### 方向 1｜CLI 侧「配置契约」+ 幂等补齐（最省力）

- **单一真源**：不手写规则表，从当前 CLI 自带 `templates/config.yaml` 解析出「框架必需条目」清单（见 §4）。契约只覆盖**集合/开关型**字段，天然适合「并集补齐」。
- **只读检验**：新增 `ojm doctor`（或 `ojm config check`），输出结构化 diff 且带影响面文案，例如 `缺 platform.exec.oj-market → 方案市场安装/收敛将 NotCapable`；`--json` + 退出码 0/1 供 CI；`--config <file>` 显式指定 + 自动发现 `config*.yaml`。
- **补齐 `--fix`**：复用 `text-edit.ts` 锚点插入，扩展为列表型字段的「缺项追加」；`--dry-run` 先看 diff、写前备份、写后用 `oj-config.ts` 重新解析自检。
- **挂到已有习惯**：接进 `ojm init --yes`，一条命令同时升级源码树 + config；再在 `ojm build` 门禁加一道契约校验，缺项复用 `scaffold-guard.ts:179` 同款 fail-fast + 处置文案。

### 方向 2｜分层配置 / 迁移账本（根治漂移，改动最大）

- **2a 分层合并**：框架基线内置 CLI（只读）+ 用户覆盖层，起站时 deep merge（`preview-config.ts` 可扩展）。用户永不编辑基线 → CLI 升级即基线升级，**此后不需要任何迁移逻辑**。代价：`config-release.yaml` 这类手写形态需收编，或上游 oj 支持多文件合并。
- **2b 水印 + 迁移账本**：config 留注释水印 `# ojm:config-contract 0.2.73`（或写入 `src/.ojm-builtin.json`），配套 `config-migrations/<ver>.ts` 按序 replay，仿 `_oj_migrations`。适合「必须回写用户文件且要可追溯」，但每加字段都要写一条迁移，长期是负担。
- **2c 三-way merge**：`init --yes` 用「模板旧版 / 模板新版 / 用户当前」三方合并，只把模板新增的键带进来。比 2b 轻，但需 CLI 内置历史模板快照。

### 方向 3｜运行期自愈 / 启动校验（不依赖用户记得跑 CLI）

- **3a 启动诊断**：`oj serve` 启动时对**本次生效 config** 跑契约校验。现状只有 `shared_allow` 两条 warn，缺 `modules` / `exec` 完全静默 —— 至少补人话 warn 并指向 `ojm doctor`。
- **3b 服务端默认回落**：把 `platform.modules` / `exec` / `anonymous_paths` 这类框架特权项改为服务端内置默认，config 只写增量覆盖，缺即回落内置。用户怎么写都不会缺，是「最不操心」的形态，但要动上游 oj 配置解析。
- **3c 启动自动补**：发现缺项直接回写 config。零人工，但服务进程改配置文件、多实例 / `readonly` 部署会打架，需谨慎。

### 方向 4｜把「出厂对账」纳入升级闭环

本次故障只有一半是配置，另一半是纯 `oj serve` 绕过 CLI 触发收敛。

- **4a** 新增 `ojm serve` 作为唯一推荐入口，内部包办起站 + `triggerFactoryConverge`；手写部署降级为高级用法。
- **4b** 服务端自持：`index` 端点本就 riding 收敛（`oj-market/api/api.ts:656`），启动后一个探针打一次即可，不依赖 CLI。顺手修 `factory-converge.ts:30` 硬编码 `superadmin/aA123456` —— 生产改过口令即永久失效，本身是隐患。
- **4c** 轻量兜底：`ojm doctor --fix` 完成后打印明确的「一次性动作：启动后访问一次 `/oj-market`」。
- **4d** 触发做成 oj 启动钩子（需上游 oj 支持，跨仓、周期长）。

### 方向 5｜可观测性兜底（成本最低，可先单独上）

- `ojm info` 附 config 契约体检结果；`--json` 给 CI 卡门禁。
- 启动日志把「缺 oj-market 双授权 → 方案市场将不可用」打成人话 warn，而不是让用户对着空菜单猜。
- 市场页 403 / 空白时展示指向 `ojm doctor` 的提示，而不是只抛 `Request failed with status code 403`。

## 4. 配置契约清单（首版）

| 契约项 | 必需内容 | 语义 |
|---|---|---|
| `platform.modules` | 含 `_platform`、`oj-market` | 集合并集 |
| `platform.exec.<mod>.allow` | `_platform` / `oj-market` 各三条安装器命令 | 集合并集 |
| `auth.anonymous_paths` | 含 oj-market 三条 | 集合并集 |
| `tenant.anonymous_paths` | 含 oj-market 三条 | 集合并集 |
| `tenant.shared_allow` | 含 `market_release` / `publish_credential` 等框架共享表 | 集合并集 |
| `server.reload_api` + `# ojm:reload` 锚点 | 存在 | 固定开关 |
| `fs` 段（`root` / `readonly`） | 存在 | 固定开关 |

契约基线随 CLI 模板发版 —— 与 `scaffold-guard`「上游模板即基线」一致，不另立可被下游手改的 lock。

## 5. 关键约束（各方案都别踩）

| 约束 | 说明 |
|---|---|
| **只增不改** | `db.default`、`vars.*` 凭据、`server.host/port`、`canonical_origin` 绝不触碰 |
| **`platform.root` 是多态** | `src`（dev）与 `dist/api`（release 手写）都合法，不能「纠正」 |
| **exec 是特权白名单** | 只补框架自带三条固定命令，绝不补用户自定义命令，避免自动放宽安全面 |
| **跳过派生配置** | `.ojm-tmp-config.yaml` 每次由 CLI 重生成，写它无意义；`config.local.yaml` 只作覆盖层 |
| **支持自定义文件名** | `--config config-release.yaml` 显式指定 + 自动发现 `config*.yaml` |
| **写前可回滚** | dry-run / 备份 / 写后重解析自检 / 重复跑零 diff |
| **校验先于写入** | 任何写盘之前完成全量契约校验，失败零增量 |

## 6. 推荐路线

- **短期（一个版本内）**：方向 **1 + 5**。四个现成件可直接复用（`oj-config.ts` 读、`text-edit.ts` 写、`scaffold-guard.ts` 门禁、`init --yes` 入口）。用户动作不变，仍是「升级 CLI 后跑一次 `ojm init --yes`」，但这次连 config 一起对齐；`ojm doctor --json` 让 CI 提前拦住。建议先只做**只读 `ojm doctor`**，验证契约清单准确后再加 `--fix`。
- **中期**：方向 **4a** 统一 `ojm serve` 入口收口收敛触发，顺带解决硬编码口令。
- **长期**：方向 **2a** 分层配置，之后模板再加任何字段都不需要迁移逻辑 —— 这才是「用户完全不用操心」的终态。

## 7. 落地清单与验收

1. `packages/cli/src/config-contract.ts`：契约定义 + 校验（纯函数）+ 补齐（文本手术）+ diff 报告。
2. `packages/cli/src/config-cmd.ts` 或新增 `doctor.ts`：`ojm doctor [--fix] [--dry-run] [--config <file>] [--json]`。
3. `init.ts`：`--yes` 恢复后追加契约校验/补齐；`build.ts` / `cli.ts`：构建前门禁；`usage.ts` / `help`：命令登记。
4. 模板侧：`config.yaml` 标注契约项（注释即文档），`templates/init.include.yaml` 无需改动。
5. 测试：全新工程零 diff；缺 1 项 / 缺多项 / 用户已有自定义值 / 自定义文件名 / 派生配置跳过 / 重复跑幂等 / `--dry-run` 零写入。
6. 文档：`docs/devkit/manual.md` 增「历史工程升级」章节；playbook 删掉「无自动迁移」遗留口径。

**BDD 验收表**

| # | 给定 | 当 | 那么 |
|---|---|---|---|
| A1 | 0.2.72 历史工程 config（缺市场线四项） | `ojm doctor` | 逐项列出 4 条缺失 + 影响面；退出码 1；零写入 |
| A2 | 同上 | `ojm doctor --fix` | 四项补齐；用户自有的 db / vars / host / root 字节不变；注释保留 |
| A3 | A2 结果 | 再跑 `--fix` | 零 diff、零写入 |
| A4 | 全新 `init --yes` 工程 | `ojm doctor` | 零缺项、退出码 0 |
| A5 | `config-release.yaml`（root=dist/api + mysql） | `ojm doctor --config config-release.yaml --fix` | 只补集合项，`root` / `db` / `host` 不被改写 |
| A6 | 目录含 `.ojm-tmp-config.yaml` | `ojm doctor` 自动发现 | 该文件被跳过，不报告不写入 |
| A7 | 缺项工程 | `ojm build` | fail-fast，未写入任何产物，文案指向 `ojm init --yes` |
| A8 | CLI 升级后工程 | `ojm init --yes` | 源码树与 config 同步对齐（一次动作完成双升级） |

## 8. 附录：wecom1107 实证（2026-11-07）

排查链可作为契约方案的现实依据：

1. `init --yes` 只把 `oj-market-0.2.0.tgz(+sig)` 放进 `cdn/` 并写 `bundles.json` 意图标记；菜单需运行期收敛安装（`oj-market/api/api.ts:656` riding `GET /api/oj-market/index`）。
2. 用户 `pnpm build` + 手写 `oj serve -c config-release.yaml` 起站：两份日志里 `GET /api/oj-market/index` 请求数 = 0，收敛从未触发；`dist/web/modules.json` 只有 `app`，全盘无 `state.yaml` → 菜单缺失。
3. `config-release.yaml` 是旧模板手写 release 配置：`platform.modules` 只有 `_platform`、缺 `exec.oj-market` 授权、缺 oj-market 匿名面、缺 `market_release` / `publish_credential` 两条 `shared_allow`（启动日志 `:12-13` 两条 warn 即其自白）。
4. 用户手工补齐上述项并重启后（20:11 mtime / 20:12 日志）：`GET /modules/oj-market/0.2.0/entry.js 304` —— 菜单已出现；`shared_allow` warn 消失 —— 配置生效。
5. 配置补齐后菜单出现，但 `GET /api/oj-market/index?page=1&size=20` 仍 **403 且与配置无关**：该端点原为 `assertSuperAdmin()` 独占（`oj-market/api/api.ts:1076`，R9），同一时刻 `history`（仅登录可读）、`publish/credential`、`_platform/solutions/routes`（登录即可）均 200。企微多租户部署中 `superadmin` 是平台级角色、按运维纪律只留在 `default` 租户（`_shared/wecom/tenant-admin.ts:9-13`），企业租户账号（JIT 员工号或租户管理员 `admin`）永远不是 superadmin → 企业用户点开市场页必 403。这是**前后端门禁口径**（菜单可见 vs 读接口超管独占）与**角色模型**的冲突，不属于配置契约能修的范围。
   **裁决（2026-11-07，用户采纳「读面降级」）**：`index` 改 `currentAccess()`（登录即可，保留租户自洽 / 禁用 / 改密悬挂检查），写面（install/task/enable/uninstall/trust）保持 `assertSuperAdmin`。与 `PRODUCT.md §4.1`「admin 能看到入口与卡片，敏感操作需 superadmin」及前端 `MarketApp.tsx` 的 `canManage` 口径一致。禁止给企业租户授 superadmin 绕过（跨租户越权红线）。已在 wecom1107 部署项目实测：`admin` index 200 / task 403 / `superadmin` index 200。

> 注：附录第 5 点也印证方向 5 的价值 —— 403 时前端只抛 `Request failed with status code 403`，用户无从判断是配置、安装还是角色问题。

## 9. 发布纪律：随站 bundle 必须与模板源码同步（2026-11-07 第二次回归）

同日另一回归：市场卡片动作区按钮换行。`79041343`（16:23）只把不换行修复落到模板源码
（`CardItem.tsx` 的 `flexWrap:"nowrap"` / `flexShrink:0` / `overflowX:auto` / `card-actions-`
testid，`CardGrid.tsx` 的 `minmax(340px,1fr)`）与单测，但**随站第一方方案包**
`shell-dist/bundles/oj-market-0.2.0.tgz` 是更早打包签发的旧字节。CLI 0.2.73 内置该包，
`ojm init --yes` 把它拷进工程 `cdn/`，站点安装后 `ojm build` 又从版本目录原样重物化 →
用户看到的仍是旧 UI。实证：CDN 包与已装 `entry.js` md5 完全一致、`card-actions-` 零命中、
网格仍是 `minmax(280px,1fr)`。根因是**发布产物漂移，不是源码回归**。

**纪律（发布流水线）**

1. 任何改动 `src/oj-market/web/`（或任意随站第一方方案的 web 面）都必须重建该方案的
   `ojm build --bundle <name>` 产物并**重签**（签名私钥属发布流水线，不入仓，不得由工具代签）。
2. 重建后的 `.tgz(+.sig)` 收进 `shell-dist/bundles/`，随 CLI 发版；`ojm init --yes` 才会把
   新字节带进新工程。
3. 已部署站点的存量安装不会自动更新（收敛「上拉不下拉」，同版本 skip）——需走发布途径
   升版本，或按下面的本地热修。

**守卫**：`packages/cli/src/__tests__/market-bundle-freshness.test.ts` 两层——源码仓恒钉住
布局特征（必需项 + 禁用项）；发布形态（`shell-dist/bundles/` 在场）时解包校验 `entry.js`
带同批特征、且不含禁用项，落后即失败并提示「重建 + 重签」。源码仓无 bundle 目录是合法态，
跳过不误报。

**同日最终形态（用户追加需求）**：先要求「增加卡片宽度、不应出现滚动条」（一度改为
`minmax(480px,1fr)`），随后定稿为「**恢复宽度、去掉详情按钮、点击卡片正文出现详情**」——
`CardGrid.tsx` 回到 `minmax(340px,1fr)`；`CardItem.tsx` 动作区移除「详情」按钮只剩 5 枚
（仍 `flexWrap:"nowrap"` + `flexShrink:0`，不设 `overflowX` → 无滚动条），新增
`card-body-*` 正文块 `onClick → onDetails`。守卫的必需/禁用项与
`CardGrid.test.tsx`（21 例）随最终形态同步。

**本次本地热修（wecom1107，用户裁决「本地热修 + 回归守卫」）**：从修复后模板源码重建
`oj-market@0.2.0` web 面，替换 `dist/web/modules/oj-market/0.2.0/entry.js`（服务读）与
`dist/api/oj-market-0.2.0/web/modules/oj-market/0.2.0/entry.js`（重物化来源），同步
`modules.json` 完整条目（integrity / chunks）与两处 `.ojm-module.json` 旁车；`ojm build`
复验不回退、HTTP 直出带修复特征。`cdn/*.tgz(+sig)` **刻意保持原样**：改动会令既有签名
失配，反而让未来的重装 fail-closed；故新 CLI 版本 / 卸载重装 / 全新 init 仍是旧 UI，须由
发布流水线按上述纪律补上。

**2026-11-07 收尾裁决（用户「oj-market 升级版本 提交」）**：不重签已签发的 0.2.0——本机标准
密钥目录没有第一方发布私钥，且同版本收敛按「上拉不下拉」恒 skip、改包还会令既有签名失配。
改为把 oj-market **升版本 0.2.1 走市场轨升级**：`solution.yaml` 的 `version` / `web.entry` /
`changelog` 与 `web/entry.ts` 的 `defineModule.version` 四处同源改 0.2.1。发布流水线产出
`oj-market-0.2.1.tgz(+sig)` 收进 `shell-dist/bundles`，站点由收敛自动从 0.2.0 升级安装
（index 的 upgradable 位）。签名仍属发布流水线动作（私钥不入仓）。
