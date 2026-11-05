# 上游 PR 提案：解决方案免重启生效（oj Rust 侧支持）

> 状态：**待提交上游**（本仓 `oj-module` 为只读分析，上游 `oj` 改动由本提案描述，由人工提交）。
> 关联本仓方案：`docs/plans/20261105-hot-apply-final.md`（定稿）、`docs/plans/20261105-hot-apply-phased-plan.md`（分期与本仓已落地 Phase 1–4）。
> 本提案对应本仓计划书中的上游依赖 **US-1 ~ US-4**。**简化原则**：热装配 = 装/卸后调用一次「正确的 `_system/config/reload`」，不再引入独立的换代身份 / 每代 anon 表机制。

## 0. 背景

`oj` 是单进程常驻服务。当前从市场安装/卸载解决方案后要求重启进程。本仓已完成模板侧的安装/卸载/补偿/门禁编排，但「装/卸真正生效」只能由 `oj` 自身（Rust 侧）实现。原方案拆成 US-1（换代身份）/US-2（每代 anon 表）两个独立机制；经复核，二者本质都是「`_system/config/reload` 没有把 `manifests.yaml`（锁）驱动的装配纳入重装范围」这一单一缺陷的两面——因此**折叠为一个正确的 reload**，方案更内聚、更易验证。

## 1. 核心思路：热装配 = 一次正确的 reload

装/卸两路径改写的资产不同：

- **安装**：同时改 `config.yaml`（追加 anon、bump `ojm_install_seq`）+ `manifests.yaml`（锁加条目）。
- **卸载**：**只改 `manifests.yaml`（摘锁），`config.yaml` 一字不动**。

若 reload 的变化检测只看 `config.yaml`，卸载时 `config` 未变 → `unchanged=true` → 不重装装配 → 模块仍挂载（**卸载空转**）。故方案核心只有一条：

> **`_system/config/reload` 必须同时以 `manifests.yaml`（锁）为变化检测与重装对象，并据此重装 module pipeline + 重编译 anon 表；cron 不被 reload 拆掉。**

满足此条后，安装/卸载只需在落盘后调用一次 reload，绝大多数场景 PID 不变、亚秒级生效。

## 2. 上游需落实的改动

### 2.1 reload 覆盖 manifests 装配（原 US-1 实质）

- reload 的变化检测与重装范围必须包含 `manifests.yaml`（锁）：锁增删模块即产生新 `generation` 并触发装配 → 解决「卸载空转」。
- 每次 reload 重建 `AppState.pipeline` 时从 manifests 重装 module 集合；响应 `applied` 须报告本次变化的模块（`+name@ver` / `-name@ver`），供模板侧 `reloadAndAssert` 断言（期望 `applied` 含 `modules`）。
- `unchanged` 语义：manifests 或 config 任一变化即 `unchanged=false`；*两者均未变*才 `true`（模板侧据此判 reload 真生效，见 §5）。
- 不引入额外 HTTP `scope` 参数（少一个对外契约面）。

### 2.2 reload 重编译匿名表（原 US-2 实质，路线 C）

- 每次 reload 重建 `pipeline` 时，由 `auth.anonymous_paths` + `tenant.anonymous_paths` **重编译** `anon:Matcher`（不依赖「每代单独存表」）。
- `admit()` 在 `guard.verify` **之前**短路：命中 `anon` 即跳过验签。
- 匹配按 `ModuleEntry.prefix` 计算（可与模块名不同、可多段），不按「首段 = 模块名」。
- 保留段黑名单：`_platform` / `_system` / `auth` / `_lifecycle` 下的新增匿名条目一律拒装（模板侧 preflight 已挡声明，上游 dispatch 亦须 honor，双保险）。
- 删除语义：运行期新增的匿名条目删除即立即失效（免重启）；启动期已在 config 的条目删除后 guard 静态表仍含，需重启才彻底撤销——其暴露面受「匿名只对已注册路由有效 + 卸载后路由已无」限制，故规则：**删免重启；但安装 preflight 必须拒绝「目标 prefix 在 config 中存在未被本次 manifest 声明的匿名条目」**（同 prefix 换装不静默继承，本仓 E8 已实现）。
- WS 匿名（P1）：每代把 anon 集合注入 `mirror_routes` + 建 `WsRegistry` 支持卸载主动 close；**P0 只承诺新连接按新代判定**，本 PR 不含 WS 主动断开（P1）。

### 2.3 capabilities 门禁（host 自报 reload 能力）

`ojInfo()` 增 `capabilities: string[]`，声明宿主 reload 已具备的能力子集，例如：

```json
{ "capabilities": ["reload.assemble_modules", "reload.anon_per_reload", "reload.cron_survives"] }
```

