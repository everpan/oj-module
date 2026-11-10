# MCP 服务管理（基础管理 · 方案工具目录面）

- 日期：2026-11-10 10:27（v2 评审修订：2026-11-10）
- 状态：五方专家评审通过（0 blocker），待批准开工
- 分支：`feat/mcp-service-management`（自 `feat/ojm` 拉出，完成后并入）
- 关联：上游 `oj-bin` v0.1.110+（MCP 双线路）；`docs/devkit/oj-api-dev/api-manual.md` §14

## 0. 价值主张与成功判据

本页 = **agent 接入运营面 + MCP 暴露面安全收敛器**：站点管理员由此看清「哪些工具对
agent 暴露、谁在调用」，方案装卸零手工配置步骤。

成功判据（SMART）：
1. 带 api 的方案安装完成后，**零手工步骤**出现在 MCP 目录（R3' 前凭据除外）；
2. 管理页一眼完成「已装方案 vs 可见工具」对账，漂移可见且可解释；
3. 接入配置复制后，主流 client（Claude Code/Cursor）按文档实配即可连通。

## 1. 需求背景

站点方案模块动态安装/升级。上游 oj 引擎（v0.1.110+）提供 MCP 双线路把 API 端点暴露为
agent 工具：

| 线路 | 形态 | 路由变更 |
|---|---|---|
| B：serve 内建 | `server.mcp.enabled: true` → `POST {base}/mcp`（streamable HTTP，stateless 子集） | **自动**——每请求读活路由表，reload 后即时生效 |
| A：离线 codegen | `oj mcp -c config.yaml …` 生成零依赖 stdio server（`OJ_BASE`/`OJ_TOKEN`/`OJ_TENANT`） | 文件快照，须重跑 |

本站消费**线路 B**。需求：在「系统管理 → 基础管理」下新增 **MCP 服务管理**页，管理本站
已安装方案模块的 MCP 暴露面并展示其工具，随方案升级动态更新。

## 2. 调研结论（上游 oj-bin 源码逐行确认）

| # | 事实 | 出处 |
|---|---|---|
| F1 | tool 名 = 净化 operationId（`[^a-zA-Z0-9_-]`→`_`，>64 截断+fnv1a64 散列后缀）；inputSchema 固定三键 `path`/`query`/`body`；GET→`readOnlyHint`、DELETE→`destructiveHint` | `serve/src/mcp.rs` `spec_to_tools` |
| F2 | **`tags[0]` = API 模块名**（剥 `-<version>`）——tool 天然携带模块归属，可按方案分组 | `serve/src/openapi.rs:75` |
| F3 | `server.mcp.modules` 白名单 **fail-closed**（Some 时仅保留 tags 有交集的 tool，无交集=空目录）；缺省（None）= 全暴露 | `serve/src/mcp_http.rs` `apply_modules_filter` |
| F4 | `mcp.enabled` 且无 auth 插件且未显式 `allow_anonymous: true` → **启动 fail-fast** | `api-manual.md` §14 |
| F5 | **reload 热更覆盖 `server.mcp`**：`do_reload` 每代重读完整 config.yaml → `App::from_config(cfg)` 影子装配 → 重建内层 router（含 mcp 挂载决策与 modules 白名单）→ swap。`diff_configs` 将 `server` 段标 `kept_listener` 仅指 TCP listener 永生（端口/证书不重绑），不阻碍 mcp 配置热生效 | `oj/src/serve_cmd.rs:455-545,648-685` |
| F6 | 浏览器直调陷阱：`Accept: */*` → 406，须显式 `Accept: application/json`；batch→-32600；非 JSON Content-Type→415 | `serve/src/mcp_http.rs` `accept_ok` |
| F7 | `GET {base}/_system/config` 已存在：Bearer 验签或 loopback 门控，返回 config_path/sha256/loaded_at/generation/modules（刻意低敏，**无 mcp 配置字段**）；**POST 同路径 = 手动触发热更**（`?force=1`）——手工改 config 后的生效通道 | `serve/src/reload.rs` `handle_config` |
| F8 | 本仓安装器已有 config.yaml 文本锚点改写先例：anonymous_paths 接线（`fsFace().readFile` + `text-edit.ts` 整行锚点插入，注释逐字保留）→ reloadConfig 热更；**且源 config 与 preview 派生文件 `.ojm-preview.yaml` 双写**（preview 服务器只读派生文件） | `_lifecycle/installer.ts:412-456`、`_lifecycle/text-edit.ts`、`compensate.ts:85-99` |
| F9 | 模板 config.yaml 随发布带锚点注释（P1-16 接线点先例：`# ojm:reload`）；模板 `config.yaml:116` 另有 `platform: modules: [_platform, oj-market]`——**`modules:` 键名不唯一** | `_lifecycle/text-edit.ts` D3 注释、模板 config.yaml |
| F10 | `server:` 段无 `deny_unknown_fields`——错层级键（如 `server.modules`）被**静默忽略**；`{enabled: false}` ≡ 段缺失（挂载门 `enabled.then(...)`）；`/mcp` 是独立 axum 路由，admit 仅验 auth、不走租户管线，裸 `tools/list` 无需 initialize 握手 | `src/config.rs:895/1657`、`oj/src/app.rs:2322`、`serve/src/lib.rs:336` |
| F11 | MCP 鉴权吃站点 JWT：上游 oj-auth 验 `exp` **leeway 0**（`plugins/oj-auth/src/lib.rs:172`），守卫只验签不签发，**无机器凭据/长期 token 面**；tool description **仅取 operation summary**（缺失=空串） | `oj-auth lib.rs`、`mcp.rs:110-117` |
| F12 | initialize 回 `capabilities:{tools:{}}` **无 `listChanged`**，stateless 无 session 无从推送——agent 目录取定于连接建立，升级后须**重连**才见新目录，会话中调旧工具得 -32601；`serverInfo` 恒 `"oj"`+引擎版本、无 `instructions` 字段；裸 Bearer 无 `WWW-Authenticate`/OAuth 发现面（上游定案取舍） | `mcp_http.rs:273-287,504`、`serve/src/lib.rs:219-220` |

