---
title: 多企业专属登录链接运维清单
audience: 平台运维 / 服务商运营 / 企业管理员
---

# 多企业专属登录链接运维清单

> 适用：**一套部署服务 N 家企业**（代开发模板），每家企业用自己的专属链接进入。
> 本方案**不需要业务工程改代码**：所有动作都在企微后台与本站管理面完成；
> 宿主早跳透传 `corp` / `agent` 的修复在框架侧（`@oj-module/cli` 的 shell，见 §0）。
> 所有 URL / 参数按本表逐字填，不要 URL 编码、不要加空格。
>
> 当前部署基线（下称 `<站点>` = `https://exp.wiz.top`）：
> 模板回调 `<站点>/api/auth/wecom/event`，授权回调域与可信域名均为 `exp.wiz.top`，
> `wecom_base_url = <站点>/api/auth/wecom`，网页授权 `redirect_uri = <站点>/api/auth/wecom/callback`（后端自动派生，不用手填）。

---

## 0. 先读：能做什么

| 入口 | 是否可用 | 行为 |
|---|---|---|
| 外部浏览器 / 企微会话消息 / 邮件 / 公告里的**专属链接** | ✅ 完整可用（实测） | 点开自动跳**该企业**的 `qrConnect` 扫码页 → 企微 App 扫码 → 回跳换票 → 首页 |
| 登录页「其他企业」折叠里手填企业代码 | ✅ 可用 | 等价于专属链接，适合链接丢失时兜底 |
| 企微工作台**应用主页** | ✅ 可用（需含修复版 shell 的 cli） | 宿主 P0 早跳把 `?corp=` / `?agent=` 白名单透传到 `/auth/wecom/login`；每家企业把应用主页填成自己的专属链接即可，企微内静默授权、零点击 |

因此：**每家企业发一条专属链接**，员工从专属链接进入，企微工作台应用主页也填各自的专属链接。

> 宿主早跳此前会丢掉 `?corp=`（只服务本企业），已修复：
> `packages/cli/shell/scripts/build.mts` 的 BOOT_JS 与 `shell/src/host.tsx` 的 P0 早跳
> 均按白名单 `corp` / `agent` 透传，票据 / `redirect` / `error` 一律不带。
> **部署侧必须重新构建 cli 的 shell-dist 并 `ojm build`**；仍用旧版 cli 的话，
> 外企业员工从工作台进入会被 `corpSelf()` 吸到本企业（或报「已授权多家企业」）。

> 为什么能一套部署服务多家：`wecom_app_profile` 主键含 `(corp_id, agent_id, suite_id)`，
> 每家企业授权后由 `create_auth` 自动落行；租户键 = `corp_id`，回跳 URL 带 `tenant`，
> 数据按租户列隔离；JIT 建档用户名 `wecom:<userid>`，跨企业不冲突。
> `qrConnect` 的 `appid` / `agentid` 是按 `corp` 从档案表查出来的，**不是写死**——
> 带 `?corp=A` 就跳 A 企业的授权页，带不存在的 `corp` 直接 400。

---

## 1. 前置检查（一次性，平台侧）

| # | 项 | 期望值 / 检查方法 | 不通过的后果 |
|---|---|---|---|
| 1 | 代开发模板凭据 | `config.yaml` 的 `wecom_suite_id` / `wecom_suite_secret` / `wecom_callback_token` / `wecom_encoding_aes_key` / `wecom_enc_key` / `wecom_base_url` / `wecom_provider_id` / `wecom_provider_secret` 八项齐 | 服务起不来或换不出套件 token |
| 2 | 模板**指令回调 URL** | 服务商后台 → 模板 → 回调 URL：`<站点>/api/auth/wecom/event`（逐字；保存时企微会 GET 一次带 `echostr`，必须当次通过） | `suite_ticket` 收不到 → 后续所有授权全断 |
| 3 | 模板**可信域名** | `exp.wiz.top`（纯域名），按企微要求上传校验文件到域名根路径 | 授权页报 `redirect_uri 需使用应用可信域名` |
| 4 | 模板**授权完成回调域名**（有的版本叫「授权回调域」） | `exp.wiz.top` —— **纯域名，不带 `https://`、不带路径、不带端口、不带尾斜杠** | 外部浏览器扫码报 `redirect_uri 与配置的授权完成回调域名不一致` |
| 5 | 组织架构四项权限 + 成员授权模式 | 见 `wecom-daikaifa.md` §2.5 / §2.6 | 通讯录同步 `60011` / `48002` |
| 6 | 登录方式开关 | `/system/settings` → 启用企业微信登录；`curl <站点>/api/system/login-methods` 返回含 `wecom` | 登录页看不到「企业微信」页签 |
| 7 | 运营账号 | 能登 `/system/wecom` 的 **`superadmin`**（注意 `admin` 不是 superadmin） | 生成不了开通链接 |

