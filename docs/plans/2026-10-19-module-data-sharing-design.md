# 模块间数据共享架构设计（服务调用 / 事件 / 前端态）

> 日期：2026-10-19 · 版本：**v2（四方评审已修订）** · 状态：待评审确认
> 读者：系统架构师 / 技术负责人 / 解决方案开发者
> 术语：解决方案=solution=模块（一对同名前后端）；通道=跨模块数据面；属主=表/topic/store 的声明方模块
> v1→v2 修订依据四方评审（产品/架构/工程/安全），处置表见 §0.3

## 0. 评审与处置

### 0.1 评审结论汇总

| 方 | 裁决 | 核心结论 |
|---|---|---|
| 产品 | 修改后通过 | 技术判断扎实；协调面（白名单/版本范围/双轨/权限码）造在第一个协作实例出现之前，需重排优先级 |
| 架构 | 修改后通过 | 两处阻断（契约未挂条款、stores 安装期校验不可执行）+ 版本 skew 与透送链断链 |
| 工程 | 修改后通过 | 一处阻断（callModule origin 取自客户端 Host = SSRF+token 外泄）+ 一批「不补细节第 3 天停工」项 |
| 安全 | 修改后通过 | 两处阻断（callModule path 穿越、push 端点入 Bearer 域）+ 10 高危；多处「工程纪律」被写成「安全边界」需降级措辞 |

### 0.2 v2 关键变更（相对 v1）

1. **范围重排**（PM-P2/P3、AR-M6、EN-P1-5、SEC-B1）：v1 = 代理轨 + store 加固 + 通知系统提供化；事件通道降 v1.1（具名消费对门禁）；直连轨降 v2（四项前置条件）。
2. **callModule 安全条款**（SEC-A1/A4、EN-P0-1/P0-2）：origin 配置钉死、URL 构造断言、错误信封对齐 oj `{code,msg,data}`、A 侧审计、跳数/超时/限流。
3. **通知收发分离**（SEC-D1）：push/pushBroadcast 仅服务端原语；list/markRead/del 才是 Bearer 端点且 user_id 服务端派生。
4. **事件注册表 + 运行期强制**（SEC-C1/C2、EN-P1-4）：topic 属主校验、pull 运行期过滤、pull 形状定形、gap 规则定死。
5. **契约 v1.4 增补**（AR-B1）：新字段条款号 + 双端同步 + 夹具。
6. **诚实性降级**（SEC-G1/G2 等 8 条）：工程纪律与安全边界分离表述。

### 0.3 评审意见处置表

