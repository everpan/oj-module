# 企业微信「企业内部应用」对接：评估与方案（M1 单企业态 + 与代开发共存）

> 状态：**评估 + 方案，未实施**。本文不改仓库代码。
> 触发：代开发（服务商模板）已完整落地（登录 / 组织架构 / 事件增量），问「能不能再支持企业内部应用（自建应用）」。
> 关联：`docs/devkit/wecom-daikaifa.md`（现有代开发手册）、`docs/plans/20261030-1845-wecom-daikaifa-login-plan.md`、
> `docs/plans/20261101-1530-wecom-org-sync-plan.md`、`docs/plans/20261101-0951-wecom-as-solution-brainstorm.md`。

---

## 0. 结论先行

**能做，而且比预期小得多——因为代开发和企业内部应用在企业侧用的是同一条数据链路。**

代开发拿到的 `permanent_code` 本来就是当 `corpsecret` 用的（`client.ts:361` 的注释与实现都写着「与自建应用同一个 gettoken」）。
所以「支持企业内部应用」不是接一套新协议，而是：**换一个 secret 的来源、去掉一整套套件流程**。

| 判断 | 结论 |
|---|---|
| 企业侧 API（gettoken / 通讯录 / 网页授权 / 登录换 userid） | **完全不用改**，同一份实现 |
| 同步引擎 / 事件写库 / 加解密 / 报文归一 | **完全不用改**，同一份实现 |
| 套件专属（suite_ticket / permanent_code / 开通链接 / create_auth 系列事件） | 自建模式下**闲置**，不删也不改 |
| 真正要写的新代码 | 配置层模式判定 + 一次「接入校验」+ 事件入口分派 ≈ **200–300 行** |
| 表结构 | 最多加 1 列（`credential_kind`），**不加也能跑** |

**但有一条硬约束必须先接受**（§3.1）：**自建应用收不到成员通讯录变更事件**。
想保留「事件增量」，必须让客户另外配「通讯录同步 → 接收事件服务器」，而企微要求该 URL 在**企业主体域名**下。
这条直接把「SaaS 多企业 + 自建应用 + 事件增量」判死——那正是代开发存在的理由。

**推荐 M1：自建应用 = 单企业部署（凭据进 `config.yaml`）**，一套部署服务一家企业，复用 85% 以上代码、零表结构风险、事件增量可选。
多企业自建（M2）技术上做得到，但不建议现在做（§6）。

**两种模式可以配置共存**，不是二选一（详见 §4.10）。但要分成两种共存：

| 共存场景 | 额外代价 | 说明 |
|---|---|---|
| **不同企业共存**（本站自己用自建应用 + 子公司/客户走代开发模板） | **几乎为零** | 租户键都是 `corp_id`，两套档案天然隔离；只需配置允许两者同时启用 |
| **同一企业双应用共存**（同一家既有代开发应用又有自建应用，常见于迁移期） | 约 100 行 + 1 个界面字段 | 6 处代码把「这家企业的应用」当成唯一，需要按 `credential_kind` 收口（§4.10） |

身份层天然合并，不需要额外处理：JIT 建档的用户名是 `wecom:<userid>`（`login.ts:110`），与凭据来源无关，同一个人在两条链路下登录的是**同一个账号**。

---

## 1. 两种接入方式的差异

先把术语分清，客户侧最容易互相误解：

- **代开发应用**：服务商建模板 → 客户管理员扫码授权。在客户企微后台里它也显示为一个「自建应用」，但权限与回调都由服务商的模板决定。
- **企业内部应用（自建应用）**：客户管理员自己在「应用管理 → 自建」里创建，把 `corpid / Secret / AgentId` 交给部署方。

