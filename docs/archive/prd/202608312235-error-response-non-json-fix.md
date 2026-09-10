# fix：错误响应体非 JSON 时 handleErrorResponse 刷 SyntaxError 噪声

> 现象（用户报告）：`runtime.js:8435 Error parsing JSON: SyntaxError: Unexpected
> non-whitespace character after JSON at position 4 (line 1 column 5)`，playground
> 每次进首页必现。

## 根因（systematic-debugging 四阶段，已探针复现）

| 层 | 事实 |
|----|------|
| 触发点 | header 通知组件 `NotificationContainer` 挂载即 `fetchNotifications()` → ky `GET /api/notifications` |
| 404 来源 | playground（ram dev）无 /api 后端（fake 仅 vite dev 有，P6.5），ram dev 404 响应体为纯文本 `404 Not Found: /api/notifications` |
| 报错机制 | `handleErrorResponse` 对 !ok 响应盲调 `response.json()`：`JSON.parse("404 …")` 解析出数字 `404` 后在位置 4 遇 `N` → SyntaxError（与用户报错逐字吻合，已 node 复现） |
| 次生 | `.catch` 兜底本可工作（回退 statusText toast），但 `console.error` 把「错误体非 JSON」这一**常态**（网关 502 HTML、代理 404 文本同理）当异常刷屏 |

## 修复方案（单点：所有 !ok 响应都经 handleErrorResponse）

对齐 ky 自家 `HTTPError` 的 text-first 模式（`Ky.js` `const text = await response.text()`）：

1. `response.clone().text()` 先取文本（clone 保持原 body 对下游 ky `.json()` 可读）；
2. 显式 `JSON.parse`，失败视为非 JSON **常态**，静默回退 statusText，不再 console.error；
3. JSON 为对象时仍优取 `errorMsg`/`message`（行为不变）。

## BDD 用例（`tests/error-response.test.ts`）

| 用例 | Given（错误响应） | Then |
|------|-------------------|------|
| T1 非 JSON 404（本次缺陷） | body `404 Not Found: /api/notifications`，status 404 | 不产生 console.error；message.error 收到 statusText |
| T2 JSON 错误体 | body `{"message":"boom"}` | message.error 收到 `boom` |
| T3 下游 body 仍可读 | 任意错误体 | 返回的 response 可再 `.text()`（clone 未消费原 body） |

## 边界/遗留

- playground 无 /api 后端属设计现状：通知/图表接口 404 → toast 提示，属诚实降级。
  若要让 playground 图表/通知有数据，需给 ram dev 接 mock API（独立任务，非本缺陷）。
- `modules/home` 图表 `.then` 无 `.catch`：本次探针未见噪声（ky HTTPError 经
  handleErrorResponse 后仍在 fetchLine promise 链内），如后续复现 unhandled rejection 再处理。

## 执行小结（2026-08-31）

- **流程**：分支 `fix/error-response-non-json` → 四阶段定位（错误逐字复现 → 探针实跑
  锁定真实触发点为通知组件而非首页图表）→ 修复文档 → TDD（t1/t3 红 → 实现 → 3/3 绿）
  → shell 全量重建 → 探针复跑验证 → 全量回归。
- **耗时**：定位与复现约 15 min；TDD 与实现约 10 min；重建+回归约 15 min；合计约 40 min。
- **关键过程**：
  - 错误「position 4 (column 5)」反推出 body 形如 `404 Not Found: …`（前 4 字符是合法
    JSON 数字），node 一行复现后由探针证实。
  - 探针修正假设：首个 404 是 header 通知组件的 `/api/notifications`（每次进页必发），
    不是 home 图表接口。
  - 修复对齐 ky 自家 text-first 模式；`clone()` 顺带修掉次生缺陷（原实现 `.json()`
    消费 body，下游 `.json()` 报 "Body has already been used"——t3 用例固化）。
- **验证结果**：探针 SyntaxError 消失（仅剩浏览器原生 404 网络日志）、vitest 236/236、
  typecheck 0 错、改动文件 eslint 0 error。