| 编号 | 严重度 | 处置 | 落点 |
|---|---|---|---|
| PM-P1 通知迁移无切割计划 | 阻断 | 采纳，切割三态入 v1 必做 | §6.4 |
| PM-P2 直连轨无威胁分析/提供侧声明 | 阻断 | 采纳，直连轨降 v2 + 前置条件清单 | §4.5、§10 |
| PM-P3 事件通道无具名消费对 | 阻断 | 采纳，事件降 v1.1 + 门禁 | §5.1、§10 |
| PM-P4 事件白名单协调死锁 | 高 | 采纳，v1.1 只做 public topic，白名单随 OJ-7 | §5.4 |
| PM-P5 广播权限授予链未定义 | 高 | 采纳，判权主体定为模块身份授予记录 | §6.3 |
| PM-P6 _platform 域切分应为决策 | 高 | 采纳，升为 D9 域分级表 | §2、§6.3 |
| PM-P7 选轨规则不可执行 | 高 | 采纳，改为纯性能规则 + 提供侧声明 | §4.4 |
| PM-P8 notificationsApi 字段处置 | 中 | 采纳，deprecated 一个 minor | §6.4 |
| PM-P9 错误信封关系未定义 | 中 | 采纳，对齐 oj 信封 + 两层错误表 | §4.2 |
| PM-P10 401/403 前端陷阱 | 中 | 采纳，禁因 B 的 401 跳登录 | §7 |
| PM-P11 store 命名空间口径 | 中 | 采纳，manifest 写裸名 + 文案正反例 | §6.1 |
| PM-P12 GC gap 复杂度外包 | 中 | 采纳，gap 规则定死 | §5.5 |
| PM-P13 匿名/cookie 穿透 | 低 | 采纳 | §4.2 |
| PM-P14 事件配额与监控 | 低 | 采纳 | §5.5 |
| PM-P15 既有行为回归门禁 | 低 | 采纳 | §9 |
| PM-M2 零协作样例 | 缺失 | 采纳，列为 v1 交付物（A+B fixture） | §9 |
| PM-M5 安装披露面 | 缺失 | 采纳 | §4.5、§10 |
| AR-B1 新字段未挂契约条款 | 阻断 | 采纳，契约 v1.4 + C2-43~47 | §8 |
| AR-B2 stores 安装期校验不可执行 | 阻断 | 采纳，搬迁到宿主加载期 + 构建期 AST 扫描 | §6.1、§8 |
| AR-H1 allowed_prefixes 透送链四断 + 前缀不可解析 | 高 | 采纳，四步链 + state.yaml 持久化 api_prefix | §4.5 |
| AR-H2 卸载无反向依赖视图 | 高 | 采纳 | §7 |
| AR-H3 _platform 版本 skew 不变量 | 高 | 采纳，GC 禁 prune + append-only 纪律 | §3.3 |
| AR-H4 export_writes 是硬前置 | 高 | 采纳，预申报清单入设计 | §3.2 |
| AR-H5 cursor 生命周期语义空洞 | 高 | 采纳，三条不变量 | §5.5 |
| AR-H6 双轨并用军规 | 高 | 采纳（直连轨降 v2 后仍保留作设计约束） | §4.6 |
| AR-M1 MIN_OJ_VERSION 未抬 | 中 | 采纳，升为实施前置 | §1.2 |
| AR-M3 unload 泄漏面更宽 | 中 | 采纳，registeredApiPrefixes 同批修 | §6.1 |
| AR-M4 _shared 签名漂移 | 中 | 采纳，append-only 纪律 | §3.3 |
| AR-M5 事件近实时期望泼冷水 | 中 | 采纳，「你不会得到什么」声明 | §5.1 |
| AR-M6 契约包分发是直连前置 | 中 | 采纳，随直连轨降 v2 | §10 |
| EN-P0-1 origin 取自 Host | 阻断 | 采纳，配置钉死 + SSRF 第四钉 | §4.2 |
| EN-P0-2 信封冲突 | 阻断 | 采纳 | §4.2 |
| EN-P1-3 allowed_prefixes 全链未定 | 高 | 采纳 | §4.5 |
| EN-P1-4 事件运行期强制缺失 | 高 | 采纳 | §5.3 |
| EN-P1-5 直连 client 分发缺口 | 高 | 采纳，直连降 v2 的核心理由之一 | §10 |
| EN-P1-6 通知迁移三坑（偏斜窗/孤儿/方言） | 高 | 采纳 | §6.4 |
| EN-P1-7 stores 声明安装期不可得 | 高 | 采纳（同 AR-B2） | §6.1 |
| EN-P2-8 pull 形状/cursor 类型 | 中 | 采纳 | §5.5 |
| EN-P2-9 loopback 超时/重试/估值 | 中 | 采纳，0.5–2ms 标注待实测 | §4.2 |
| EN-P2-10 非请求上下文影响面 | 中 | 采纳，callModule 限请求上下文 | §4.2 |
| EN-P2-11 gone 形状 + apiPrefix 泄漏 | 中 | 采纳 | §6.1 |
| EN-P2-12 e2e 基建位置 | 中 | 采纳，lifecycle-e2e / Playwright 分工 | §9 |
| EN-P2-13 unavailable 探测机制 | 中 | 采纳，注册表 + 404 归类 | §4.2、§5.3 |
| EN-P2-14 cookie 会话凭据面 | 中 | 采纳 | §4.2 |
| EN-P3-17 topic 无命名空间 | 低 | 采纳，`<publisher>.<name>` | §5.2 |
| SEC-A1 callModule path 穿越 | 阻断 | 采纳，URL 构造条款 | §4.2 |
| SEC-A2 混淆代理人 | 高 | 采纳，结构性事实明示 + exports.endpoints | §4.2、§4.5 |
| SEC-A3 凭证经手模块代码 | 高 | 采纳，短时效 token 前置 + 禁落库 | §4.2 |
| SEC-A4 origin SSRF | 高 | 采纳（同 EN-P0-1） | §4.2 |
| SEC-A5 http.module 是路由属主非调用方 | 高 | 采纳，事实纠正 + A 侧审计 | §4.2 |
| SEC-A6 loopback 递归/DoS | 中 | 采纳 | §4.2 |
| SEC-B1 白名单非访问控制 | 高 | 采纳，措辞降级 + 提供侧 direct 声明 | §3.3、§4.5 |
| SEC-C1 publish 无属主校验 | 高 | 采纳 | §5.3 |
| SEC-C2 可见性无运行期执行 | 高 | 采纳 | §5.3 |
| SEC-C3 事件 DoS 三件套 | 高 | 采纳 | §5.5 |
| SEC-C5 append-only 是服务属性 | 中 | 采纳，措辞降级 | §3.3 |
| SEC-D1 push HTTP 化=钓鱼 API | 阻断 | 采纳，收发分离 | §6.3 |
| SEC-D2 broadcast 判权主体错位 | 高 | 采纳 | §6.3 |
| SEC-D3 铃 widget link/avatar | 中 | 采纳 | §6.3 |
| SEC-E1 store 无可见性/双路径 | 高 | 采纳 | §6.1 |
| SEC-E2 恶意 store 对象 | 中 | 采纳，防御性包装 | §6.1 |
| SEC-E4 store 广播 DoS | 中 | 采纳 | §6.1 |
| SEC-F1 新通道零审计 | 中 | 采纳 | §4.2、§5.3、§6.3 |
| SEC-G1/G2 措辞越界 | 高 | 采纳，降级清单 | §3.3 |
| SEC-H1 authProvider/layout 抢占 | 高 | 采纳，记入后续项决策 | §10 |

---

## 1. 背景与约束基座

解决方案市场里模块由不同开发者、不同仓库产出，在同一站点共享根（`api/modules/`）共居。三类数据共享需求：服务调用、事件、前端态。

既有约束（本文不推翻）：