> 第 3、4 项是**两处独立配置**：可信域名给企微客户端内的 `snsapi_base` 静默授权用，
> 授权完成回调域名给外部浏览器的 `qrConnect` 扫码用。工作台能登录只说明前者已配好。
> 用**自建应用**接 N 家企业时这两项要每家各配一遍；走**代开发模板**只需在模板上配一次，
> 所有企业共用——这正是多企业必须走代开发的原因（`wecom-internal-app.md` §1.1）。

---

## 2. 每家企业接入（逐家执行）

1. `superadmin` 登 `<站点>/system/wecom` → 代开发卡片 → 点「**生成开通链接**」
   （每次点都重新向企微换，链接有效期以企微返回为准，不要缓存；可选 `state=prod` 指定环境标签）。
2. 把链接 / 二维码发给**该企业管理员**（只有企业管理员能授权）。
3. 管理员扫码或打开链接完成授权 → 企微推 `create_auth` → 本站自动完成：
   - 按 `agentIds` 逐个写 `wecom_app_profile`（**同一企业多个应用各一行**）；
   - 建租户（键 = `corp_id`）；
   - 建该租户管理员 `admin`（`provisionTenantAdmin`，尽力而为，失败可补）。
4. 回到 `/system/wecom` 清单确认该企业出现、`status=active`，**记下 `corp_id` 与 `agent_id`**。
   - `corp_id` 是 `ww` 开头的**真实企业 ID**；不要抄成企微后台的 `open_corpid`。
   - 从清单页复制，不要凭记忆手打；也可查库 `select corp_id, agent_id from wecom_app_profile where status='active'`。
5. 同页「**重设租户管理员口令**」给该企业设初始口令（落库只有 bcrypt，置 `must_change=1`，首次登录必须改）。
   把「**企业代码 + 初始口令**」交给该企业管理员。
6. 按 §3 生成专属链接，发给该企业（公告 / 入职通知 / 会话消息 / 应用主页均可，但见 §0 边界）。

> 新增企业**不需要改配置、不需要重启**。停用企业在清单里点「停用」，会级联吊销该租户会话。

---

## 3. 生成专属链接

```
<站点>/login?corp=<corp_id>&agent=<agent_id>
```

示例（本企业自建应用）：

```
https://exp.wiz.top/login?corp=wwd2d00dedd5c84818&agent=1000051
```

| 参数 | 必填 | 从哪来 | 说明 |
|---|---|---|---|
| `corp` | **是** | `/system/wecom` 清单的 `corp_id` | 决定落在哪个租户、`qrConnect` 的 `appid` 用谁。填错 → `400 企业代码无效或应用未开通` |
| `agent` | **建议必填** | 同清单的 `agent_id` | 同企业装了多个应用时，不填会 `400 该企业开通了多个应用，登录链接必须带 agent 参数` |
| `redirect` | 否 | 站内路径 | 登录后跳到指定页；只放行 `/` 开头，拒绝 `//` 协议相对地址，非法值回落首页 |
| `tenant` | **不要填** | — | 由服务端 302 回跳时带，前端据此注入 `X-TENANT-ID`；手填会与票据租户冲突 |

三条红线：

- 链接里**只放 `corp` / `agent`**，绝不放 `access_token`、`wecom_ticket` 或任何票据。
  一次性票据由后端 302 生成、180 秒有效、单次消费，用完即废。
- `corp` 不是机密（企业代码本就公开），但**别把 A 企业的链接发给 B 企业**——登录会落进 A 的租户。
- 逐字填写，不要 URL 编码、不要加空格、不要带尾斜杠。

---

## 4. 员工入口

