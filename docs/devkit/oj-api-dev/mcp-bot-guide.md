# MCP 机器人对接指导手册（IM bot / agent 接入，v0.1.130）

> 何时读我：要给企业微信 / 钉钉 / 飞书类 IM 机器人（或任何「一台机器代表多名员工
> 调 oj」的 agent）接 oj 工具面，从零走到上线。
>
> 分工：本手册是**任务导向的端到端路线图**；API 契约权威在
> `api-manual.md` §14（MCP 与机器人凭据小节）；可照抄的端到端配方在
> `scenarios.md` 场景 75；agent 工作流陷阱速查在 `SKILL.md`。骨架源码
> `sample/src/bot/wecom/api.ts`。

## 1. 总览：一次调用的完整链路

```
员工 @机器人
   │ ① IM 回调（POST bot 路由，5s 内须 ack）
   ▼
机器人模块（如 bot/wecom）
   │ ② MsgId 去重（kv.incr，防 IM 重推）
   │ ③ obo 换签：svc token + 员工标识 → 员工受托 token（10min）
   │    POST /v1/api/auth/obo
   ▼
{base}/mcp（JSON-RPC）
   │ ④ tools/call：受托 token 调工具——权限服务端收口
   │    （三档 scopes 按【员工 roles】判；act 会话拒 delete）
   ▼
⑤ 中文模板回复（IM sendMessage 主动推送）
```

两条不变式，全链通用：

- **机器人凭据不放大权限**：svc token 只用于换签；真正干活的受托 token
  按**员工本人 roles** 生效（"够用，最终以员工本身的权限为准"）。
- **客户端不判权限**：三档 scopes / jti 吊销 / act 遮蔽全部在服务端 admit
  单点判定，对 `/mcp`、`/rpc`、直连 REST 三面同规则。客户端解析 403 文案
  只为提示话术，不是权限逻辑。

## 2. 选型：线路 B（`{base}/mcp`），不是线路 A

| 场景 | 用哪条 |
|---|---|
| 多员工代操作机器人（obo 换签、按人授权） | **线路 B**——`server.mcp.enabled: true`，受托 token 逐请求携带 |
| 单人开发者 agent（Claude/Cursor 直连自己的 token） | 线路 A（`oj mcp` 生成 stdio server）或线路 B 均可 |

线路 A 的 stdio server 用固定 `OJ_TOKEN` env，**没有逐请求换凭据的能力**，
不适合多员工机器人。路由变更时线路 B 自动跟随活路由表（无需重跑生成器）。

## 3. 运营开通清单（一次性）

### 3.1 config.yaml

```yaml
server:
  mcp:
    enabled: true
    modules: [user, news, order]  # 模块白名单（fail-closed）：admin/运营面绝不进机器目录
    act_mask_destructive: true    # 代操作遮蔽（推荐开启）：act 会话拒 delete 且隐藏 destructive tool
```

`enabled` 而无 auth 插件且未写 `allow_anonymous: true` → 拒启（fail-fast）。
生产必配 auth——机器人走 Bearer，不需要 `allow_anonymous`。

### 3.2 签发机器人凭据（明文只此一次）

```bash
curl -s -X POST {base}/v1/api/admin/service-token/ \
  -H "authorization: Bearer <admin-jwt>" -H 'content-type: application/json' \
  -d '{"name":"wecom-bot","scopes":["read","write"]}'
# → {"code":0,"data":{"token":"<明文>","jti":"…"}}
```

- **明文 token 仅此一次**（落库只存 jti）——立即转存密管/vars。
- `scopes` 按机器人职责给档：纯查询 `["read"]`；要办事加 `"write"`；
  **永远不给 `"destructive"`**（配了 `act_mask_destructive` 后代操作也删不了）。
- scopes 只约束机器人**直连**工具/路由的动词档位；**不约束换签面**
  （换签产物按员工 roles 生效）。

### 3.3 员工绑定（provider + external_sub ↔ oj 用户 id）

```bash
curl -s -X POST {base}/v1/api/admin/bot-binding/ \
  -H "authorization: Bearer <admin-jwt>" -H 'content-type: application/json' \
  -d '{"provider":"wecom","external_sub":"zhang","user_id":2}'
```

批量导入走 `POST /admin/bot-binding/import`（CSV）；查询/导出/删除见
api-manual §14「svc 凭据与 jti 吊销」。

### 3.4 凭据注入机器人

骨架经 `vars`（部署期常量）读取：`vars.get("WECOM_BOT_SVC_TOKEN")`。
真实接入建议存 kv 并定期轮换（轮换 = 签发新 token + 吊销旧 jti，见 §7）。

## 4. 凭据模型速览（判 403 时心里有数）

三档动词映射（服务端判定，`missing scope: <tier>` 是唯一权威信号）：

| 档位 | 动词 | 备注 |
|---|---|---|
| `read` | GET | 只读面 |
| `write` | POST / PUT / PATCH | **POST 一律按 write 判**（含按 POST 发查询的 admin 惯例路由） |
| `destructive` | DELETE / DEL | 破坏面 |

语义细则（fail-closed）：scopes **缺席** = 全量随 roles（旧 token 零破坏）；
present-but-empty `[]` = 全拒；显式 `null` = 全拒；未知档名 = 拒。

**jti 吊销**：svc 凭据逐请求核销 `oj_svc_token` 表（30s TTL 缓存）——
签发后最长 30s 才可过门；吊销后最长 30s 全网失效；查库失败/无行恒拒。

