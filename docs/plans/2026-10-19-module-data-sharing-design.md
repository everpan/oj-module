# 模块间数据共享架构设计（服务调用 / 事件 / 前端态）

> 日期：2026-10-19 · 状态：**设计稿（脑暴已收口，待评审）**
> 读者：系统架构师 / 技术负责人 / 解决方案开发者
> 术语：解决方案=solution=模块（一对同名前后端）；通道=跨模块数据面；属主=表/topic/store 的声明方模块

## 1. 背景与问题

解决方案市场里，模块由不同开发者、不同仓库产出，但运行在同一站点共享根（`api/modules/`）里共居。三类数据共享需求已被确认：

1. **服务调用**——A 需要 B 的 API 能力；
2. **事件**——A 的状态变更要让 B 知道；
3. **前端态**——A 的实时状态要让 B 的界面消费。

约束基座（既有事实，本文不推翻）：

- 后端模块统一挂 `/api/<name>`（约束 A），跑在 oj isolate（每请求重建 handler，模块级状态不跨请求）；
- 跨模块表读靠 `deps` 自证声明（`ownership_guard` warn/deny），**写隔离 OJ-7 未落地**（唯一 oj 侧阻塞项）；
- 前端 `ctx.utils.request` scoped 到本模块登记的 apiPrefix（P6.3 安全模型）；
- provider 槽位先到先得（authProvider/notificationsApi/systemApi/routesApi/uploadApi/layout）；
- `http.module.{name,version}` 调用方身份已落地（oj 0.1.76，只读 frozen）；
- isolate 有 WHATWG `fetch`；`http.headers` 可读（token 转发前提）；
- 无后台 worker，长任务只能分段+状态文件续跑。

## 2. 决策记录（D1–D8，本次脑暴收口）

| # | 决策 | 备选（未选） | 理由 |
|---|---|---|---|
| D1 | 三通道都建：服务调用 + 事件 + 前端态 | 只做服务调用 | 三类需求均确认存在 |
| D2 | 跨模块鉴权=**用户身份穿透**（B 按登录用户判权） | 服务身份 token | B 零改代码即获得正确鉴权语义；无凭证签发新面 |
| D3 | 事件=**纯日志 + 拉取**（append-only 表 + cursor pull） | 同步扇出 | isolate 无后台 worker，扇出失败处理重；拉取无失败面 |
| D4 | 前端态=**分层**：共享 store（数据多播）+ provider 槽位（能力单例） | 二选一 | 两者语义不同，见 §6.2 |
| D5 | 架构=**约定优先 + 最小框架原语** | 框架重中介 / 纯约定 | 重中介每跳 HTTP 且与自包含哲学冲突；纯约定无强制力 |
| D6 | 放置=**契约在 runtime，实现在 `_platform/_shared`** | 全进 runtime | 后端 handler 不 import npm 包（现状），共享 service 相对导入是既有模式 |
| D7 | 前端 client=**前端不跨模块直调生成 client**；默认代理，**声明式直连**为可选第二轨 | 一律代理 / 消费方各自生成 | 一律代理在聚合/大载荷有真实 loopback 开销；各自生成有版本漂移 |
| D8 | **共享型通道一律「系统提供 + 自由发射 + 无抢占」**；provider 槽位只保留给「接管型」能力 | — | 通知铃是框架 chrome 不是业务能力，被抢占即坏 |

**D8 首个落地：notificationsApi 系统提供化**（§6.3）。

## 3. 总体架构

**核心原则：前端只调自己后端（默认），跨模块数据面收敛到后端 + 系统共享通道。**

```
浏览器 ── 自己模块的 /api/<name> ──► A 后端 ──callModule(用户穿透)──► B 后端
   │                                                        ▲
   └── 声明式直连 /api/b/*（白名单放行，可选轨）───────────────┘
   │
   └── ctx.shared 订阅 A/B 的共享 store（浏览器内广播）

A 后端 ──publish(topic)──► _platform 事件表 ◄──pull(cursor)── B 后端（自己请求内补拉）
任意模块 ──notify.push()──► _platform 通知服务 ──► 铃 widget（per-user / broadcast）
```