- 后端模块统一挂 `/api/<name>`（约束 A），跑在 oj isolate（每请求重建 handler，模块级状态不跨请求）；
- 跨模块表读靠 `deps` 自证声明（`ownership_guard` warn/deny）；**写隔离 OJ-7 未落地**；
- 前端 `ctx.utils.request` scoped 到本模块登记的 apiPrefix（P6.3）；
- provider 槽位先到先得（authProvider/notificationsApi/systemApi/routesApi/uploadApi/layout，其中 layout 是覆盖语义非纯抢占）；
- `http.module.{name,version}` 由**路由分发按 handler 文件所属模块目录**注入、只读 frozen（oj 0.1.76）——**它是路由属主身份，不是调用方身份**（v1 表述错误，v2 纠正，见 §4.2）；
- isolate 有 WHATWG `fetch`；`http.headers` 可读；
- 无后台 worker；长任务只能分段+状态文件续跑；
- oj 信封统一为 `{code, msg, data}` 且 HTTP 状态码=code（code=0→200）；
- release 构建把跨模块相对导入改写为指向目标模块**版本目录**的相对路径（版本钉死）。

### 1.2 实施前置（v2 新增）

| # | 前置 | 理由 |
|---|---|---|
| 1 | `MIN_OJ_VERSION` 抬至 ≥ 0.1.76（`vendor.ts:37` 现为 0.1.73） | `http.module` 是全部归因/校验的授信基座，低版本静默退化 |
| 2 | oj 入口剥离客户端 `x-oj-*` 内部头（上游项） | 跳数计数与调用方提示头不可被浏览器伪造 |
| 3 | 短时效 access token + 旋转 refresh（站点侧） | 代理轨=用户凭证经手模块代码（SEC-A3），压缩失窃窗口 |

---

## 2. 决策记录

| # | 决策 | 备选（未选） | 理由 |
|---|---|---|---|
| D1 | 三通道都建 | 只做服务调用 | 三类需求均确认存在 |
| D2 | 跨模块鉴权=**用户身份穿透** | 服务身份 token | B 零改代码获得正确鉴权语义；无凭证签发新面 |
| D3 | 事件=**纯日志 + 拉取** | 同步扇出 | isolate 无后台 worker；拉取无扇出失败面 |
| D4 | 前端态=**分层**：共享 store + provider 槽位 | 二选一 | 数据多播与能力单例语义不同 |
| D5 | 架构=**约定优先 + 最小框架原语** | 框架重中介 / 纯约定 | 重中介每跳 HTTP 且与自包含哲学冲突；纯约定无强制力 |
| D6 | 放置=**契约在 runtime，实现在 `_platform/_shared`** | 全进 runtime | 后端 handler 不 import npm 包；共享 service 相对导入是既有模式 |
| D7 | 前端 client=**前端不跨模块直调生成 client**；默认代理 | 一律代理 / 消费方各自生成 | 一律代理在聚合/大载荷有真实开销；各自生成有版本漂移 |
| D8 | **共享型通道「系统提供 + 属主侧授权后自由发射」**；provider 槽位只保留「接管型」 | — | 通知铃是框架 chrome；v2 补「属主侧授权后」——无授权的自由发射即攻击面（SEC-C1） |
| **D9** | **`_platform` 路由按域分级表分域**：编排域（`/market/*`、`/solutions/*`）=`assertSuperAdmin`；管理域（`/api/system/*`）=`assertSystemAdmin`；用户 Bearer 域（`/contacts`、新 `/notification/*`）=登录态+限流 | 一律 superadmin | 抄 `contacts`（D207）先例；每新增端点必须声明属层，防口径漂移 |
| **D10** | **运行期出站仅限配置钉死的 loopback 源**（SSRF 第四钉） | 信任 Host 头 | Host/x-forwarded-proto 客户端可控=SSRF+token 外泄（EN-P0-1/SEC-A4） |
| **D11** | **通知 push 仅服务端原语**（相对导入），list/markRead/del 才是 Bearer 端点 | 全套 HTTP 化 | HTTP 端点分不清模块 handler 与用户浏览器=内置钓鱼 API（SEC-D1） |
| **D12** | **事件/导出走注册表 + 运行期强制**（`sys_module_event_topic`/`sys_module_web_export`/`sys_module`） | 仅安装期声明 | 安装期对账只拦诚实声明者（SEC-C2/E1） |
| **D13** | **范围重排**：v1=代理轨+store 加固+通知系统提供化；事件=v1.1（具名消费对门禁）；直连=v2（四项前置） | 三通道同期全量 | 协调面不应造在第一个协作实例之前（PM-P2/P3） |
| **D14** | **`api.deps` 保持纯耦合声明**，不升级为安装序要求；直连前缀解析失败=任务停 `dependency_not_installed` 可重试 | deps 含存在性强制 | C2-12b 现行口径（安装器不做存在性，避免共享根状态进纯函数校验）只对直连轨破例 |

---

## 3. 总体架构

### 3.1 核心原则与通道图

**前端只调自己后端（默认）；跨模块数据面收敛到后端 + 系统共享通道。**

```
浏览器 ── 自己模块的 /api/<name> ──► A 后端 ──callModule(用户穿透,origin 钉死)──► B 后端
   │
   └── ctx.shared 订阅 A/B 的共享 store（浏览器内广播，注册表校验）

A 后端 ──publish(topic)──► _platform 事件表 ◄──pull(cursor,limit)── B 后端（自己请求内补拉）
任意模块 ──notify.push()──► _platform 通知服务（服务端原语）──► 铃 widget
```

**放置分层（D6）**：

| 层 | 位置 | 内容 | 消费方式 |
|---|---|---|---|
| 前端态 + 契约类型 | `packages/runtime` | `ctx.shared` API、错误码类型 | web 代码 import |
| 后端原语 | `_platform/_shared/service/` | `module-call.ts`、`events.ts`、`notify.ts` | handler 相对导入 |
| 逐对 client | `ojm api` 生成 | 直连轨 typed client（v2 前置见 §4.5） | 生成进消费方 `web/src/<b>/__client` |

