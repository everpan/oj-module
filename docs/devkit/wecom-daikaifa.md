# 企业微信代开发集成：凭据清单与三角色手册

本文件覆盖「把模板工程接到真实企业微信代开发套件」这件事的全过程：**要准备哪些凭据、
填到哪里、按什么顺序开通、三种角色各自怎么用**。三种角色指：企业员工（用户）、
本工程开发者、部署与运营（服务商侧运维）。

读完本文件即可独立完成对接，不需要其它文档。文中路径都是**你工程里的相对路径**。

---

## 0. 谁该读哪几节

| 你是 | 读 | 大约要做什么 |
|---|---|---|
| 部署 / 服务商运营 | §2 §3 §4 §7 §8 | 备凭据、填后台、按顺序开通、日常启停与轮换 |
| 本工程开发者 | §1 §6 §8 | 本地联调、加企业、改前端、写没有真实套件的自动化测试 |
| 企业管理员（客户的 IT） | §2.5 §2.6 §6.8 §8 | 开四项通讯录权限、选对授权模式、读懂同步页面上的卡片 |
| 企业员工（用户） | §5 | 怎么进、要不要注册、进不去怎么办 |

---

## 1. 这套东西在做什么

一句话：**企业管理员在自己企业里「授权安装」一次，之后该企业员工就能用企微身份直接登录
本站，不需要注册**。本站同时服务多个企业，靠租户列隔离数据。

四条链路，看懂这张图就够排查九成问题：

```text
企微服务商后台（一套代开发模板 = 一个部署）
  │
  ├─ suite_ticket ── 每 10 分钟推一次，30 分钟不用即作废 ──▶ wecom_suite_ticket（共享表）
  │
  └─ 指令回调 URL ──▶ POST <wecom_base_url>/event
        │
        ├─ ① suite_ticket + suite_secret ─▶ suite_access_token（缓存，提前 5 分钟过期）
        │       ├─ get_permanent_code ◀── auth_code（企业管理员确认授权时推 create_auth）
        │       └─ pre_auth_code ─▶ 开通链接（10 分钟内有效、一次性）
        │
        └─ ② permanent_code + corp_id ─▶ 企业 access_token（缓存）
                └─ ③ code（网页授权或扫码回跳）─▶ userid ─▶ ④ 自动建档 ─▶ 一次性票据 ─▶ 会话
```

- `permanent_code` 等价于「该企业这个应用的全部数据权限」，**只以 AES-GCM 密文落库**
  （列名 `permanent_code_enc`），任何接口都不回传明文。
- 「哪个企业装了哪个应用」**不写在配置文件里**：新增企业只是多一行数据，不改配置、不重启。
- JIT（Just-In-Time）建档：员工第一次登录时自动建本地账号，用户名 `wecom:<企微userid>`。

第四条链路是**组织架构同步**（前三条是登录，这条是通讯录）；它同样是「授权一次、之后自动跑」：

```text
企业管理员授权（auth_mode = 管理员授权，且四项通讯录权限已生效，§2.5）
  │
  ├─ 轨一 登录自更新：某员工登录时顺手 user/get 一次（24h 节流）→ 补姓名/职务/部门
  ├─ 轨二 全量同步：/system/departments 点「立即同步」→ department/simplelist + user/list
  │       └─ 分片推进（一片 12 秒）+ 调用方轮询 → 进度落在 wecom_sync_job
  └─ 轨三 事件增量：change_contact（尚未上线，靠轨二兜底）
        ↓
   sys_department / sys_dept_member（origin='wecom'）+ users（activated=0）
```

- **归属权**（`origin`）决定谁能改：`local` 的行同步一根毛都不碰；`wecom` 的行管理员只能「转为本地维护」
  之后才改得动，改了之后同步也不再覆盖。
- **可见范围永远是子集**：代开发只能拉到「本应用可见范围内」的部门，授权也解不开（§2.4）——
  页面上「N 个部门因权限被跳过」通常就是它。

---

## 2. 凭据清单

### 2.1 八项部署常量（全部填在工程根 `config.yaml` 的 `vars:` 段）

一个部署 = 一套代开发模板，所以这八项是**部署维度**的常量，不进数据库。

八项分三层，**来源与必填时序不同**——这是破解「先有 suite 还是先有回调」死锁的关键
（详见 plan §18）：

- **Tier A（部署方本地生成，创建模版前即可配齐）**：`wecom_callback_token` /
  `wecom_encoding_aes_key` / `wecom_enc_key` / `wecom_base_url`。这四项决定服务能否启动并响应
  回调验证，**不依赖企业微信下发**；即使 `suite_id` / `suite_secret` 还空着，服务也能跑通 echostr。
- **Tier B（企业微信在「代开发模版创建成功」后下发）**：`wecom_suite_id` / `wecom_suite_secret`。
  只影响登录 / 授权等 suite 流程（login / callback / create_auth）；**回调 URL 验证（echostr）不依赖它们**。
- **Tier C（服务商级凭证，只供「生成开通链接」用）**：`wecom_provider_id`（= 服务商后台
  **服务商信息**页的 CorpID）/ `wecom_provider_secret`（= 服务商后台 **应用管理 → 通用开发参数** 点「编辑」
  后的 `ProviderSecret` 字段，**不在**服务商信息页，也**不是** suite 的 secret）。代开发的开通入口走
  `get_customized_auth_url`，该接口只认 `provider_access_token`，而它必须由服务商 corpid + provider_secret 换得。
  缺它**不影响登录**（login 走 suite 流程），但 `/system/wecom` 点「生成开通链接」会 400 点名缺这两项。

Tier A 任一为空 → 服务启动即 400 拒绝（宁可不登录，也不明文存 `permanent_code`）。
Tier B 为空时服务仍可启动并响应 echostr，但 suite 流程会 400——先配 Tier A 把回调验证跑通、
创建模版、拿到 suite 凭据，再补全 Tier B 即可，无需鸡生蛋。Tier C 可与 Tier B 同一阶段补全。

> 📌 **官方术语对齐**：企微服务商后台「代开发应用 → 模板详情 → **基本信息**」页里，
> 这两项就直接标作 **模板ID** 与 **模板Secret**（英文即 SuiteID / SuiteSecret）。
> 也就是说：本仓的 `wecom_suite_id` ← 官方「模板ID」，`wecom_suite_secret` ← 官方「模板Secret」，
> **不是**企业的 CorpID / CorpSecret，也**不是**某个自建应用的 Secret。照着「基本信息」页抄这两格即可。
> 两者都是「创建模板成功后」才出现在该页，创建前只有 Tier A 的 Token / EncodingAESKey 可设。