- 模板侧在 **preflight（锁之前、零痕迹）** 比对 `manifest.requiresCapabilities` 子集，缺失即 `failed(host_capability)`。
- 不放 market meta（那是模板版本，回答不了宿主能力）；不做反向门禁（老模板不可变，靠 oj 保持老语义）。
- 老 oj（无 `capabilities` 或不含 `reload.assemble_modules`）视为能力缺失 → 模板侧 fail-closed（声明了 requiresCapabilities 即拒），避免「静默卸载空转」。

### 2.4 cron 独立 OS 线程（US-3，不可省边界）

cron 驱动改独立 OS 线程 + current_thread runtime（同 `TaskPool` worker），生命周期随进程而非随 reload 的临时 rt——否则「装完 cron 生效」是假的。

- 旧池停机加超时（保 N-1 代，超时记 warn），避免卡死 worker 挂死整次 reload。
- commit 与 `current_sha` / tasking 落定顺序调整为「tasking 就绪 → commit → current_sha」，消除 SIGTERM 停不到新池的窗口。

> 此条与「是否调用 reload」正交：无论 reload 怎么实现，只要它重建事件循环/cron 池，cron 就会静默停摆。故 US-3 不能折叠进 reload，必须单列。

### 2.5 启动自检降级（US-4，不可省边界）

- 锁内版本目录 / `manifest.yaml` **缺失** → 跳过该模块 + 点名 + `/_system/config` 标 degraded（不再全站拒启）。
- `manifest.yaml` **解析失败 / name 不符 / version 错位** → 仍 `Err`（构建错误不掩盖）。

> 与 reload 无关，是启动自检。卸载「reload 失败 → 锁写回 → 再 reload 回旧代」的编排本仓已落地（Phase 4），其运行时成立前提正是 §2.1 的「reload 覆盖 manifests」。

### 2.6 restart_pending → partial + 换进程（P4，不可省边界）

reload 返回的 `restart_pending` 非空（触及特权面 / 插件 ABI / `server.*`）时，仍须如实标 `partial + restart.required:true`：

- **T1 无守护 / T3 外部管理器**：提示人工或外层 `Restart=always` 重启 `oj serve`。
- **T2 有壳 `oj supervise`**：worker 调 `POST /_system/restart` 自动换进程，续跑 smoke → done（纯壳 supervisor 为独立提案，不在本 PR）。

## 3. 三轨形态与判定（不变）

| 轨 | 形态 | 安装结果 |
|---|---|---|
| **T1 无守护** | `oj serve` / `--daemon` | 热装载照常；restart_pending 非空 → 任务 `partial + restart.required` |
| **T2 有壳** | `oj supervise` | 调 `_system/restart` 自动换进程，续跑 smoke，`done` |
| **T3 外部管理器** | systemd/k8s/nssm 托管 `oj serve` | 同 T1；外层 `Restart=always` 时人工/外层重启后生效 |

判定只有一处：`reload` 返回 `restart_pending` 非空 → 走换进程；空 → `done`。T1/T2 差异只体现在端点两种响应（202 / 409），安装器不自己探测有没有壳。

## 4. 范围与排除

- **本 PR 包含**：`_system/config/reload` 覆盖 manifests 装配（§2.1）+ 重编译 anon（§2.2）+ `ojInfo().capabilities`（§2.3）+ cron 独立线程（§2.4）+ 启动降级（§2.5）。
- **本 PR 不含**：P4 纯壳 `oj supervise`（换进程路径，独立提案）；WS 主动断开（P1）；seed 随装（P3）；cron 随装（后续项）。
- **不做**：文件监听驱动重扫；全量 seed 重放；补跑空窗内错过 cron 触发；反向兼容门禁（新 oj + 老模板靠 oj 保持老语义）。

## 5. 联调验收（本仓 → 上游）

本仓已为每项预留 stub 单测（以 `reload`/`fsp`/`db` 注入模拟上游行为），上游发版后在真机复测：

| 上游项 | 真机复测验收 | 本仓已落桩 |
|---|---|---|
| §2.1 reload 覆盖 manifests | 验收 1（generation+1）、3（卸载顺序真源，解卸载空转）、16（capabilities 缺失写锁前失败生效） | preflight 门禁读端 + `reloadAndAssert`（`unchanged===false` 且 `applied⊇modules`） |
| §2.2 reload 重编译 anon | 验收 2（匿名 200 真生效） | 无守护 partial 判定已就位 |
| §2.4 cron 独立线程 | 验收 7（reload 触发 5 分钟后原 cron 仍触发） | — |
| §2.5 启动降级 | 验收 5（缺目录跳过、启动降级） | uninstall reload 失败回滚编排 |

> 关键安全网：`reloadAndAssert` 断言 `unchanged===false` 且 `applied` 含 `modules`，是把「reload 是否真的重装了模块」变成可观测、可 fail 的契约——无论采用原方案还是本简化方案都必须保留，它是「卸载空转」回归的唯一拦截点。

> 提交上游后，本仓计划书「US-1~US-4 阻塞跟踪」状态可更新为「已提交 PR #xxx」，真机复测通过后再标记验收项绿。

## 6. 交互调用与重启流程图（mermaid）