**放置分层（D6）**：

| 层 | 位置 | 内容 | 消费方式 |
|---|---|---|---|
| 前端态 + 契约类型 | `packages/runtime` | `ctx.shared` API、槽位扩展、错误码类型 | web 代码 import |
| 后端原语 | `_platform/_shared/service/` | `module-call.ts`、`events.ts`、通知服务 | handler 相对导入（与 `assertPermission` 同模式） |
| 逐对 client | `ojm api` 生成 | 直连轨的 typed client | 生成进消费方 `web/src/<b>/__client` |

**授信哲学与 OJ-7 一致：属主侧声明。** 本设计零跨模块写表（事件表唯一写入口是 `_platform` publish 服务），不依赖未落地的 OJ-7；OJ-7 落地后 `export_writes` 可叠加收紧，本文机制不需改写。

## 4. 服务调用通道（双轨，D7）

### 4.1 公共语义

- 身份穿透：代理轨转发 `http.headers.authorization`；直连轨浏览器直发。B 侧 `assertPermission` 按登录用户判权。
- 调用方可观测：B 侧 `http.module.name` 即调用方模块身份（oj 0.1.76 注入，不可伪造）——注意直连轨时 B 侧 `http.module.name === "b"`（路由属主），「经 A」归因丢失，仅可加不可信提示头作审计线索。
- 错误信封统一：`{ ok, code, message, data? }`；错误码单一真源定义在 runtime/`_platform` 契约类型。

### 4.2 轨 1：后端代理（默认）

```ts
// _platform/_shared/service/module-call.ts
callModule(name, method, path, { body?, query?, required? })
```

- URL：`siteOrigin()`（site-facade.ts:20，非请求上下文返回 null 即拒调）+ `/api/<name>/<path>`；
- `required: true`（缺省）：B 未装 → `module_unavailable`（含 B 名 + 安装指引）；网络失败 → `module_unreachable`；B 的 4xx/5xx 原样透传；
- `required: false`：同上但语义为「可选增强」，A 走降级路径（唯一允许静默降级的声明式路径）。

### 4.3 轨 2：声明式直连（可选）

- A 的 manifest 声明 `api.deps: {b: "^1.2"}` → 安装期把 b 的 apiPrefix 登记进 A 的前端放行清单（`modules.json` A 条目 `allowed_prefixes`）；
- A 的 entry 调 `ctx.register.apiPrefix("/api/b")` 时 runtime 校验 ∈ 放行清单，否则拒绝——scoped 模型从「只信自己」放宽到「自己 + 声明过的依赖」；
- client 由 `ojm api` 从 B 的 openapi 生成，钉死 `b@1.2`；B 升级出不兼容版本时安装预检拦 A（deps 范围不满足）；
- B 未装时浏览器请求 `/api/b/*` 得框架层结构化 404（含「模块未安装」），非 oj 原生 404 文本。

### 4.4 选轨规则（写进开发者文档）

写操作 / 需归因 / A 二次加工缓存 → 代理；读密集 / 前端聚合 N 模块 / 大载荷流转发 → 直连。代理成本为一次 loopback 全栈往返（估 0.5–2ms：TCP + JWT 复验 + 路由 + 双次序列化），DB 型端点可忽略，缓存型端点翻倍，聚合场景线性叠加——直连轨的存在就是为了这后两类。

## 5. 事件通道（纯日志 + 拉取，D3）

**存储**：`_platform` 单属主持有 `sys_module_event`（append-only）：`id`（自增=cursor）/ `topic` / `publisher` / `payload`(json) / `created_at`。**无新 HTTP 端点**——与「前端只调自己后端」一致。