### 3.2 与 OJ-7 的关系（v2 修正）

v1 称「零跨模块写表、不依赖 OJ-7」——**措辞越界，纠正为**：

> 本设计零跨模块**直写**；跨模块写收敛于 `_platform` 单一服务收口。OJ-7 落地前这是**工程纪律**（模块可 `db` 绕过服务直写表），落地后随 `export_writes` 升格为边界。

`export_writes` 是 OJ-7 deny 模式下的**硬前置**（非可选收紧）——`publish` 在 SQL 层即「A 写 `_platform` 的表」。预申报清单：

```yaml
# _platform/manifest.yaml（OJ-7 落地时）
export_writes:
  sys_module_event:      { to: "*", mode: append_only }
  sys_module_event_topic: { to: "_platform" }        # 仅安装器注册路径
  sys_notification:      { to: "*" }
  sys_notification_broadcast: { to: "*" }
  sys_notification_broadcast_read: { to: "*" }
  sys_module_web_export: { to: "_platform" }
```

且发布方 manifest 须 `deps: {_platform: ...}`（站点 `ownership_guard: deny` 时拒无声明者）。

### 3.3 诚实性分级（工程纪律 vs 安全边界）

| # | v1 措辞 | v2 措辞 |
|---|---|---|
| 1 | 本设计零跨模块写表 | 零跨模块**直写**；服务收口在 OJ-7 前是工程纪律 |
| 2 | 直连白名单放行 | 前端**开发期护栏**（纵深防御前半）；访问控制始终在 B 的端点鉴权，与放行清单无关 |
| 3 | 事件可见性=属主侧授信（安装期拒装） | 安装期注册 + **运行期校验**（D12）；无运行期校验时仅为安装期工程检查 |
| 4 | append-only 无改删路径 | 服务 API 无删改路径；表级可删性至 OJ-7 落地前存在 |
| 5 | 事件表不随订阅方卸载受损 | 服务语义不受损；OJ-7 前可被 `db` 直删 |
| 6 | D8 自由发射 | 系统提供 + **属主侧授权后**自由发射 |
| 7 | `http.module.name` 即调用方身份 | `http.module` 是**路由属主**身份；双轨下 B 侧均只见属主；不可伪造≠可归因 |

### 3.4 版本 skew 不变量（v2 新增）

1. **GC 禁 prune**：任何被已装方案 import 过的 `_platform` 版本目录不得 prune（最低成本不变量，写进 GC 设计）。
2. **`_shared` 服务 API append-only 演进纪律**：只增参/增导出、不改语义；破坏性变更=`_platform` major + peerPlatform 拦截。
3. `_shared` 增补文件时不 bump `_platform` 模块版本（兼容性经 peerPlatform/API_VERSION 表达），避免既有 bundle 导入路径悬空。
4. `packages/core/src/module-loader` 是 runtime 的平行蒸馏副本（已发布供外部宿主 importmap）——本期改动**双包同步**或显式声明 core 不在范围，不留暗歧。

---

## 4. 服务调用通道

### 4.1 公共语义（v2 修正）

- **身份穿透**：代理轨转发 `http.headers.authorization`（+ cookie，按站点会话形态，v1 仅 Bearer 站）；直连轨浏览器直发。B 侧 `assertPermission` 按登录用户判权。
- **归因（v2 纠正）**：`http.module.name` 在 B 侧**两轨均为 "b"**（路由属主）。调用方归依**A 侧审计**：`callModule` 服务在 A 侧落 `recordOp({caller: http.module.name, target: "<b>/<path>", user_id})`；B 侧可记录 `x-oj-caller` 提示头但标注「不可信」——**任何客户端/被调方可设的头不得作为审计依据**。
- **错误信封两层**（对齐 oj，v2 修正）：
  - 框架层（callModule 自身失败）：抛 `ModuleCallError{code}`，code 全集=`module_unavailable` / `module_unreachable` / `origin_untrusted` / `timeout` / `hop_limit_exceeded` / `path_rejected`；A 的 handler 捕获后自行决定呈现。
  - 业务层（B 的响应）：原样透传 oj 信封 `{code, msg, data}`，A 前端单一解析器处理。
  - 错误码单一真源=runtime 契约类型（新增 export 入口，非既有三入口）。

### 4.2 代理轨 callModule（v2 大幅加固）

```ts
// _platform/_shared/service/module-call.ts
callModule(name, method, path, { body?, query?, required? })
```