## 3. 用户故事与范围

- **US-1**（浏览）：作为 superadmin，我在基础管理打开「MCP 服务」页，看到 MCP 服务状态
  （含代际）与按方案模块分组的工具目录（名称/描述/只读/危险/入参 schema/质量标注）。
- **US-2**（对账）：作为 superadmin，我能看到「白名单登记 vs 目录实测」漂移：方案已装但
  工具不可见（未入白名单/服务未启用）、非方案模块工具（折叠展示）。
- **US-3**（接入）：作为 superadmin，我能一键复制 MCP client 接入配置：线路 B 的
  URL+Bearer 说明（含 JWT exp/agent 重连/参数形状/主流 client 实配示例）；线路 A 的
  `oj mcp` 生成命令模板。**凭据面本身依赖 R3'**，落地前为「指路文档」形态（§6）。
- **US-4**（动态）：方案安装/升级/卸载后，无需重启：白名单随安装器自动登记/摘除，
  reload 热更生效；管理页刷新即见最新目录。**对 agent 的「动态」= 重连后生效**（F12，
  文案明示）。
- **US-5**（统计，v1 范围=静态半）：每方案工具数、只读/写/危险分布、未声明契约端点数
  （目录推导，恒可用）。调用统计（每工具调用数/错误数/最后调用时间）**整半后置 v2**，
  依赖上游 R2' + `audit.allow` 前置配置（§10 处置 #11）。

### 非目标

- 不做 MCP 调试台（tools/call 试调）——agent 侧行为，站点页面不重复。
- 不做线路 A 产物托管/分发——codegen 是站点外的运维动作，页面只给命令模板。
- 不做目录漂移 diff 观测（升级前后 tools/list 对比）——依赖机器凭据面（R3'）解耦后
  v2 做；v1 仅文案警示 + §8 留档。
- 不改上游 oj-bin 任何行为（R1'/R2'/R3'/R4' 仅提需求）。

### 反目标（红线）

- 不为「方便 agent」绕过 fail-closed：白名单登记只做方案名登记，绝不静默放开全量。
- 不在页面透出任何 token 值——接入配置只给「去哪取 token」的说明与 exp 警示。
- **工具 description 一律纯文本渲染**（AntD 默认转义），禁止 HTML/markdown 渲染或
  `dangerouslySetInnerHTML`——description 是方案作者提供的第三方文本（注入面），
  页面测试须含此断言。

## 4. BDD 用例

### 4.1 服务状态探测（后端代理端点）

```gherkin
功能: MCP 目录代理端点 GET /api/oj-market/mcp/catalog
场景: 按上游响应形态归一状态
  假如 站点 origin 的 {base}/mcp 对 tools/list 请求返回 <HTTP>
  那么 端点返回 <归一>

  | HTTP           | 归一                                          |
  | 200 tools/list | status="mounted"，tools=归一化工具数组（含 tags/annotations/inputSchema） |
  | 404            | status="unmounted"（mcp 未启用或 oj < 0.1.110） |
  | 401/403        | status="auth"（鉴权失败，透传上游 msg）          |
  | 网络失败/超时  | status="unreachable"（附 origin 解析原因——canonical_origin 未配置须与网络不可达文案区分） |
```