| 维度 | 代开发（现有） | 企业内部应用（本次要加） |
|---|---|---|
| 谁创建 | 服务商建模板，企业管理员扫码授权 | 企业管理员自建，人工交付 3 个值 |
| 密钥来源 | `suite_ticket + suite_secret → suite_access_token → auth_code → permanent_code` | 应用详情页「Secret」直接给 |
| 换企业 token | `gettoken(corpid, permanent_code)` | `gettoken(corpid, corpsecret)` —— **同一个接口** |
| `suite_ticket` | 必需，每 10 分钟一推，断则登录 503 | **没有**（少一个常驻故障源） |
| 开通 / 续期 | 开通链接 + `create_auth` / `reset_permanent_code` 回调 | 没有。换 secret 就得重新接入 |
| 取消授权 | `cancel_auth` 回调 → 停用 + 吊销会话 | **没有事件**，只能从同步/登录失败发现 |
| 授权模式 | `auth_mode` 0/1，成员授权下通讯录接口全 60011 | **没有这个概念**（同步闸门恒通过） |
| 通讯录权限 | 四项自定义权限 + 「待企业确认」中间态 | 由「应用可见范围」决定，管理员直接设，无待确认 |
| 成员变更事件 | **默认回调**到代开发回调 URL | **收不到**（§3.1），只能走通讯录同步的接收事件服务器 |
| 通讯录范围 | 永远是可见范围子集 | 可见范围子集；但可设为「全公司」 |
| 多企业 | 一套部署服务 N 家（扫码即加，不改配置） | 一套部署一套凭据（除非把凭据入库） |

一句话：**自建省掉了套件的复杂度，代价是省掉了套件带来的「零配置开通」和「默认事件推送」。**

---

## 2. 为什么改动小：代码取证

在 `packages/cli/templates/src/auth/api` 下：

```bash
cat _shared/wecom/*.ts | wc -l          # 3009
wc -l wecom/api.ts wecom/admin/api.ts wecom/sync/api.ts | tail -1   # 688
sed -n '224,359p' _shared/wecom/client.ts | wc -l    # 136  suite 专属块
sed -n '361,529p' _shared/wecom/client.ts | wc -l    # 169  企业侧块（自建直接复用）
sed -n '135,211p' _shared/wecom/events.ts | wc -l    #  77  套件事件分支（自建闲置）
```

| 文件 | 行数 | 自建模式 |
|---|---|---|
| `client.ts` | 550 | 套件块 136 行闲置；企业侧 169 行（gettoken / 通讯录 / userinfo）原样用 |
| `sync.ts` | 501 | **原样**（唯一改动：`auth_mode` 恒 0 即通过，代码不用动） |
| `contacts.ts` | 263 | **原样**（`findCorpAuth` 取 secret，自建同一个语义） |
| `crypt.ts` / `payload.ts` / `replay.ts` | 550 | **原样**（签名、加解密、报文归一与来源无关） |
| `login.ts` | 320 | **原样**（授权 URL 本来就是 `appid=corpid&agentid=…`，自建同样成立） |
| `store.ts` | 295 | **原样**（`permanent_code_enc` 的语义变成「该应用的企业级密钥密文」） |
| `config.ts` | 199 | **要改**：模式判定 + 按模式取凭据 |
| `events.ts` | 212 | 套件分支闲置；通讯录事件那段原样 |
| `admin.ts` / `admin/api.ts` | 119 + ~110 | **要改**：开通链接 → 接入校验 |
| `wecom/api.ts` | 366 | **要改**：三处 `readWecomConfig()` 换成按模式取凭据 |

**结论**：suite 专属约 0.9k 行在自建模式下只是「不执行」，不是「要删」；要写/改的是配置解析、事件入口、profile 引导三块。

---

## 3. 三条硬约束（先认下来，再谈方案）

### 3.1 自建应用收不到成员变更事件 —— 想增量就得另配一套回调

官方《成员变更通知》（90970）在「新增成员 / 更新成员 / 删除成员」三处都写着同一句：

> 该事件会回调给**通讯录同步助手，代开发自建应用**以及上游企业共享的应用。

也就是说**普通自建应用不在回调对象里**。企微技术支持在社区里也直说：「成员变更事件需要在通讯录同步中设置接收事件服务器接收，自建应用只能用户消息、外部联系人变更事件等」。
部门变更事件属同一文档系列且措辞一致，按同一结论处理（P3 真机再确认一次）。

能拿到事件的唯一路径是：客户在**管理工具 → 通讯录同步 → 设置接收事件服务器**填 URL / Token / EncodingAESKey。
而《接收通讯录变更事件》（90967）对 URL 有一句硬要求：