| # | 变量 | 层级 | 从哪取 | 格式 / 校验 | 配错或缺失的后果 |
|---|---|---|---|---|---|
| 1 | `wecom_suite_id` | Tier B | 企微服务商后台 → 应用管理 → 代开发应用 → 模板详情 → **基本信息**页（**创建成功后**才有），标作「**模板ID**」，即 **SuiteID**（形如 `ww…` / `wwb…`） | 非空字符串 | Tier A 配齐时服务可启动并验证回调；此项空 → login/callback/create_auth 等 suite 流程 400 `config vars 缺少 wecom_suite_id`；`event.post` 还会判 `SuiteId 与本部署配置不一致` |
| 2 | `wecom_suite_secret` | Tier B | 同页「基本信息」标作「**模板Secret**」，即 **SuiteSecret**（可重置） | 非空字符串；重置后旧值立即失效 | 换不出 `suite_access_token` → 502 `企微 get_suite_token 失败：errcode=40001 …`；开通链接生成也失败 |
| 3 | `wecom_callback_token` | Tier A | 同页 **Token**（自设，字母数字 3–32 位） | 与企微后台**逐字一致** | 保存回调 URL 时 `echostr` 解不解得开；事件被判验签失败，企微持续重推 |
| 4 | `wecom_encoding_aes_key` | Tier A | 同页 **EncodingAESKey**（自设，43 字符） | **43 字符**，且与企微后台**逐字一致**（差一个字符就是 `pkcs7: bad padding`） | 回调报文解不开、`suite_ticket` 永远收不到；企业管理员扫码后提示「应用安装失败」 |
| 5 | `wecom_enc_key` | Tier A | **自己生成**，见 §2.4 | hex 32 字符（16 字节）或 64 字符（32 字节），或 base64 解码后 16 / 32 字节。**AES-192（24 字节）不支持** | 400 `企业微信配置错误：wecom_enc_key 必须是 16 或 32 字节的 hex（32/64 字符）或 base64` |
| 6 | `wecom_base_url` | Tier A | **基址**：你站点的对外地址 + `/api/auth/wecom`（注意这是基址，**不是**企微后台要填的回调 URL） | **绝对地址、无尾斜杠、必须以 `/api/auth/wecom` 结尾** | 400 `wecom_base_url 必须是绝对地址` 或 `必须以 /api/auth/wecom 结尾`；配错还会让登录回跳落到别的应用或 404 |
| 7 | `wecom_provider_id` | Tier C | 服务商后台 → **服务商信息**页显示的 CorpID（服务商自己的 corpid，不是企业 corpid，也不是 suite_id） | 非空字符串 | 只影响「生成开通链接」：`get_provider_token` 换不出 `provider_access_token` → 生成链接 502；此项为空 → 生成链接 400 `config vars 缺少 wecom_provider_id` |
| 8 | `wecom_provider_secret` | Tier C | 服务商后台 → **应用管理 → 通用开发参数**（**点「编辑」按钮**那一栏的 `ProviderSecret` 字段）。**不在「服务商信息」页**（那里只显示 CorpID），也**不是** suite_secret | 非空字符串；重置后旧值立即失效 | 换不出 `provider_access_token` → 生成链接 502 `企微 get_provider_token 失败：errcode=40001 …`；此项为空 → 生成链接 400 `config vars 缺少 wecom_provider_secret` |

`wecom_base_url` 是唯一「配一处、派生两处」的值——它同时决定：

- 指令回调 URL = `<wecom_base_url>/event`
- 网页授权 `redirect_uri` = `<wecom_base_url>/callback`
- 登录成功后的站点回跳 = 去掉 `/api/auth/wecom` 的那部分（子路径部署也正确，例如
  `https://example.com/oj/api/auth/wecom` → 回跳 `https://example.com/oj/login`）

> ⚠️ **`wecom_base_url` 不是回调 URL 本身，别把它直接填进企微后台。** 企微后台要填的
> 「指令回调 URL」是 `<wecom_base_url>/event`（**必须带 `/event`**）。裸的 `/api/auth/wecom`
> 没有任何 handler，企微验签时会打到它 → **404 → 验证失败、模版保存不了**。
> 派生关系如上：回调 URL = base + `/event`，网页授权回跳 = base + `/callback`。

### 2.2 两项备案（都在企微后台，不写在代码里）

| 备案项 | 填什么 | 不做的症状 |
|---|---|---|
| **可信域名**（网页授权 / JS-SDK） | 站点域名（如 `example.com`），一般还需按企微要求上传校验文件到该域名根路径 | 企微授权页直接拒绝：`redirect_uri 需使用应用可信域名` |
| **可信 IP / API 调用白名单** | 服务商服务器的**出口** IP（多机部署要全列） | 上游接口报 `errcode=60020 not allow to access from your ip` → 本站回 502 并把 errcode 透出 |

> 两项都在服务商后台的「开发配置」一类的页面里，菜单名随企微版本会变；
> 认准**可信域名**与**可信 IP**这两个词即可。
> 回调与网页授权都要求 **https**：本地开发必须用内网穿透（见 §6.1），企微不会回调 http。

### 2.3 一个用于验收的企业

建议单独准备一个**测试企业**（企微可免费创建），把模板先装进测试企业跑通，
再给真实客户开通。理由很实际：企业管理员确认授权这一步需要人操作，测试企业里你自己就是管理员。

### 2.4 `wecom_enc_key`：怎么生成、怎么轮换

生成（32 字节，推荐）：

```sh
openssl rand -hex 32        # 输出 64 个 hex 字符，直接贴进 wecom_enc_key
```

- 只用 hex 或 base64；**不要**随手敲 32 个字符——它会被当 base64 解成 24 字节，
  触发 AES-192 不支持的报错（这正是最常见的配置事故）。
- 轮换：新 key **只能加密新写入**，旧密文用新 key 解不开。轮换 = 让企业重新授权一次
  （企微侧会推 `reset_permanent_code`，或重新走开通链接 → `create_auth`），把 `permanent_code`
  用新 key 重写。轮换前后要留旧 key 用于读取，直到所有企业都重授权完毕。
- 与数据库分开保管：`db.sqlite` 备份 + `wecom_enc_key` 备份，**缺任何一个都等于全部企业要重新授权**。

### 2.5 组织架构四项权限（同步能不能拿到「人话」全看这四项）

组织架构同步读的是通讯录接口，能不能读到**姓名 / 部门名 / 职务 / 完整部门树**，由四项权限决定。
官方把它们分成两类，处置方式完全不同：