| 条款 | 规则 |
|---|---|
| **origin 钉死（D10）** | 站点基址取框架设置/配置（`framework.site_base_url`），**禁从 Host/x-forwarded-proto 推导**；Host 头仅作一致性复核，不符即拒调（`origin_untrusted`）。ARCHITECTURE §12 SSRF 三钉同步修订为第四钉 |
| **URL 构造断言** | `name` 限 `^[a-z][a-z0-9-]{0,63}$`；`path` 禁前导 `/`、禁 `..` 段、禁控制字符、禁绝对 URL、`?`/`#` 编码后拼接；归一化后断言 `url.pathname.startsWith("/api/" + name + "/")`，否则拒发（`path_rejected`）+ `auth.deny` 审计 |
| **上下文** | 仅请求上下文可调（`siteOrigin` 无 Host→拒调的语义保留，但 Host 缺失不再单独当安全边界）；安装钩子/任务桥/`run_with` 场景不可用 |
| **超时** | 内置 `AbortSignal.timeout`（默认 5s 可配），必须 < oj route timeout |
| **跳数/循环** | 内部跳数头（oj 入口剥离客户端同名头，前置项），单请求上限 3 跳，超限 `hop_limit_exceeded` |
| **限流** | 每 (caller, target) 限流（复用 `_shared/service/rate.ts`） |
| **凭据 custody** | 转发 authorization(+cookie)；**禁令牌落库/外发**（工程要求+供应链审查）；短时效 token 为上线前置（§1.2） |
| **required 语义** | `true`（缺省）：B 未装→`module_unavailable`（含安装指引）；网络失败→`module_unreachable`；B 4xx/5xx 透传。`false`：同上但允许静默降级（唯一路径） |
| **探测机制** | B 未装与路径写错同显 oj 404（msg 恒 `no route matched`）——按 404 归类 unavailable 会误报；以 `sys_module(name, version, api_prefix)` 注册表（registering 段 upsert）判定「已装但不可达」vs「未装」，消歧 |

**混淆代理人结构性事实（明示，不可消除只可收敛）**：属主 opt-in 前，「模块可在用户会话内驱动该用户可及的一切端点」是结构性事实——B 的 `assertPermission` 为**用户意图**设计，不为**模块代发**设计；U 是 admin 时四级链前两级全通。收敛路径=属主侧端点出口声明（§4.5）+ OBO token（上游立项）。

### 4.3 选轨规则（v2 修正）

归因要求是 B（被调方）的属性，对 A 不可判定——v1「需归因→代理」不可执行，v2 改为：

- **调用侧可判定的纯性能规则**：读密集/前端聚合/大载荷→直连；其余→代理。
- **提供侧容忍声明**：B 在 manifest 声明端点是否容忍直连轨（§4.5 `api.direct`），不容忍即只能代理。

### 4.4 韧性表（v2 扩充）

| 失败态 | 表现 |
|---|---|
| origin 不可信/缺失 | `origin_untrusted`，拒调 |
| B 未装 | `module_unavailable`（注册表消歧） |
| loopback 失败 | `module_unreachable` |
| B 返 401/403 | 原样透传；**A 不得因 B 的 401 自动跳登录/清 token**（「权限不足」≠「登录失效」），e2e 钉死 |
| 超时/跳数超限 | `timeout` / `hop_limit_exceeded` |

### 4.5 直连轨（v2：降 v2，四项前置）

**前置条件全部满足才允许实施**（PM-P2/SEC-B1/AR-M6/EN-P1-5）：

1. **提供侧端点出口**：manifest `api.exports.endpoints[]`（method+path 模式），默认空=谁都不能调；安装期注册 + callModule 运行期双重校验。同时是 §4.2 混淆代理人的收敛机制。
2. **提供侧直连容忍声明**：`api.direct: allow|deny`（按端点），写端点默认 deny。
3. **分发定夺**：bundle 增 openapi.json 成员（动 C2-30/31 布局+市场索引）或降为「文档约定+手写 client」——未定夺前直连轨标注「机制可验、分发待定」，e2e 只用仓内 fixture 自证，不进市场叙事。
4. **安装披露**：A 声明 `deps:{b}` 时安装摘要/市场卡片展示「A 将能以登录用户身份直连 B 的端点」+ 威胁分析文档。

**机制要点**（前置满足后适用）：deps 声明→安装期把 b 的**真实** apiPrefix（C2-13 可非默认）登记进 A 的 `allowed_prefixes`（`state.yaml` `SolutionEntry.api_prefix` 持久化 + `modules.json` 条目）；`ctx.register.apiPrefix` 运行时校验 ∈ 放行清单（归一化后精确匹配，防 `"/api/_platform/../x"` 前缀把戏）；B 未装时 A 前端自行兜底「模块未安装」空态（oj 上游只读，无框架层结构化 404 载体，v1 表述纠正）；失效=注册表驱动重写（B 卸载/A 升级）。

**allowed_prefixes 全链（v2 补全）**：写入=`deploying_web` 段（安装路径）+ `build.ts`（dev 路径，注意两条路径 dependencies 语义今日已不一致，须对齐）；失效=B 卸载反向级联 + A 升级重写（并入 registering 段 upsert）；读取链四步=`shell/preload.ts` HostModule 字段 → `shell/manifest.ts` toLoaderManifest 透传 → runtime `ManifestModuleEntry` 字段 → `createModuleContext` 接线（现拿不到 entry，唯一接线点=`loadAll` Phase 3 同时持有 entry+definition）；加 shell 侧透传回归单测（P7.7 F1/F2 前科）；`packages/core` 同款同步。

**deps 安装序破例（D14）**：`api.deps` 保持纯耦合声明；直连轨前缀解析时 dep 未装→任务停 `dependency_not_installed` 可重试，不静默。

### 4.6 双轨并用军规（保留作设计约束）

同功能按端点选轨、不按调用点混用；A 不得对代理结果建缓存又对同端点发直连 client；直连轨对 A 前端与代理轨同构（B 信封即 `{code,msg,data}`）；放行粒度=**模块前缀级**（A 可调 B 全部端点，B 端点防护自负——明示，勿误读为端点级授权）。

---

## 5. 事件通道（v2：降 v1.1，具名消费对门禁）

### 5.1 门禁与「你不会得到什么」

