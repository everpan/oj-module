# ojm preview 单服务化：调查与可行性评估

> 日期：2026-10-19 · 状态：评估（未实现） · 关联：设计 §6（preview）、D9 历史修订
>
> 议题：`ojm preview` 应只起一个服务、前后端一起部署预览，不经 proxy 访问后端。
> 本文 = 现状调查 + oj 0.1.80 能力实证 + 方向评估 + 推荐方案。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 单服务（前后端一个进程）技术可行吗？ | **可行**。oj 0.1.80 的 `mounts` 模型原生支持「一个 api 挂载 + 一个 web 挂载 + SPA 深链回落」，本文已用本仓 `bin/oj`（0.1.80）实测通过 |
| 今天为什么是双服务 + proxy？ | 2026-09-01 审阅记录二 D9：当时 oj v0.1.0 **静态服务无 SPA 回退**，官方绕行是前置反代，故定「ojm 静态层兜底 + oj 仅 API」。**该前提已于 oj 0.1.58（mounts + spa: true）过期** |
| 推荐方向 | **方向 2：派生 config 单服务**——ojm 不再自建 http server，改为现场生成预览用 config（upsert web 挂载 + `spa: true`），只 spawn 一个 `oj serve`。保留 SPA 深链与端口参数，用户零配置 |
| 最大代价 | ① `web.config.ts` 的 `htmlTransform` 在单服务 preview 失效（今日 `--oj-static` 同样失效，需文档引导到 oj `html_meta`/`html_meta_handler`）；② 预览端口从 ojm 的 4173 变为 oj 的 `server.port`（默认 9778）；③ 少数静态行为差异（405/Range/畸形 URL，见 §6.3） |
| 不在范围 | `ojm dev` 保持双服务不动（SSE 热更 / 宿主 hostRoots / 模块产物优先都依赖 ojm 静态层，且 dev 本就不是生产形态） |

## 1. 现状：preview 的两个监听者

`packages/cli/src/preview.ts`（120 行）当前编排：

1. fail-fast 四查（`bin/oj`、`api/config.yaml`、`web/dist/index.html`、`api/dist/manifests.yaml`）；
2. `oj migrate -c <config> -d <apiDist>`（非零即退，不起 server）；
3. spawn `oj serve -c <config> -b <base> --api-path <apiDist>`（release/js，**仅 API**，监听 `server.port`）；
4. ojm 自建 `http.createServer`（默认 **4173**）：静态走 `createStaticHandler`（SPA 回退、可选 `htmlTransform`），`${base}/*` 经 `proxyApi` 反代到 oj 子进程；
5. `--oj-static`：给 oj 传 `--app-path <siteDir>` 直出静态（**已知限制：history 深链 404**）。

即默认形态 = 两个监听者（ojm 4173 + oj 9778）+ 一层 Node 反代。

**这一形态在任何生产拓扑里都不存在**：生产要么 oj web 挂载直出（devkit 手册 §「静态站点与 per-route meta」），要么前置反代/CDN 直出 SPA（手册「部署形态提醒」）。ojm 静态层 + proxy 是只为 preview 存在的第三种形态。

## 2. 历史决策链（前提已过期）

`docs/archive/prd/202609011158-uni-dev-design.md` 审阅记录二：

> 与业界不符 | preview 依赖的 oj 静态层无 SPA 回退，且 oj 手册自述官方绕行就是前置反代，ram dev 已有现成实现 | D9 修订：preview 默认 ram 静态层兜底 + oj 仅 API；`--oj-static` 直出留作选项

oj 0.1.58 起重写挂载模型（顶层 `mounts:`，一行 = 前缀 + 目录，api/web 恰好其一），并引入逐挂载 `spa: true`（手册 §13：SPA 深链回落需挂载显式 `spa: true`，默认关）。「oj 无 SPA 回退」这一 D9 的基石已不存在；模板 `api/config.yaml` 里甚至已备好注释样例：

```yaml
# 生产若由 oj 直出前端（不走 ojm 静态层），取消下一行注释并先 build 出 web/dist：
# - prefix: "/"
#   web: "../web/dist"
#   spa: true
```

## 3. oj 0.1.80 能力实证（bin/oj 实测，2026-10-19）

夹具：/tmp 最小站点（index.html + app.css）+ 现场签发证书三件套 + 最小 api dist（`manifests.yaml` 锁 + `routes.js` 桩）。

| # | 形态 | 配置 | CLI | `/` | `/deep/link` | `/api/health` | 结论 |
|---|---|---|---|---|---|---|---|
| A | 纯 `--app-path` | 无 | `--app-path` | 200 | **404** | — | CLI 折叠不出 SPA（= 今日 `--oj-static` 限制的来源） |
| A′ | 仅 api mount | 仅 api | `--api-path -b --app-path` | 200 | **404** | 200 | 今日 `--oj-static` 全栈等价形态 |
| B | config web mount | web + `spa: true` | 无 | 200 | **200** | 200 | **单服务 + SPA 成立** |
| C | config web + CLI | web + `spa: true` | `--app-path` | 200 | **200** | 200 | CLI upsert **保留** config 的 `spa`（手册「保留 headers/spa」属实） |
| D | web mount 目录缺失 | web → 不存在目录 | — | **拒启** | — | — | 挂载目录缺失 → **整体拒启**（api 一起挂） |
| E | 无 config 纯静态 | 无 | `--app-path` | **拒启** | — | — | 0.1.80 证书强制（手册「纯静态无需配置」表述已过期） |