| # | 权限 | 类型 | 没申请的症状 |
|---|---|---|---|
| ① | 成员基本信息 → **姓名** | 基础 | 满屏工号（`name` 回成 userid） |
| ② | 成员基本信息 → **部门名** | 基础 | **一棵全无名节点的树**——注意它**不在**「组织架构」权限下，是最容易漏的一项 |
| ③ | 成员基本信息 → **职务** | 自定义 | `users.position` 一直是空 |
| ④ | 组织架构 → **部门及父部门 ID、部门负责人** | 自定义 | `department[]` 不完整，只拿得到可见范围内的部门 id |

- **基础**权限扫码即得、不可编辑；**自定义**权限每次编辑保存会向企业推一条权限变更消息（`97201`），
  中间存在「**待企业客户确认**」状态，**企业没确认就不生效**。
- 重发开通链接只是**幂等 upsert**，**补不了权限**——必须企业管理员在企微后台确认。
- 本系统**不画**「未申请 / 待企业确认 / 已生效」三态：企微没有开放查询权限授予状态的接口，
  画出来的三态只能靠猜。替代做法是**按症状反推**——同步完成或失败时页面会给自助卡片
  （见 §6.8 与 §8），卡片直说「缺少通讯录权限」，对照上表自查即可。这是取舍，不是遗漏。

### 2.6 成员授权模式（阻断级：这种企业装上了也同步不了）

企业授权时选的是「**管理员授权**」还是「**成员授权**」，`get_permanent_code` 的
`auth_info.agent[].auth_mode` 会把它带回来（0=管理员 / 1=成员）。**成员授权模式下应用没有任何部门权限**，
`department/*`、`user/*` 一律 `60011`——跑同步只会得到一片无权限错误。

本系统把它落进 `wecom_app_profile.auth_mode`，并在三处用上：

- `POST /auth/wecom/sync/start`：`auth_mode=1` → **400 明确文案，一个上游请求都不发**；
- 组织架构页：直接给「该企业为成员授权模式」卡片，**不给同步按钮**（点了必然是 400）；
- 代开发后台清单：「授权模式」列让服务商一眼看出哪家企业「装了但同步不了」。

企业管理员在企微后台把模式改回「管理员授权」后，企微只推一个 `change_auth`（**不带 AuthCode**），
本系统会用已存的 `permanent_code` 反查 `get_auth_info` 刷新 `auth_mode`，不需要重新开通。

---

## 3. 要填进企微后台的地址（逐字）

| 企微后台位置 | 值 | 说明 |
|---|---|---|
| **模板**回调 URL（指令回调 / 事件接收） | `https://<站点>/api/auth/wecom/event` | 点保存时企微会 GET 一次带 `echostr`：必须**当次就通**，否则保存不了。`suite_ticket` 与 `create_auth` / `change_auth` / `cancel_auth` 都走这里 |
| **应用**回调 URL（数据回调 / 通讯录变更） | **同上** `https://<站点>/api/auth/wecom/event` | 一个端点吃两种回调，不用再开路由。当前版本收到 `change_contact` 只记一条 `wecom event ignored` 并回 `success`（事件增量尚未上线，靠全量同步兜底），但**现在就要填**：不填等于以后上线事件增量时还得再让每家企业的管理员动一次后台 |
| 可信域名 | `https://<站点域名>` | 不含路径 |
| 网页授权 `redirect_uri` | **不用手填**：后端按 `wecom_base_url` 拼出 `https://<站点>/api/auth/wecom/callback` | 企业的授权页里的域名必须与可信域名一致 |

代开发后台（`/system/wecom`，见 §6.4）点「生成开通链接」时会把**当前应填的回调地址**
一并显示出来——上线时以它为准，避免「配置文件改了、企微后台忘了改」。

---

## 4. 首次开通：顺序错了一定卡在 503

开通分两个阶段，两阶段之间由「代开发模版创建成功、拿到 suite 凭据」衔接——这正是
破解鸡生蛋死锁的关键（详见 plan §18）：**回调验证只需 Tier A，不必等 suite**。

### 阶段一：配 Tier A + 跑通回调验证（此时还没有 suite）

| 步 | 动作 | 为什么 | 错序的症状 |
|---|---|---|---|
| 1 | 配好 §2.1 的 **Tier A 四项**（`callback_token` / `encoding_aes_key` / `enc_key` / `base_url`），重启服务 | 这四项本地生成，服务凭它们即可启动并响应 echostr | 400 `企业微信未配置：config vars 缺少 …` |
| 2 | 站点对外 https 可达；把指令回调 URL `<base>/event` 填进企微后台并保存 | 保存动作本身就是第一次验签（GET `echostr`）——而 echostr 只依赖 Tier A | 保存失败：`Token` / `EncodingAESKey` 对不上 |

> 阶段一**不需要** `suite_id` / `suite_secret`：企微在「模版创建成功」后才下发它们，而 echostr
> 验证在创建期就能跑通（receiveid 校验在 suite 未下发时自动放宽，签名仍是唯一鉴权闸门）。

### 阶段二：拿 suite 凭据，再走 suite 流程

| 步 | 动作 | 为什么必须在这一步 | 错序的症状 |
|---|---|---|---|
| 3 | 模版创建成功后，从模版详情拿 **SuiteID / SuiteSecret**，填入 §2.1 的 **Tier B**，重启服务 | 否则 `suite_ticket` 推来时 `event.post` 因缺 suite 凭据 400，票据永远收不到 | 日志看不到 `wecom suite_ticket updated`；`/system/wecom` 生成链接报 503 |
| 4 | **等 `suite_ticket` 到手**（企微每 10 分钟推一次） | 换 `suite_access_token` 必须有票据，而票据只能由回调推来（登录流程要用） | 503 `suite_ticket 尚未收到：回调 URL 未打通或企微尚未推送` |
| 5 | 配好 §2.1 的 **Tier C**（`wecom_provider_id` / `wecom_provider_secret`，服务商后台「通用开发参数」页取），重启服务；再用超级管理员登录，进 `/system/wecom` → 「生成开通链接」 | 代开发的开通入口走 `get_customized_auth_url`（返回 `qrcode_url`），它只认 `provider_access_token`，而 provider_access_token 必须由服务商 corpid + provider_secret 换得（= Tier C）。**不是**第三方应用的 `get_pre_auth_code`（代开发调它会 48002） | 400 `config vars 缺少 wecom_provider_id / wecom_provider_secret`；或 502 `get_provider_token 失败`（provider_secret 错/重置）；或链接生成失败 |
| 6 | 把链接/二维码发给企业管理员，由其扫码/打开授权 | 只有企业管理员能授权；确认后企微推 `create_auth` | 企业侧没有应用；本站无该企业记录 |
| 7 | 进 `/system/settings` 打开「启用企业微信登录」 | `wecom.enabled` 默认 **关**，只是「发现登录方式」的开关 | 登录页根本看不到「企业微信」页签 |
| 8 | 企业员工从企微工作台/扫码/专属链接进入 | 首次登录自动建档 | 401 `登录凭据无效或不在应用可见范围内`（多半是可见范围没配） |