> 绝大多数是**热装配主路**（PID 不变、亚秒级生效）；只有涉及特权面 / ABI / `server.*` 的少数变更才走**换进程**（P4 纯壳 supervisor）。原 US-1/US-2 已折叠为「一次正确的 `_system/config/reload`」节点，US-3/US-4 与 restart_pending 路径为不可省边界。

### 6.1 安装热装配交互时序图（免重启主路）

```mermaid
sequenceDiagram
    autonumber
    participant T as 模板安装器 runInstall
    participant API as oj server (_system/config/reload)
    participant RL as reload 重装装配 (R1/R2)
    participant ANON as 匿名 dispatch 短路 (R3)
    participant CRON as cron (独立 OS 线程) (US-3)
    participant CL as 请求方

    Note over T,CL: 锁后 reloading 段：装配生效主路（PID 不变）
    T->>API: POST /_system/config/reload
    API->>RL: 变化检测覆盖 manifests.yaml (锁) + config
    RL->>RL: 锁变更即重装 module pipeline，generation+1
    RL->>ANON: 重编译 anon:Matcher (auth + tenant anonymous_paths)
    ANON->>ANON: admit() 在 guard.verify 前短路命中 anon
    API->>CRON: reload 不拆 cron 池，旧池停机+超时，新池独立线程保活
    API-->>T: 返回 generation+1、applied 含 modules、restart_pending 列表
    alt restart_pending 为空
        T->>T: 任务 done (热装载覆盖部分已生效)
    else restart_pending 非空 (特权面/ABI/server.*)
        T->>T: 任务 partial + restart.required:true (无守护形态)
        T->>CL: 提示人工/外层管理器重启 oj serve
    end
    CL->>ANON: 新匿名端点请求
    ANON-->>CL: 跳过验签直接放行 (按 ModuleEntry.prefix 匹配)
```

> 前置门禁：模板侧 preflight 比对 `manifest.requiresCapabilities` 与 `ojInfo().capabilities`，缺 `reload.assemble_modules` 即写锁前 `failed(host_capability)`（§2.3），不碰锁/库表/清单。

### 6.2 重启判定与换进程流程图（少数特例）

```mermaid
flowchart TD
    START([reload 返回 restart_pending 非空]) --> Q{运行形态?}
    Q -->|T1 无守护 / T3 外部管理器| P[任务标 partial + restart.required:true]
    P --> P1[人工或外层 Restart=always 重启 oj serve]
    P1 --> BOOT[新进程启动]
    Q -->|T2 有壳 oj supervise| R[worker 调 POST /_system/restart]
    R --> S[worker 优雅退出:<br/>停 cron → 停 accept → 等在途请求（上限 30s）]
    S --> X[exit 78]
    X --> SP[父进程 spawn 新 worker<br/>boot.seq+1 经 env 下发]
    SP --> BOOT
    BOOT --> D{模块版本目录 / manifest.yaml 缺失? (US-4)}
    D -->|缺失| SKIP[跳过该模块 + 点名 + /_system/config 标 degraded<br/>不全站拒启]
    D -->|解析失败 / name 不符 / version 错位| ERR[仍 Err fail-fast（构建错误不掩盖）]
    SKIP --> READY[新 worker ready（专用 fd JSON）<br/>（boot, generation）单调]
    ERR --> READY
    READY --> DONE[新代生效，续跑 smoke → done]
```

### 6.3 卸载顺序与启动降级（US-4 收口）

```mermaid
flowchart TD
    U0([卸载触发]) --> U1[预检：影响面 / 空锁]
    U1 -->|拒| U1X[零改动返回]
    U1 -->|过| U2[DB 级联事务 → sidecar → modules.json → 摘锁]
    U2 --> U3[触发 reload：变化检测覆盖 manifests（锁）<br/>断言 applied 含 modules、restart_pending 为空]
    U3 -->|reload 成功| U4[删版本目录 / staging / siteModulesDir（best-effort）]
    U3 -->|reload 失败| U5[锁写回 → 再 reload 回旧代（幂等）]
    U5 --> U6[目录未删，不留缺目录状态，返回失败可重试]
    U4 --> UDONE([卸载完成，PID 不变（卸载空转已解：reload 现覆盖 manifests）])

    S0([oj 启动自检]) --> S1{锁内模块版本目录 / manifest.yaml 缺失?}
    S1 -->|缺失| S2[跳过该模块 + 点名 + degraded 标记]
    S1 -->|解析失败 / name 不符 / version 错位| S3[仍 Err 全站拒启（构建错误不掩盖）]
    S2 --> S4([其余模块正常装配])
```

> 图 6.2 / 6.3 中「reload 失败锁写回」「摘锁即掉挂载」的运行时成立前提，正是 §2.1（reload 覆盖 manifests 重装装配）与 §2.5（启动降级）。本仓 `uninstall.ts` 已实现上述编排，上游落位 §2.1 后「摘锁即生效」才在真机成立。