**发布**：A 的后端 handler 相对导入 `_platform/_shared/service/events.ts`，`publish(topic, payload)` 写表即返回（与 `assertPermission` 同调用模式）。

**拉取**：订阅方 B 的后端在自己的请求内调 `pull(topics, sinceCursor)` 直拉，经 B 自己的端点喂 B 的前端。cursor 进度存 **B 自己的表**——订阅进度是订阅方状态，不占框架面。

**契约三件套（安装期校验）**：

| 声明 | 位置 | 内容 |
|---|---|---|
| `api.provides.events[]` | 发布方 manifest | topic + 可见性（`public` / `allowed:[模块白名单]`） |
| `api.consumes.events[]` | 订阅方 manifest | topic + 期望的 publisher 版本范围 |
| 发布方卸载 | — | topic 失效，订阅方 pull 到空自然降级 |

可见性=属主侧授信：B 声明 consumes 而发布方 `allowed` 不含 B → 安装期拒装（或 public 放行），与 OJ-7 `export_writes` 同哲学。payload 结构 v1 不做框架级校验（YAGNI），双方契约文档约定。

**保留策略**：`_platform` 按时间窗 GC（建议 30 天）；事件表不随订阅方卸载受损。

## 6. 前端态通道（D4 + D8）

### 6.1 共享 store（数据多播）

在现有 `register.store`/`getRegisteredStore`（module-loader/index.ts:54、333）上加固：

| 机制 | 现状缺口 | 加固 |
|---|---|---|
| 命名空间 | 全局裸名，碰撞=后者覆盖 | `ctx.shared.declare(name, store)` 强制 `<module>.<name>`，属主前缀由 ctx 闭包注入（同 headerProvider 模式，伪报不了他人属主） |
| 导出声明 | 无 | manifest `web.exports.stores[]` 安装期校验：declare 集合 ⊆ 声明集合，漏声明 fail-fast |
| 订阅 | 无跨模块订阅通道 | `ctx.shared.get(owner,name)` / `ctx.shared.subscribe(owner,name,listener)` |
| 卸载清理 | **registeredStores 从不清理**（unloadModule 只清 slots/providers/layouts） | 属主卸载=移除其全部 store + 广播 `gone`，订阅方据此降级 |
| 韧性 | — | 属主未装/已卸 → `get` 返回 undefined、`subscribe` 收 `unavailable`；UI 降级是订阅方职责 |

类型契约 v1 从简：双方各自声明 interface + 文档约定，运行时不强校验 store 形状（同一解决方案内前后端的既有信任级别，不因跨模块升格）。

### 6.2 与 provider 槽位的分工（D4）

store=同屏实时态（无持久化语义，刷新重拉）；slot=能力单例（一个能力只有一个实现者）。**槽位仅保留「接管型」能力**：authProvider（登录流接管）、layout（布局覆盖）——天然单实现者且语义是接管。共享型能力（人人要用的数据面）走 D8：系统提供，不走注册表。

### 6.3 notificationsApi 系统提供化（D8 首落地）

| 层 | 现状 | 改为 |
|---|---|---|
| 存储 | notification 模块自持两表 + 回执表 | 迁 `_platform` 第一方表（`sys_notification*`，与 `sys_oplog` 同籍） |
| API | notification 模块的 push/push-broadcast/list/markRead | `_platform` 端点（普通 Bearer 域，非 superadmin） |
| 发射面 | `notify` facade 委托「注册的 provider」，未注册抛错 | facade 固定委托框架服务，**注册表路径整个删掉** |
| 铃 widget | runtime 布局 widget | 不变 |
| 样例 notification 模块 | 能力提供者 | 退化为演示消费者（去留另出实施计划） |

**广播权限分级**（已确认）：per-user 推送自由（任何登录模块可发，同今日 Bearer 口径）；broadcast（全员公告）加框架权限码门禁（`system.notification.broadcast`），防第三方模块滥用全员广播。