> 🔐 **进 `/system/wecom` 必须用 `superadmin` 账号，不是 `admin`。** 该页是跨租户的服务商
> 运营面（生成开通链接 = 调企微 `get_customized_auth_url` 换 `qrcode_url`、管理所有已授权企业），前端（`system/web/pages/wecom/index.tsx:61`
> 的 `roles.includes("superadmin")`）与后端 `auth/wecom/admin/*`（每个端点 `assertSuperAdmin()`）
> 都只放行 `superadmin`。模板 seed 已把 `admin` 从 `superadmin` 角色解绑（收敛为「账号名 = 角色名」，
> 见 `_platform/api/seed.sql` 的 `DELETE … WHERE role_name='superadmin' AND username='admin'`），
> 所以拿 `admin` 登录会直接显示「无权限」。请用 `superadmin` 登录（seed 口令 `aA123456`，
> **登录后立即改密**）；若坚持让 `admin` 也能进，由 `superadmin` 在 `/system/roles` 把 `admin`
> 绑到 `superadmin`，但不推荐——这会取消「日常管理员 vs 跨租户运营面」的隔离。

> **为什么第 4 步容易漏**：`suite_ticket` 是被推送的，不是拉取的。第一次部署时如果回调
> URL 保存得晚，就要等下一个 10 分钟周期。看到 503 不必怀疑代码——先确认回调真的通。
> **阶段二衔接的新坑**：若第 3 步的 suite 凭据还没填、企微就推来了 `suite_ticket`，那几条会被
> 400 拒掉（属预期），填好 Tier B 重启后下一个推送周期会自动补上，不必手动回放。

---

## 5. 用户手册（企业员工）

### 5.1 三个入口，随便哪个都行

| 入口 | 怎么用 | 适用 |
|---|---|---|
| A 企微客户端内 | 工作台里点该应用，或从会话里的应用消息进入 | 手机 / 桌面企微，**静默登录**，不弹授权页 |
| B 普通浏览器扫码 | 打开本站登录页 → 选「企业微信」→ 填企业代码（`ww` 开头的 corp_id）→ 扫码 | 首次在陌生电脑上用 |
| C 专属链接 | 管理员/HR 发来的链接，点开即落到你们企业 | 新人入职通知、内部公告 |

企业代码由管理员提供。**填错的表现**是 400 `企业代码无效或应用未开通`——不是你的问题，找管理员。

> 从专属链接（带 `?tenant=`）进入登录页时，「企业代码」输入框会**自动展开并预填**——
> 它决定你的账号落在哪家企业，不该看不见。要改用别家企业，清空它再登录即可；
> 留着旧值会让这次登录仍然算在那家企业名下。

### 5.2 不需要注册，也不需要设密码

- 第一次登录时系统**自动给你建账号**：用户名是 `wecom:<你的企微账号>`，显示名优先用企微里的姓名
  （取不到就用账号工号兜底）。
- 这个账号**没有本地密码**（口令位是占位符，任何密码都验不过），所以：
  - 不能用「账号 + 密码」在登录页登录；
  - 不能给它改密码来登录。
- 权限与角色仍由本站管理员分配，跟企微里的身份是两件事。

### 5.3 进不去时先看提示

| 提示 | 含义 | 你该做什么 |
|---|---|---|
| `账号已被停用，请联系管理员` | 本站把你的账号停用了（企微那边还有你） | 找本站管理员启用 |
| `登录凭据无效或不在应用可见范围内` | 你不在该应用的可见范围，或不是该企业成员 | 找企业管理员把你加进应用可见范围 |
| `登录状态已失效，请从企业微信重新进入` | 落地链接过期/被复用（票据 180 秒、一次） | 重新从入口进 |
| `授权未完成：企业微信未返回 code` | 授权页上点了取消 | 重新点一次并同意 |

### 5.4 换企业 / 换设备 / 退出

- 一个浏览器同一时间只归属**一个企业**（租户）。要切到另一家企业，直接用那家企业的入口登录。
- 退出后再次进入会**重新静默登录**，不需要输密码。
- 在企微客户端里换手机、换电脑后，从工作台进入即可，账号是同一个。

---

## 6. 开发手册（本工程开发者）

### 6.1 本地联调

企微只回调**公网 https**，所以本地必须内网穿透。最小闭环：

```sh
# 1) 八项 vars 填进工程根 config.yaml 的 vars:（见 §2.1，含 Tier C 的 provider 凭证）
#    其中 wecom_base_url 先写成穿透地址：https://<穿透域名>/api/auth/wecom
# 2) 起前后端
pnpm dev
# 3) 把本地 9778（后端）暴露成 https（任意内网穿透工具）
# 4) 企微后台 → 指令回调 URL 改成 https://<穿透域名>/api/auth/wecom/event，保存
# 5) 等一个推送周期（≤10 分钟）→ 进 /system/wecom 生成开通链接
```

三个常见坑：

- **回调 URL 是「一个模板一套」**：本地改了，生产那套就收不到 `suite_ticket`（30 分钟后过期）。
  正确做法是给开发/测试单独建一个代开发模板（另一套 SuiteID），而不是跟生产抢同一个。
- **匿名路径**：`/auth/wecom/{login,callback,ticket,event}` 必须同时出现在
  `config.yaml` 的 `auth.anonymous_paths` 与 `tenant.anonymous_paths` 里（模板工程已配好）。
  漏了会 401，而且报错看起来像「登录失败」，不像「未匿名」。
- **改了 `config.yaml` 必须重启**（`ojm dev` 不会热更配置），改前端 `src/**/web/**` 会自动重建。

### 6.2 加一家企业：不改配置、不重启

企业管理员确认授权 → 企微推 `create_auth` → 本站用 `auth_code` 换 `permanent_code` →
写 `wecom_app_profile`。**新增企业的唯一操作就是「发一条开通链接」**。

- 同一企业可以并行装**两个应用**（比如测试与正式各一个）：`wecom_app_profile` 主键含
  `agent_id`，天然两行。
- 这时登录链接**必须带 agent**，否则 400
  `该企业开通了多个应用，登录链接必须带 agent 参数`：
  `/auth/wecom/login?corp=ww…&agent=1000011`
- 开通链接支持环境标记：`state` 传 `env=test`（或 `test` / `staging` / `dev`）会落到
  profile 的 `env` 列，缺省 `prod`。同一套代码区分「测试企业」与「正式企业」就靠它。

### 6.3 数据面：三张共享表 + 五张租户表