补充实测：

- **api + web 双挂载共存无冲突**：`/api`（api）+ `/`（web, spa）下，`/deep/link` 200、`/api/health` 200 JSON、`/api/nope` 404 JSON（跨挂载不回落）、`POST /deep/link` 405（web 挂载仅 GET/HEAD）；
- **`oj serve` 无 `--port` flag、无 `OJ_CONFIG` 类 env**：端口只能来自 config `server.port`（`readOjPort` 亦只读 config）；
- CLI `--app-path d` = upsert `{prefix: "/", web: d}`，**不能**设 `spa`；`spa` 只能来自 config 文件。

## 4. 三个方向

### 方向 1：纯 CLI 单服务（`--oj-static` 升默认，最小改动）

preview = 四查 + migrate + `oj serve -c cfg -b base --api-path apiDist --app-path <web/dist>`，ojm 零监听。

- 优：改动最小（preview.ts 砍掉 http server 与 proxy 分支，删 `--oj-static` flag）；真正一个进程。
- 劣：**SPA 深链 404 回归**（形态 A′）——比今日默认预览能力倒退，用户刷新深链即白屏；端口固定 `server.port`（9778），`ojm preview [port]` 位置参数失效；`htmlTransform` 失效。
- 定位：把 preview 当「oj 二进制验收」才成立；作为日常预览不可接受。

### 方向 2：派生 config 单服务（推荐）

ojm 不再自建 server；spawn 前现场生成**预览专用 config**（原 config 的深拷贝，写在 `api/` 下的临时文件，退出即删）：

- upsert `{prefix: "/", web: <web/dist 绝对路径>, spa: true}`（用户已有的 `/` web 条目被覆盖并打日志；其他挂载如 `/docs` 不动）；
- 用户传了 `ojm preview [port]` → 覆盖 `server.port`；
- `oj serve -c <派生config> -b base --api-path apiDist`；相对路径（证书、`db`、`api: src`）天然按派生 config 所在目录解析，与原件一致；
- `startOj` 以派生 config 为 `configPath` → 端口/前缀读取自动正确；
- migrate 仍用**原 config**（与生产公式一致）；派生文件注册 `process exit` / SIGINT / server close 三路清理 + 启动时清上次残留。

- 优：单进程 + SPA 深链 + 端口参数全保留；用户零配置；preview 与「oj serve + web 挂载」的生产公式逐字同形；WS 顺带修好（今日 preview 无 upgrade 隧道，协作端点握不上手；单服务下 oj 原生支持）。
- 劣：① 往工程里写临时文件（git status 噪音、崩溃残留需兜底）；② config 深拷贝的语义风险（结构已知：`mounts`/`server`/`db`/`auth`/`vars`/`platform`/`secrets`/`ldap`，只做两处 upsert，其余原样拷）；③ `htmlTransform` 仍失效（见 §5）。

### 方向 3：配置驱动（用户 config 自带 web mount）

- 模板默认开启 web mount **不可行**：形态 D 实测，`web/dist` 缺失（未 build 的新工程）→ `oj serve` 整体拒启 → `ojm dev` 一起挂。
- 可行变体：模板保持注释；`ojm preview` 检测到 config 无 `/` web 挂载时，人话提示「取消注释模板中三行」或内部走方向 2 兜底。
- 定位：最贴生产，但依赖用户动作；适合作方向 2 的补充提示，不单独成方案。

## 5. 附加维度：htmlTransform（web.config.ts）何去何从

`loadHtmlTransform` 是 **serve 期**钩子（dev 与 preview 默认消费）；`ojm build` 不烘焙。单服务后 oj 直出 HTML，钩子不再被调用——这与今日 `--oj-static` 的既有例外一致（框架指南 §4.3/§4.8 已文档化该例外）。

| 选项 | 内容 | 评价 |
|---|---|---|
| 5a 接受 + 引导 | preview 单服务；配了 `htmlTransform` 时打 WARN 指向 oj `server.html_meta`（构建期 JSON）/ `html_meta_handler`（运行期 GET 路由派发，fail-open、匿名、每次 HTML 多派发一次 JS） | **推荐**。生产若走 oj 托管，meta 本来就该在 oj 侧做；preview 与生产同形 |
| 5b 条件双服务 | 检测到 `htmlTransform` 已配置 → 回落今日双服务 | 保钩子但破坏「只起一个服务」的承诺，且引入第二形态；不推荐 |
| 5c build 期烘焙 | 把 transform 结果写进产物 | 不可行：transform 是逐路由动态函数（`/share/:id`），构建期无法枚举 |