| 入口 | 位置 / 链接 | 行为 |
|---|---|---|
| A 专属链接 | §3 的链接 | 自动发起授权：外部浏览器 → 企微 `qrConnect` 扫码页；企微内 → `snsapi_base` 静默。扫码 / 静默后回跳换票 → 首页 |
| B 登录页手填 | `<站点>/login` → 「企业微信」页签 →「其他企业？使用企业代码登录」 | 填 `corp` / `agent` 后跳；链接丢失时兜底 |
| C 不带参数的一键按钮 | `<站点>/login` 默认「使用企业微信一键登录」 | **只应给本企业用**：不带 `corp` 时后端 `corpSelf()` 从 `wecom_corp_*` 锁定本企业 |
| D 企微工作台应用主页 | 每家填自己的专属链接（§3） | 企微内 `snsapi_base` 静默授权、零点击；宿主早跳透传 `corp` / `agent` 落到正确企业 |

> 扫码那一步是企微在外部浏览器确认身份的动作，省不掉；本方案省的是「输账号密码 / 填企业代码 / 选页签」。
> 企微工作台内本来就是零点击静默，见 §0 边界。

---

## 5. 验收（每家企业逐项打勾）

- [ ] `/system/wecom` 清单出现该企业，`status=active`，`corp_id` / `agent_id` 已记录
- [ ] 拼链接自检（把 `<corp>` / `<agent>` 换成实际值）：
      `curl -s -D - -o /dev/null '<站点>/api/auth/wecom/login?corp=<corp>&agent=<agent>' -A 'Mozilla/5.0 Chrome/130'`
      → `302` 的 `location` 里 `appid=<该企业 corp_id>`、`agentid=<agent>`、
      `redirect_uri` 指向 `<站点>/api/auth/wecom/callback`
- [ ] 外部浏览器打开专属链接 → 出现「请使用企业微信扫描二维码登录 <企业名>」，
      **不是** `redirect_uri 与配置的授权完成回调域名不一致`
- [ ] 企微 App 扫码确认 → 落到 `<站点>/home`，地址栏里 **没有** `wecom_ticket`
- [ ] 该企业 `admin` 用初始口令登录 → 强制改密 → 能进管理面，看不到别家企业的数据
- [ ] `GET <站点>/api/system/login-methods` 返回含 `wecom`

---

## 6. 故障速查

| 现象 / 文案 | 原因 | 处理 |
|---|---|---|
| `redirect_uri 与配置的授权完成回调域名不一致` | 模板「授权完成回调域名」没填 `exp.wiz.top`，或填成了完整 URL / 带路径 | 改成纯域名，等几分钟生效（§1 第 4 项） |
| `redirect_uri 需使用应用可信域名` | 模板可信域名未备案 / 校验文件没传 | §1 第 3 项 |
| `企业代码无效或应用未开通` | `corp` / `agent` 抄错，或 `create_auth` 没落库 | 从 `/system/wecom` 复制；查日志 `wecom.auth.apply` |
| `该企业开通了多个应用，登录链接必须带 agent 参数` | 该企业多个应用，链接没带 `agent` | 补 `agent`（§3） |
| `已授权多家企业，请在登录链接带 corp 参数以区分` | 链接丢了 `corp`（旧版 cli 的企微内早跳会丢；修复版已透传） | 用 §3 完整链接；若从工作台进仍复现，确认 cli 的 shell-dist 已含修复并重新 `ojm build` |
| `应用安装失败，联系服务商` | `create_auth` 回调 1 秒窗口超时 | 看服务端日志；重推幂等已处理，已落库的档案不会重复 |
| `errcode=60020 not allow to access from your ip` | 企业可信 IP 没列全出口 IP | 模板 / 应用后台补齐所有出口 IP |
| `errcode=60011` / `48002` | 可见范围、四项权限或成员授权模式 | `wecom-daikaifa.md` §2.5 / §2.6 |
| `登录凭据无效或不在应用可见范围内` | 该员工不在应用可见范围 | 把应用可见范围设为全公司 |
| `40001` / `42001` gettoken 失败 | 应用 Secret 轮换过 | 重新授权，或重置后重新「验证并接入」 |

---

## 7. 日常运维

- **加企业**：重复 §2，零配置变更、零重启。
- **停企业**：清单里点「停用」→ 级联吊销会话；`cancel_auth` 事件也会停用 + 吊销。
- **换 Secret / 重置租户管理员口令**：`/system/wecom` 同页操作；重置会置 `must_change=1` 并吊销旧会话。
- **租户与数据**：租户键就是 `corp_id`，所有运行时路径按它隔离；同一企业多个应用共用一个租户管理员。
- **相关文档**：`wecom-daikaifa.md`（凭据清单、首次开通顺序、三角色手册）、
  `wecom-internal-app.md`（自建应用与共存、三项备案）。