| 表 | 是否租户表 | 存什么 | 为什么这样放 |
|---|---|---|---|
| `wecom_app_profile` | **共享**（`tenant: false`） | 企业 × 应用 → 密文 `permanent_code`、`corp_name`、`env`、`status`、`auth_mode` | 它是「corp → 租户」映射的**权威表**；登录前还没确定租户，必须是部署级 |
| `wecom_suite_ticket` | **共享** | 每个部署一条 `suite_ticket` + 过期时刻 | 套件凭据属于整个部署，不属于某个企业 |
| `wecom_login_ticket` | **共享** | 一次性登录票据的 **sha256** + 归属租户 + `used` | 落地换票发生在「已知租户但尚未建会话」的瞬间；只存哈希，泄库不可重放 |
| `wecom_sync_job` | **租户** | 同步任务的状态 / 阶段 / 游标 / 计数 / 脱敏错码 | 同步只在**调用方自己的租户**里跑（D7），跨租户读元数据要走显式 `tenant_id` 的裸 SQL |
| `wecom_sync_lock` | **租户** | 抢锁（`tenant_id + agent_id` 复合主键） | 同上；「插入撞主键」是唯一可靠的原子判据 |
| `sys_department` / `sys_dept_member` | **租户** | 部门树 / 部门成员（`origin` 标归属权） | 组织架构属于某个企业；`origin='wecom'` 的行归同步管 |
| `users` | **租户** | JIT 建的 `wecom:<userid>` 账号（`activated=0`） | 账号天然属于某个企业，`tenant_id = corp_id` |

三张共享表已列进 `config.yaml` 的 `tenant.shared_allow`。**不要**把它们改成租户表：
登录路径在 `ensureTenant` 之前就要读 profile，改成租户表会在守卫那里直接 403。
反之，两张同步表**不要**加进 `shared_allow`——它们存的是租户业务状态（进度、跳过计数），
共享化等于让所有企业的同步进度混在一张无人守卫的表里。

票据换会话的顺序是刚性的：**先绑租户，再抢票据（`used` 0→1 原子）**，然后才校验过期——
重放与并发双花都只会成功一次。

### 6.3.1 同步怎么跑：分片 + 轮询（不是后台长任务）

服务端 isolate **没有定时器**，路由也有超时（全局 `server.timeout` 缺省 30 秒），所以同步被切成
「一片一片推」：

```text
POST /auth/wecom/sync/start     一次 = 推一片（预算 12 秒）→ 返回当前进度
GET  /auth/wecom/sync/status    只读本地行，不打上游（页面 1~2 秒轮询一次）
POST /auth/wecom/sync/cancel    置 cancelled 并清游标；**不回滚**已写入的数据（同步幂等，重跑即覆盖）
```

- 三个阶段固定顺序：`departments`（拉全量部门，按父子序落库）→ `members`（逐部门拉人）→
  `reconcile`（墓碑回收）。游标存在 `wecom_sync_job.cursor_text`，**续跑就是再调一次 start**。
- 状态四态：`running`（还有下一片）/ `done` / `failed`（连续 10 次致命错熔断）/ `cancelled`。
  页面看到 `running` 就继续调 start，看到其余三个就停。
- **限速 10 次/分**（`orgsync:<uid>`）与「一片 12 秒」是配对的：串行驱动天然 5 次/分，
  10 次是不挡正常推进的余量。改一个必须看另一个。
- 抢锁：同一企业同一应用同时只允许一个同步，重复 start 会 409。

### 6.4 代开发后台（`/system/wecom`，仅超级管理员可见）

三件事，各对应一个端点（都在 `src/auth/api/wecom/admin/`）：

| 界面动作 | 端点 | 说明 |
|---|---|---|
| 已开通企业清单 | `GET /auth/wecom/admin/apps` | **不返回** `permanent_code`，最多到 `corp_name`；带 `auth_mode`（授权模式列） |
| 启用 / 停用某企业某应用 | `POST /auth/wecom/admin/status` | 停用是安全动作：**只在该企业没有其它 active 应用时**才吊销该租户会话 |
| 生成开通链接 | `GET /auth/wecom/admin/install` | 返回 `{installUrl, callbackUrl, expiresIn}`；`installUrl` 是代开发 `get_customized_auth_url` 返回的 `qrcode_url`（企业管理员扫/开即授权），`callbackUrl` 就是要逐字填进企微后台的那个值 |

> 清单里的「授权模式」列是**只读事实**：`成员授权` 意味着这家企业的应用做不了组织架构同步（§2.6）。
> 改模式只能由**企业管理员**在企微后台改，服务商这边没有接口能替他改。
> 同理，**跨租户手动触发同步**（superadmin 替某家企业点同步）目前**没有做**：它需要绕过租户守卫
> 并双写审计，属于后续排期；现在的同步入口只同步「调用方自己所在的那家企业」。

开通链接由企微 `get_customized_auth_url` 生成，**有效期以企微返回为准**（文档口径可达 10 天，实测可能较短），
过期后界面上的二维码会置灰，重新点一次即可（每次点都重新换 `provider_access_token` + 调
`get_customized_auth_url`，不做缓存）。代开发**不支持**第三方应用的 `get_pre_auth_code`——本接口
刻意走 `get_customized_auth_url`，踩过 48002 的坑。

权限是**超级管理员**而不是站点 admin：这三件事跨租户（能看别家企业的 corp_id）。

### 6.5 没有真实套件时怎么写测试

企微侧不可自动化（需要企业管理员点确认），但**登录后半程可以完全自动化**——
这也是本地与 CI 里的推荐做法：

1. 打开开关：`sys_setting` 里 `wecom.enabled = '1'`（默认 `0`）。
2. 造「企业已开通」：往 `wecom_app_profile` 插一行（`suite_id / corp_id / agent_id / env / status`）。
3. 造「票据」：自己生成一串随机串当 raw ticket，库里只存它的 sha256 到 `wecom_login_ticket`
   （带 `owner_tenant`、未使用、未过期）。
4. 造「员工」：往 `users` 插 `wecom:<userid>`（`source='wecom'`，口令位 `!wecom`）。
5. 前端直接落在 `/login?wecom_ticket=<raw>&tenant=<corp>` → 走换票 → 断言进入首页。
6. 造「组织架构 / 同步状态」（**不碰企微上游**）：`wecom_app_profile` 的 `auth_mode` 决定页面给哪张卡，
   `wecom_sync_job` 的一行决定状态条文案。两个都造就能覆盖「成员授权 / 已取消授权 / 从没同步过 /
   同步过且 N 个部门跳过」四种界面，全部可离线跑。仓库里 `tests/e2e/templates/wecom-org-sync.spec.ts`
   就是这么做的（5 例），要改文案先看它。

