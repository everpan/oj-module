# 企微机器人代理访问 oj /api/mcp · 架构重评估 + 上游能力提案（R7）

- 状态：**架构转向**（用户 2026-11-12 重评估）。原定稿的「1a 独立编排层」方案**废止**，改为 oj JS handler 代理；缺失能力以需求提案 **R7** 提交上游 oj 评估实现。
- 关联：定稿 `docs/plans/20261112-1322-wecom-mcp-multitenant-user-proxy-plan.md` —— 其 §4.2/§4.3 的「1a 独立进程」形态被本稿取代；§1–§3、§4.1、§5–§11 仍有效。
- 硬约束：oj 侧能力缺口只提需求、不改 `oj-bin`（与定稿一致）；本仓只做业务层 handler。

---

## 1. 转向：从「MCP 插件 + 独立编排层」到「JS handler 代理」

原定稿走「企微普通模式 MCP 插件 → 独立进程编排层(1a) → oj /api/mcp」。现改为：**在 oj 模板内写一个 JS handler，由它代理访问 oj 自身的 `/api/mcp`**（企微机器人走该 handler，不再以 MCP 插件形态接入）。

动机：
- 去掉独立进程（1a）的部署/运维负担（原 P2 交付形态、P6 高可用、K9 单点随之消失）。
- 回归「业务 handler 落本仓」原则：`oj` 只提供基础工具（加解密 / http / db / token 签发），代理编排属业务层。
- 已落地的 obo 换签、per-tool `admit`、多租户 tenant claim、service-token 自助签发 + `ttl_days`（本会话已实施）**全部复用，不受影响**。

## 2. 阻塞点：同进程内 handler `fetch` 回 `/api/mcp` 会死锁

handler 代理 `tools/call` 时需在进程内 `await fetch("/api/mcp", { tools/call })`。oj 的 JS actor 池机制导致并发下死锁：

- `oj-bin/serve/src/actor.rs:80-137`：`pool_size` 个 js-actor 线程，每个 `while let Some(job) = rx.recv().await` **串行**执行 JS handler（Source/Module job）。即「并发 JS handler 数上限 = `pool_size`」。
- `oj-bin/serve/src/mcp_http.rs:460,479`：`tools/call` → `call_tool` → 经 `run_capture` 派发到 **JS handler（占一个 actor）**（`mcp_http.rs:13` 注释与 `:580` 「tool 名 → dispatch 映射 → 执行 → Capture 映射」印证）。
- 因此：外层代理 handler 占 1 个 actor 线程并 `await` 内层 `tools/call`，内层又要占第 2 个 actor 线程。当并发代理请求数 ≥ `pool_size` 时，所有 actor 线程都在等内层 → **全站永久挂死、断连不自愈**（路由 watchdog / `route_timeouts` 只打断 JS 执行，不打断宿主侧 `await fetch`；运行时无 `AbortSignal`）。
- 实测：`/tmp/oj-loop-lab`（oj 0.1.130）内嵌自环 `N ≥ pool_size` 7/7 全挂；进程外两步独立 HTTP 不死锁。

> 注：`initialize` / `ping` / `tools/list` 在 Rust 侧算完（`mcp_http.rs:458-478`），**不占 actor**，故仅代理这些 method 不触发死锁；死锁严格绑定 `tools/call`（及任何落到 JS handler 的 tool）。

**结论**：oj 当前**不提供**「handler 在进程内调用另一个端点/handler 而不额外占一个公共 actor」的能力 —— 这正是缺失项。

## 3. 上游提案（R7）：同运行时内部 dispatch 原语 —— ✅ 已落地（oj v0.1.131）

> **状态**：R7 已于 oj **v0.1.131** 落地，原语为 `bridge.call({ method, path, headers?, body? })`（devkit `api-manual.md`「bridge」节 + `scenarios.md` 场景 76）。本节保留原提案与 API 草图供对照，落地 API 以 devkit 为准。

需求：给 oj handler 一个**在进程内、于当前 actor 内**调用另一个端点/handler（典型 `/api/mcp`）的原语，使其**不再消耗公共 actor 池的第二个槽位**，从而消除死锁。

建议形态（任一即可，按 oj 实现偏好择一）：

- **R7-A（首选，通用）**：handler 全局暴露 `bridge.call(req)` / `oj.dispatch({ method, path, headers, body })`，在当前 isolate/线程内同步执行目标 handler 逻辑并返回 `Response`。代理 handler 调 `bridge.call("/api/mcp", ...)` 即原地拿结果，零额外 actor。
- **R7-B（隔离池）**：内部 loopback（handler → localhost/内部端点）走**独立 actor 池**（不受公共 `pool_size` 限制），公共池不再因代理自环耗尽。
- **R7-C（MCP 定向）**：oj 暴露 `bridge.mcpForward(req)`，内部复用 Rust 侧 `mcp_http` 处理路径，不重入 HTTP actor 队列。

R7-A 最通用（一并解锁任意 handler-to-handler 编排，不止 MCP），推荐作主方案；R7-B/C 为备选。

**验收（上游侧）**：固定 `pool_size` 下，单进程内 handler 自环代理 `tools/call` 并发数 ≥ `pool_size` 不死锁（沿用 `/tmp/oj-loop-lab` 矩阵，目标从「进程外才 200」变为「进程内也 200」）。

## 4. 本仓 JS handler 设计（依赖 R7，取代 1a）

文件：`src/app/api/.../wecom-bot/mcp/api.ts`（普通 handler，归 `ojm api --check` 管辖 → `.schema` 变更走 openapi/__client 同步，本会话已具备流程）。职责（与原 §4.3 一致，仅把「进程外 fetch」换成「R7 原语」）：

1. 只读解析入站体 `method`（转发明文/字节，不重序列化）。
2. `initialize` / `ping` / `tools/list` → 发现身份（复用静态 svc Bearer）→ `bridge.call("/api/mcp", ...)`。
3. `tools/call` → 必须 `X-WeCom-User-Id` → `bridge.call("/api/auth/obo", ...)` 换受托 token → `bridge.call("/api/mcp", ...)`。
4. 响应透传（status+body 原样；仅 oj 未设 `Content-Type` 时补 `application/json`；202 空 body 严格回 202）；obo 失败 4031x → JSON-RPC error 映射（§4.3#6）。
5. 头置换：剥 `X-WeCom-User-Id` / `X-TENANT-ID` / 原 svc Bearer，强制 `Content-Type`/`Accept`，租户从 Bearer claim 推导（不转租户头）。

> 关键死锁差异：用 `bridge.call`（R7）时第 2/3 步的「内层 /mcp 调用」在**当前 actor 内**完成，不占第二个公共 actor → 死锁消除。若 R7 未落地，本 handler 在 `tools/call` 并发 ≥ `pool_size` 下仍复现 §2 死锁 —— 故 **本 handler 上线硬阻塞于 R7**。

## 5. 任务影响

- 定稿 §4.2（1a 独立进程）**废止**；§4.3 行为约束保留（改由 JS handler 实现）。
- 本会话已落地：P1 `config.yaml`（mcp.enabled）、P1.5 service-token 自助 + `ttl_days`、契约三处同步、前端 `ttl_days` 字段 —— **全部保留**（新形态仍需要）。
- 阻塞链：**R7（上游） → 本仓 JS handler（任务 #16）**。P0 真企微 K4/K3、P3 网络、P5 测试不变。
- 原 R3/R5/R6（定稿 §8）仍有效；R5（SSE/有状态）触发条件因「非 MCP 插件」而弱化，但 K4 真企微门保留。
