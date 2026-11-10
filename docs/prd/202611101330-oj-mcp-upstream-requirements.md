# oj MCP 上游需求（R 系列，提给 oj-bin）

- 日期：2026-11-10 13:30
- 来源：oj-module「MCP 服务管理」方案（`docs/plans/20261110-1027-mcp-service-management.md`）
  v1 落地 + `ojm dev` 真机演练（T8）。上游代码全部只读核实，未改动。
- 状态：待提上游。优先级降序 R3' > R4' > R2' > R1'，R5' 为演练新发现（插在 R4' 与 R2' 之间亦合理）。

## 背景

oj ≥ 0.1.110 的 `{base}/mcp`（streamable HTTP stateless MCP 端点）+ `tags[0]` 模块归属 +
annotations hints 已支撑站点侧「方案工具目录」管理页闭环（目录代理 + 分组归一 + 质量标注 +
unmounted 两态指引）。以下需求为 v1 留档的四项能力缺口与演练新发现的一项接入摩擦，
按对 agent 接入体验的影响排序。

## R3'：机器凭据 + scope 化（最高优先）

- **现状**：oj-auth 只验签不签发（login/refresh 在站点 JS 侧）、验 `exp` leeway 0、默认
  TTL 24h——agent 静态配置（`OJ_TOKEN`/Authorization 头）过期即全量 401，无刷新流程，
  管理页亦无信号。
- **需求**：机器凭据面（长期 token 或 API key），带 scope（至少 readOnly 档，对齐
  `annotations.readOnlyHint`）；凭据可自助签发/吊销。
- **验收（BDD）**：
  - 当 agent 持机器凭据调 `tools/list`/`tools/call`，则 200 且 scope 外调用 403；
  - 当凭据跨 24h 仍在有效期内，则调用不 401（无 TTL 断崖）；
  - 当凭据被吊销，则后续调用 401 且无副作用。
- **价值**：业界 MCP 网关/hub 对照下 v1 唯一缺失的强需求；落地后站点管理页可展示
  「接入凭据」真实形态并一键轮换。

## R4'：`server.mcp` 可配 `server_name` + `instructions`（次高）

- **现状**：`serverInfo` 恒 `"oj"`+引擎版本（多站点在 agent 侧不可区分）；`instructions`
  字段未实现（`mcp_http.rs` initialize 应答）。
- **需求**：`server.mcp.server_name` + `instructions` 配置面，reload 热更同代生效。
- **验收**：
  - 当配置 `server_name: "acme-wiki"`，则 initialize 回 `serverInfo.name="acme-wiki"`；
  - 当配置 `instructions`，则 initialize 回填该字段（未配置 = 缺省，不加空串）。
- **价值**：一段 instructions 同时缓解 agent 重连语义告知（无 `listChanged`、升级后须重连）
  与 path/query/body 三键参数形状说明——一次改动收益两项，杠杆最高。

## R5'：`/api/mcp` 租户头门槛（T8 演练新发现）

- **现状**：`/api/mcp` 在外层 tenant 中间件之后，租户中间件启用的站点缺 `X-TENANT-ID`
  即 400「missing tenant header」——**外部 MCP client（Claude Code `--header`/Cursor 静态头）
  按标准 MCP 接入姿势只带 Authorization，首连即 400**；api-manual §14 未记载该门槛。
  同前缀下 `_system/health` 全免、`_system/config` 仅 Bearer，三者门槛各异无文档。
- **需求**（二选一）：① 单租户/默认租户站点 `/api/mcp` 免租户头（挂载点前置于租户中间件，
  同 `_system/*` 口径）；② 保持现行为但 api-manual §14 明记「HTTP 接入须带
  `X-TENANT-ID`」+ 401/400 文案点名缺失头。
- **验收**：当租户中间件启用且 client 仅带 Bearer，则 ① 下 200 / ② 下 400 文案含
  `X-TENANT-ID` 字样。
- **价值**：消除外部 agent 接入的第一公里摩擦；站点侧接入配置当前只能靠写全两组请求头兜底。

## R2'：`tools/call` 发审计事件 `kind="mcp.call"`（调用统计前置，v2）

- **现状**：审计设施完备（`audit:` 段：环形存储/零凭据事件/`audit.query` op 已注册且
  AllowList 门控——`bridge/mod.rs:619`），但 `emit` 调用点全在 db 侧；`mcp_http.rs` 的
  `run_tool` 不发任何事件。
- **需求**：`tools/call`（与 `/rpc` 同执行链）经同一 audit 出口发事件：`alias`=净化 tool 名、
  `module`=tags[0]、`user`=调用方主体、`detail`=outcome（ok/is_error/时长 ms）。
- **验收**：
  - 当站点配 `audit.allow` 含 `mcp.call` 且 agent 调 `tools/call`，则 `audit.query(kind="mcp.call")`
    出对应事件（含 tool 名/模块/主体/outcome）；
  - 当未配 allow，则零事件（既有 fail-closed 语义不破）。
- **消费**：站点目录页「调用统计」列从恒「—」变实测计数。环形存储=近期观测，不做长期分析。

## R1'：`GET {base}/_system/config` 增补低敏 `mcp` 字段（可选）

- **需求**：响应增补 `"mcp": {"enabled": bool, "modules": [..]|null, "allow_anonymous": bool}`
  ——同现有字段同一低敏线。
- **验收**：当字段存在，则站点可展示「配置真值 vs 登记镜像 vs 目录实测」三方对账；
  当字段缺失（旧引擎），则消费方静默降级（版本门禁：字段缺失不影响闭环）。

## 备忘（规模信号触发，暂不成需求）

- `tools/list` cursor 分页（规范允许不分页；方案数上量后 agent 上下文噪音与每请求全量
  generate 延迟才是成本）。
- annotations 增 `title`（UI 展示净化名可读性）。

## 附：演练过程已在上游可对齐的两处事实勘误建议

1. `serve/src/reload.rs` 摘要字段本仓源码为 `cfg_sha256`，线上 0.1.129 二进制为 `sha256`
   ——版本间字段名漂移，消费方需双字段兼容；建议定稿一处并在 CHANGELOG 标注。
2. `sha256` = `doc_sha(解析后 YAML)` 值规范指纹而非文件字节 sha——api-manual 值得写明
   口径（站点侧曾按「文件 sha」误用，实测两侧永不相等）。