纯函数也值得单测：`src/login/web/wecom.ts` 的 `parseWecomLanding()` 与 `wecomAuthorizePath()`
（无 react / 无 request，node 侧可直接跑）；同步器的错码三分、分片、墓碑回收在
`packages/cli/templates/tests/wecom-org-sync.spec.ts`（23 例）与 `wecom-sync.spec.ts`（15 例）。

### 6.6 前端红线：整页跳转要拼 **API base**

授权入口是**后端端点**，不是前端路由：

```ts
// 对：API base（部署期可能是 /api，也可能是网关前缀）
window.location.assign(`${resolveApiBase()}${wecomAuthorizePath(corp)}`);
```

拼站点 base 是最隐蔽的错误：根部署下会得到 `/auth/wecom/login`，被 SPA 兜底页吞掉——
**页面原地重载、一个 auth 请求都不发**，控制台无报错。单元测试与类型检查都发现不了，
只有 e2e 或真机能发现。

同一口径适用于**每一个走整页跳转的后端端点**：SSO 的 `GET /auth/sso` 同样是后端端点，
也必须拼 `resolveApiBase()`。整页跳转只允许这一种拼法——多一种就多一处「点了没反应」的角落
（曾因一处拼 API base、一处拼站点 base，子路径部署下 SSO 按钮像是坏了）。

同理，企微面板里的「企业代码」输入框如果是受控值（`Form.Item` 没有 `name`），
必须显式写 `htmlFor` + `id`，否则标签只是视觉文本：读屏取不到，`getByLabel` 也取不到。

### 6.7 只能真机验的部分

- 扫码 / 企微内静默授权的真实跳转（浏览器 UA 分支、`snsapi_base` 行为）
- 可信域名备案与 https 回调
- `suite_ticket` 的真实推送节奏（10 分钟）
- 企业管理员确认授权的交互，以及「点了取消」时企微只回 `state` 不回 `code`
- 通讯录权限导致的兜底：拿不到姓名时显示名落回工号
- **四项权限的「三态」**（未申请 / 待企业确认 / 已生效）：企微没有开放查询接口，只能看症状——
  名字是工号 ⇒ 缺 ①；树节点无名 ⇒ 缺 ②；职务空 ⇒ 缺 ③；部门少 ⇒ 可能是 ④ 或可见范围窄。
  这几条**只能真机验**，单测里全部是桩。
- **`auth_mode` 的真实取值**：`get_permanent_code` 回包里 `auth_info.agent[].auth_mode` 的形态
  （是数组逐应用、还是回落到 `auth_info.auth_mode`）来自官方文档，本地只有桩；
  第一次真机开通后请确认后台清单里的「授权模式」与实际授权方式一致。

### 6.8 组织架构页：文案与降级卡片（企业管理员看的）

页面在 `/system/departments`，顶部**常驻**一条状态条（不是弹窗、不是只在出错时出现）。
文案刻意不暴露内部名词（分片 / 三轨 / 适配器）：

> 企微组织架构更新于 **X 分钟前** · 自动同步 · [立即同步]

四态与对应卡片，改文案前先确认这四条都还在：

| 事实 | 页面给什么 | 为什么 |
|---|---|---|
| 本站没装企微（无授权记录） | **整条不出现** | 纯 CRUD 站点不该看到企微的任何痕迹；「没装」不是错误，不画红叉 |
| `auth_mode=1`（成员授权） | 说明卡 + **不给同步按钮** | 点了必然是 400；不如直接说清怎么改 |
| `status=disabled`（取消授权/停用） | 冻结黄条 + 不给按钮，数据保留 | 「以下为最后一次同步的快照」 |
| 正常 | 「更新于 X · 自动同步 · [立即同步]」+ `N 个部门因权限被跳过` | 跳过是可解释的常态（可见范围外的部门），不是错误 |

失败时按错码给**自助卡片**（不是把 `errcode` 原文甩给人）：`60011`/`48002` → 去企微后台开通讯录权限；
`60020` → 找服务商运维加可信 IP；`45009`/`45033` → 已自动退避，稍后点「继续同步」；
`timeout`/`network` → 查服务器出网。**卡片里永远不出现异常原文**：`client.ts` 把 `access_token`
拼在 URL query 里，异常消息可能夹带凭证，落库前统一只存 `{errcode, phase, deptId, at}`。

同步一个企业大概要几次点击？正常规模（几十个部门）一次点击会在内部串行推完所有分片再停；
大企业中途会显示进度条。**离开页面即停**（前端不续推），回来点「继续同步」从游标接着走，不会从零重来。

---

## 7. 部署 / 运维手册（服务商侧）

### 7.1 上线前 checklist

- [ ] 服务商账号已认证，代开发应用模板已创建
- [ ] Tier A 四项已生成并填好（`wecom_callback_token` / `wecom_encoding_aes_key` 在企微后台同页自设；`wecom_enc_key` 见 §2.4 本地生成；`wecom_base_url` 为站点对外地址）
- [ ] 模版创建成功后拿到 **SuiteID / SuiteSecret**（Tier B），已填入配置并重启（详见 §4 阶段二）
- [ ] 站点已用 **https** 对外，反向代理放行 `POST /api/auth/wecom/event`（含原始 XML 请求体，不要改写）
- [ ] 可信域名已备案（含校验文件）
- [ ] 可信 IP 已列全所有出口 IP
- [ ] 服务器时间已 NTP 同步：回调只接受 ±5 分钟内的 `timestamp`，偏得多了**所有**指令都会被拒
- [ ] `wecom_enc_key` 已生成并**离线备份**（与数据库分开）
- [ ] 测试企业已准备好，且你自己是它的管理员
- [ ] 一个能登录本站的**超级管理员**账号（生成开通链接用）
- [ ] 部署后先跑 `oj migrate`：组织架构与同步需要 `0016__org`、`auth/0002__org_sync` 两组迁移
- [ ] 后台清单里「授权模式」是**管理员授权**（成员授权的企业同步不了，§2.6）
- [ ] 组织架构四项权限已核对（§2.5）；同步一次后页面**没有**「N 个部门因权限被跳过」以外的告警
- [ ] 同步结果抽查：树有名字、人挂在正确部门、主部门唯一（不是所有人都在「总公司」）

### 7.2 上线顺序

照 §4 的两阶段八步走。每步的验收点：

| 步 | 验收 |
|---|---|
| 1–2（阶段一） | 企微后台保存回调 URL 成功（说明 Tier A 的验签与解密都对——此时还没有 suite 凭据也照常通） |
| 3（阶段二） | 填好 Tier B 并重启成功 |
| 4 | 服务日志出现 `wecom suite_ticket updated` |
| 5 | `/system/wecom` 能出链接，且显示的回调地址与企微后台一致 |
| 6 | 列表出现该企业；日志出现 `wecom auth applied … agents=…` |
| 7 | 登录页出现「企业微信」页签 |
| 8 | 用一个**普通员工**账号登录成功（不要只用管理员自己的号） |