- 代理服务端转发浏览器 JWT（Authorization 原样透传，`/mcp` 不走租户管线、裸 tools/list
  免握手——F10）+ 显式 `Accept: application/json`（F6 陷阱在服务端规避）；门禁
  `assertSuperAdmin`（对齐 settings/wecom 面）。
- 目录按 `tags[0]` 分组返回：`{ status, generation?, groups: [{ module, tools: [...] }] }`。
  `generation` 取自同 JWT 对 `GET {base}/_system/config`（F7）的顺带探测；探测失败
  （reload_api 关闭 / 旧 oj）则省略，页面代际显示「—」。
- **v1 不做 audit 联查**（模板侧无消费先例、`audit.allow` 门控未配——见 §10 #11）；
  静态统计（各分组工具数/只读写危险分布/无契约计数）由目录直接推导。

### 4.2 白名单自动登记（安装器）

```gherkin
功能: 安装/卸载时维护 server.mcp.modules 白名单（文本锚点编辑 + reload 热更）

背景: 接线点 = reloading 段内 reloadStage、patchConfigAt→reloadAndAssert 之前
  （模板无「reconfiguring」段，文档统一用此口径）；登记/摘除/补偿均镜像
  「源 config + preview 派生文件 .ojm-preview.yaml」双写纪律（F8）

场景: 首个带 api 的方案安装，config.yaml 无 modules 键
  假如 config.yaml 的 server.mcp 段内锚点「# ojm:mcp-modules」下方无 modules 键
  并且 文档其他位置存在 platform.modules 键（config.yaml:116）
  当 安装方案 wiki@1.0.0（含 api）
  那么 仅在锚点缩进域内识别「无键」，插入 modules 键并登记 wiki（块列表形态：
       「modules:」行 + 「  - wiki」行），platform.modules 不受任何影响
  并且 reload 后 tools/list 只含 wiki 的工具（fail-closed 收敛）

场景: 后续方案安装（幂等）
  假如 白名单已含 [wiki]  当 安装 order@2.0.0
  那么 白名单变 [wiki, order]；重复安装同版本 no-op（列表行 trim 相等判定）

场景: 用户手写 flow 风格 modules 键
  假如 锚点下已有「modules: [wiki]」（内联非空值）
  当 安装方案 order
  那么 显式跳过登记（不做块级追加——flow 列表后接块级项是坏 YAML，oj 拒启），
       任务历史记「mcp.modules 为手写 flow 风格，跳过登记」

场景: web-only 方案（无 api 段）
  假如 方案无 api  当 安装  那么 白名单不变（无 api 模块名可登记）

场景: 卸载摘除与双轨同名
  假如 白名单 [wiki, order]  当 卸载 wiki 且锁中无其余同名来源
  那么 摘除 wiki 行；若列表变空则连同 modules 键一并摘除（回到缺省全暴露，避免空白名单
       = 全屏蔽陷阱）；双轨同名（内建模块仍占名）则不摘除
  并且 卸载自带 reload 失败回滚路径（uninstall.ts:254-269）须对称加回登记行

场景: 安装失败补偿对称回滚
  假如 登记发生在 reloadStage 且其后 smoke 失败触发补偿
  当 compensate 回滚  那么 对称摘除本次登记（镜像 deferredAnonymous；best-effort，
      防止幽灵登记把 fail-closed 目录打成空）

场景: 存量站点锚点缺失（升级兼容）
  假如 config.yaml 无「# ojm:mcp-modules」锚点
  当 安装方案  那么 登记跳过（不阻塞安装），任务历史记「MCP 白名单锚点缺失，未登记」
```

- 登记时机挂在 reloading 段 reloadStage 内（anonymous_paths 接线同一处）；卸载摘除在
  uninstall 对称位置（须扩 `UninstallInput` configPath 管道 + api.ts 调用点，§5.2）。
  均为 best-effort：失败记任务历史，不阻塞安装主流程。

### 4.3 管理页（前端 `/system/framework/mcp`）