> 为保证企业数据安全，URL 需要配置**本企业主体的域名**链接。

**推论（决定了产品边界）**：

| 部署形态 | 事件增量 |
|---|---|
| 单企业私有化部署（站点就在客户自己域名下） | **可用**（客户配通讯录同步回调即可） |
| SaaS 一套部署服务多家企业 | **基本不可用**（每家都要把 URL 指向自己主体域名） |
| 代开发（现有） | 默认可用（企微主动推） |

### 3.2 通讯录读取仍受「应用可见范围」限制，别为此引入通讯录同步 secret

自建应用用应用 secret 读通讯录，拿到的同样只是**可见范围内**的部门与成员。
要全量，最省事也最安全的做法是让管理员把**应用可见范围设为全公司**——一次点击，零密钥扩散。

**不建议**让客户把「通讯录同步 secret」也交出来：那把钥匙能**写**全公司通讯录，风险与收益完全不匹配。
自建模式就一个 secret（应用 secret），这是本方案的安全底线。

### 3.3 多租户边界：一套部署 = 一家企业（M1）

自建模式的凭据是「企业 × 应用」维度的，进 `config.yaml` 就意味着一套部署只服务一家。
这是**产品定位**而不是技术妥协：SaaS 多企业的需求本来就该走代开发（零配置开通 + 默认事件）。

若真的要做 M2（多企业自建），代价见 §6：凭据入库、回调按信封 `ToUserName`（明文 corpid）选钥、事件增量仍旧拿不到、以及每家客户的人工开通流程——等于用更大代价复刻一个更差的代开发。

---

## 4. 方案 M1：自建应用 = 单企业部署

### 4.1 新增部署常量（`config.yaml` 的 `vars:`）

| 变量 | 必填 | 从哪取 | 说明 |
|---|---|---|---|
| `wecom_mode` | 否 | `suite` / `corp` | 空 = `suite`（现有部署不改即兼容） |
| `wecom_corp_id` | corp 模式必填 | 企微后台「我的企业 → 企业信息 → 企业ID」 | 同时是租户键（沿用 `tenantOfCorp`） |
| `wecom_corp_secret` | corp 模式必填 | 应用详情页「Secret」 | 换取企业 access_token；换过要重新接入 |
| `wecom_corp_agent_id` | corp 模式必填 | 应用详情页「AgentId」 | 登录授权 URL 与 token 缓存键都要 |
| `wecom_corp_callback_token` | 可选 | 通讯录同步 → 接收事件服务器 → Token | 不配 = 不做事件增量（全量同步照常） |
| `wecom_corp_encoding_aes_key` | 可选 | 同上 → EncodingAESKey（43 字符） | 同上 |
| `wecom_allow_coexist` | 否 | `false`（默认）/ `true` | 允许 suite + corp 同时启用；见 §4.10 |

复用不变：`wecom_enc_key`（落库加密）、`wecom_base_url`（派生回调 URL 与登录回跳）。
`wecom_suite_*` / `wecom_provider_*` 在 corp 模式下**留空**，启动不校验。

配置校验规则（fail-fast，文案要点名缺哪项）：

- `wecom_mode=corp` 且 `wecom_corp_*` 三项缺任一 → 启动/首个请求 400。
- `wecom_mode=corp` 但 suite 凭据也填了 → 由 `wecom_allow_coexist` 决定：`false`（默认）报 400「两种模式不要同时配」；`true` 则按 §4.10 共存，两类档案并存。
- `wecom_mode` 空且 suite 凭据齐 → suite（今天的行为，一字不改）。

### 4.2 运行时解耦：三处「只为拿 encKey 却要整套凭据」的地方

现状 `readWecomConfig()` 同时要 Tier A+B，而登录 / 回跳 / 同步其实只用它里面的 `encKey`（解密 profile）与 `baseUrl`。
corp 模式没有 suite 凭据，会在这些地方直接 400。

改法（`config.ts` 拆成三个读取器，调用点按需取）：