**开工门禁（PM-P3）**：必须指定一个具名消费对（含至少一个第一方模块）作为上线验收对象，否则不开工。v1.1 范围=表+publish+pull+`public` topic+GC+gap 规则；`allowed` 白名单与 publisher 版本范围留待 OJ-7 后叠加（PM-P4：白名单存在协调死锁——B 后装被拒而修复动作在 A）。

**语义声明**：你不会得到——推送、扇出、跨 GC 窗口的顺序保证。这是**最终一致性读路径**：B 的看板不会因 A 改状态而更新。近实时前端感知=store 通道（§6.1）；后端最终一致=事件通道。与 oj ws 房间原语分工：本期不用；未来升级扇出的正解是「在线 WS + 离线拉取补洞」双模，非替换拉取。

### 5.2 存储与 topic 契约

`_platform` 持 `sys_module_event`（append-only）：`id`(自增=cursor)/`topic`/`publisher`/`payload`(json)/`created_at`。**topic 命名空间强制 `<publisher>.<name>`**（EN-P3-17，与 permission code 同思路），`_platform` 自留前缀除外。无新 HTTP 端点。

### 5.3 注册表与运行期强制（D12，v2 核心修正）

`_platform` 持 `sys_module_event_topic(module, topic, visibility, allowed)`，registering 段从 `provides.events` upsert：

- **publish**：fail-closed 校验 topic ∈ 调用方 `provides.events`；`publisher` 列由 `http.module.name` **服务端派生**（null 上下文拒发）；落 `recordOp`（detail 只记 topic/size/hash，不记 payload——脱敏红线）。
- **pull**：运行期校验 `topics ∈ 调用方 consumes ∩ 发布方 allowed/public`——**安装期对账只拦诚实声明者，运行期校验才拦绕过声明者**（SEC-C2）；拒绝留 `auth.deny` 审计。
- **契约条款**：订阅方**必检 publisher 列**（防伪造事件注入业务逻辑，SEC-C1）。
- `sys_module(name, version, api_prefix)` 注册表同时服务 §4.2 的 unavailable 消歧。

### 5.4 拉取与 cursor（v2 定形）

```ts
pull(topics, sinceCursor, { limit = 500 }) → { items, nextCursor, gap, oldest_available }
```

- `limit` 强制（默认 500，上限 1000）；cursor 类型 `string|number`，SQL 侧 `CAST` 归一（pg bigint 回 string）。
- **gap 规则定死（PM-P12）**：`sinceCursor < oldest_available` → `gap=true`；订阅方唯一正确动作=从 cursor 0 全量重拉。不留「自行决定」。
- **cursor 生命周期三条（AR-H5）**：① cursor=订阅方业务数据（卸载保留 Q4、重装续用）；② 重装后首次 pull 对照 `oldest_available` 校验，越界即 gap；③ `oldest_available` 由框架返回，框架不猜订阅方幂等语义。

### 5.5 配额与 GC（v2 新增）

- payload ≤ 64KB（超出拒收+审计）；每模块 publish 速率配额（复用 `rate.ts`）；每模块 topic 数上限；pull 强制 limit。
- GC：保留窗 `framework.module_event_retention_days`（默认 30，`sys_setting` 可配，长落后订阅方可抬窗）；**触发机=机会式**（挂 publish 路径或安装钩子——isolate 无 cron，不能假设后台）。
- 运维监控：按 publisher 分组的事件表体积 Top N 进运维文档。

---

## 6. 前端态通道（D4 + D8）

### 6.1 共享 store（数据多播）

在现有 `register.store`/`getRegisteredStore`（module-loader/index.ts:54、333）上加固：

| 机制 | 现状缺口 | v2 加固 |
|---|---|---|
| 命名空间 | 全局裸名，碰撞=后者覆盖 | `ctx.shared.declare(name, store)` 强制 `<module>.<name>`，属主前缀由 ctx 闭包注入 |
| 导出声明 | 无 | manifest `web.exports.stores[]` 写**裸名**（运行时注入前缀）；declare 集合 ⊆ 声明集合校验**搬迁到宿主加载期**（安装器不执行 entry.js，物理上不可验——AR-B2/EN-P1-7）+ `ojm build` 静态 AST 扫描（`ctx.shared.declare("x")` 字面量参数，同 handler-scan 范式）双保险；fail-fast 文案给正反例（声明 `foo`→`demo.foo`；误写 `demo.foo` 的纠正提示） |
| 运行期校验 | 无 | get/subscribe 校验 `(owner,name) ∈ sys_module_web_export` 注册表（安装期 upsert）——安装期声明无运行期执行即装饰（SEC-E1） |
| 双路径 | `getRegisteredStore` 全局裸名仍导出 | **删除旧入口**，禁双路径（RBAC 单一收口教训） |
| 订阅 | 无 | `ctx.shared.get/subscribe` |
| 卸载清理 | registeredStores **且** registeredApiPrefixes 从不清理（AR-M3/EN-P2-11） | 属主卸载=清两者（按属主扫描）+ 广播 `gone`；时序=`gone` 在 `onDestroy` 之后、实例删除之前广播（gone handler 里 `get` 仍可拿到值） |
| 重入/HMR | 未定 | 同名 declare=覆盖+通知订阅者（复刻 apiPrefix 去重先例 index.ts:60-65） |
| 恶意对象 | 无防护 | 交出对象防御性包装：`structuredClone`、剥离 `then/catch/finally/constructor`、禁 getter 副作用、`__proto__` 键剥离（SEC-E2） |
| 广播 DoS | 无 | 节流/合并 + payload 尺寸上限（SEC-E4） |
| 韧性 | — | 属主未装/已卸→`get` undefined、`subscribe` 收 `unavailable`；`gone`/`unavailable` 降级为订阅方**强制契约**（防属主卸载前投毒致 UI 假死，SEC-E3） |