```gherkin
功能: MCP 服务管理页
场景: 服务未启用    当 catalog.status="unmounted"  那么 状态卡显示「未启用」+ 启用指引
                    （文案=「在 config.yaml 现有 server.mcp 段内把 enabled 改为 true，
                     然后触发热更：POST {base}/_system/config（回环或 Bearer）」），
                    并区分「尚未修改」与「已修改未触发热更」两种情形
场景: 鉴权失败      当 status="auth"               那么 展示上游 msg + 指向接入配置的
                    token 说明（exp 警示）与 mcp 段检查项（auth 插件/allow_anonymous）
场景: 不可达        当 status="unreachable"        那么 区分「canonical_origin 未配置」
                    与「网络不可达」两种文案，各附下一步
场景: 服务已启用    当 status="mounted"            那么 按方案分组渲染工具表；每组头部显示
                    方案名与工具数；mounted 态常驻 Alert 讲 fail-closed 规则：
                    「已启用白名单：仅方案模块工具对外暴露；安装方案自动登记；
                    非方案模块工具不出现在本目录」（首装收敛的认知过渡）
场景: 非方案分组    当 分组 module ∉ 已装方案锁/索引 那么 折叠展示并标「非方案」
                    （可观测真值，不用「内建」措辞）
场景: 只读/危险标注 当 tool 有 annotations          那么 readOnlyHint/destructiveHint 以 Tag 呈现
场景: 质量标注      当 tool description 为空        那么 标「无描述」Tag；契约未声明标「未声明契约」Tag
场景: 描述渲染      当 渲染任意 tool description    那么 纯文本（禁 HTML/markdown 渲染——测试断言）
场景: 漂移提示      当 方案在锁中但无任何工具分组   那么 该方案行提示「无可见工具（未入白名单或无 api）」
场景: 接入配置      当 点击「复制接入配置」          那么 剪贴板得到：URL+Bearer 说明
                    （JWT 有 exp 约 24h、过期即 401、agent 静态配置不自动刷新、
                    长效凭据待 R3'）；目录取定于连接建立、方案升级后 agent 须重连
                    （会话中旧工具调用 -32601）；arguments 固定 path/query/body
                    三键嵌套；Claude Code/Cursor 实配 JSON 示例；线路 A 命令模板。
                    不含 token 值
场景: 静态统计      当 status="mounted"            那么 每方案行显示工具数与只读/写/危险分布
场景: 调用统计列    当 页面渲染                     那么 列恒显示「—」（v2 随 R2' 上线，
                    文案不出现内部需求编号）
场景: 动态刷新      当 手动刷新                     那么 重新拉 catalog 与已装方案列表（升级 reload 后即见新工具）
```

- 权限：路由 `roles: ["superadmin"]`（对齐 settings/wecom）；后端 assertSuperAdmin 兜底。
- 数据源：新代理端点（4.1）+ 既有方案列表接口（已装方案与版本，市场页同源）。
- 页面含说明行「工具描述由方案作者提供」（管理员决定接不接的关键信息）。

## 5. 设计

### 5.1 数据流

```
浏览器(管理页)
  ├─ GET /api/oj-market/index        （既有：已装方案+版本）
  └─ GET /api/oj-market/mcp/catalog  （新增：superadmin）
        └─ 服务端 fetch(siteOrigin + {apiPrefix}/mcp, tools/list,
             透传 Authorization, Accept: application/json) ＋ _system/config 代际探测
              └─ 归一 {status, generation?, groups[], 静态统计}   ← tags[0] 分组（F2）

安装器/卸载器
  reloading 段 reloadStage: text-edit 登记方案名 → 源 config + preview 派生双写
  reloading 段（既有）:     reloadConfig → router 换代（F5）→ tools/list 即时反映
  uninstall:                对称摘除（UninstallInput +configPath）→ 同款双写
  compensate:               安装失败对称回滚登记
```

### 5.2 落点清单（本仓改动面）

