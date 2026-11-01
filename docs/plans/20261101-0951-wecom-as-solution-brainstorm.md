# 企微模块能否独立成解决方案（可行性取证 + 三种拆法）

> 状态：**调研与脑暴，未实施**。本文只给结论、证据与取舍，不动仓库代码。
> 触发：组织架构同步（A1–A3 / B1 / B2）已在模板内落地，问「这块能不能抽出去，独立成一个解决方案 / 独立项目」。
> 关联：`docs/plans/20261101-1530-wecom-org-sync-plan.md`（功能本身）、
> `docs/prd/solution/ARCHITECTURE.md`（方案契约权威）、
> `docs/prd/20261019-platform-distribution-brainstorm.md` §7.12（`_platform` 分发五裁决）、
> `../oj-registry/CODEBUDDY.md`（已跑通的「独立解决方案仓」实例）。

---

## 0. 结论先行

**整体拆不出去，按能力切三段才拆得动。**

| 能力 | 能否成为独立解决方案 | 决定性依据 |
|---|---|---|
| ① **同步与管理面**（B1 适配器 / B2 全量同步 / `change_contact` 事件 / 代开发后台清单 / 定时） | **有条件可以** | 三处硬前提：宿主组织**写**面没有契约（现在靠源码 import）、回调地址在企微后台已固定、权限码要改名 |
| ② **登录**（扫码 / 工作台免登 / 票据换 token） | **不能** | `issueTokens` 不向方案暴露（R8/D3）；匿名路径禁 `auth`/`login`/`token` 段（C2-26③）；登录页渲染与 `auth-provider` 都在第一方。与 LDAP/SSO 同性质——**身份源属宿主** |
| ③ **宿主页面挂件**（部门页同步状态条、系统菜单里的企微后台页、登录页企微 tab） | **不能注入**，只能改成方案自有页 | 方案只能注册自己的路由，没有 slot / 组件替换机制（全树 grep `slot` 零命中） |

**推荐路径（三档，按代价排）**

1. **先划边界，再谈独立（建议先做）**：把企微代码从 `auth` / `system` / `login` 三个模块里搬进 `src/wecom/{api,web}`，宿主只留三处**软引用**（登录页 tab、换票调用、部门页状态条——都是字符串路径 + 本地 interface，模块不在就自然降级）。收益不是「省代码」，而是**边界可读**：今天没人能从目录看出哪些是企微专属。代价是**回调地址必须改**（§2-K3 的硬结论）。
2. **若连地址都不能改**：只能在 `ojm init` 上做「分档剥离」（像 demo-only 那样按区段改文件），涉及约 8 个宿主文件，改完还要保一条「未启用不崩」的回归。
3. **不要把登录也外移，也不建议整包交给第三方仓**：那会把唯一必须由宿主签票的动作交给一个拿不到签票能力的模块；且企微服务商级 secret 本来就不该离开宿主配置。

---

## 1. 现状取证（数字都可以用 §8 的命令复现）

### 1.1 体量：每个新工程无条件带走这些

| 项 | 数量 | 说明 |
|---|---|---|
| 随 `ojm init` 分发的企微专属文件 | **30 个** | `src/auth/api/_shared/wecom/*.ts`（10）、`src/auth/api/wecom/{api,admin/api,sync/api}.ts`（3）、迁移 6、`system/web/pages/wecom/index.tsx`、`login/web/wecom.ts`、`departments/sync-bar.tsx`、测试 8 |
| 后端 | **3237 行** | 13 个文件；最大 `client.ts` 514 / `sync.ts` 505 / `crypt.ts` 327 |
| 迁移 | **123 行 / 6 文件** | `auth` 模块的 `0001__wecom`、`0002__org_sync`，各三方言 |
| 前端 | **528 行 / 3 文件** | 后台清单页 220、部门页状态条 257、登录页落地逻辑 51 |
| 单元测试 | **2859 行 / 8 份** | 刻意随源码分发（用户工程要能本地自检），故也在 `init.include` 白名单里 |
| e2e | **236 行 / 2 份** | 不进用户工程，只在本仓跑 |
| 合计（不含 e2e） | **≈ 6983 行** | |

> 不用企微的站点，这 30 个文件照样编译进 `auth` 模块、迁移照样执行、菜单里照样出现「企业微信」页。

### 1.2 与宿主其它模块的耦合点（这才是能不能拆的真问题）