类型契约 v1 从简：双方各自声明 interface + 文档约定，运行时不强校验形状。

### 6.2 与 provider 槽位的分工（D4）

store=同屏实时态（无持久化语义，刷新重拉）；slot=能力单例。**槽位仅保留「接管型」**：authProvider（登录流接管）、layout（布局覆盖）。共享型能力走 D8。

### 6.3 notificationsApi 系统提供化（D8 首落地 + D9/D11）

| 层 | 现状 | v2 改为 |
|---|---|---|
| 存储 | notification 模块自持三表 | 迁 `_platform` 第一方表（`sys_notification*`，与 `sys_oplog` 同籍；三方言迁移） |
| **收发分离（D11）** | push/push-broadcast/list/markRead 全套 HTTP | **push/pushBroadcast=服务端原语**（`_shared/service/notify.ts` 相对导入，与 events.ts 同模式）；**list/markRead/del=用户 Bearer 端点**且 user_id **服务端派生、禁客户端传** |
| 域（D9） | — | `/api/_platform/notification/*` 落用户 Bearer 域（登录态+限流，抄 contacts 先例），非 superadmin |
| 发射面 | notify facade 委托注册 provider，未注册抛错 | facade 固定委托框架服务，注册表路径删除 |
| 铃 widget | runtime 布局 widget | 不变 + **展示发送方模块名**（反钓鱼归属） |
| 内容校验 | 无 | link/avatar 仅 http(s) scheme+长度上限（拒 `javascript:`/`data:`）；title/message 上限；每 (模块,用户) 推送配额 |
| broadcast 门禁 | 权限码 `system.notification.broadcast` | **判权主体=模块身份**：安装期 manifest 意向声明 + superadmin 授予记录（框架表承载）AND/OR 触发用户持码——写死前者为 v1；强制审计（发送方模块、触发用户、内容哈希）。注册主体=system 模块 manifest 声明（C2-15 正则放行 `name=system`），注意 `moduleOf` 使 `system.admin` 直接通过——显式确认此隐含授权面是否有意 |
| 样例 notification 模块 | 能力提供者 | 退化（见 §6.4 切割） |

**为什么不能 HTTP 化 push（SEC-D1）**：HTTP 端点分不清调用者是模块 handler 还是用户浏览器（同源请求可设任意头，`http.module` 两种情形都是路由属主）——「任何登录模块可发」在 HTTP 面上退化为「任何登录用户可向任何人发」，即成内置钓鱼 API（框架 chrome 样式、无发送方标识、`window.open(item.link)` 落地）。per-user 才是精准钓鱼面，门禁加在 broadcast 是加错了面。

### 6.4 迁移切割三态（v2 新增，v1 必做）

| 态 | 动作 |
|---|---|
| 新站点 | scaffold 同发版去掉样例的通知能力 |
| 存量站点 | `_platform` 迁移含一次性 backfill（旧表→`sys_notification*`）；**backfill 前铃双读**；对旧表只读兼容期（或安装器对 notification 模块版本设下限） |
| 过渡期结束 | 样例端点返回 410 + 迁移指引 |

配套必答项：`register.notificationsApi` 字段标 **deprecated 保留一个 minor** 后删（同步 runtime 破坏性发版说明 + `tests/runtime` 出口冻结面）；`api/src/notifications/` 兜底模块（deps:{notification}，查旧表）**明确删除**；0002/0003 补三方言；框架发版与新版样例模块**锁步**（偏斜窗内双写分流=铃看到半个宇宙）；修订 10-13 通知设计文档为 v1 交付物。

---

## 7. 韧性与错误处理汇总（v2 扩充）

| 通道 | 失败态 | 表现 |
|---|---|---|
| 代理 | origin 不可信 | `origin_untrusted` 拒调 |
| 代理 | B 未装/不可达 | `module_unavailable`（注册表消歧） |
| 代理 | loopback 失败/超时/跳数超限 | `module_unreachable`/`timeout`/`hop_limit_exceeded` |
| 代理 | B 返 401/403 | 透传；A **不得**自动跳登录/清 token |
| 直连 | B 未装 | A 前端兜底空态（无框架 404 载体） |
| 直连 | 前缀不在放行清单 | 客户端 scoped request 即拒（**护栏非访问控制**） |
| 事件 | publisher 卸载 | topic 失效，pull 到空自然降级 |
| 事件 | cursor 越 GC 窗 | `gap=true`→全量重拉（规则定死） |
| 事件 | pull 失败 | 订阅方按自身重试（无框架 SLA） |
| store | 属主卸载 | `gone`；`get` 返回 undefined |
| **依赖方断裂** | B 卸载/升级 | 三通道同断；**卸载预检增「反向 deps」影响面**（依赖 §4.5 的 api_prefix 持久化才能读已装声明），UI 二次确认同款口径；运行期无自愈 |

统一原则：跨模块失败一律显式可观测；只有 `required:false` 声明式路径允许静默降级。

---

## 8. 契约与安装期校验（v2：契约 v1.4）

**新 manifest 字段全部可选（append-only 底线：P1 未声明字段省略合法）**，挂条款号：