| 落点 | 改动 |
|---|---|
| `packages/cli/templates/src/oj-market/api/api.ts` | 新增 `GET /mcp/catalog` 路由（superadmin；tools/list 代理 + tags 分组归一 + 静态统计推导 + `_system/config` 代际探测；**无 audit 联查**） |
| `packages/cli/templates/src/app/api/_platform/_lifecycle/text-edit.ts` | 新纯函数：段内定界的 `ensureMcpModule`/`removeMcpModule`（以锚点缩进域为界，防 platform.modules 误写）+ 空表连键摘除 + flow 风格跳过 |
| `…/_lifecycle/installer.ts` | reloadStage 内登记接线（patchConfigAt 位置，镜像 anonymous 双写） |
| `…/_lifecycle/uninstall.ts` + 调用点 api.ts | `UninstallInput` 扩 configPath + 摘除接线 + reload 失败回滚路径对称加回 |
| `…/_lifecycle/compensate.ts` | 对称回滚登记（镜像 deferredAnonymous） |
| `packages/cli/templates` config.yaml 模板 | 预置**真实 `server.mcp:` 骨架**（`enabled: false`，F10 证实 ≡ 缺失、行为中性）+ **mcp 段内**锚点 `# ojm:mcp-modules`——不可与 `# ojm:reload` 同层（server 直子级），否则插出被静默忽略的 `server.modules`（F10） |
| `packages/cli/templates/src/app/web/system/pages/mcp/` | 新页面（状态卡/分组工具表/常驻 Alert/质量标注/漂移/静态统计/接入配置/刷新） |
| `packages/cli/templates/src/app/web/system/routes.ts` | `/system/framework/mcp` 路由（superadmin） |
| `packages/cli/templates/src/app/web/system/locales/{zh-CN,en-US}.json` | `menu.mcp` + 页面文案 |
| client 生成 | `ojm api` 重生成 `__client`（catalog 端点类型面） |
| 测试 | text-edit.spec.ts（现成家，195 行）扩纯函数用例（§4.2 全场景含 platform.modules 共存/flow 跳过）；代理端点归一单测（FetchFace stub，market-api.spec.ts:99 先例）；页面 vitest（§4.3 场景含纯文本渲染断言） |

### 5.3 关键判定（两轮评审后定稿，可否决）

- **模板预置 `server.mcp:` 真实骨架 + 段内锚点**：`enabled: false` 行为中性（F10）；
  锚点层级是唯一正确性保证——`server:` 无 deny_unknown_fields，错层级键静默忽略。
  启用指引文案固定为「在现有 mcp 段内把 enabled 改为 true + 触发热更」，绝不引导
  用户新增 mcp 块（重复键）。站点模板含 auth 段，翻转 enabled 不触发 F4 fail-fast。
- **`modules:` 键检测段内定界 + 块列表形态**：以锚点缩进域为界（`modules:` 键名不唯一，
  模板另有 `platform.modules`——全局查找会误写平台装配列表，flow 列表后接块级项 =
  坏 YAML、oj 拒启）；写入恒为块列表（键行 + `  - name` 行）；用户手写 flow 风格 →
  显式跳过 + 任务历史，不做改写。
- **preview 双写纪律**：登记/摘除/补偿三处均镜像「源 config + `.ojm-preview.yaml`」双写
  （F8），否则 preview 形态白名单静默不生效、重启后「突然生效」。
- **白名单键缺省不预置**：首个方案安装才插入 `modules:` 键——此前保持缺省全暴露（F3），
  不产生「升级即断」的行为变更；首个方案安装后收敛为 fail-closed，非方案模块工具从
  目录退出（预期安全收敛，页面常驻 Alert 讲明）。
- **分组标注用可观测真值**：不在已装方案锁/索引中的 module 标「非方案」折叠展示
  （弃用「内建」措辞——`.ojm-builtin.json` 不随站点发布、`platform.modules` 仅两项，
  硬编码名单必腐）；登记/摘除守卫以锁为唯一真值。
- **补偿与卸载回滚对称**：compensate 摘除（镜像 deferredAnonymous）；uninstall reload
  失败回滚加回登记行。
- **代理挂在 oj-market**：它已代管方案编排面（R29）且 system 模块已有 bindRequest 先例。
- **探测而非自省**：服务状态靠 tools/list 实测（unmounted/auth/unreachable/mounted 四态），
  不解析 config.yaml——与 F7 的低敏红线一致；generation 经 `_system/config` 顺带探测，
  失败省略。
- **调用统计后置 v2**：v1 不引入 audit 消费（无先例 + `audit.allow` 门控未配置）。

## 6. 上游需求（提给 oj-bin，优先级降序）

### R3'：机器凭据 + scope 化（最高优先）

- 现状：oj-auth 只验签不签发（login/refresh 在站点 JS 侧）、验 `exp` leeway 0、默认
  TTL 24h——agent 静态配置（`OJ_TOKEN`/Authorization 头）过期即全量 401，无刷新流程，
  管理页亦无信号。US-3 在此之前只能「指路」。
- 需求：机器凭据面（长期 token 或 API key），带 scope（至少 readOnly 档，对齐
  annotations.readOnlyHint）；管理页据此可展示「接入凭据」真实形态。
- 价值：业界 MCP 网关/hub 对照下 v1 唯一缺失的强需求（agents 评审结论）。

### R4'：`server.mcp` 可配 server_name + instructions（次高）

- 现状：`serverInfo` 恒 `"oj"`+引擎版本（多站点在 agent 侧不可区分）；`instructions`
  字段未实现。
- 需求：`server.mcp.server_name` + `instructions` 配置面。一段 instructions 同时缓解
  agent 重连语义告知（F12）与三键参数形状说明——一次改动收益两项，杠杆最高。