## 6. 推荐方案的行为差异清单（方向 2 + 5a）

### 6.1 不变

四查、migrate 先于起服务、`startOj` 健康轮询/秒退回收/退出善后（SIGINT、3s SIGKILL 升级）、`[oj]` 日志透传、`OJ_PLUGINS_DIR` 注入、fail-fast 人话报错风格。

> 实现期发现（2026-10-19 冒烟）：终端 Ctrl-C 是进程组信号，外层 bin 转发 + 组送达使内层收到**两个** SIGINT——`once` handler 首次触发即摘除，第二个走默认动作杀死进程、清理全没跑。preview 与 dev 的信号 handler 均已改为 `on` + 幂等守卫；preview 侧派生 config 的 `cleanup()` 同步先行。

### 6.2 变化

| 项 | 今日（默认） | 单服务后 |
|---|---|---|
| 监听者 | ojm 4173 + oj 9778（proxy 相连） | **仅 oj（config server.port，默认 9778）** |
| 预览 URL | `http://localhost:4173` | `http://localhost:<server.port>`（`preview [port]` 经派生 config 覆盖仍有效） |
| SPA 深链 | ojm 静态层回落 | oj web 挂载 `spa: true` 回落（条件：无扩展名 + Accept 含 `text/html`/`*/*`/缺失，比 ojm 层略宽） |
| `htmlTransform` | 生效 | **不生效**（WARN + 文档引导 oj `html_meta*`） |
| `--oj-static` flag | 选项 | **删除**（成为默认；按「不加兼容 shim」原则直接移除，usage/指南/教程同步） |
| WS / 协作端点 | preview 无 upgrade 隧道 → 握不上手 | oj 原生支持（附带修复） |
| API 反代跳数 | 浏览器 → ojm → oj | 浏览器 → oj（少一跳，preview 更贴生产） |

### 6.3 静态行为细微差异（需记录，预计无用户感知）

- 非 GET/HEAD 方法打静态路径：ojm 层发文件，oj web 挂载 405（浏览器只发 GET/HEAD）；
- 无 Range/ETag（oj web 挂载不提供；生产经前置反代补，手册 §13）；
- 畸形百分号编码（`/%ZZ`）：ojm 层回 400，oj 侧实测 **200**（按无扩展名路径走 SPA 回落，2026-10-19 真机验证）；
- HTML 缓存头：默认都不加；oj 侧可用 `server.html_cache_control` 全局键表达。

## 7. 改动面（方向 2）

| 文件 | 改动 |
|---|---|
| `packages/cli/src/preview.ts` | 重写：四查 → migrate → 生成派生 config → `startOj(派生config, …)`（无 `--app-path`、无 `http.createServer`、无 `proxyApi`）→ 清理派生 config；返回类型从 `http.Server` 改为 void/句柄 |
| `packages/cli/src/index.ts`（52–57 行） | 删 `ojStatic` 传参；`port` 语义改为「覆盖派生 config 的 server.port」 |
| `packages/cli/src/usage.ts`（23 行） | `ojm preview [port]` |
| `tests/cli/preview.test.ts` | 契约重写：断言派生 config 内容（web 挂载/spa/port）、migrate 参数、单进程、清理；静态/代理/400/transform 用例改按新形态（transform 用例 → WARN 断言）；建议补 e2e：真 `bin/oj` 起单服务，深链 200 + `/api/health` 200 |
| `docs/prd/framework-development-guide.md` §4.3/§4.8 | preview 形态、`--oj-static` 移除、transform 例外改为主形态例外 |
| `docs/prd/oj-fullstack-tutorial.md` §7 | preview 描述与生产公式对齐 |
| `packages/cli/templates/api/config.yaml` | mounts 注释更新：preview 自动注入 web 挂载，无需手动取消注释 |
| `packages/cli/src/dev-proxy.ts` | **不动**（dev 继续用） |

## 8. 风险与未决点

1. **派生 config 写盘**：位置（`api/.ojm-preview.yaml` vs 带 pid/时间戳）、`.gitignore` 是否需要模板提示、崩溃残留的启动清理策略——需定。
2. **用户已有 `/` web 挂载**：派生 config 覆盖还是尊重？建议覆盖 + 日志（preview 的目标就是预览本站点），但 `headers` 等自定义是否保留需定。
3. **畸形 URL / 405 / Range** 差异的补实测（§6.3 第三条）。
4. `html_meta_handler` 每次 HTML 派发一次 JS 的开销（手册 §13）——仅影响选 5a 且配置了 meta 的用户，记录备查。
5. `preview [port]` 与 config `server.port` 双轨的文档表述（哪个是权威）。

## 9. 附：实证复现

``bash`
# 夹具（/tmp/oj-spa-test）：站点 + 证书三件套 + 最小 api dist
# B：config web + spa:true        → /deep/link 200
# A：仅 --app-path                → /deep/link 404
# D：web mount 目录缺失           → oj serve 拒启
```

（实证脚本与日志留存于评估人工作区；关键输出已摘录 §3。）