**POST-as-query 的两条正路**：查询类业务路由改 GET + query 参数（首选）；
或该机器人签发时纳入 `write` 档。不要在客户端绕。

**`/ws`（WebSocket 升级）不经 scopes/jti/act_mask 门**——机器人集成不涉及
WS；浏览器 WS 匿名入口是另一回事（api-manual §8）。

## 5. obo 换签（机器人的核心动作）

```ts
const r = await fetch(`${OJ_ORIGIN}/v1/api/auth/obo`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${svcToken}` },
  body: JSON.stringify({ provider: "wecom", external_sub: userid }),
});
const v = await r.json();
// 成功 → v.data.access_token（10min 受托 token，claims.act.sub 指回 svc 名）
```

错误码契约（信封 `code`，HTTP 500）与分流话术：

| code | 场景 | 机器人话术 |
|---|---|---|
| 40310 | 绑定缺失 | "未绑定，请联系管理员完成账号绑定" |
| 40311 | svc 凭据已吊销（jti 不在册） | 静默 + **告警运营** |
| 40312 | 非 svc 凭据（普通员工 token 打到 obo；或 roles 不含 bot——双查纵深） | 静默 + **告警运营**（凭据配置错） |
| 40313 | 员工已停用 | "账号已停用，请联系管理员" |

换签纪律：

- 受托 token 只有 **10 分钟**——**不要预缓存**；401 才重换签，**限一次**，
  仍 401 告警（可能凭据被吊销）。
- svc token 的 claims.svc 缺失 / roles 不含 bot 都会在服务端被拒（40312）——
  手签测试 token 时记得带全 `{svc, jti, scopes}` 且 roles 含 `"bot"`。

## 6. 调工具（tools/call）

```ts
const r = await fetch(`${OJ_ORIGIN}/v1/api/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json",
             authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call",
    params: { name: "user_account_get", arguments: { query: { id: "1" } } } }),
});
```

要点（契约细节见 api-manual §14 线路 B）：

- **必须** `Accept: application/json`（`*/*` → 406）。
- `arguments` 与公布的 inputSchema 同构：顶层三键 `path` / `query` / `body`。
- 结果映射：信封 `code==0` → `result.content[0].text` + `structuredContent`；
  业务错 → `isError: true`，text 带 **`[code=<n>] <msg>` 冻结前缀**（HTTP 200，
  不是 JSON-RPC error）——agent 侧用正则 `^\[code=(\d+)\] ` 程序化解析。
- 未知 tool → JSON-RPC error `-32601`；被 scopes 裁掉的 tool 直呼 → 403
  （不是 -32601——调用面不裁）。
- `tools/list` 按 token 的 scopes 裁剪展示面：read 档不见写 tool、act 会话
  不见 destructive tool——**名单因人而异，勿跨会话缓存**。

## 7. 运维手册

| 动作 | 操作 |
|---|---|
| 轮换凭据 | 签发新 token（新 jti）→ 机器人切流 → `DELETE /v1/api/admin/service-token/{旧jti}` |
| 紧急止血 | 直接 DELETE 旧 jti——最长 30s 全网失效（TTL 设计内） |
| 审计换签 | `GET /v1/api/admin/obo-audit/`（分页）/ `/export`（CSV）：svc、provider、user_id、reason、成败 |
| 绑定维护 | `bot-binding` CRUD + CSV import/export |
| 指标口径 | description 覆盖率（openapi 产物统计）/ obo 日换签数（`oj_obo_audit` ok=1 按天）/ 绑定缺失占比（reason='unbound'）/ scope 拒绝分布（日志 `missing scope: <tier>` 三桶）——详见场景 75 指标表 |

## 8. 上线检查单

- [ ] config：`mcp.enabled` + `modules` 白名单 + `act_mask_destructive: true`
- [ ] svc token 已签发，明文进密管/vars，scopes 最小档位（无 destructive）
- [ ] 员工绑定表已灌（import CSV），抽查一条能换签
- [ ] 机器人：MsgId 去重 + 5s ack（重活搬 tasks 池）+ 4031x 四码分流话术
- [ ] 401 → 重换签一次的纪律已实现（不预缓存受托 token）
- [ ] isError `[code=<n>] ` 前缀解析已实现（不解析 HTTP 状态码判业务错）
- [ ] 吊销演练：DELETE jti 后 ≤30s 机器人换签得 40311 并告警
- [ ] 首条消息知情话术："本机器人将以你的权限执行操作并留痕"

## 9. 常见坑速查（展开见 SKILL.md / 场景 75 坑表）

| 坑 | 解 |
|---|---|
| 客户端解码 scopes 自判权限 | 不要——服务端 admit 是唯一权威；白维护两份逻辑 |
| 受托 token 缓存进 kv 长期复用 | 只有 10min；401 才重换签（限一次） |
| tools/list 名单缓存复用 | 展示面按 token scopes 裁剪，因人而异；实时拉或按需直呼 |
| 给机器人签 destructive 档 | 破坏面只留给人；自动清理走服务端 tasks 池（无 act，走系统身份+审计） |
| 回调同步处理超 5s | 重活搬 tasks 池异步 + sendMessage 主动推送；去重兜住 IM 重推 |
| 用线路 A stdio server 做多员工机器人 | OJ_TOKEN 固定，无逐请求换签能力——用线路 B |
| 空串 Bearer 头（`"Bearer "`） | 会被守卫当坏 token 拒；匿名场景干脆不带头 |
| 换签产物权限按 svc scopes 预期 | svc scopes 不约束换签面；受托 token 按**员工 roles** 生效 |