### R2'：`tools/call` 发审计事件 `kind="mcp.call"`（调用统计前置，v2）

- 现状：审计设施完备（`audit:` 段：环形存储/零凭据事件/`audit.query` op 已注册且
  AllowList 门控——`bridge/mod.rs:619`），但 `emit` 调用点全在 db 侧；`mcp_http.rs` 的
  `run_tool` 不发任何事件。
- 需求：`tools/call`（与 `/rpc` 同执行链）经同一 audit 出口发事件：`alias`=净化 tool 名、
  `module`=tags[0]、`user`=调用方主体、`detail`=outcome（ok/is_error/时长 ms）。
- 消费：站点经 `audit.query(kind)` 过滤聚合；站点侧须先配 `audit.allow` 前置。
- 边界：环形存储=近期观测，不做长期分析。

### R1'：`GET {base}/_system/config` 增补低敏 `mcp` 字段（可选）

- 需求：响应增补 `"mcp": {"enabled": bool, "modules": [..]|null, "allow_anonymous": bool}`
  ——同现有字段同一低敏线。价值：管理页可展示「配置真值 vs 登记镜像 vs 目录实测」
  三方对账；缺省不影响闭环。
- 版本门禁：字段缺失时消费方静默降级。

### 备忘（规模信号触发，暂不成需求）

- `tools/list` cursor 分页（规范允许不分页；方案数上量后 agent 上下文噪音与
  每请求全量 generate 延迟才是成本）。
- annotations 增 `title`（UI 展示净化名可读性）。

## 7. 任务分解（TDD：每项先写用例再实现）

| # | 任务 | 依赖 | 状态 |
|---|---|---|---|
| T1 | 分支 `feat/mcp-service-management`；本设计文档随首提交入库 | - | ✅ |
| T2 | `text-edit.ts`：段内定界 `ensureMcpModule`/`removeMcpModule` 纯函数 + 单测（§4.2 全场景数据表：含 platform.modules 共存、flow 风格跳过、空表摘键、双轨同名、锚点缺失） | T1 | ✅ |
| T3 | installer reloadStage 登记接线 + preview 双写；uninstall 摘除（`UninstallInput` +configPath、api.ts 调用点、reload 失败回滚对称加回）；compensate 对称回滚 | T2 | ✅ |
| T4 | config.yaml 模板预置 `server.mcp:` 骨架 + 段内锚点 | T2 | ✅ |
| T5 | oj-market API：`GET /mcp/catalog` 代理端点（归一+分组+静态统计+代际探测，无 audit 联查）+ 归一单测（§4.1 数据表，FetchFace stub） | T1 | ✅ |
| T6 | `ojm api` 重生成 client；system 路由 + i18n | T5 | ✅ |
| T7 | 管理页（状态卡四态指引/常驻 Alert/分组工具表/质量标注/漂移/静态统计/接入配置含 client 实配/刷新；纯文本渲染断言）+ vitest（§4.3 场景） | T6 | ☐ |
| T8 | 全量校验：`pnpm test`/`pnpm lint`/`pnpm typecheck`；真机演练钉死形态 = `ojm dev` 起真实 oj serve（reload 返回 generation 非 unchanged——dev embedded 无 server 时 reloadOf 回落 no-op，热更路径未被演练） | T7 | ☐ |
| T9 | 收尾：更新本文档任务状态与总结段落；R3'/R4'/R2'/R1' 需求落 `docs/prd/` 提上游 | T8 | ☐ |

## 8. 调研问题记录（分类）

- **反常规（部署面风险）**：oj config.yaml 无 `deny_unknown_fields`，错层级键
  （如 `server.modules`）被静默忽略且无任何告警；`modules:` 键名全局不唯一
  （`platform.modules` 共存）——文本锚点的层级与段内定界是唯一正确性保证（§5.3）。
- **反常识（已解）**：`server` 段在 reload 三清单中标 `kept_listener`，直觉读作「server 配置
  改动不热更」——实为 listener 永生语义，`server.mcp` 随影子装配换代热生效（F5）。文档
  （api-manual §14「路由变更自动」）未提白名单热更语义，易误判须重启。
- **与业界不符（上游定案取舍，留档）**：MCP 2025-06-18 Authorization 章要求 HTTP 传输走
  OAuth 2.1（含 RFC 9728 发现面）；上游为裸 Bearer（401 无 `WWW-Authenticate`、无
  `/.well-known/oauth-protected-resource`）——严格 OAuth client 不可接入；Claude Code
  `--header`/Cursor 自定义头静态凭据为一等支持，业界实操无碍。R3' 落地时建议一并补
  发现面。