```
readBaseConfig()   → token / encodingAesKey / encKey / baseUrl   （按 mode 决定 token/aesKey 取哪套）
readSuiteConfig()  → suiteId / suiteSecret / providerId / providerSecret（仅 suite 分支用）
readCorpConfig()   → corpId / corpSecret / agentId                （仅 corp 分支用）
```

调用点对应关系：

| 调用点 | 现在 | 改成 |
|---|---|---|
| `wecom/api.ts:129` `decryptVerified()` | `readWecomConfig()` | `readBaseConfig()` + 按 mode 选 receiver |
| `wecom/api.ts:165` `login.get()` | `readWecomConfig()` | `readBaseConfig()`（只用到 encKey/baseUrl） |
| `wecom/api.ts:210` `callback.get()` | `readWecomConfig()` | `readBaseConfig()` |
| `wecom/sync/api.ts:98` `profileOf()` | `readWecomConfig()` | `readBaseConfig()` |
| `wecom/admin/api.ts:103` 生成开通链接 | `readWecomConfig()` | `readSuiteConfig()` |

### 4.3 profile 引导：自建模式没有 `create_auth`，必须显式「接入校验」

`wecom_app_profile` 是所有运行时路径的唯一凭据真源（登录 / 同步 / 事件都读它），
自建模式必须有人把它写进去。新增一个 superadmin 端点：

```
POST /auth/wecom/admin/connect   （仅 corp 模式；suite 模式 400「本部署为代开发模式」）
```

做四件事，**任何一步失败都不落库**：

1. `gettoken(corp_id, corp_secret)` → 验证 secret（40001 = 抄错/已重置）；
2. `department/simplelist` → 验证通讯录读权限（60011 / 48002 = 可见范围或权限没给）；
3. `user/list`（取 1 人）→ 验证能读到人（返回空 = 可见范围内没人，提示改可见范围）；
4. 写 / 刷新 profile：`suite_id = ''`、`credential_kind = 'corp'`、`secret` 密文入库、`auth_mode = 0`、`status = active`。
   同时 `invalidateCorpToken()`——换过 secret 的部署不会带着旧 token 打上游。

幂等：重复点 = 重写密文 + 清 token 缓存。**「换 secret 后必须重新接入」这件事要写在页面上**，不能只写在文档里。

> 为什么不「启动时自动写一行」：自检失败会变成启动失败，而自建模式最常见的失败是客户还没加可信 IP / 可见范围没配——那是运营动作，不该让服务起不来。

### 4.4 事件入口：`/event` 按模式分支

```
mode=suite → 现行为一字不改（验签用 suite token/aeskey，receiver 候选 = [suite_id, 信封 ToUserName]）
mode=corp  → 验签用 wecom_corp_callback_token / _encoding_aes_key，
             receiver = corp_id（+ 信封 ToUserName 兜底），
             明文直接交 handleContactChange()（不走 handleSuiteEvent 的 switch）
```

理由：`handleSuiteEvent` 里那套 `InfoType` 分支（suite_ticket / create_auth / change_auth / cancel_auth）在 corp 模式下永远不该出现；
而通讯录变更那段本来就是「在 switch 之前分流」（`events.ts:149`），直接复用。

**corp 模式回调地址只填一处**：企微后台「通讯录同步 → 接收事件服务器」= `<wecom_base_url>/event`。
**应用自身的「接收消息」回调留空**——两处 Token 不同，填两个到同一 URL 会让一半报文验签失败。
页面上的回调地址卡片要带这句提示，并沿用现有的 `aesKeyFp` 指纹日志，便于一眼看出「这把钥匙是哪来的」。

### 4.5 登录：零改动（前提是 profile 已写入）

- `/auth/wecom/login`：`resolveWecomProfile()` 在只有一家企业时自动解析，`?corp=` 可省——自建模式下正好是「唯一一家」。
- 授权 URL：`appid=corpid&agentid=…`（`login.ts:45`）对企业内部应用同样成立，`snsapi_base` 静默拿 userid。
- 换 userid / JIT 建档 / 登录自更新 / 一次性票据 / 302 落地：全复用。

### 4.6 组织架构同步：零改动