| 方向 | 位置 | 形态 | 拆走后会怎样 |
|---|---|---|---|
| 后端 → 宿主组织**写** | `sync.ts` → `#/_platform/_shared/service/domain/org`（`upsertDepartment` / `upsertMember` / `setMainDepartment` / `markSeen` / `reconcileHidden`）+ `domain/users`（`upsertSourceUser`） | **源码级 import**，不是 HTTP 契约 | 方案可以用 `deps: {_platform: ^x}` 声明后照抄这种 import——技术上能跑（platform-distribution 的 F14 实测，见 §2-K2），但等于把方案钉在宿主内部实现上 |
| 后端 → 登录签票 | `login.ts` 换取会话 | `_platform` 的 `issueTokens` | **硬断**。方案拿不到该原语 |
| 后端 → 宿主表 | `sys_department` / `sys_dept_member` / `users` / `wecom_sync_job` | 直接 SQL / service | `sys_*` 属 `_platform`；`wecom_*` 现在挂在 `auth` 模块名下 |
| 前端 → 登录页 | `login/web/pages/login.tsx` 内置 `wecom` tab、`auth-provider.ts` 调 `POST /auth/wecom/ticket` | 第一方页面硬编码 | 页面可保留（后端不报该方法就不显示 tab），但**换票必断**：没有第二方能签票 |
| 前端 → 部门页 | `system/web/pages/departments/sync-bar.tsx` | 第一方页面内嵌组件，但**用全局 `request` + 本地 interface**（注释明写「走全局 request 而非生成本模块 client」） | 软引用：模块不在 → 404 → 状态条不画。**这是现成的好设计，拆分时应保持，别改成 import 方案的 client** |
| 前端 → 系统菜单 | `system/web/entry.ts` 注册 `/system/wecom` | 第一方路由表 | 方案的 `web.route_prefix` 只能单段（C2-14），页面只能搬到 `/wecom/*` |
| 配置 / 数据 | `wecom.enabled`（`sys_setting`）、`auth.wecom.sync`（`sys_permission`，三方言 seed 各一行）、8 个 `wecom_*` 部署常量 | 宿主 seed + `config.yaml` | 方案须把自己的权限码改成 `wecom.*`；8 个常量要么继续走 `config.yaml`（方案能读 `vars`），要么搬进 `sys_setting`（密钥入 DB 是另一个取舍） |

**耦合只有一处是「硬」的**：换票（`/auth/wecom/ticket` → `issueTokens`）。其余都是软引用或可平移的数据。这一条决定了「登录留宿主、同步可外移」的分界线落在哪里。

### 1.3 平台契约对「解决方案」的硬约束（原文，逐条对上）