- **与规范差距（protocol 评审）**：无 `listChanged` capability + stateless 无推送——
  「动态更新」对 agent 仅在重连后成立（F12）；US-4 与接入配置已明示重连语义。
- **空表陷阱**：卸载最后一个方案若留 `modules: []`，等于全屏蔽且无报错——摘除规则须
  连键一起摘（§4.2）。
- **静默类失效清单**：错层级键静默忽略（F10）、preview 形态单写静默不生效（F8）、
  手写 flow 风格坏 YAML 拒启、半失败幽灵登记空目录——四类均已在 §4.2/§5.3 闭合。
- **观测缺口**：目录漂移（升级换 tool 名/同名 tool 指向变化）破坏已保存 agent 配置，
  v1 不观测（依赖 R3' 凭据面解耦），v2 以安装路径 tools/list 前后 diff 补齐，任务历史
  承载。

## 9. 备注

- token 面：接入配置仅说明「从哪取 JWT」+ exp 警示，页面绝不展示 token 值。
- 双轨同名纪律沿用既有结论：登记/摘除以锁+可观测名单为真值，不凭单一来源猜。
- MCP 端点 per-mount 挂载（`mount_for_endpoint`）：本站单 api mount 场景按 `{base}/mcp`
  单目录处理；多 mount 站点留待规模信号（代理端点已按 origin 全局一次探测）。
- 跨请求 config.yaml 读改写竞态：anonymous 接线同样存在，非本方案新增风险，不在本期。

## 10. 评审记录（2026-11-10 五方专家）

| 评审方 | 判定 | 发现 | 处置去向 |
|---|---|---|---|
| builder check | 通过 | 4 问 | 全部定稿进 §5.3（骨架层级/补偿回滚/非方案真值/代际探测） |
| 专家架构师 | 无 blocker | 3 major 2 minor | #1 卸载管道→§5.2/T3；#2 preview 双写→§4.2/§5.3；#3 modules 段内定界→§5.3；#4 演练形态→T8；#5 unreachable 文案区分→§4.3 |
| 专家工程师 | 无 blocker | 2 major 3 minor | #1 段内定界(坏 YAML 后果)→§5.3/T2；#2 任务表补 compensate/uninstall 回滚→T3；#3 T5 不带 audit 联查→§5.2/US-5；#4 术语勘误 reloadStage→§4.2；#5 flow 跳过→§4.2/§5.3 |
| AI agents 专家 | 无 blocker | 2 major 2 minor | #1 凭据生命周期→R3'+接入文案；#2 漂移破坏→§8 留档+文案；#3 per-tool 标注→§4.3；#4 注入红线→§3 反目标 |
| MCP 协议专家 | 无 blocker | 1 major 4 minor | #1 重连语义→US-4/§8/文案；#2 分页→§6 备忘；#3 OAuth 偏离→§8；#4 三键形状→接入文案；#5 server_name+instructions→R4' |
| AI 产品经理 | 无 blocker | 4 major 1 minor | M1 两态指引→§4.3；M2 生效方式→§4.3(F7 POST)；M3 凭据闭环→R3'/US-3；M4 fail-closed Alert→§4.3；m5 编号泄漏/价值主张→§0/§4.3；INVEST 裁剪→US-5 拆半 |

## 11. 阶段记录

### Phase 1：地基（T1/T2/T4，阶段评审通过）— 2026-11-10 11:11

- 交付：特性分支 + 本文档入库（6a55a4f）；`ensureMcpModule`/`removeMcpModule` 纯函数
  （锚点缩进域段内定界扫描、块列表写入、flow 风格跳过、空表连键摘除、锚点保留）；
  模板 `config.yaml` 预置 `server.mcp:` 骨架（`enabled: false`）+ 段内锚点（8fc92b0）。
- BDD/TDD：14 条新用例先 RED（`is not a function`/模板缺锚点）后 GREEN；全量 templates
  套件 1246 用例/65 文件全绿；lint（if-newline 自动修复）/typecheck 通过。
- 关键判定落码：`removeMcpModule` 保持纯文本语义——**双轨同名守卫归调用方**（锁真值），
  设计稿签名中的 `remain` 参数去掉（§5.2 勘误）；段内定界 + flow 跳过两个评审 major
  在纯函数层闭合。
- 耗时：T2/T4 编码+审查约 20 分钟。
- 遗留：无（Phase 2 接线直接消费）。

### Phase 2：生命周期接线（T3，阶段评审通过）— 2026-11-10 11:35