`startSync({ authMode })` 的准入判据是 `auth_mode !== 0` 才拒（`sync.ts:306`），自建恒 0 直接通过。
「成员授权」卡片、`change_auth` 复核、授权模式列这些**只在 suite 模式出现**，corp 模式下前端不渲染即可。

### 4.7 后台页 `/system/wecom`

| 区块 | suite 模式 | corp 模式 |
|---|---|---|
| 顶部卡片 | 「生成开通链接」+ 二维码 | 「接入状态」：企业代码 / 应用 id / 应填的回调地址 / [验证并接入] |
| 清单表 | 现有列 + 授权模式 | 去掉「授权模式」列（恒 `—`） |
| 停用 / 启用 | 保留 | 保留（这是本地开关，不依赖企微） |
| 权限 | superadmin | superadmin（它读的是部署级配置） |
| 常驻提示 | 授权模式 / 可见范围 | 「改过 Secret 必须重新验证接入」「应用可见范围决定能同步到多少人」 |

### 4.8 数据面：加一列还是用空串约定

| 方案 | 代价 | 结论 |
|---|---|---|
| 加 `credential_kind TEXT NOT NULL DEFAULT 'suite'`（三方言 `ALTER TABLE ADD COLUMN`） | 1 个迁移 + schema.yaml + 测试 | **建议**：后台展示、日志、将来 M2 都要用；**若开共存（§4.10）则是必加** |
| 用 `suite_id = ''` 推断 | 0 迁移，但主键里塞了一个「空值即语义」的约定 | 仅在不开共存时可接受 |

不动的是：`sys_department` / `sys_dept_member` / `users` 的 `origin` 归属权模型——自建应用只是换了个 `origin` 的**来源**，
`origin='wecom'` 照旧，CRUD 基线、转为本地维护这些行为一个字不变。

### 4.9 文档与测试

- `docs/devkit/` 新增一节（或新文件）：自建应用的 5 项配置、回调只填一处、可见范围设全公司、可信 IP、可信域名。
- 单测：mode 判定与配置校验、connect 的四步校验（用桩）、事件按 mode 分派、corp profile 的 secret 加解密往返。
- e2e：沿用 `tests/e2e/templates/wecom-org-sync.spec.ts` 的套路——造一行 `credential_kind='corp'` 的 profile + 同步任务行，离线覆盖页面四态（不需要真企微）。

---

## 4.10 共存形态：一个部署同时服务两种应用

结论：**可以**。但「不同企业共存」和「同一企业双应用」是两个难度级别，代码要处理的是后者。

### 4.10.1 为什么不同企业共存几乎免费

所有运行时路径都以 `corp_id` 为租户键（`store.ts:66 tenantOfCorp`），档案表主键是 `(suite_id, corp_id, agent_id)`。
代开发行的 `suite_id` 是真值，自建行用 `suite_id=''`（或 `credential_kind='corp'` 区分），**两行天然不撞**。
所以「本站自己用自建应用、子公司走代开发模板」这种组合，只需配置允许共存，代码走的就是同一套 `corp_id` 分支。

### 4.10.2 同一企业双应用：六处「把应用当成唯一」的地方

这些地方今天都隐含假设「一家企业 = 一个可用应用」，同一 `corp_id` 出现两行时会各错一处：

| # | 位置 | 今天的症状 | 修法 |
|---|---|---|---|
| C1 | `store.ts:150 findProfile` / `store.ts:189 probeProfile` | `picked.length > 1` → 400「该企业开通了多个应用，登录链接必须带 agent」 | 加可选 `kind` 参数；未指定时按 `wecom_default_kind` 取一类，只有该类仍多行才 400 |
| C2 | `login.ts:70 resolveWecomProfile` | 登录链接不带 `corp` 时，多企业直接 400；同企业双应用还会走到硬编码的 `DEFAULT_WECOM_AGENT="1000059"`（`login.ts:68`） | 删掉硬编码常量，改成 `wecom_default_agent` 配置或「按 kind 优先级取首个」，并把候选范围按 kind 收窄 |
| C3 | `store.ts:221 findCorpAuth` | `rows[0]` 任取一行的 secret；同企业双应用时可能拿到另一套凭据 | 增加 `kind` 入参：由事件入口把「本次验签通过的是哪套凭据」传下来 |
| C4 | `events.ts:63 disableCorp`（`cancel_auth`） | 把该 `corp_id` 的**所有行**置 disabled 并吊销会话——会顺手停掉自建应用 | 只停 `credential_kind='suite'` 的行；并沿用 `admin.ts:78` 的语义：**仍有其它活跃应用时不吊销会话** |
| C5 | `events.ts:113 refreshAuthModes` | 遍历 `findCorpAuth().agentIds`，对自建行也去刷 `auth_mode`（自建没有这个概念） | 只遍历 suite 行 |
| C6 | `wecom/sync/api.ts` 的 `VIEW` | 不返回 `agentId`，前端状态条无法回传，双应用租户一点「立即同步」就 400 | VIEW 增加 `agentId`；`sync-bar.tsx` 的 start/cancel/status 原样回传 |