### 7.3 启停与解绑

| 动作 | 效果 |
|---|---|
| 后台「停用」某企业某应用 | 该行 `status=disabled`，企业 token 缓存作废；**仅当该企业没有其它 active 应用时**才吊销该租户全部会话 |
| 后台「启用」 | 恢复登录；不发会话（用户下次进入重新登录） |
| 企业在企微侧取消授权 | 收到 `cancel_auth` → 该 corp 全部应用置 `disabled` + 作废 token 缓存 + **清空该租户全部 refresh token** |
| 企业重新授权 | `create_auth` / `reset_permanent_code` 幂等 upsert，重写密文与状态 |

> 停用某企业**不会**删除它的账号与业务数据，只是拦住新登录并（在无其它应用时）断掉已有会话。
> 要「彻底下线」得另外清理该租户数据，属于业务决策，不在本连接器范围。

### 7.4 密钥与备份

- `permanent_code` 只以密文存在 `wecom_app_profile.permanent_code_enc`；
  任何接口（含后台清单）都不返回明文，日志里也不打。
- 备份必须是**两份**：`db.sqlite` + `wecom_enc_key`。只备份数据库 → 换机后全部企业要重授权。
- 轮换 `wecom_enc_key`：见 §2.4（新 key 只能写新数据，旧企业要重授权）。
- 重置 SuiteSecret（企微后台）会让当前的 `suite_access_token` 缓存失效 → 下一次调用自动重换；
  但**要同步改 `config.yaml`**，否则 40001。

### 7.5 留痕（审计日志里能看到）

| action | 触发 | 级别 |
|---|---|---|
| `wecom.auth.apply` | `create_auth` / `reset_permanent_code` | 普通 |
| `wecom.auth.cancel` | 企业取消授权 | 安全事件 |
| `wecom.admin.enable` / `wecom.admin.disable` | 后台启停 | 停用按安全事件记 |
| `wecom.org.sync` | 组织架构同步（每次 start 一片一条，带 status/phase/stats） | 普通 |
| `wecom.org.sync.cancel` | 取消同步 | 安全事件（级别 4：中断了一次全量覆盖） |

同步的审计落在**本租户**（同步只动自己那家企业的数据），所以企业管理员在自己的操作日志里
就能看到「谁在什么时候同步过、同步到哪一步、跳过了几个部门」。

---

## 8. 故障速查

按「看到的文案」查，快过按代码查。