**与事件通道边界**：两个都是「系统提供、自由发射」，但铃=系统→用户（per-user 投递 + 已读回执），事件=模块→模块（append-only 主题流、无已读态、pull 模型）。不合并。

## 7. 韧性与错误处理汇总

| 通道 | 失败态 | 表现 |
|---|---|---|
| 代理 | B 未装 | `module_unavailable`（含安装指引） |
| 代理 | loopback 失败 | `module_unreachable`，不伪装成 B 的业务错误 |
| 代理 | B 返回 4xx/5xx | 状态码 + 体原样透传（B 的信封优先） |
| 直连 | B 未装 | 框架层结构化 404（「模块未安装」） |
| 直连 | 前缀不在放行清单 | 客户端 scoped request 即拒 |
| 事件 | publisher 卸载 | topic 失效，pull 到空自然降级 |
| 事件 | pull 失败 | 订阅方按自身重试（无框架 SLA） |
| store | 属主卸载 | subscribe 收 `gone`；get 返回 undefined |

统一原则：跨模块失败一律显式可观测；只有 `required:false` 声明式路径允许静默降级，其余禁止静默 undefined/空数组伪装成功。

## 8. 契约与安装期校验汇总

新增 manifest 字段（全部安装期 fail-fast，零运行期动态授权）：

- `api.deps`（既有，范围算子）——服务调用白名单与 client 版本钉死的依据；
- `api.provides.events[]` / `api.consumes.events[]`——事件 topic 契约与可见性；
- `web.exports.stores[]`——共享 store 属主声明；
- `modules.json` 条目 `allowed_prefixes`——直连轨前端放行清单（安装器按 deps 登记）。

新端点（如有）按 openapi.json↔`__client`↔init.test.ts 三处同步，`ojm api --check` 守卫。

## 9. 测试策略

**E2E（tests/e2e，真装两个方案）**：

- 双轨：装 A+B → ① 代理轨验证用户穿透（B 侧见登录用户、无 token 401）；② 直连轨放行清单内 200、未声明 deps 被 scoped 拒；
- 事件：A publish → B 请求内 pull 到（cursor 递进）；未声明 consumes 安装期拒装；publisher 卸载后 pull 到空；
- 前端态：A declare → B subscribe 收更新；A 卸载 → B 收 `gone` 降级；
- 通知铃回归：任意模块 emit 即入铃（无注册步骤）；broadcast 无权限码 403；per-user 推送到达对应用户。

**单测**：callModule 错误信封四态 + token 转发 + `required` 语义；events publish/pull/cursor + `allowed` 过滤 + append-only 无改删路径；shared store 命名空间强制 + 卸载清理 + 订阅通知。

## 10. 不在本期范围（后续项）

1. **其余 provider 槽位系统提供化**（已确认暂记录）：`systemApi`/`routesApi`/`uploadApi` 按 D8 原则同为「共享型」候选——系统角色菜单 API、动态路由拉取、上传端点本就是框架面，宜在后续期次评估系统提供化。
2. 共享 store / 事件的 types-only 契约包分发（编译期类型共享，现为文档约定）。
3. 通知样例模块（notification）表与端点迁 `_platform` 的具体迁移实施。
4. 事件 payload 的框架级 schema 校验（v1 为双方约定）。

## 11. 待确认 / 开放点

1. `_platform` 通知端点放普通 Bearer 域后，与既有 `/api/_platform/*` 的 `assertSuperAdmin` 独占口径（R9）如何切分——通知域需显式声明为「非 admin 域」，防口径漂移。
2. 直连轨 `allowed_prefixes` 的运行时形态（modules.json 条目 vs 独立注册面）待实施期定。
3. 事件表 GC 保留窗（30 天为建议值）与订阅方 cursor 落后于 GC 窗口时的行为（拉取间隙 → 订阅方收到 `gap` 信号自行决定重全量或告警）待实施期定。