C4 是最容易漏、后果最重的一条：代开发的取消授权不该影响同一家企业的自建应用（反之亦然）。

**明确不用改**的：`admin.ts:78` 的「还有别的应用在用就不吊销会话」本来就是按租户算的，共存下语义正好正确。

### 4.10.3 回调：两条路径，别在一个 URL 上赌两把钥匙

同一部署下两套凭据的 `Token / EncodingAESKey` 不同，而验签必须在解密之前完成，所以「一个 URL 同时接两种」只能靠**逐个 token 试签**。

| 形态 | 做法 | 代价 | 建议 |
|---|---|---|---|
| **两条路径（推荐）** | suite 继续用 `<base>/event`（存量零迁移）；corp 用 `<base>/contacts/event` | +1 个路由，两组匿名路径白名单 | ✅ 推荐 |
| 单路径双凭据 | 先用 suite token 算签名，不匹配再用 corp token；用命中的那把钥匙解密 | 每次回调多 1 次 SHA1（可忽略），但日志里「这条是谁的」要靠试出来，排障变绕 | 只在不允许加路由时用 |

选两条路径的另一个理由：corp 模式的回调**只该填在「通讯录同步 → 接收事件服务器」**，而 suite 的 `/event` 是给指令回调用的。
两个后台位置、两套密钥，用两个 URL 才不会互相踩（§7 R1）。

### 4.10.4 共存的配置与页面

```yaml
wecom_mode: corp          # 主模式：决定后台页默认展示哪一块、未显式指定时按谁路由
wecom_allow_coexist: true # 允许 suite 凭据同时生效
```

- `/system/wecom` 两块卡片各自按「该类凭据是否齐」显示：代开发 → 生成开通链接；自建 → 验证并接入。清单表增加「来源」列（代开发 / 自建）。
- 清单表「授权模式」列只对代开发行有意义，自建行显示 `—`。
- 组织架构页状态条：`connected` 的判定改为「该租户存在任一 active 档案」；双应用租户按后端返回的 `agentId` 回传（C6）。

### 4.10.5 增量账

| 项 | 量 |
|---|---|
| 相对 M1 的新增代码 | `store.ts` 三处签名 + `events.ts` 两处过滤 + `login.ts` 去掉硬编码常量 ≈ **100 行** |
| 界面 | 清单加「来源」列、状态条回传 `agentId` ≈ **30 行** |
| 路由 | corp 回调单独一条 + 匿名白名单 ≈ **10 行** |
| 测试 | 「同 corp 两行档案」的分辨、`cancel_auth` 只停 suite 行、双应用同步带 agent ≈ **4–6 条单测** |
| 表结构 | `credential_kind` 从「建议加」变成 **必加**（否则无法在 SQL 层区分行） |

---

## 5. 分期与验收

| 期 | 内容 | 交付判据（真机） |
|---|---|---|
| **P1 凭证与引导** | 6 个 var、`config.ts` 三拆分、`connect` 端点、后台卡、`credential_kind` 迁移 | 填 3 个值点「验证并接入」→ 清单出现该企业；普通员工从工作台进入能登录 |
| **P2 同步** | 预计零代码，只做验证与文案 | 点「立即同步」→ 部门数 / 人数 / 跳过数 / 耗时四个数能写进验收记录；本地部门不被覆盖 |
| **P3 事件增量** | `/event` 的 corp 分支 + 通讯录同步回调指引 | 客户改一个部门名，不点同步刷新页面即变；日志出现 `wecom change_contact applied` |