| 约束 | 出处 | 对企微的含义 |
|---|---|---|
| 一个方案 = 一个 api 模块，`api.module === name` | ARCHITECTURE §4.4 C2-12 | `/api/auth/wecom/*` → 必须变 `/api/wecom/*`（前缀默认 `/api/<name>`） |
| 权限码必须 `<name>.<...>` | §4.6 C2-15 | `auth.wecom.sync` 要改名 `wecom.sync`；**已绑过自定义角色的站点要迁移绑定** |
| 匿名路径禁 `login/logout/token/session/signin/signup/auth` 段 | §4.5 C2-26③ + `preflight.ts` 的 `LOGIN_ENDPOINT_RE` | `/wecom/ticket` 能过名字检查，但**过不了真门**：`issueTokens` 不外露（§2.1 + R8/D3） |
| 方案只能注册自己的路由 / 菜单 / 设置分组 | §4.7 / §4.8 | 无法注入登录页、部门页；需要改这三处宿主页面 |
| 业务表保留、卸载不删表 | §10 Q4 | 迁移可平移（现有 SQL 全 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`） |
| 安装要 superadmin + CDN + 签名信任 + 十阶段 | §4.12 / §7.4 | 激活成本从「填 4 个 vars」升级为「装一个签名包」 |

### 1.4 一个反面参照：`oj-registry` 为什么能独立

它是本仓已经跑通的独立方案仓：`name: oj-registry`、九张自有表、`deps: {_platform: ^0.1.0}` 只借判权/响应/审计出口，**零账号表、零登录端点**（REG-R1 是硬结构守卫）。它的边界恰好是企微的痛点所在：**不碰宿主账号与组织数据**。企微同步天然要碰——这是本质差异，不是工程量差异。

---

## 2. 五个真卡点（按「会不会让人半夜起来」排序）

**K1 登录签票：不可解，除非上游加能力。**
不是「名字被正则挡了」这种可以绕的形式问题，而是方案根本拿不到签发会话的原语。可行替代只有两种：① 宿主开一个受控出口（「外部身份源已核验此人 → 建会话」，只对第一方签名方案开放），这等于新造一个认证插件协议；② 方案把票据交回宿主的 `/login` 换票——但换票逻辑本身就在第一方的 `auth` 模块里。两条都要改宿主。

**K2 组织写面：技术上能跑，契约上不该跑。**
`deps` 允许声明 `_platform`，`ownership_guard` 默认 `warn`（用户工程 `config.yaml` 根本没有这一段），且 **OJ-7 表级写守卫至今未落地**（platform-distribution §F14 用 `/tmp` 实测过：第三方零 import，只写一句 `db.query("select … from users")` 就能拿到 email，构建期扫描零覆盖）。也就是说：**今天拆，方案确实能写 `users`**——但它写的是宿主的账号表，宿主升级改列名就把它打断，且这正是那份文档要堵的洞。让第一方产品去踩这个洞，等于把「反正有洞」变成设计。

**K3 回调地址迁移：不是工程选择，是契约限制。**
方案的模块挂载前缀只能是**单段**：`preflight.ts` 的 C2-13 正则 `^/api/[a-z][a-z0-9-]{0,63}$` 不收第二段，而 `auth` 又在 `RESERVED_NAMES` 里——所以 `/api/auth/wecom/*` 在方案形态下**复现不了**，只能 `/api/wecom/*`（web 的 `route_prefix` 同理，`/system/wecom` 只能搬成 `/wecom/*`）。
运营后果：企微后台填的 `<site>/api/auth/wecom/event` 要改成 `<site>/api/wecom/event`。好消息是代开发的回调地址在**模板级**（一个服务商账号一次），不是每家企业各填一份；坏消息是改完到重新验证通过之间 `suite_ticket` 会断（企微每 10 分钟推一次），断了登录就 503。`wecom_base_url` 一起变，**已发出去的开通链接/二维码全部失效**。

**K4 迁移账本：可平移，但要留一笔账。**
现有 6 个迁移文件全幂等，模块改名后在新账本名下重跑只是空转；但老账本里 `auth` 名下那两行会永远留着（`oj migrate` 不认「这表已经归别人了」）。需要在发版说明里写清，并在 `oj migrate` 前实测一次「已有库 + 新模块名」的路径（**未实测，标为待验**）。

**K5 权限码改名：静默失效风险。**
`auth.wecom.sync` → `wecom.sync`。已把该权限绑给自定义角色的站点，改名后绑定会指向不存在的码 → 点「立即同步」403，而管理员看到的只是「没权限」。方案注册的 `permissions[]` 是加法 upsert，不负责迁移旧绑定。

---

## 3. 四种形态：诚实账

| | A 维持现状 | B 模板内分档（init 剥离） | C 第一方解决方案包 | D 完全独立仓 |
|---|---|---|---|---|
| 形态 | 现状 | 同一模块，`ojm init` 按档拷或不拷 | 本仓构建，`ojm install` 装进站点 | 像 `oj-registry` 那样独立 repo |
| 每站点白扛 | 30 文件 / ~7k 行 | **接近 0**（不选企微就不拷） | 0（装了才有） | 0 |
| 升级链路 | **快照**：`ojm init` 之后模板更新到不了老站点，得 rsync 模板 | 同 A | **有**（方案可独立发版/回滚） | 有 |
| 激活成本 | 填 4 个 vars 即可 | 填 vars | + CDN + 签名 + 信任 + superadmin 安装 | 同 C，另加独立仓维护 |
| 登录 | 宿主 | 宿主 | 宿主（不变） | **拆不动** |
| 组织写面 | 源码 import（第一方，合理） | 同 A | **需要新契约**，否则又是源码 import | 同 C，且跨仓更糟 |
| 回调/页面 URL | `/api/auth/wecom/*`、`/system/wecom` | **不变** | 必须变 `/api/wecom/*`、`/wecom/*`（K3） | 同 C |
| 改动面 | 0 | 中：`init` 要能按区段改宿主文件（auth 的 `manifest`/`schema` 两张表清单、`_platform` seed 三方言、`system/web/entry`、登录页与 `auth-provider`、`login-methods` 页、部门页状态条）+ 一条「未启用也不崩」的回归 | 大：搬迁 30 文件、改路由前缀、权限码、迁移账本、seed、三处宿主页面、文档与 9 份测试全部对账 | 同 C + 新仓、双仓发版纪律、版本 pinning |
| 谁维护 | 本仓 | 本仓 | 本仓（第一方方案） | 本仓 + 新仓 |
| 主要风险 | 无（但每站点背债） | 分档后的两份模板会漂移（默认关闭的分支没人跑） | K1–K5 全部要解，且解的是一半 | 兼容性断链：登录/部门页永久留在宿主，产品被劈成两半 |

> **B 不是「一行开关」**：企微长在 `auth`（后端）、`system` 与 `login`（前端）**三个模块内部**。`web.config.ts` 的 `enabled: false` 只管整个前端模块，管不到别的模块里的页面；后端 `oj build` 更是按目录全量编译，没有 `enabled`。所以要么让 `init` 按区段改写那 8 个宿主文件，要么先把企微挪成独立目录（那就是 C 的前半段，且 URL 要变）。

**对 D 的额外判断**：`oj-registry` 能独立，是因为它**只读宿主身份、只写自己的表**。企微一旦独立，最核心的两件事（签票、写组织表）都留在宿主，独立仓里剩下的是「HTTP 客户端 + 加解密 + 分片同步」——这三样恰好是可复用性最高、但也是最不该独立发版的部分（它们要跟宿主的组织模型同步演进）。独立出来的收益是「少背代码」，代价是「模型双写漂移」。

---

## 4. 如果走 C：上游必须先补的两件事

| 补什么 | 为什么非补不可 | 最小形态 |
|---|---|---|
| **组织写面契约** | 方案不能 import 宿主内部 service（升级即碎），也不该直接写 `users` | `_platform` 暴露受限写端点（例如 `POST /api/_platform/org/sync/dept|member`，仅供持特定权限的方案调用），或等 OJ-7「属主授权写」落地后用 `export_writes` 声明 |
| **外部身份源出口** | 否则登录永远只能第一方 | 「已核验身份 → 建/补账号 → 签发会话」的单一出口，只对第一方方案开放；方案只负责拿到 `corpid + userid` 并自证签名 |

在两者落地前，C 只是「把代码搬个地方，耦合一个没少」——除了少背文件，没有任何架构收益。

---

## 5. 我的建议（分阶段，先摘低垂果子）

**第一步（如果目标只是「给站点减负」）——B 档：`ojm init` 分档，保 URL。**

- 必做的不是「加一个开关」，而是**让 `init` 会按区段改写宿主文件**（模板里已有同类先例：`// #region demo-only` 整段剥离）。要改的约 8 处：`auth/api/manifest.yaml` 的 `tables`、`auth/api/schema.yaml`、`_platform` seed 三方言（`wecom.enabled` + `auth.wecom.sync`）、`system/web/entry.ts` 的路由、`login/web/pages/login.tsx` 的 tab 分支、`login/web/auth-provider.ts` 的换票分支、`system/web/pages/login-methods`、`departments` 页的状态条挂载。
- 顺手要做的是**删掉「表声明了但没有迁移」这种坏状态**：`S005` 只核对 `tables ↔ schema.yaml`，不管有没有迁移文件——剥了迁移却留着声明，构建期不报、运行期才缺表。
- 收益：不用企微的站点从 30 文件 / ~7k 行降到 0，URL 与权限一个不动。
- 成本：两份模板会漂移（默认关闭的分支没人跑）；因此必须同时加一条「未启用也不崩」的回归（登录方式发现 / 部门页 / 菜单三处空态）。

**第二步（如果目标是「独立发版 / 可售卖」，且能接受改回调地址）——C 档：先划边界，再谈装包。**

1. 先把 `src/auth/api/{wecom,_shared/wecom}` 平移成 `src/wecom/api`，页面搬成 `src/wecom/web`（这一步不改行为，只改目录与 URL，是 **一次性可验证的重构**）。
2. 再决定是「模板内独立模块」还是「打成方案包」——两者代码相同，差别只在分发与升级通道。
3. 走方案包之前必须先补 §4 两件事，否则只是把 import 换个位置。
4. 出「存量站点迁移清单」：企微后台改回调地址 → 重新验证 → 重发开通链接 → 权限绑定迁移（`auth.wecom.sync` → `wecom.sync`）。

**第三步——D 档：不建议。** 除非企微这块要交给另一个团队/另一条产品线独立运营；即便如此，登录也必须留宿主，产品的「一键登录」体验会永久分裂成两个仓的联合调试。

**明确不做的事**
- 不为「能拆」而先把 `_platform` 组织写面做成公开 API（那是 OJ-7 的活，不是企微的活）。
- 不把 8 个部署常量搬进 `sys_setting` 来「适配方案」——密钥入 DB 是独立的安全取舍，不该被拆分议题顺带决定。
- 不为了「独立」改回调路径而不做存量迁移方案（K3 会直接打断线上登录）。
- 不把部门页状态条改成 import 方案的 client——它现在用全局 `request` + 本地 interface 是**对的**，模块缺席时天然降级，别为了「类型共享」重新焊死。

---

## 6. 待拍板

| # | 问题 | 影响 |
|---|---|---|
| Q1 | 目标是「给站点减负」，还是「让企微可独立发版/可售卖」？ | 前者只要 B；后者必须 C，且要先补两项上游能力 |
| Q2 | 登录**永久留宿主**，能接受吗？ | 不能接受 ⇒ 需要新造认证插件协议，成本量级远大于本次拆分 |
| Q3 | 企微后台回调地址可以改一次（含一次 `suite_ticket` 断档）吗？ | 不能 ⇒ C 档直接作废，只剩 B |
| Q4 | 是否已有把 `auth.wecom.sync` 绑给自定义角色的客户？ | 有 ⇒ C 档要额外做权限绑定迁移 |
| Q5 | 未启用企微的站点，菜单里现在那条「企业微信」要不要一并消失？ | B 档的验收口径 |

---

## 7. 若继续，下一步的验证清单（都不需要改代码）

1. 起一个 `ojm init` 出来的干净站点，`grep -r wecom` 数一遍实际背包（验证 §1.1 的 30 文件口径在**发布包**里也成立——要用 `pnpm pack` 出来的 tarball 解包验，不能只看源码树）。
2. 在 `oj serve` 上实测一次「模块改名 + 已有库」的 `oj migrate` 路径（§2-K4 的待验项）。
3. 用 `/api/wecom/ticket` 这种路径试着装一个 demo 方案，确认 `LOGIN_ENDPOINT_RE` 放行但**换票不可行**（把 K1 从「读文档」变成「有实测」）。
4. 量一次 B 档的真实收益：默认关闭后产物里 `auth` 模块体积与首屏路由表的变化。

---

## 8. 取证命令（本文字段来源）

```bash
# 体量（在 packages/cli/templates 下）
cat src/auth/api/_shared/wecom/*.ts src/auth/api/wecom/api.ts \
    src/auth/api/wecom/{admin,sync}/api.ts | wc -l            # 3237
cat src/auth/api/migrations/000{1__wecom,2__org_sync}.*.sql | wc -l   # 123
cat src/system/web/pages/wecom/index.tsx src/login/web/wecom.ts \
    src/system/web/pages/departments/sync-bar.tsx | wc -l      # 528
cat tests/wecom-*.spec.ts | wc -l                              # 2859

# 随脚手架分发的文件数
ls src/auth/api/_shared/wecom/*.ts src/auth/api/wecom/api.ts \
   src/auth/api/wecom/*/api.ts src/auth/api/migrations/*wecom* \
   src/auth/api/migrations/*org_sync* src/system/web/pages/wecom/* \
   src/login/web/wecom.ts src/system/web/pages/departments/sync-bar.tsx \
   tests/wecom-*.spec.ts | wc -l                               # 30

# 耦合点
grep -n "_platform" src/auth/api/_shared/wecom/{sync,login}.ts
grep -rn "wecom" src --include=*.ts --include=*.tsx | grep -v "src/auth/api"

# 平台约束（在仓库根）
grep -n "LOGIN_ENDPOINT_RE\|ANONYMOUS_RE" packages/cli/templates/src/_platform/api/_lifecycle/steps/preflight.ts
grep -rn "issueTokens" docs/prd/solution/*.md | head
```