| 现象 / 文案 | 病根 | 处置 |
|---|---|---|
| 400 `企业微信未配置：config vars 缺少 …` | `vars:` 有项为空 | 补 §2.1 对应项，重启 |
| 400 `wecom_base_url 必须以 /api/auth/wecom 结尾` | 只写了域名，或写了别的路径 | 改成 `https://<站点>/api/auth/wecom`（无尾斜杠） |
| 400 `wecom_enc_key 必须是 16 或 32 字节 …` | 随手敲的 32 字符被按 base64 解成 24 字节 | `openssl rand -hex 32` 重新生成 |
| 503 `suite_ticket 尚未收到：回调 URL 未打通或企微尚未推送` | 回调没通，或刚保存还没到推送周期 | 先验回调（§4 第 2 步），再等 ≤10 分钟 |
| 503 `suite_ticket 已过期：企微每 10 分钟推送一次` | 回调曾经通、后来断了（换域名/反代挡了 POST） | 修回调；企微重推三次也救不回来时，等下一周期 |
| 400 `回调 timestamp 超出允许窗口：请检查服务器时间，或该请求为历史回调的重放` | 服务器时钟与真实时间偏差超过 5 分钟，或这条回调是被人回放的旧报文 | 校服务器时间（NTP）；校正后企微的重推会自动成功 |
| 400 `回调 nonce 重复：同一条指令回调已被处理过（重放请求已拒绝）` | 同一条指令被投递了两次（企微重试、或反代重复转发） | 首次生效、重放被拒属预期保护；若常态出现，查反代是否重复转发 POST |
| 企微后台保存回调 URL 失败 | `Token` / `EncodingAESKey` 与 `config.yaml` 不一致 | 逐字对齐（43 字符别多空格） |
| 日志 `wecom callback decrypt failed … reason=pkcs7: bad padding` | 签名已经过了（说明后台 Token 与本部署一致），所以解不开只剩两种：**EncodingAESKey 与后台不一致**（后台点过「随机生成」、或抄错/抄多一个字符），或这条推送其实来自**另一个模板** | 看同一行日志的两个字段：`envelopeToUser` ≠ `configuredSuite` → 回调地址填在了别的模板上，去「应用与模板上线」核对；两者相同 → 从「模板详情 → 回调配置」重抄 43 字符到 `vars.wecom_encoding_aes_key`，**重启生效**，再回后台点一次「保存」触发 echostr 验证（页面会当场报验证失败）。`aesKeyFp` 没变 = 新配置没生效（没重启 / 改的不是运行中那份 config） |
| 企业管理员扫码/打开开通链接后提示「**应用安装失败，联系服务商**」 | 企微推 `create_auth` 后**约 1 秒内**没拿到纯文本 `success`（它只看 body 是不是 `success`，不看 HTTP 200）。三类原因：① 事件没到（指令回调 URL 不是当前地址 / 改过没重新上线）；② 处理里同步出网超预算（`get_suite_token` + `get_permanent_code` 是两次往返）；③ 处理过程抛错（如审计表在租户守卫下被拒） | 先翻服务日志：有 `wecom event failed … reason=<文案>` → 按文案修（缺配置/验签/解密各自有明确文案）；**一条日志都没有** → 事件根本没到，回 §4 第 2 步验回调，并到「应用与模板上线」核对指令回调 URL 是否就是当前地址。若后台清单里**已有该企业且 status=active** → 授权其实成功了（失败发生在 profile 落库之后），让企业管理员再扫一次即可 |
| 400 `企业代码无效或应用未开通` | corp_id 打错，或该企业没装本应用 | 核对 corp_id（`ww` 开头）；确认已在后台清单里 |
| 400 `该企业开通了多个应用，登录链接必须带 agent 参数` | 同企业装了测试+正式两个应用 | 链接加 `&agent=<agentid>` |
| 401 `登录凭据无效或不在应用可见范围内` | code 无效 / 员工不在应用可见范围 / 非本企业成员 | 企微后台检查应用可见范围 |
| 400 `本站尚未开通企业微信：没有可同步的授权记录` | 该租户在 `wecom_app_profile` 里没有行（这会出现在组织架构页的同步入口，不是登录） | 先走开沟通道（§4）；单租户部署下「租户」= 企业代码 |
| 400 `该企业为「成员授权」模式，应用没有通讯录权限 …` | `auth_mode=1`（§2.6），此时任何通讯录接口都是 `60011` | **企业管理员**在企微后台把授权模式改为「管理员授权」；企微会推 `change_auth`，本系统自动刷新 `auth_mode`，无需重新开通 |
| 400 `该企业已取消授权或应用已停用：组织架构同步已冻结 …` | `status=disabled`（企业取消授权，或后台点了停用） | 服务商重新发开通链接；已同步的组织数据保留，可当快照用 |
| 组织架构页卡片「应用缺少通讯录权限（错误码 60011 / 48002）」 | 缺 §2.5 的 ①/②/④（自定义权限还卡在「待企业确认」也会这样） | 企业管理员：企微后台 → 应用管理 → 本应用 → 权限，勾选后提交，并**在企微里确认**那条权限变更消息 |
| 卡片「企微接口限流（错误码 45009 / 45033）」 | 触发企微频率/并发限制（大企业全量同步常见） | 已自动退避三次；仍失败就点「继续同步」，游标停在原部门，不会丢进度 |
| 卡片「服务器出口 IP 不在企微白名单（60020）」 | 同上方 60020 行 | 同上方处置（加可信 IP） |
| 状态条「N 个部门因权限被跳过」 | 这些部门在应用**可见范围外**（或负责人/父部门权限缺失） | 常态可忽略；若 N 与总部门数接近，先查 §2.5 ④ 与可见范围（§2.4 的话术可以直接发给企业管理员） |
| 409 `同步正在进行，请稍后再试` | 同一企业同一应用已有同步在跑（另一个标签页 / 上一次请求崩了留下锁） | 等一次轮询周期再点；崩溃残留的锁 120 秒后可被抢占，不用人工清 |
| 429 `rate limited` | `start`/`cancel` 限速 10 次/分（同一账号在两个页面同时驱动，或手动连点） | 等一分钟再点；进度已落库，不需要从头重来 |
| 点「立即同步」后按钮立刻回到可点、进度没动 | 这一片被限流或上游抖动提前收手（状态仍是 `running`） | 正常现象：再点「继续同步」；页面每 2 秒会自己刷新状态 |
| 403 `账号已被停用，请联系管理员` | 本站把该账号 `is_forbidden=1` | 后台启用该账号 |
| 401 `登录票据无效或已使用` / `登录票据已过期，请重新登录` | 票据被重放，或 180 秒没换 | 重新从入口进 |
| 400 `授权未完成：企业微信未返回 code` | 用户在授权页点了取消 | 重新授权 |
| 400 `登录状态已失效，请从企业微信重新进入` | `state` 过期（10 分钟）/ 已用 / 换过部署 | 重新进；跨部署时正常现象 |
| 502 `企微 … 失败：errcode=60020 … client ip 113.80.7.113` | 调用企微 API 的**服务器出口公网 IP**未在可信 IP 白名单（代开发套件级/服务商级；`get_suite_token` 与「生成开通链接」用的 `get_provider_token` / `get_customized_auth_url` **都必校**） | 企微服务商后台 → 应用管理 → 代开发应用 → 对应套件 → **IP 白名单/可信IP**，把报错里的 `client ip`（例 `113.80.7.113`，即你服务器访问公网的出口 IP，**不是内网 IP**）加进去；多出口/运营商 NAT 就加整段 CIDR。改完等几分钟再点「生成开通链接」。注：此码**不在自动重试验证集**（只有 40001/42001 重换一次），属配置阻断、重试无用 |
| 502 `企微 … 失败：errcode=48002 api forbidden` | 代开发应用调了第三方应用的 `get_pre_auth_code`（代开发**明确不支持**该接口） | 本系统「生成开通链接」已改用代开发专属的 `get_customized_auth_url`（返回 `qrcode_url`）。若仍见此码：确认跑的是本版代码（`admin.ts` 的 `createInstall` 不再调 `get_pre_auth_code`），并检查是否别处/旧版本在调它 |
| 502 `企微 … 失败：errcode=40058 state missing` | `get_customized_auth_url` 的 `state` 必填，本系统没传/传空（旧版） | 已改为始终发送 `state`（调用方不传则补默认常量）。若仍见此码：确认跑的是本版代码（`client.ts` 的 `customizedAuthUrl` 始终带 `state`） |
| 502 `企微 … 失败：errcode=842002 代开发模板尚未上架/上线` | 传入的代开发模板（`templateid_list` 里的 suite_id）只是「创建成功」但**未上线**——`get_customized_auth_url` 只在模板正式上线后才生成 `qrcode_url` | **运营动作，非代码缺陷**：服务商后台 → 应用管理 → 代开发应用上线 → 提交模板上线审核 → 审核通过后手动点「提交上线」。模板状态变「已上线/上架」后再点「生成开通链接」。凭证/参数都对却卡这步，就是模板没上线（创建成功 ≠ 上线） |
| 502 `企微 … 失败：errcode=40001/40014/42001` | 凭据错或 token 过期（会自动重换一次） | 若持续：核对 SuiteSecret / 是否重置过 |
| 502 `企微接口不可达` / `HTTP 5xx` | 出网被墙、DNS、代理 | 查机器出网与 DNS |
| 点登录页「企业微信」按钮页面只闪一下、无请求 | 跳转拼了站点 base 而不是 API base | 见 §6.6 |
| 登录回跳落到 404 或别的应用 | `wecom_base_url` 的站点前缀与实际部署不一致 | 用 `/system/wecom` 显示的回调地址反推 |
| 登录页没有「企业微信」页签 | `wecom.enabled` 未开 | `/system/settings` 打开 |
| 后台清单为空但企业说已授权 | `create_auth` 回调没收到（回调地址/验签） | 查服务日志有无 `wecom auth applied`；让企业重新授权一次 |

---

## 9. 一分钟自检

```text
[ ] 八个 vars 非空（Tier A/B/C），wecom_base_url 以 /api/auth/wecom 结尾
[ ] 企微后台的指令回调 URL == <wecom_base_url>/event（逐字）
[ ] 服务日志有 wecom suite_ticket updated（近期）
[ ] /system/wecom 列表里有目标企业，status=active，授权模式=管理员授权
[ ] /system/settings 的「启用企业微信登录」= 开
[ ] 用普通员工账号（非管理员）完整走过一次登录
[ ] /system/departments 顶部状态条有「更新于 X」；树有名字、人挂在正确部门
[ ] db.sqlite 与 wecom_enc_key 各自有备份
```