验收口径沿用 `wecom-daikaifa.md` §7.6：**四个数（部门数 / 人数 / 跳过数 / 耗时）写不出来就等于没验**。
跳过数不为 0 不是失败（可见范围外的硬口径），但「跳过数接近总数」必须判不通过——自建模式下这条多半是可见范围没设全公司。

---

## 6. 如果真要做 M2（多企业自建）：诚实账

| 问题 | 代价 |
|---|---|
| 凭据入库 | `wecom_app_profile` 每企业一行，`suite_id` 失去唯一性语义 → 主键要重建（sqlite 不能改主键，得建新表倒数据，三方言各写一遍） |
| 回调选钥 | 信封 `ToUserName` 是明文 corpid → 先用它查 profile，再拿该行的 token/aeskey 验签解密。冷启动时多一次索引查询，可接受；但库里多了一张「密钥表」，泄露面变大 |
| 事件增量 | **仍旧拿不到**（§3.1 的域名要求），M2 下等于永久失去事件增量 |
| 开通流程 | 每家客户人工交付 3 个值 + 点一次「验证并接入」，等于把代开发的「扫码即装」退回人工 |
| 净收益 | 只比代开发少一个 `suite_ticket` 依赖 |

**结论：M2 不建议做。** 若客户是 SaaS 形态，正确答案是「走代开发」；若客户是私有化单企业，M1 就够。

---

## 7. 风险与明确不做的事

| # | 风险 | 处置 |
|---|---|---|
| R1 | 客户把「应用回调」和「通讯录同步回调」都填到 `/event`，两套 Token 不同 → 一半报文验签失败 | 页面上回调地址卡片写明「只填通讯录同步这一处、应用回调留空」；日志打 `aesKeyFp` 便于定位 |
| R2 | 可见范围设成「部分成员」→ 同步只有子集 | 沿用现有「N 个部门因权限被跳过」+ 可见范围话术；验收清单里加一条「跳过数远小于总数」 |
| R3 | 客户重置 Secret 后无感知 | 「验证并接入」常驻按钮 + 页面上写明「换 Secret 必须重新验证」；错误卡片按 40001 提示 |
| R4 | 客户删掉应用（无 `cancel_auth` 事件） | 不新增机制；表现为登录 400 / 同步 40001，走错误卡片 |
| R5 | 术语混淆（代开发应用在客户后台也叫「自建应用」） | 文档与页面统一叫「代开发」vs「企业内部应用（自建）」 |

**明确不做**：
- 不引入「通讯录同步 secret」（可写全公司的密钥，不进配置）；
- 不改回调路径（`/api/auth/wecom/*` 保持不变，存量代开发部署零迁移）；
- 不改 `auth.wecom.sync` 权限码、不改方案化边界（`20261101-0951` 的结论不受影响）;
- 不做 secret 自动轮换、不做多企业自建。

---

## 8. 待你拍板

| # | 问题 | 影响 |
|---|---|---|
| Q1 | 目标客户是「私有化单企业」还是「SaaS 多企业自建」？ | 前者做 M1；后者建议劝回代开发（§6） |
| Q2 | 事件增量要不要（要不要让客户多配一处通讯录同步回调）？ | 不要则 P3 砍掉，只留全量 + 登录自更新 |
| Q3 | `credential_kind` 加列，还是用 `suite_id=''` 约定？ | 加列 = 1 个三方言迁移；省事但隐式 |
| Q4 | corp 模式下后台页给 superadmin 还是该企业 admin？ | 建议 superadmin（读的是部署配置，不是租户数据） |
| Q5 | 变量前缀用 `wecom_corp_*` 还是 `wecom_selfbuilt_*`？ | 只影响命名一致性，不影响实现 |
| Q6 | 要不要开共存（§4.10）？只做「不同企业共存」还是连「同一企业双应用」一起做？ | 前者几乎零成本；后者 +~140 行，且强制加 `credential_kind` 列 |