- 交付（49f0206d7）：三处接线全落——① installer `reloadStage`：带 `api` 段方案把名字登记进
  `server.mcp.modules`（源 config + preview 派生双写；锚点缺失/flow 风格仅注记不阻塞安装的
  best-effort 语义，注记随 reloading 段 message 进任务记录）；② uninstall：锁摘除后、reload
  前摘除白名单（`lockEntryIsSolution` 双轨同名守卫；reload 失败/断言失败两条回滚路径对称加回
  登记行，与锁一致回滚）；③ compensate：`config.mcp` 对称回滚步（仅本次真登记才注册该步）。
- 附带收口：`previewSiblingOf`/`MCP_ANCHOR` 上收 text-edit.ts（纯函数叶模块，消 installer/
  compensate 两处重复副本）；`oj-market` uninstall 端点补传 `configPath`（同 install 端点
  `resolveDeploymentConfigPath` 解析口径；未传 = 跳过 MCP 摘除，旧调用形态零变化）。
- BDD/TDD：12 条新用例先 RED 后 GREEN（其中 4 条为负向守卫：web-only 不登记、升级失败不误摘、
  双轨同名不摘、reload 回滚加回）；RED 期修正两处用例自身缺陷（web-only 夹具缺 `m.web` 覆盖、
  MCP_BASE 缺 anonymous_paths 基线）。全量 templates 套件 1258 用例/65 文件全绿；typecheck/
  lint（0 error）通过。
- 关键判定落码：登记/摘除时机对称——安装侧登记在 reload 前（热更代同时吃到锁 diff 与白名单
  diff），卸载侧摘除同为锁后 reload 前；回滚语义双向对称（安装补偿摘除 ⇔ 卸载回滚加回）。
  `mcpRegistered` 内部通道防误摘：升级失败（登记幂等 no-op）不回滚既有登记行。
- 耗时：T3 阅读接线点 + 编码 + 审查约 25 分钟。
- 遗留：无（Phase 3 消费面 T5/T6 直接依赖登记事实）。

### Phase 3：消费面（T5/T6，阶段评审通过）— 2026-11-10 12:05

- 交付（d662eab + 04c7a02）：① T5——`mcp-catalog.ts` 消费面（tools/list 代理 + `tags[0]`
  分组归一 + annotations hints + params 三键子集 + `_system/config` 代际顺带探测）+ api.ts
  端点管道（assertSuperAdmin → 取浏览器 JWT → `resolveCanonicalOrigin`，REG-CS6 不读 Host；
  origin 未解析 fail-closed 归 unreachable 且零出站）+ `FetchInitFace` 加性扩 method/body
  （出站 POST 面）；② T6——路由键嵌套化 `mcp.catalog`（对齐 trust/review 口径）+ 契约
  response JSON-schema → `oj openapi` → `ojm api` 重生成 `__client`（`ojMarketMcpCatalogGet`），
  `ojm api --check` 门禁 0 drift（dist 过期致首跑报缺路由，`ojm build` 刷新后过）；
  MarketClient 增 `mcpCatalog()`（types/defaultClient/fake 三件套，trust-review 先例同款）；
  `/system/framework/mcp` 路由（`roles: ["superadmin"]`）+ 页面骨架（T7 填实）+ `menu.mcp` zh/en。
- BDD/TDD：T5 §4.1 数据表 8 用例先 RED 后 GREEN（含出站形态断言：显式 `Accept: application/json`
  规避 F6 406 陷阱、JWT 原样透传、URL= canonical origin）；T6 注入缝 3 用例红→绿（状态透传/
  错误面/未注入常态）。RED 期修正：api 级夹具误把 `installDb()` 裸句柄覆写 `globalThis.db`。
- 全量绿：仓库根套件 1024 用例（含 oj-market 组件测试）+ templates 套件 1266 用例/66 文件；
  typecheck/`ojm api --check`/lint 全过。
- 关键判定：① `/mcp` 不走租户管线（F10），浏览器 JWT 原样透传即可，无需服务端换凭据；
  ② unreachable 双文案刻意可区分（canonical_origin 未配置 ≠ 网络不可达），§4.3 页面据 message
  分叉指引；③ system 页经 `useMarketClient()` 消费（context 缺省即 httpMarketClient，零 provider），
  测试注入内存 fake——双数据源（catalog + 既有 index 漂移对账）走同一 seam。
- 耗时：T5 编码 + 数据表用例约 20 分钟；T6 生成链 + 三件套 + 路由约 25 分钟。
- 遗留：页面为骨架（T7 填实 §4.3 全场景）；真机演练形态钉死归 T8。