| 字段 | 条款 | 执行点 |
|---|---|---|
| `api.provides.events[]` | C2-43 | 构建期语法 + 安装期 upsert 注册表 |
| `api.consumes.events[]` | C2-44 | 构建期语法 + 安装期对账 |
| `web.exports.stores[]` | C2-45 | 构建期 AST 扫描 + 宿主加载期运行时校验 |
| `api.exports.endpoints[]` | C2-46 | 构建期语法 + 安装期 upsert + callModule 运行期校验 |
| `api.direct` | C2-47 | 构建期语法 + 直连轨登记依据 |

**双端同步（AR-B1）**：契约文档 v1.4 增补（唯一真源，含规则编号）→ `packages/cli/src/manifest-contract.ts`（Node 侧）+ `_platform/_lifecycle/steps/preflight.ts`（站点侧）同改 + fixtures（valid/invalid 增例）。未挂条款的字段会被现行双端校验器**直接拒装**（契约「未列出顶层键一律拒绝」）。

`allowed_prefixes` 不是 manifest 字段，是安装期派生的 modules.json 站点状态（§4.5）。新端点按 openapi.json↔`__client`↔e2e spec 三处同步（注意：init.test.ts 全仓不存在，第三处实为 routes.js 对账，v1 表述纠正），`ojm api --check` 守卫。

---

## 9. 测试策略（v2：基建分工修正）

**安装/集成场景 → lifecycle-e2e 范式**（`scripts/lifecycle-e2e.mjs`：真站点+本地 CDN+Ed25519 签名+install 全链，新增 A/B 双 fixture 方案）：

- 代理轨：用户穿透（B 侧见登录用户、无 token 401 不伪装）、B 的 403→A 页面展示 message 会话保持
- **安全回归**：path 穿越拒发（`../../_platform/...`）、origin 伪造拒调、未声明 consumes 拉取被拒、伪造 publisher 事件被拒/被订阅方识别、push HTTP 直调被拒（D11）
- 事件：publish→pull→cursor 递进、gap 全量重拉、publisher 卸载后 pull 到空
- 卸载：B 卸载反向依赖预检展示、A 三通道断裂降级
- 直连（v2 后）：放行清单内 200、清单外 scoped 拒、dep 未装任务停 `dependency_not_installed`

**前端态 → Playwright**（playground-oj 挂两个 web entry）：store 订阅更新、`gone` 降级、铃回归（任意模块 emit 即入铃无注册步骤、broadcast 无授予记录 403、per-user 到达对应用户、铃展示发送方模块名）。

**单测**：callModule 六态错误码 + origin 拒调 + token 转发 + URL 断言；events publish 属主校验/pull 过滤/gap/limit；store 命名空间 + gone + 防御性包装（thenable/getter/`__proto__`）。

**回归门禁（PM-P15）**：既有单模块 e2e 全绿是合并门禁——命名空间强制、scoped 放宽都是行为变更。

---

## 10. 范围与排期（v2：D13）

**v1（三项互相独立，可并行）**：

1. 服务调用·代理轨（含全部安全条款）+ 契约 v1.4 + 注册表（`sys_module`/`sys_module_event_topic`/`sys_module_web_export`）
2. shared store 加固（含运行期校验、卸载清理、防御性包装、双路径删除）
3. 通知系统提供化（含切割三态、收发分离、broadcast 授予链、字段 deprecation、兜底模块删除、10-13 文档修订）
4. A+B 协作 fixture（市场叙事的可运行素材，PM-M2）

**v1.1（门禁满足才启动）**：事件通道——具名消费对 + public topic + gap 规则 + 配额 GC。

**v2（四项前置满足才启动）**：直连轨——`api.exports.endpoints` + `api.direct` + 分发定夺 + 安装披露。

**后续项**：① 其余 provider 槽位系统提供化评估（`systemApi`/`routesApi`/`uploadApi`）+ **槽位抢占策略裁决**（authProvider/layout 先到先得无保留名无属主校验=登录流可被劫持，SEC-H1/PM-M6：保留名+属主声明+框架优先装配）；② types-only 契约包分发（直连轨前置）；③ 事件 payload 框架级 schema 校验；④ OBO token 上游立项；⑤ `packages/core` 同步决策。

---

## 11. 待确认 / 开放点（v2：三项已收敛为推荐方案）

1. ~~`_platform` 端点域切分~~ → 已定 D9 域分级表（§6.3），需沉淀进 ARCHITECTURE §12 并加「每新增端点必须声明属层」军规。
2. ~~`allowed_prefixes` 运行时形态~~ → 已定 modules.json 条目（§4.5 全链），独立注册面会重复建设 D13 原子写纪律且是 P7.7 F1/F2 历史故障模式。
3. ~~GC 窗口与 cursor gap~~ → 已定 `oldest_available`+`gap`+可配保留窗（§5.4/5.5）；不推荐框架自动重全量（无从知道订阅方幂等语义，补发=重复投递风险）。
4. **保留**：OJ-7 落地时间表决定 §3.2 预申报清单与 §5.4 白名单叠加的排期；`sys_notification*` 的 R3 mode（full/append_only/columns）待 OJ-7 细则定。
5. **保留**：broadcast 隐含授权面确认（`system.admin` 经 `moduleOf` 第四命中直接通过广播门禁是否有意）。
6. **保留**：短时效 token 的站点侧改造责任方与时间点（§1.2 前置）。
