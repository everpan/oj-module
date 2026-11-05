# 方案：安装解决方案后免重启生效（安装 / 卸载 / 异常三轴）

> 状态：**v5 定稿**（2026-11-05；未实施）
> v1 经架构 / 工程 / 产品运维三角色只读评审，判定「打回重写 §4.2 / §5 / §6」，本文已按发现逐条修订；v2 再经架构 / 工程 / 安全三视角复审（§1.1）；v3 按用户定调收敛为「纯壳 supervisor」；**v5 按「纯壳 + 不改现有启动方式」再经架构 / 工程 / 安全 / 运维四视角复审 + 两轮交叉质辩（§1.2）**。
> 场景：生产 oj 是**单进程**常驻服务；市场安装/卸载方案后，当前行为要求重启进程。
> 上游基线：oj `0.1.121`（热更 v1：`server.reload_api=true` + 内层 Router 换代 swap）
> 本仓关联：`docs/prd/framework-verification-playbook.md` §9 / §11；`docs/prd/solution/OPERATIONS.md`

## 0. 一句话结论

v1 的「三档递进」方向保留，但**P0 不能是「补三个缺口」**——评审取证发现四个既有缺陷会让 P0 直接空转：

1. reload 的换代身份只有 `config.yaml` 的 sha，**锁（manifests.yaml）变化根本不触发装配**，所以卸载、回滚不写 config 就恒 `unchanged`；
2. 每次热更后 **cron 驱动所在 runtime 被 drop，定时任务静默停摆**（既有缺陷，与本次需求无关但必须一起修，否则 G1 是假的）；
3. 安装失败时 **config.yaml 里的匿名条目与安装序号不会回滚**，反复失败会逐步放大匿名面；
4. 卸载「先摘锁后删目录」且不 reload，一旦此窗口内重启，缺目录会让 `App` 装配 `return Err` → **全站拒启**。

自重启提供两种形态，**默认形态一字不改**：

- **默认（无守护）**：`oj serve` / `oj serve --daemon` 行为字节级不变。遇到必须换进程的变更，安装任务判 `partial` + `restart.required:true`，提示人工重启——这是今天的行为，但不再伪装成 `done`。
- **可选（纯壳）**：新增子命令 `oj supervise`，父进程只做四件事——spawn worker、收 ready、看退出码、退避重启；**不持 socket、不读配置、不开 HTTP、不连 DB**。需要换进程时 worker 写 `restart.intent` → 自 drain → 以 **78** 退出；父看到 78 立即起新 worker，新 worker 自己 bind。代价是**实测中位 0.19s 的空窗**，且**没有失败保活**（端口只有一个监听者，旧 worker 必须先退）。

v1 的「进程内 execve」被否——execve 成功即旧映像消失，新映像起不来无人重试；且 listener 带 CLOEXEC，exec 时端口释放，空窗并不比壳小（§5.7.2）。第二轮评审否掉 `kill -HUP`（全仓无 handler）与「控制文件放 fs jail 内」。**第三轮（本轮）否掉三处 v4 的硬伤**：stdout 上的 ready 行会被日志 tee 吞掉（`logging.rs:147`）、`server.supervisor` 配置键本身就是「改变启动方式」、`--daemon` 打印 pid 后退出是既发布契约。详见 §5.7。

---

## 1. 评审结论台账

判定口径：**采纳** = 照改；**部分采纳** = 问题成立但解法换；**驳回** = 不成立或不做。

| # | 发现 | 来源 | 判定 | 处理 |
|---|---|---|---|---|
| F1 | reload 换代身份只有 config sha；`diff_configs` 无 `modules` 键；`scope` 入参无载体 | 三方一致 | ✅ 采纳 | §5.1 身份改 `sha(config) ⊕ sha(manifests.yaml)`，`modules` 进 `applied`；不加 `scope` 参数（少一个对外面） |
| F2 | 安装失败后 config.yaml 的匿名条目 / seq 不回滚 | 架构 | ✅ 采纳 | §5.6 补偿清单；`deferredAnonymous` 精确撤销 |
| F3 | 「回滚点只有 manifests.yaml」不成立（还有 modules.json / sidecar / sys_solution_route / DB） | 架构 + 产品 | ✅ 采纳 | §5.6 改为有序补偿清单 + 版本一致性断言 |
| F4 | 「删除/修改匿名项要重启」与 G2 冲突 | 架构 | ⚠️ 部分采纳 | §5.2 按「是否影响仍注册路由 / 是否 startup 期已在守卫静态表」分级，见 §2 质辩 1 |
| F5 | WS 匿名不随代（`ws.rs:117` 只用启动期 guard） | 架构 + 工程 | ✅ 采纳 | 移出 P0 → P1；P0 的 G2 只承诺「新连接 404」，不承诺主动 close |
| F6 | 方案任务的 tasks 是非版本化资产，不进锁/tgz | 架构 | ✅ 采纳 | G1 收缩（§6）；「cron 已注册」从 P0 移除，列为后续项 |
| F7 | seed 时点错（lock_commit 前 `dist/api` 还没有该模块）；`oj seed -m` 不存在 | 架构 + 工程 | ✅ 采纳 | §5.8 只在上游出命令后做（P3）；P0 不承诺 seed |
| F8 | execve 自重启「旧进程保活」不可能；daemon ready fd 会被误关 | 三方一致 | ✅ 采纳 | §5.7 改 fork + 继承 + readiness；exec/fork 前清 `OJ_DAEMON_READY_FD` |
| F9 | 卸载先写锁后删目录 + 启动缺目录直接 `Err` 全站拒启 | 工程 | ✅ 采纳 | §5.3 顺序改为 reload 成功后再删盘；§5.5 启动自检降级 |
| F10 | cron 驱动挂在 reload 线程的临时 runtime 上，drop 即取消 | 工程 | ✅ 采纳 | §5.4 独立 OS 线程 + current_thread；列为 P0 前置 |
| F11 | 「首段 = 本次模块」口径错（prefix ≠ name，允许多段与 `_platform`） | 工程 | ✅ 采纳 | §5.2 改用 `ModuleEntry.prefix` + 保留段黑名单 |
| F12 | 匿名不必下沉 Router；Pipeline 本就每代重建 | 工程 | ✅ 采纳 | §5.2 走「每代 anon 表 + dispatch 短路」（路线 C），否决 v1 的 A/B |
| F13 | 「重扫 6ms」无据；reload 真实成本是每 api 文件一线程一 runtime | 工程 | ✅ 采纳 | §3 显式自纠；性能数字改为待测（§9 PoC-2） |
| F14 | 旧池停机 `join` 无超时，可挂死整次 reload | 工程 | ✅ 采纳 | §5.4 加超时 + 保 N-1 |
| F15 | dev 索引换代只影响路由，StableState 仍持旧索引 | 工程 | ✅ 采纳 | P2 扩为「索引 + StableState 派生面一致」 |
| F16 | smoke 无 health 时 404 也判过 | 产品 | ✅ 采纳 | §5.6 探首个路由，401/403 = 已注册，404 = 失败 |
| F17 | 新增 `restart_required` 状态会让旧 CLI 当 running 死等 | 产品 | ⚠️ 部分采纳 | 不加第 6 个状态；改任务字段 `restart{required,performed,pidBefore,pidAfter,generation}` |
| F18 | 清盘无执行者；web 产物从不清理 | 产品 | ✅ 采纳 | §5.3 卸载请求内 best-effort 清 `siteModulesDir`，失败只 warn |
| F19 | `tenant.anonymous_paths` 落 `_ => applied`，与 `auth` 口径不一致 | 架构 | ✅ 采纳 | §5.2 二者都并入每代 anon 表，分类语义统一 |
| F20 | `commit` 先于 `current_sha` / tasking 落定，窗口内 SIGTERM 停不到新池 | 工程 | ✅ 采纳 | P0 内顺手调整提交顺序（1 行级） |

评审中「写得对、应保留」的三条原样保留：三档递进与失败保上一代的地基判断、卸载「先失去可达性再失去文件」、以及不做文件监听 / 不做全量 seed 重放 / 不放开特权面热生效的边界。

### 1.1 第二轮评审台账（守护进程专项，2026-11-05）

第二轮针对 §5.7 换了一组「架构 / 工程 / 安全」视角重审，并做了一轮交叉质辩。结论：**v2 初稿的 §5.7 有三处必须改**。

| # | 发现 | 来源 | 判定 | 处理 |
|---|---|---|---|---|
| F21 | **变体 A 没有「失败保活」**：bind 与装配同进程（`app.rs:2397-2401`），旧 worker 必须先退出才能让出端口 | 架构 | ✅ 采纳 | G4/E13 按变体分开写；A 改为「prepare（装配+校验）→ 停旧 → bind」，只承诺崩溃自愈 |
| F22 | **父持 socket 后 host/port 改动永久无效**：`server` 整段归 `kept_listener`（`serve_cmd.rs:602`） | 架构 | ✅ 采纳 | 单列 `restart_full`；父进程不解析配置，fd 首次由 worker bind 后 `SCM_RIGHTS` 交给父 |
| F23 | **`auto` 在 systemd/k8s 下关掉能力**，且环境变量判据不可靠 | 架构 | ✅ 采纳 | 去掉环境嗅探：`auto` = 前台 off / `--daemon` on；systemd 下补 `sd_notify` 才允许 on |
| F24 | **generation 换进程归零**：`ReloadState::new` 固定 0（`reload.rs:118-123`） | 架构 | ✅ 采纳 | 父落盘 `boot_epoch` 经 env 下发，上报二元组 |
| F25 | **重叠期跑全量迁移 + seed**，与旧 worker 抢 sqlite（`app.rs:1906/1958`） | 工程 | ✅ 采纳 | 新 worker 走 `--handoff`：verify-only + skip seed |
| F26 | **任务池在 bind 前就起、cron 双跑**（`serve_cmd.rs:204`、`tasks.rs:314-326`） | 工程 + 架构 | ✅ 采纳 | 注册与 start 拆开，收到 `go` 后才起 cron |
| F27 | **就绪 fd 泄漏**：`OJ_DAEMON_READY_FD` 从不 remove；管道写端未设 CLOEXEC（`serve_cmd.rs:750`） | 工程 | ✅ 采纳 | spawn 前清 env + env 白名单 + 读端 CLOEXEC；**写端必须在 worker 取到后补 CLOEXEC**（写端跨 exec 必须非 CLOEXEC，所以不能「两端都设」，见 5.7.3） |
| F28 | **监听 fd 被 `oj migrate` 孙进程继承**（`exec.rs:615` 只 env_clear） | 安全 | ✅ 采纳 | 接管后立即重设 `FD_CLOEXEC`（内核在孙进程 exec 时自动关）；**不在 pre_exec 关 3+ fd**（会吃掉 std 的 exec 错误管道） |
| F29 | **控制面若落盘就在 fs jail 内，可被已装方案伪造**（`config.rs:389`、`market/api.ts:163`） | 安全 | ✅ 采纳 | 控制面改为 stdio 双管道，不落盘；`restart.intent` 只存 taskId 且放 jail 外 |
| F30 | **`kill -HUP` 是致命入口**：全仓无 SIGHUP handler，默认动作 = 终止 | 安全 | ✅ 采纳 | 废弃 HUP；drain 复用 SIGTERM 且只由父发 |
| F31 | **drain 退 0 不可依赖**：池 join 无超时 + mail drain 10s，父 10s 预算必误杀 | 架构 | ✅ 采纳 | 父预算 30s；独立退出码 79 = drained |
| F32 | **父以 70 退出会连坐 worker**（`KillMode=control-group`）或引发 EADDRINUSE（mixed + Restart=on-failure） | 架构 | ✅ 采纳 | 父不退出，标 `degraded` 交给 watchdog |
| F33 | **pid 文件 / `oj stop` / `oj restart` 全都不存在** | 架构 + 安全 | ✅ 采纳 | 纳入 P4：pid 文件 0600 + starttime 校验，新增 stop/restart |
| F34 | **变体 A 抢绑窗口**（`app.rs:2397` 无任何 socket 选项） | 安全 | ✅ 采纳 | 生产 Unix 只上 B；Windows A 必须 `SO_EXCLUSIVEADDRUSE`，bind 失败即告警退出 |
| F35 | **SCM_RIGHTS 传 fd 不值得**（std `Command` 无 fd 通道） | 工程 | ⚠️ 部分采纳 | 父→worker 仍用 env + CLOEXEC；仅「首次 worker→父」用一次 `SCM_RIGHTS`（没有别的办法把 fd 交给已在运行的父） |

**台账保留原样，但其中 7 条已被 2026-11-05 的「纯壳 + 不改启动方式」定调推翻或改写**（详见 §5.7 与 §1.2；阅读时以本段为准）：

| # | 台账里的处置 | 定调后 |
|---|---|---|
| F23 | `auto` = 前台 off / `--daemon` on，靠 sd_notify 才允许 on | **作废**：整个 `auto` 机制删除，形态只由子命令决定（F38） |
| F21 | G4/E13 按变体分开写，A 走「prepare → 停旧 → bind」 | **结论保留、处置改写**：「没有失败保活」现在是唯一形态的事实，不分公司；「prepare（装配+校验）」也不再必要——旧 worker 是自己退出的，不是被父叫停的 |
| F22 | 单列 `restart_full` + 父持 fd | **作废**：worker 自己 bind，端口变更走普通换进程，不需要 `restart_full` |
| F25 | 新 worker `--handoff` verify-only | 保留，但动机从「避免与旧 worker 抢 sqlite」变为「避免重复跑迁移/seed」——不再有重叠进程 |
| F35 | 首次 worker→父 `SCM_RIGHTS` | **作废**：父不持 socket，`SCM_RIGHTS` 整条链路不存在 |
| F26/F31 | 「收到 `go` 后才起 cron」「独立退出码 79」 | 半作废：`go` 消息随重叠期一起删除；`79` 保留（父发 stop 后的正常退出码） |
| F34 | 生产 Unix 只上 B | **作废**：只有一种形态；`SO_EXCLUSIVEADDRUSE` 也不再需要（std 在 Windows 不设 `SO_REUSEADDR`，二次 bind 本就 `WSAEADDRINUSE`，见 F48） |

### 1.2 第三轮评审台账（「纯壳 + 不改启动方式」专项，2026-11-05）

本轮换了一组视角（架构 / 工程 / 安全 / **运维**），四位独立取证后做两轮交叉质辩。结论：**v4 有三处硬伤必须改，另有六处口径要收紧**。

| # | 发现 | 来源 | 判定 | 处理 |
|---|---|---|---|---|
| F36 | **ready 走 stdout 必然收不到**：`logging::init` 在 bind 之前就把 fd1/fd2 `dup2` 进日志 tee（`logging.rs:147-148`、`serve_cmd.rs:163`），而 `println!` 在 `serve_cmd.rs:247` | 架构 + 工程 + 安全（三方独立命中） | ✅ | Unix 用继承管道（**新 env `OJ_SUPERVISOR_READY_FD`**，复用 `OJ_DAEMON_READY_FD` 的机制与 payload 隔离）；Windows 走 stdout（tee 仅 `cfg(unix)`）。见 5.7.3 |
| F37 | **退出码 78 没有返回路径**：`main.rs:122` 唯一退出点，`Command::Serve` 只做 `Ok(())→0 / Err→1` | 工程 | ✅ | `serve_cmd::run` 返回码化（`Result<i32, String>`），main 透传；禁止 `process::exit` 直调（会跳过 drain 与日志 flush） |
| F38 | **新配置键 `server.supervisor` 本身就改变了启动方式**（一个 YAML 键就能让裸跑变成父子进程），且让壳必须解析配置 | 架构 + 运维 | ✅ | 删除该键；形态只由子命令决定，壳真无配置 |
| F39 | **`--daemon` 打印 pid 后退出是既发布契约**（`args.rs:346-348`、`serve_cmd.rs:652`） | 架构 + 运维 | ✅ | `--daemon` 一字不改；常驻守护只由 `oj supervise` 提供 |
| F40 | **fs jail 不是 OS 沙箱**：只是路径前缀 + canonicalize（`bridge/fs.rs:42-44,135-136`），且 `net/env/run/ffi/import` 全放行 | 安全 | ✅ | 「运行时目录放 jail 外 → 方案写不到」降级为「**降低可达性**」，不再当安全保证 |
| F41 | **`/tmp` 回退可被预创建/符号链接** | 安全 | ✅ | 删 `/tmp`、`%LOCALAPPDATA%` 回退；`$XDG_RUNTIME_DIR` → `$HOME/.oj/run` |
| F42 | **78 无上限 = 重启风暴**（每 0.19s 一轮空窗） | 安全 | ✅ | 壳侧限速：60s 内 >2 次即按崩溃加退避；退避封顶 30s |
| F43 | **degraded 后停重启，在裸跑形态下等于永久停摆**（没有 systemd 兜底） | 运维 | ✅ | `degraded` 只作标签，**每 30s 继续重试、永不自行停止**；watchdog 只是额外通道 |
| F44 | **无守护时 `done` 是假成功**：`smoke.ts:144-149` 把待重启的 401 判为通过，`reload.ts:77-80` 只把 `restart_pending` 拼进 message | 运维 | ✅ | 无守护 → `partial` + `restart.required:true`；P0 收紧 smoke 口径 |
| F45 | **缺 capability 门禁**：老 oj + 新模板会在**锁已提交之后**失败（最贵的一种失败） | 运维 | ✅ | P0：`ojInfo()` 增 `capabilities`，模板 preflight 断言，缺即 `host_capability` |
| F46 | **裸 execve 空窗非 0**：listener 带 CLOEXEC，exec 时内核关 fd、端口释放，窗口 = 冷启动到 bind | 工程 | ✅ | 修正 §5.7.2 的「execve ≈0」；不采用 execve 替代壳（无崩溃自愈 + 静默 re-exec 属改变启动方式 + 第二套机制违 DRY） |
| F47 | **worker 当前完全不读 stdin**；新 stop reader 必须并入唯一停机入口 `shutdown_signal`（`serve_cmd.rs:911-934`） | 工程 | ✅ | 第 3 个 select 分支，≈20 行；否则就是第二条停机实现 |
| F48 | **`SO_EXCLUSIVEADDRUSE` 不需要**：std 在 Windows 显式不设 `SO_REUSEADDR`，二次 bind 即 `WSAEADDRINUSE` | 工程 | ✅ | 删除该要求，也不引 socket2 |
| F49 | **Windows 父 spawn 控制台子系统子进程会弹窗**（SCM / 计划任务 / detach 场景） | 工程 | ✅ | `CREATE_NO_WINDOW`，1 常量 1 行 |
| F50 | **nonce 对同 uid 主体无意义**（可读即不可信） | 运维 | ✅ | 不写成安全保证；改用 owner 校验 + `O_NOFOLLOW` + `starttime` |

**两轮质辩收敛出的四条口径**（第一轮四人有分歧，第二轮定案）：

1. **入口**：`oj supervise` 子命令（`#[command(flatten)]` 复用 `ServeArgs`），不是 `--supervise` 开关、不是独立 bin、也不是「只交外部」。改动面：`ServeArgs` 字面量 7 处，其中 5 处带 `..Default::default()`，真断 2 处；`args_tests.rs` 0 处。
2. **控制通道**：不引入 socket 层。ready = Unix 专用 fd / Windows stdout；stop = stdin 一行 JSON；外部 `oj stop` = Unix 发 SIGTERM 给父、Windows 写 `stop.request`。
3. **无守护时**：`partial` + `restart.required`，**不拒装**（拒装会让前台用户永远装不上；且「是否要换进程」只有 reload 之后才能判定，preflight 预测不了）。
4. **失败语义**：退避封顶 30s，`degraded` 只降级不上报健康，重试**永不停止**。

---

## 2. 交叉质辩（三方结论冲突处）

### 质辩 1：匿名表到底要不要「删除即重启」

- 架构：要（否则卸载后配置永久留档，且 v1 的规则与 G2 冲突）。
- 工程：不要（不必下沉 Router，每代 anon 表 + dispatch 短路即可）。

取证后两者都只对一半。关键事实：`auth.anonymous_paths` 在**启动期**被编进 auth 插件的 guard（`app.rs:1891` 复用 `backend.auth_guard()`），而 dispatch 的 `guard.verify` 对匿名路径返回 `Ok(None)`（`dispatch.rs:246-253`）——**dispatch 无法区分「守卫说匿名」和「没配鉴权」**，因此无法反向否决。

于是删除分两种：

| 该项来源 | 删除后 | 结论 |
|---|---|---|
| **运行期**新增（安装时写进 config） | guard 静态表本就不含 → dispatch 每代表也不再含 → 立即失效 | 免重启 |
| **启动期**已在 config 里 | guard 静态表仍含 → 仍放行 | 需重启才能彻底撤销 |

而「启动期条目被删」的实际暴露面受两点限制：① 匿名只对**已注册路由**有效（`app.rs:262`）——卸载后路由已无，条目残留不构成暴露；② 真正的风险是**同 prefix 换装**：新模块未声明匿名却继承旧条目。所以规则收敛为：

> **删除免重启；但安装 preflight 必须拒绝「目标 prefix 在 config 中存在未被本次 manifest 声明的匿名条目」。**

这条同时满足 G2（卸载免重启）和安全（不会静默继承）。v1 的「删除/修改一律 restart_pending」驳回。

### 质辩 2：状态机加不加 `restart_required`

- 产品：加，语义最直白。
- 架构 / 工程：不加，`TaskStatus` 只有 5 值（`types.ts:72`），CLI 侧 `site.ts:35` 手工同步，旧 CLI 不认识会当 running 死等。

结论：**不加状态，加字段**。`status` 仍是 `done | partial`；`restart: {required, performed, pidBefore, pidAfter, generation}` 表达「换过进程」。旧 CLI 忽略未知字段，不会死等；文案由 `restart.performed` 驱动。

### 质辩 3：重启形态——execve / 一次性 fork / 常驻守护父进程

- v1：execve 原地替换，失败则旧进程保活——**自相矛盾**（execve 成功旧进程即不存在）。
- 架构 / 工程：改 fork + exec + ready 管道，可复用 `daemon_ready`（`serve_cmd.rs:629-652`）；fork 前必须 `remove_var("OJ_DAEMON_READY_FD")`，否则子进程会对已 close、可能被复用的 fd 做 write+close。
- 用户（2026-11-05）：改成**常驻父进程守护子进程**，父负责监控与重启，子只负责服务；Linux 可行，Windows 待评估。

结论（最终，已被后续定调覆盖）：**采纳守护父进程，作为重启的唯一载体**。它把「一次性 fork+exec」降级成它的一个特例（重启 = 让父进程回收子进程），并且是所有形态里唯一能同时覆盖 Windows 的（Windows 没有 exec）。

**但本节当时的「A/B 双形态」结论作废**：用户在同日追加定调「父进程只写一个壳，只完成对 oj 的生命周期监控，不负责其他，无网络服务，无配置」，因此「父持 socket 传 fd（B）」整条路线删除，只剩一种形态——父 spawn、worker 自己 bind。代价是 0.19s 空窗、且没有失败保活；换来的是整块重叠期设计消失。详见 §5.7。

---

## 3. 性能实测（v1 的 6ms 断言作废）

v1 §4.1 写「模板 292 文件 `find` 全遍历 6ms，解析同量级，可忽略」。**这个结论作废**：6ms 是纯文件遍历，不是 reload 成本。

PoC-2 实测（同一工程、同一台机、同一份产物，只改 `vars.ojm_install_seq` 触发，n=3 取中位）：

| 形态 | api 文件数 | 三次耗时 | 中位 |
|---|---|---|---|
| **release/js**（生产形态，按模块读 `routes.js`） | 337 | 124 / 106 / 106 ms | **106 ms** |
| dev/ts（`--module-root src`，逐文件内省） | 336 | 3072 / 3029 / 3081 ms | **3029 ms** |
| dev/ts 基线 | 44 | 474 / 450 / 450 ms | **450 ms** |

结论三条：

1. **生产（release）是亚秒级**，106ms，P0 的「亚秒级」承诺成立。
2. **dev 是秒级**，且随文件数线性增长：斜率 ≈ 8.9 ms/文件，截距 ≈ 60ms。原因是 `bridge_introspector` 对每个 api 文件起一个 OS 线程 + 一个 current_thread runtime 再 join（`serve/src/routes.rs:864-886`）；release 每模块只有一个 `routes.js`，所以只有 9 次。
3. 因此 **`ojm dev` 下安装的 reload 是 3 秒级**，不能宣传成亚秒；这也解释了为什么 v1 的「模板 292 文件 6ms」是错的——把遍历当成了装配。

---

## 4. 现状取证（v2 复核版）

| 面 | 现状 | 证据 |
|---|---|---|
| 路由换代 | ✅ `ReloadState` 持 `watch<Arc<Router>>`，listener 永生，新代 swap、旧代 drain | `serve/src/reload.rs:66-88`、`oj/src/app.rs:2413` |
| 后端连接 | ✅ 复用，不重连；迁移强制 `verify-only` | `oj/src/serve_cmd.rs:499-515` |
| 换代触发 | ❌ **只有 `doc_sha(config)`**；`unchanged` 直接返回 | `serve_cmd.rs:471-485` |
| 段 diff | ❌ 遍历 `known_top_level_keys()`，**无 `modules`/锁键**；`auth` 整段→restart_pending；`tenant` → `_ => applied` | `serve_cmd.rs:575-601` |
| 模块集合（release） | ⚠️ 每代重读 `dist/api/manifests.yaml`，新增目录天然可见；但**锁里某个目录缺失 → 整体 `Err`** | `app.rs:2001-2035` |
| 模块集合（dev） | ❌ `--module-root` 的 `ModuleIndex` 跨代同一 Arc | `serve_cmd.rs:455-462` |
| 匿名（HTTP） | ❌ guard 在启动期固化；restart_pending 明示重启生效 | `app.rs:1891`、`dispatch.rs:246-253` |
| 匿名（WS） | ❌ 握手复用同一启动期 guard，无 per-gen 表 | `app.rs:2247-2254`、`ws.rs:106-117` |
| cron 驱动 | ❌ `tokio::spawn` 在 do_reload 的临时 rt 内，rt drop 即静默停 | `tasks.rs:348-352`、`serve_cmd.rs:436-451` |
| 旧池停机 | ⚠️ `join` 无超时 | `task_pool.rs:644-657` |
| 卸载 | ❌ 写锁 + 删目录，**无 reload**，无 config 写入 | `_lifecycle/uninstall.ts:176-233` |
| 安装 reload 触发 | ⚠️ 靠 `vars.ojm_install_seq` 自增 + 匿名条目写入 config；**失败不回滚** | `installer.ts:366-404`、`482-510` |
| 种子 | ❌ 热更路径不重放；`oj seed` 子命令不存在（`seed.rs` 只是库） | `app.rs:1955-1957`、`oj/src/args.rs` |
| tasks 资产 | ❌ 只镜像到 `dist/tasks`，不进锁/tgz，安装器不写任务目录 | `build_cmd.rs:117-125` |

---

## 5. 修订后的设计

### 5.1 换代身份（F1）

`do_reload` 的幂等键从 `sha(config)` 扩为：

```
generation_key = sha256(归一 config 文档) ⊕ sha256(dist/api/manifests.yaml 原文)
```

- 安装器不再需要「为了触发 reload 而写 config」这一隐式约定，**模板 config.yaml 的 `vars.ojm_install_seq` 哨兵已删除**（R18 修订：unchanged = 已是最新装配 = 幂等成功，不再依赖 config 文档 sha 触发）；安装/升级/降级由 manifests 锁 diff 自然触发装配。
- `diff_configs` 的返回里新增 `modules` 段（锁内容增删按 `+name@ver` / `-name@ver` 计入 `applied`）。
- 卸载只需摘锁 + 触发 reload，即产生新的 `generation_key`（解决 F1 的卸载空转）。
- 不加 HTTP `scope` 参数：减少一个对外契约面，语义由「锁变了就是模块变了」自然表达。

### 5.2 匿名表随代（F4 / F11 / F12 / F19）

**路线 C：每代 anon 表 + dispatch 短路**（否决 v1 的 A 重建守卫 / B Router 标记）。

- `App::from_config` 每代已重建 `AppState.pipeline`（`app.rs:2210-2229`），只需在 `Pipeline` 里放 `anon: Matcher`，由 `auth.anonymous_paths` + `tenant.anonymous_paths` 共同编译。
- `admit()`（`dispatch.rs:242`）在 `guard.verify` 之前短路：命中 `anon` 即跳过验签。
- 匹配按 `ModuleEntry.prefix`（`module_scan.rs:112`，可与模块名不同、可多段）计算，不按「首段 = 模块名」猜。
- 保留段黑名单：`_platform` / `_system` / `auth` / `_lifecycle` 下的新增匿名条目一律拒装（preflight）。
- 段分类精细化：`auth` 不再整段 `restart_pending`——只有 `anonymous_paths` 之外的子键变更才 `restart_pending`；`tenant.anonymous_paths` 同表处理。
- 删除语义见 §2 质辩 1；preflight 增加「同 prefix 未声明条目」检查。

不做 Router 标记：改动面大一个量级，且 WS 是另一条链路（§5.2.1），下沉 Router 也覆盖不到。

**5.2.1 WS（F5，P1）**——WS 握手在 `ws::mirror_routes` 装配期用 `auth.clone()`（`app.rs:2247-2254`），且无连接注册表，`close(1001)` 无落点。P1 需要：每代把 anon 集合注入 `mirror_routes`；新建 `WsRegistry`（module → 连接句柄）以支持卸载时主动关闭。P0 只承诺「新连接按新代判定」，不改 G2 的 WS 部分。

### 5.3 卸载顺序（F9 / F18）

**先失去可达性，再失去文件**——且 reload 必须成功后才允许删盘：

1. 预检（影响面 / 空锁）→ 拒则零改动。
2. DB 级联事务 → sidecar → `modules.json` → **锁摘除**。
3. 触发 `reload`（靠 §5.1 的锁摘要进入身份）→ 断言 `applied` 含 `modules`、且 `restart_pending` 为空。
4. reload 成功后才删版本目录 / staging / `siteModulesDir`（best-effort，失败只 warn，锁是真相）。
5. reload 失败 → 锁写回 → 再 reload 一次回旧代（幂等）；目录未删，因此不会留下缺目录状态。

### 5.4 任务与 cron（F10 / F14 / F6）

- **cron 驱动改独立 OS 线程 + current_thread runtime**（形态同 `TaskPool` worker），生命周期随进程而非随 reload 的临时 rt。这是 P0 前置，否则任何「装完 cron 就生效」都是假的。
- 旧池停机加超时（保 N-1 代，超时后不再等待并记 warn），避免一个卡死 worker 挂死整次 reload。
- `commit` 与 `current_sha` / tasking 落定的顺序调整为「tasking 就绪 → commit → current_sha」，消除 SIGTERM 停不到新池的窗口。
- 市场方案的 tasks 不进锁（F6）：G1 不含「cron 已注册」，单列为后续项。

### 5.5 启动自检降级（F9）

`App` 装配时区分两类失败：

| 情形 | 今天 | 改为 |
|---|---|---|
| 锁内版本目录 / `manifest.yaml` **缺失** | `return Err` 全站拒启 | 跳过该模块 + 点名 + `/_system/config` 标 degraded |
| `manifest.yaml` **解析失败 / name 不符 / version 错位** | `Err` | 保持 `Err`（这是构建错误，不该被降级掩盖） |

### 5.6 安装链路与补偿清单（F2 / F3 / F16）

| 阶段 | 动作 | 失败处置 |
|---|---|---|
| preflight | 契约/冲突/匿名语法 + 保留段 + **同 prefix 未声明条目** + **目标 prefix 与既有匿名残留** | 零痕迹 |
| downloading / verifying / extracting | 拉包、验签、解 staging | 清 staging 重试 |
| migrating | `oj migrate`（子进程，事务/备份） | DB 回滚 |
| lock_commit | rename 版本目录 + 写锁（生效点） | 锁未变 → 撤 rename |
| reloading | seq 自增 + 匿名接线 → `reloadAndAssert`（期望含 `modules`） | 见下 |
| smoke | **探首个路由**：200 / 401 / 403 = 已注册；404 / 连接失败 = 失败 | `partial` 或按开关回滚 |
| audit / history | oplog | 仅日志 |

**补偿清单（回滚不是「写回锁」一个动作）**，按序执行、每步记 `partial`：

1. `manifests.yaml` 写回装前快照；
2. `config.yaml`（及 preview 派生文件）**精确移除本次新增的匿名条目**（`deferredAnonymous`），seq 不必回滚（单调无害）；
3. `modules.json` 写回装前条目，并断言 `modules.json.version == 锁版本`；
4. sidecar / `sys_solution_route` 按卸载同一事务回退；
5. 再 `reload` 一次让旧代回来；任一步失败 → `partial` + 可重试入口。

**smoke 口径修正**：v1 的「anonymous 预期 401」整体删除——匿名端点装完必须 200。

### 5.7 重启路径：纯壳 supervisor——P4

> 本节经「架构 / 工程 / 安全 / 运维」四位评审 + 两轮交叉质辩，按 2026-11-05 的两条定调收敛：**父进程只写一个壳，只做 oj 的生命周期监控，不负责其他，无网络服务，无配置**；**且不改变现有 `oj serve` / `oj serve --daemon` 的启动方式**。
> 后一条把 v4 的三处做法判死：`server.supervisor` 配置键（一个 YAML 键就能改变进程拓扑）、改 `--daemon` 为常驻（破坏「打印 pid 后退出」的既发布契约）、ready 走 stdout（被日志 tee 吞掉）。守护因此改成**显式可选入口** `oj supervise`，默认形态零变化。

#### 5.7.1 壳的职责边界与入口

**入口只有一个**：`oj supervise [serve 的全部参数]`。`oj serve` 与 `oj serve --daemon` 的命令行、参数、退出码、打印内容全部不变——不装壳的用户感知不到本方案的存在。

```
oj serve ...          → 今天的行为，一字不改（无守护形态）
oj serve --daemon     → 今天的行为，一字不改（打印服务进程 pid 后父退出）
oj supervise ...      → 新增：父常驻，spawn 一个 worker，worker 才是今天的 serve
```

`oj supervise` 通过 `#[command(flatten)]` 复用 `ServeArgs`，不复制字段；`--daemon` 在 supervise 下**运行期拒绝**（supervise 本身就该由外层管理，再 daemon 化会变成三层进程）。

**职责只有四件事**（下面的运行时状态文件是记账，不是职责扩展）：

1. `spawn` worker（argv **逐字节原样**转发；跨代信息走 env，不改写 argv）；
2. 收 **ready**（Unix：继承的专用 fd 一行 JSON；Windows：stdout 一行 JSON，见 5.7.3）；
3. 看**退出码**（0 / 79 = 正常；78 = 请求换进程；其它 = 崩溃）；
4. **退避重启**并计数（含 78 限速，见 5.7.6）。

**明确不做**：bind / 持 socket、读 config（**一个字节都不读**，形态只由子命令决定）、解密、连 DB、开 HTTP、装配 App、跑迁移、读写任务状态机、判断安装是否成功。

**运行时状态只有四件**，目录优先 `$XDG_RUNTIME_DIR/oj-<hash>/`，无该变量时退到 `$HOME/.oj/run/oj-<hash>/`（**不用 `/tmp`**，见 F41），目录 0700：

| 文件 | 内容 | 谁写谁读 | 用途 |
|---|---|---|---|
| `restart.intent` | `taskId` + `attempt` | 旧 worker 写 → 新 worker 读 | 让新 worker 知道「我是为哪个安装任务而重启」 |
| `boot.seq` | 一个整数，每次父 spawn 前 `+1` | 父写 → 父读（下发 env） | 让 `generation` 跨进程单调（见 5.7.9） |
| `supervisor.pid` | `pid + starttime + boot + config 路径` | 父写 → `oj stop` / 单实例判定读 | 找到并确认「那个父进程」 |
| `stop.request` | 空文件 | `oj stop` 写 → 父 1s 轮询读后删除 | **仅 Windows** 的停服入口（Unix 用 SIGTERM，见 5.7.9） |

**安全定位（不要夸大）**：fs jail 只是路径前缀校验（`bridge/fs.rs:42-44`），不是 OS 沙箱，`net/env/run/ffi` 全放行。把状态文件移出 jail 只提供「**降低可达性**」——挡得住只会走 `fs` 的非特权方案；privileged 模块、白名单 `exec`、同 uid 的其他进程仍然够得着。因此文件侧只做三件事：目录 0700 + `st_uid == euid` 校验、`O_NOFOLLOW|O_CREAT|O_EXCL` + 0600、父启动时清残留。**不引入 nonce 当安全边界**（同 uid 可读，毫无意义）。

#### 5.7.2 形态对比（最终结论）

| 形态 | 空窗 | Linux | Windows | 崩溃自愈 | 结论 |
|---|---|---|---|---|---|
| execve 原地替换 | **≈0.19s**（listener 带 CLOEXEC，exec 时端口释放） | ✅ | ❌ 无 exec | ❌ | 否（见下） |
| 一次性 fork+exec | ≈0.19s | ✅ | ❌ | ❌ | 否（同上） |
| **纯壳 + 子进程自己 bind** | **0.19–0.25s（实测）** | ✅ | ✅ | ✅ | **采纳** |
| 父持 socket 传 fd | ≈1ms | ✅ | ⚠️ 需 FFI | ✅ | **不做**（见下） |
| 外部 supervisor（systemd/SCM/k8s） | 视配置 | ✅ | ✅ | 视外层 | 共存，见 5.7.8 |

**为什么 execve 也不行**（v4 只说它「换 pid」，这个说法本身是错的——execve 保持 pid）：

1. **空窗并不更小**：listener 是 `SOCK_CLOEXEC`，execve 时内核关闭 fd、端口释放，窗口 = 从 exec 到重新 bind，与壳的 0.19s 同量级；真正省下的只是 fork/exec 的 ~1ms。「≈0 空窗」只在「父持 listener 并传 fd」时成立，而那正是被否掉的复杂度。
2. **没有崩溃自愈**：execve 成功即旧映像消失，新映像起不来没有人重试——「父进程监控子进程」这个需求直接落空。
3. **静默 re-exec 就是改变启动方式**：pid 不变但 `starttime` 变，systemd/监控/调试器全部脱钩；用户没有显式表达「我要守护」。
4. **两套重启机制并存违反 DRY**：壳已经覆盖该场景，再加一条 execve 路径只会让失败语义分叉。

**为什么「父持 socket 传 fd」判不做**（v2/v3 曾推荐它）：它换来的是把 0.19s 空窗压到 1ms，代价是——

1. 父进程必须理解 config（至少 host/port/socket 类型），直接违反「壳无配置」；而 `load_cfg` 遇到 ENC 会全树解密（`config.rs:1612`），等于把 secret 拉进一个零业务、只做看护的进程。
2. 需要 `SCM_RIGHTS` + `pre_exec` 清 CLOEXEC + `OJ_DAEMON_READY_FD` 必须从子进程继承里剔除（现在父只给读端设 CLOEXEC，`serve_cmd.rs:750`），fd 编号在 fork/exec 之间不可控，关错一个就吃掉 exec 错误管道。
3. 一旦父持 socket，旧 worker 就不能退——于是必须在两个完整进程之间做重叠期编排（迁移、cron、任务池、DB 写入全部要跨进程互斥），这才是本方案真正复杂度的来源。
4. Windows 上要 `WSADuplicateSocket` + `WSASocket(FROM_PROTOCOL_INFO)`，std `Command` 不暴露，必须 unsafe WinAPI；即「Unix 做、Windows 不做」会分裂成两套语义。

0.19s 对「装一个方案」这个动作是噪声级；跨进程互斥带来的 bug 面不是。**用 0.19s 换掉整套重叠期设计，是本节的定调。**

#### 5.7.3 最小协议（两条消息 + 四个退出码）

| 载体 | 内容 | 方向 | 平台 |
|---|---|---|---|
| **专用 fd**（新增 `OJ_SUPERVISOR_READY_FD`，机制同 `OJ_DAEMON_READY_FD`） | `{"event":"ready","pid":123,"generation":7}` 一行 | worker → 父 | Unix |
| **stdout** | 同上 | worker → 父 | Windows |
| **stdin** | `{"cmd":"stop"}` 一行 | 父 → worker | 两平台 |
| 退出码 **0** | 正常退出 | worker → 父 | |
| 退出码 **78** | 请求换进程（intent 已写） | worker → 父 | |
| 退出码 **79** | 已 drain 完（父发过 stop） | worker → 父 | |
| 其它 / 信号 | 崩溃 | worker → 父 | |

**ready 为什么不能用 stdout（Unix）**：`logging::init` 在 bind **之前**就把 fd1/fd2 `dup2` 进日志 tee（`logging.rs:147-148`，调用点在 `serve_cmd.rs:163`），而 `println!` 在 `:247`。`console=false`（默认）时镜像线程不回写终端，父管道永远收不到任何字节、也不 EOF。**Windows 相反**：`install_terminal_tee` 整段是 `cfg(unix)`，非 unix 只打两行 warn（`logging.rs:55-81`），fd1 就是父管道——所以平台分载体，协议内容保持一致。

**复用机制，不复用 env**：管道创建与「写一次即关」的语义照抄 `OJ_DAEMON_READY_FD`（`serve_cmd.rs:743-760`、`:828-871`），但 supervise 用**新的 `OJ_SUPERVISOR_READY_FD`**，payload 是 JSON。原因：旧 env 的 payload 是字面量 `ok`，父侧 `wait_daemon_ready` 用 `msg == "ok"` 判定（`:820-824`）；共用会让 `--daemon` 的解析逻辑跟着变，违反 F39。**`--daemon` 一行不改。**

**两个必做修复**：① worker 拿到写端后必须就地补 `FD_CLOEXEC`，否则它 spawn 的长寿子进程会继承写端，父读到 ready 后仍在等 EOF，只能 30s 超时判 `Starting`；② supervise 启动 worker 前必须 `remove_var("OJ_DAEMON_READY_FD")`（父可能就是 `--daemon` 的子进程，env 会被继承下来）。

父侧读法统一：**按行读取，只认第一个 `{"event":"ready",...}`，其余行透传为日志**。Windows 上 stdout 里还有 `oj serve listening on …` 这类普通行（`:247`），不能假设「第一行就是 ready」。

- **没有双向命令通道、没有 swap/drain 编排**：父不指挥 worker 做任何事。「换进程」由 worker 自己决定、自己收尾、自己退出——父只认 78。
- **`stop` 走 stdin 而不是信号**：Windows 的 `Child::kill()` 是 `TerminateProcess`（无优雅停机），且非 unix 只等 `ctrl_c`（`serve_cmd.rs:930-933`），而在无控制台环境里 `ctrl_c` 永不触发。
- **stop reader 必须并入唯一停机入口**：worker 现在完全不读 stdin（全链只有 `secret_cmd` / `exec_cmd` 的 REPL 读），新增 reader 只能是 `shutdown_signal`（`serve_cmd.rs:911-934`）的第 3 个 `select` 分支，≈20 行；另起一条停机实现会分叉 drain 语义。
- **父自己收 SIGTERM/SIGINT（Unix）**：收到后向 worker 写 `stop`、等它退 79、父以 0 退出。父**不把信号转发**给 worker（转发会绕过父的收尾编排，见 5.7.8 的 `KillMode=mixed`）。
- **`CREATE_NO_WINDOW` 必须加**：父在无控制台环境（SCM / 计划任务 / 被 detach 拉起）spawn 控制台子系统子进程会新分配可见窗口，1 个常量 + 1 行。
- 父进程若死亡，stdin 关闭：worker **不跟着退**，只记 `supervisor lost` 并继续服务（可用性优先；此时没有监管，由外层或人工介入）。
- spawn 前必须 `remove_var("OJ_DAEMON_READY_FD")` 再按需重设，并给子进程**显式 env 白名单**（`OJ_SUPERVISOR=1` / `OJ_HANDOFF=1` / `OJ_BOOT_SEQ=n` / ready fd）；现有 `serve_cmd.rs:636` 只设不删。
- **退出码要能穿透**：`main.rs:122` 是唯一退出点，`Command::Serve` 现在只做 `Ok(())→0 / Err→1`。需把 `serve_cmd::run` 改成返回码（`Result<i32, String>`），main 原样透传；**禁止在业务层直接 `process::exit`**（会跳过 drain 与日志 flush）。

#### 5.7.4 换进程时序

```
installer(worker, JS) 全部收尾完成：
    任务记录落盘 → 释放任务锁 → 响应已能发出
  → JS: POST /_system/restart {taskId}   （platform-only；没有 supervisor 时 409 no_supervisor）
  → Rust: 写 restart.intent{taskId, attempt}（fsync）→ 先回 202，再排空
  → Rust: graceful shutdown（停 cron → 停 accept → 等在途请求，上限 30s）
  → exit 78
父: 看到 78 → boot.seq +1 → 立即 spawn 新 worker
    env: OJ_SUPERVISOR=1 / OJ_HANDOFF=1 / OJ_BOOT_SEQ=n / ready fd   （argv 逐字节原样）
新 worker: 不跑迁移/seed（verify-only）→ bind → ready
  → 读 intent → 复核任务仍在 running/partial → 续跑 smoke → done / partial
```

**为什么加一个内部端点，而不是让 JS 直接退出**：`installer.ts` 是单次 for 循环 + `finally` 释放锁（`installer.ts:576/746`），JS 里 `process.exit` 会打断当前帧——任务终态、锁释放、smoke 全落空。端点的语义是「**我已收尾，请你在响应写完之后再换进程**」，把「何时可以退」的判断留给唯一知道在途请求数的 Rust 侧。

**为什么 argv 不注入 `--handoff`**：5.7.1 承诺「argv 逐字节原样转发」，用 env 传代际信息即可，也避免 supervise 的参数表被内部开关污染。

「新 worker 先 ready 再 drain 旧 worker」在这里不存在——端口只有一个监听者，旧 worker 必须先把端口让出来。**因此「新 worker 装配失败」时旧 worker 已经退了**，这是 §5.7.5 那 0.19s 窗口之外的第二个代价。

#### 5.7.5 空窗实测（本方案的核心代价）

测法：release 形态（9 模块 / 335 个 api 文件 / sqlite / 无待应用迁移），从 `spawn` 到首次能返回 HTTP 的时间，跑 3 次：

| run | 可接客耗时 |
|---|---|
| 1 | 0.246s |
| 2 | 0.189s |
| 3 | 0.188s |

**中位 ≈ 0.19s，最坏 0.25s。** 这是「纯壳」在**正常路径**（换进程一次成功）上的代价；失败路径的代价是「没有旧进程兜底」，见 §5.7.6。

诚实边界三条：

1. 这个数字含插件加载与**启动期 seed 重放**（本轮 PoC 是普通启动，没有 `--handoff`）。真换进程时新 worker 走 verify-only、跳过 seed，所以**真实空窗应当 ≤ 实测值**——但这是推算，未实测，不作为承诺。
2. **不含待应用的迁移**：如果重启时正好有大批迁移，空窗会显著变长。因此 G4 的口径写「**常规重启 < 1s**」，并要求需要换进程的安装任务把迁移在装进程的 `migrating` 段做完，而不是留到重启时做。
3. 这是**冷启动**成本，不受模块数量线性放大 —— 9 个模块 335 个 api 文件的规模已经覆盖典型生产形态。

#### 5.7.6 失败、崩溃与退出码

| 情形 | 父的行为 |
|---|---|
| worker 退出码 **79**（父发过 stop，已 drain） | 不重启，父以 **0** 退出 |
| worker 退出码 **0**（worker 自己判断该停） | 不重启，父以 **0** 退出 |
| worker 退出码 **78**（请求换进程） | **立即** spawn 新 worker（受下方限速约束） |
| worker 崩溃（信号 / 其它非零，含 bind 失败） | 退避 200ms→400ms→…→**封顶 30s** 重启 |
| 稳定运行 **60s** | 退避计数清零 |
| 新 worker ready 超时（默认 60s） | 杀该 worker，按崩溃处理；**此期间服务不可用**——纯壳形态已声明的代价 |
| worker 写 `restart.intent` 后崩溃 | intent 残留；下一个 worker 起来后拿 taskId 去任务目录复核阶段：`running`/`partial` 则续跑，否则**删除 intent** 并按普通启动走 |
| **degraded** | 判据是时间：**自上次 ready 起持续 60s 未恢复**。它只是一个标签（外显 + 停发 watchdog），**不代表停止重试**——父继续每 30s 重试，永不自行停止 |

**78 必须限速（v4 没有）**：78 原本是「立即重启且清零退避」，一个能反复触发安装的模块就能让服务每 0.19s 断一次。规则放在壳侧（只有父持有计数与退避状态）：

- 60s 内第 1、2 次 78 → 立即重启；第 3 次起 → 按崩溃退避（不是拒绝，是不再「立即」）。
- 78 **不清零**退避计数；只有连续 ready 60s 才清零。
- 单个任务 `attempt > 3` → 任务直接判 `partial`，不再自动尝试换进程。

**「5 分钟 5 次失败」这个 v4 判据是错的**：配 3.2s 封顶时，约 7 秒就会触发，与「5 分钟」自相矛盾；而且「5 次就停」在裸跑形态下等于永久停摆——没有 systemd 时没有第二个外援。改为「时间判据 + 永不停止」，watchdog 只是额外通道，不是唯一退路。

**「父进程以 70 退出交外层」仍然是错的**：默认 `KillMode=control-group` 下 systemd 会把仍在退避中的 worker 一起杀掉再整体重启，等于把「失败」的判断权交给 `StartLimitBurst`，两边计数打架。父保持存活、用 watchdog 表达不健康，语义只有一处。

**端口占用不是独立情形**：`kill -9` 后监听 socket 立即释放，正常不会 `EADDRINUSE`；真遇到（如两次 spawn 重叠、或上一代 `TerminateProcess` 未回收）就表现为 worker 非零退出 → 走崩溃退避。壳不为此做端口探测（那需要读配置）。**也不需要 `SO_EXCLUSIVEADDRUSE`**：std 在 Windows 显式不设 `SO_REUSEADDR`，第二次 bind 本来就 `WSAEADDRINUSE`（F48），加它只会逼我们绕开 tokio 自建 listener。

#### 5.7.7 跨平台判定（同一形态，没有 A/B 之分）

窗口事实：本仓 release 明确出 `x86_64-pc-windows-msvc`（`release.yml:146-148`）；`--daemon` 走 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`（`serve_cmd.rs:884-901`），`daemon_ready` 在非 unix 是空实现（`serve_cmd.rs:875-880`）。**这些都不改**——`--daemon` 的「打印 pid 后退出」是既发布契约。

| 能力 | Linux / macOS | Windows | 结论 |
|---|---|---|---|
| 父守护 + 崩溃重启 | ✅ `fork/exec` 可用 | ✅ 纯 `CreateProcess` + `WaitForSingleObject` | 同一套逻辑，平台分支集中在 spawn |
| 就绪握手 | ✅ 继承的专用 fd 一行 JSON | ✅ stdout 一行 JSON（tee 仅 unix） | 协议相同、载体按平台分（见 5.7.3） |
| 优雅停机 | ✅ stdin 一行 `stop` | ✅ 同左 | 统一 stdin；Windows 无「温和信号」 |
| 不换 pid 的重启 | ❌ 无 | ❌ 无 | 两平台都不做，统一换 pid |
| 子进程继承 socket | ✅ 可做 | ⚠️ 需 unsafe WinAPI | 两平台都不做（5.7.2） |

Windows 专项口径：
- **`CREATE_NO_WINDOW` 必须设**：父在无控制台环境（SCM / 计划任务 / 被 detach 拉起）spawn 控制台子系统子进程，否则会弹出一个可见的黑窗口。
- bind 失败 = 非零退出，交给父退避；worker 自己不重试（重试逻辑只存在一处）。
- **不需要 `SO_EXCLUSIVEADDRUSE`**：std 在 Windows 显式不设 `SO_REUSEADDR`，第二次 bind 本就 `WSAEADDRINUSE`（F48）。
- **oj 不提供 Windows 服务（SCM）集成**：没有 `CreateService` / `ServiceMain`。要用服务形态，由 nssm / winsw / 计划任务托管 `oj supervise`，此时 `supervisor` 进程是 SCM 的子进程，`oj stop` 走 `stop.request`（5.7.9）。
- 纠正一个口径：让 `ctrl_c` 失效的是 **worker 自己的进程创建标志**（无控制台），不是 `DETACHED_PROCESS` 这个名字本身。

#### 5.7.8 与外部 supervisor 的关系（没有配置项）

**没有 `server.supervisor` 这个键**（v4 的 `auto|on|off` 全部删除）。形态只由命令行决定：

| 启动命令 | 形态 | 守护来源 |
|---|---|---|
| `oj serve ...` | 单进程，今天的形态 | 无（安装遇换进程 → `partial` + `restart.required`） |
| `oj serve --daemon ...` | 一次性 daemonize，打印服务 pid 后父退出 | 无（同上） |
| `oj supervise ...` | 父常驻 + worker | 壳自己 |
| systemd / k8s / nssm 托管 `oj supervise` | 父常驻 + worker | 壳 + 外层双保险 |

**sd_notify 由父进程发，不由 worker 发**——纯壳的好处正在这里：壳知道「有没有一个健康 worker 在服务」，worker 自己不知道父是否存在。

| 消息 | 父何时发 |
|---|---|
| `READY=1` | 第一次收到 worker 的 `ready` 之后 |
| `WATCHDOG=1` | 每 `WatchdogSec/3` 一次，**仅当**「有 worker 处于 ready 且未在退避」 |
| `STOPPING=1` | 收到外层 SIGTERM、向 worker 写 `stop` 之前 |

**停发 `WATCHDOG=1` 不等于停止重试**：`degraded` 时父仍在每 30s 重试；watchdog 只是让外层也能接管。外层一旦重启，父进程结束、`boot.seq` 随之重置，不会与父的重试并行——这也是不需要跨进程互斥的原因。

systemd 单元（仅当 `ExecStart` 是 `oj supervise` 时）：

```ini
KillMode=mixed          # SIGTERM 只给主进程(父)；父把它转成 stdin stop，超时后 SIGKILL 全组
TimeoutStopSec=40       # ≥ worker drain 上限(30s) + 父回收余量
Restart=on-failure
# Type=notify 从 P4b（sd_notify 落地）起才可用；之前必须保持默认 simple
```

`KillMode=mixed` 的必要性：默认 `control-group` 会把 SIGTERM 同时发给父和 worker，worker 会绕过父自己收尾，父子同时 drain 容易出竞态。

k8s 下建议：容器入口保持 `oj serve`（默认形态，Pod 级重启即平台惯例）；确需自愈再换 `oj supervise`，且 liveness 必须打业务端点而不是进程存活。

#### 5.7.9 运维面（P4 必须补齐，现在全都没有）

- **pid 文件只在 `oj supervise` 形态下存在**：`supervisor.pid` 放运行时目录，0600、`O_NOFOLLOW|O_CREAT|O_EXCL`，内容 `pid + starttime + boot + config 路径`。这里的 config 路径**取自 argv 的 `-c`，不解析配置文件**（缺省时记 CWD 的相对路径）；运行时目录的 `<hash>` 也由同一字符串算出，不读 config。`oj serve` / `--daemon` 不写这个文件——否则等于给默认路径新增一个失败分支（F38 的同类问题）。
- **采信 pid 之前必须校验**：`starttime` 与 `/proc/<pid>/stat` 一致（Linux）；macOS 无 `/proc`，退化为 `kill(pid,0)` + 命令名校验。不一致就按陈旧文件清理。**不引入 nonce**（同 uid 可读，不构成安全边界，F50）。
- **`oj stop` / `oj restart` 不存在**（`args.rs` 子命令枚举里没有），P4 一并加：
  - Unix：向 supervisor 发 SIGTERM（父已注册处理 → 向 worker 写 `stop` → 等 79 → 父退 0）。
  - Windows：没有「温和信号」，写 `stop.request`，父每 1s 轮询后删除并走同一条收尾路径。**这是唯一用到文件轮询的地方**，其余全走 stdio。
  - `oj restart` = stop + 等 pid 消失 + 同参数重起；**没有 `--full` 变体**（worker 自己 bind，改 host/port 与改任何特权面配置一样，只需要一次换进程）。
- **单实例保护只作用于 supervise**：`oj supervise` 启动前查 `supervisor.pid`，指向存活的同 config 父进程则拒绝启动并点名 pid。`oj serve` 保持今天的行为（端口冲突由 bind 报错）。
- `/_system/config` 增：`supervisor_pid` / `worker_pid` / `boot` / `generation` / `degraded{reason,since}` / `last_restart{reason,taskId,at,ms}` / `restart_pending[]`。**换进程期间这些字段是 on-call 判断「正在换代」而不是「服务挂了」的唯一依据**（见 §8 的告警抑制）。
- **`generation` 必须跨进程单调**：`ReloadState::new` 固定 `generation:0`（`reload.rs:118-123`），换进程后会从 N 掉回 0，安装器的 `+1` 断言必错、外部监控会看到计数倒退。做法：父每次 spawn 前把 `boot.seq` 加一并经 env 下发；worker 上报 `(boot, generation)`，安装器与监控的判据从「数值 +1」改为「**lexicographic 递增**」：同 boot 内要求 `generation == 上次+1`，换 boot 时要求 `boot` 变大、`generation` 从 0 重新开始。
- 日志分流：worker 写 `server.log`、supervisor 写 `supervisor.log`；两者都 0600，父 tail 打印前过 `redact`。**Windows 必须由父代为落盘**：非 unix 的 `logging` 不落盘（`logging.rs:71-81`），父接走 stdout 后 worker 日志会全丢。

#### 5.7.10 与热更的关系（不替代，分三轨）

热装载永远是主路；本节只处理「热装载覆盖不了的那一小部分」。按部署形态分三轨，**产品语义不同，不能混写**：

| 轨 | 形态 | 安装结果 |
|---|---|---|
| **T1 无守护** | `oj serve` / `--daemon` | 热装载照常；需要换进程时任务 `partial` + `restart.required:true`（含命令提示），**不伪装成 done** |
| **T2 有壳** | `oj supervise` | 调 `_system/restart` 自动换进程，续跑 smoke，`done` |
| **T3 外部管理器** | systemd/k8s/nssm 托管 `oj serve`（不套壳） | 同 T1；外层若配置 `Restart=always`，人工/外层重启后生效。**不承诺自动续跑** |

**无守护不等于「装不上」**：绝大多数安装只走热装载（P0 范围），只有 `platform` / `fs` / `db_*` / `audit` 等特权面、插件 ABI、`server.*` 变更才需要换进程。把这些统一判 `done` 才是问题——今天 `smoke.ts:144-149` 把「因待重启的 401」当成通过，用户看到的是假成功。

**判定只有一处**：`reload` 返回的 `restart_pending` 非空 → 调 `POST /_system/restart`；空 → 正常 `done`，不碰端点。所以 T1/T2 的差异只体现在端点的两种响应上（202 / 409），安装器不需要自己探测有没有壳。

其余三条不变：

- **不再需要跨进程互斥**：旧 worker 完全退出后新 worker 才起，任何时刻只有一个进程在跑迁移、cron、任务池。v3 里的 `deploy.lock` + 重叠期时序约束随「父持 socket」一起删除。
- **任务锁必须在 `_system/restart` 之前释放**：`_lifecycle/lock.ts` 的锁是磁盘文件，新 worker 续跑 intent 时会先取同一把锁；顺序已写进 5.7.4。崩溃路径（未及释放）沿用既有的过期/接管逻辑。
- **安装接口改后台任务 + 立即返回 task_id**：换进程会断连，同步响应等不到结果。客户端按 task_id 轮询，容忍一次断连（连接被 reset 就重试，不是失败）。

### 5.8 种子（F7）——P3

- 时点必须在 `lock_commit` 之后（版本目录此时才进 `dist/api`）。
- 依赖上游新增 `oj seed -m <name>`（今天只有库，无子命令），因此 P3 需要先发一个 oj 版本。
- 只灌该模块，不做全量重放；幂等由 S006 门禁保证。

### 5.9 宿主能力门禁（F45）——P0

老 oj + 新模板的失败**发生在锁提交之后**（`installer.ts:660` 之后才 reload，`reload.ts:68-75` 判 `retryable:false`）——这是最贵的一种失败：每次装都白跑一遍补偿。

**做法**：`ojInfo()`（`bootstrap.js:874`，与 `oj info` 同源、装配期冻结、任何模块可读）增一个字段：

```json
{ "capabilities": ["reload.api", "reload.modules_in_key", "anon.per_generation"] }
```

模板侧在 **preflight**（`steps/preflight.ts`，锁之前、零痕迹）断言所需子集，缺即 `failed` + 稳定 code `host_capability` + 文案「当前 oj 不支持热装配，请升级至 ≥X」。

**不放 market meta**：那是模板版本，回答不了「宿主具备哪些能力」。**不做反向门禁**（新 oj + 老模板）：老模板的 `expected` 只认 `["vars"]`（`reload.ts:67`），老 uninstall 不 reload、老 smoke 吞 401——已发布模板不可变，只能靠 oj 保持老语义可用。

---

## 6. 目标重述（收缩后的 G1）

- **G1（P0）**：安装完成时——新路由 200、声明的匿名端点 200、`generation+1`、PID 不变。
- **G2（P0）**：卸载完成时——该模块路由立即 404、`modules.json` 无条目、其他模块不受影响、PID 不变。WS 只承诺新连接 404（主动断开在 P1）。
- **G3（P0）**：任一步失败——上一代继续服务，任务 `partial`，错误含失败段与原因，可重试。
- **G4a（P4，T2 有壳）**：`oj supervise` 下，热装载覆盖不了的变更由 worker 请求换进程。承诺：supervisor pid 不变、worker pid 变化、`(boot, generation)` 单调、**常规重启空窗 < 1s（实测中位 0.19s，最坏 0.25s）**、崩溃后自愈、正常停机不误重启。
  **明确不承诺**：零空窗、零连接中断、换进程失败时旧 worker 继续服务。端口只有一个监听者，旧 worker 必须先退——「失败保活」与「零空窗」是同一个能力的两个面，要它就得让父持 socket，已否（§5.7.2）。换进程失败的窗口由父的退避重试兜住，`< 1s` 的空窗内客户端会看到连接被拒，需重试。
- **G4b（P0，T1/T3 无壳）**：需要换进程的安装**必须如实标 `partial` + `restart.required:true`**，并给出重启命令；不得判 `done`。热装载能覆盖的部分照常立即生效（所以任务不是全失败，而是「已生效一部分 + 待重启」）。
- 移出承诺：seed 随装（P3）、cron 随装（后续项）、WS 主动断开（P1）。

## 7. 异常矩阵（v5）

| # | 场景 | 期望 |
|---|---|---|
| E1 | reload 中 kill -9 | 重启后按锁重建：旧代或新代，功能单调；`restart.intent` 驱动续跑或 partial |
| E2 | 写锁前断电 | 目录是垃圾但锁未含 → 不加载；启动 GC 清 staging |
| E3 | 写锁后、reload 前崩溃 | 新模块已锁定 → 重启即生效；任务 partial 可重放 smoke |
| E4 | reload 返回 `unchanged` | 判失败并提示「锁摘要未变化 = 模块集未变」 |
| E5 | 并发安装 | 409 + 串行化（现状锁） |
| E6 | 路由冲突 | preflight 拒装 |
| E7 | 匿名条目指向保留段 / 登录端点 | preflight 拒装 |
| E8 | 同 prefix 存在未声明匿名残留 | preflight 拒装（§2 质辩 1） |
| E9 | 卸载 reload 失败 | 锁写回 + 再 reload；目录未删，可重试 |
| E10 | 锁内目录缺失 | P0 前：全站拒启；P0 后：跳过 + degraded 点名 |
| E11 | 卸载时 DB 级联成功、写锁失败 | 锁保留（模块仍挂载）+ 拒绝卸载，可重试 |
| E12 | 磁盘满 | 安装失败、零锁变更 |
| E13 | 换进程后新 worker 起不来（产物坏 / bind 失败） | 父退避重试（封顶 30s，永不停止），**期间服务不可用**（已声明）；恢复后 worker 读 intent 复核任务 → `partial`，可重试 |
| E14 | cron 在 reload 后停摆 | P0 前：静默（既有缺陷）；P0 后：不受 reload 影响 |
| E15 | worker 崩溃（panic / OOM / kill -9） | 父按退避重启；自上次 ready 起 60s 未恢复 → 标 `degraded` + 停发 watchdog，但**继续每 30s 重试**（P4） |
| E16 | 正常停机（`oj stop` / 外层 SIGTERM） | Unix：SIGTERM→父→stdin `stop`→worker drain→79→父退 0；Windows：`stop.request`→同一路径。均不重启（P4） |
| E17 | 父进程崩溃 | worker 继续服务，stdin 关闭，日志 `supervisor lost`；再起父进程时若 bind 失败 → 点名 worker pid，**不静默抢端口**（P4） |
| E18 | 换进程空窗（≈0.19s） | 旧 worker 已完全退出、新 worker 未 ready：连接被拒。客户端（安装器 / 外部探活）必须重试；空窗内到点的 cron 可能错过一次触发（`next_run` 只在内存，`tasks.rs:347`），**不补跑**（P4） |
| E19 | 反复触发换进程（重启风暴） | 壳侧限速：60s 内第 3 次起按崩溃退避；单任务 `attempt>3` → `partial` 不再自动换（P4） |
| E20 | 无守护形态下装「必须换进程」的方案 | 热装载部分生效，任务 `partial` + `restart.required` + 命令提示，**不判 done**（P0） |
| E21 | 老 oj + 新模板 | preflight 读 `ojInfo().capabilities` 缺项 → `failed(host_capability)`，**在写锁之前**失败（P0） |

## 8. 验收（BDD / INVEST）

1. **Given** 已装 API-only 方案，**When** 安装新方案，**Then** 同 PID、`generation+1`、`GET /api/<prefix>/<health>` 200。
2. **Given** 方案声明 `api.anonymous`，**When** 安装完成，**Then** 该端点无 Authorization 也 200（不再 401）。
3. **Given** 已装模块，**When** 卸载完成，**Then** 1s 内该 prefix 全部 404、`modules.json` 无条目、其他模块仍 200、PID 不变。
4. **Given** 上一次安装失败（含匿名接线），**When** 再次安装同一方案，**Then** config 中该 prefix 的匿名条目数不增长（幂等）。
5. **Given** 锁内某模块目录被删，**When** 启动，**Then** 该模块被点名跳过，其余模块 200。
6. **Given** 安装时 smoke 探活，**When** 首个路由返回 404，**Then** 任务判 `partial`，不判 `done`。
7. **Given** reload 触发，**When** 5 分钟后到点，**Then** 原 cron 任务仍被触发（P0 前置的回归）。
8. **Given** 卸载 reload 失败，**When** 操作结束，**Then** 模块仍可访问（fail-closed），任务 `partial` 且可重试。
9. **Given** `oj supervise` 下安装需要换进程，**When** worker 调 `_system/restart`，**Then** ≤1s 内可访问（`accept` 成功）、supervisor pid 不变、worker pid 变化、`(boot, generation)` 单调递增；空窗内客户端拿到的是连接被拒，**不是** 5xx 或半截响应。
10. **Given** 新 worker 装配失败（配置坏 / 产物坏 / bind 失败），**When** 父进程换进程，**Then** 父按退避重试（封顶 30s）且**永不自行停止**；60s 未恢复转 `degraded` 并停发 watchdog，但仍在每 30s 重试；worker 恢复后任务判 `partial` 且点名失败阶段。
11. **Given** 运行中的 worker 被 `kill -9`，**When** 5s 内观察，**Then** 服务恢复（新 worker ready 且 `(boot, generation)` 不回退），无 `restart.intent` 时不误判为安装任务。
12. **Given** 执行 `oj stop`，**When** Unix（SIGTERM）/ Windows（`stop.request`）两条路径各自触发，**Then** worker 优雅退出、父以 0 退出且不重启，运行时目录被清理。
13. **Given** 发生一次换进程，**When** 跨过一整分钟，**Then** 新 worker 内 cron 全部重新生效（不因换进程停摆）、空窗内到点的触发至多错过一次且不补跑、**不出现双跑**（任何时刻只有一个 worker 进程）。
14. **Given** 已装方案尝试伪造控制（写 `restart.intent` / `stop.request`、发 HUP），**When** 触发，**Then** 不构成权限提升：HUP 未注册；`restart.intent` 只含 taskId，worker 必复核任务存在性与阶段；最坏结果是诱导一次停服（同 uid 本就有权停服），且被日志与 `last_restart` 记录。
15. **Given** 无守护形态（`oj serve`）安装一个需要换进程的方案，**When** 安装结束，**Then** 任务 `partial` + `restart.required:true` + 给出重启命令；热装载覆盖的部分已生效；**不出现 `done`**。
16. **Given** 老 oj（无 `capabilities`）+ 新模板，**When** 执行安装，**Then** 在**写锁之前**以 `host_capability` 失败，`modules.json` 与锁文件零变更。
17. **Given** 一个能反复触发换进程的方案，**When** 60s 内第 3 次请求换进程，**Then** 壳不再「立即重启」而按退避处理；单任务第 4 次 → `partial`，服务不进入 0.19s 循环。

## 9. PoC 闸门（P0 开工前，全部在 /tmp，不改仓库）

| # | 验证 | 判据 | 状态 |
|---|---|---|---|
| PoC-1 | **cron 存活**：最小工程 + 每分钟 cron，启动后改 `vars` 触发一次 reload，观察 5 分钟 | 预期「reload 后再无触发」→ 坐实 F10 | 未跑；F10 已由代码取证（`tokio::spawn` 于 reload 临时 rt 内），PoC-1 降级为 P0 的**回归用例**，不再阻塞开工 |
| PoC-2 | **reload 耗时**：336 文件，`vars` 自增触发 3 次 | 见 §3 | ✅ 已完成：release 106ms / dev 3029ms |
| PoC-3 | ~~**fd 继承**~~ | — | **作废**：fd 路线已被 §5.7.2 否决；其代价面（空窗）已由 §5.7.5 实测量化，无待验证项 |
| PoC-4 | **Windows 守护**：`oj supervise` 在无控制台环境 spawn worker；`stop.request` 后 1s 内优雅退出；`kill -9` worker 后 5s 内自愈；不弹窗 | 父打印 pid 时已可访问；stop 后 1s 内退出、父以 0 退；kill -9 后 5s 内恢复；无可见窗口 | 未跑；需 Windows 机器，只阻塞 P4b，不阻塞 P0 |
| PoC-5 | **ready 通路**：在 `logging::init` 之后（`serve_cmd.rs:247` 位置）经继承 fd 写一行，父侧在 tee 已生效的前提下读到 | 父在 30s 内读到 `ready` 且能读到 EOF；同时验证 worker spawn 的长寿子进程不继承写端（`FD_CLOEXEC` 补齐生效） | 未跑；**P4a 开工前必跑**——这是 v4 唯一的「必然失败」假设 |

## 10. 分期（v5）

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| **P0** | §5.1 换代身份 + `modules` 进 applied；§5.2 路径 C（HTTP）+ preflight 两条新检查；§5.4 cron runtime + 停池超时 + 提交顺序；§5.3 卸载顺序；§5.5 启动降级；§5.6 补偿清单；**§5.9 capability 门禁；smoke 收紧（待重启不得判过）；无守护形态判 `partial` + `restart.required`** | 验收 1/2/3/4/5/6/7/8/15/16 全绿；reload 耗时：release < 200ms、dev（336 文件）< 5s |
| **P1** | WS 匿名随代 + `WsRegistry` + 卸载主动 close | 验收 3 的 WS 部分补齐 |
| **P2** | §4.1 索引 `ArcSwap`（dev/release 统一）+ StableState 派生面一致 | `ojm dev` 安装免重启；别名/表归属不漂移 |
| **P3** | 上游 `oj seed -m` + 安装器接线 | 带种子方案装完即读得到 |
| **P4a** | `oj supervise` 子命令（flatten `ServeArgs`、拒绝 `--daemon`）；壳四件事（spawn / ready / 退出码 / 退避+限速）；**PoC-5 先行**（ready 通路）；ready = 继承 fd（Unix）/ stdout（Windows）；stop = stdin 并入 `shutdown_signal`；78/79 经 `serve_cmd::run`→`main` 透传；`POST /_system/restart`；`boot.seq` + `(boot, generation)`；pid 文件 / 单实例 / `oj stop`·`oj restart`；安装改异步任务 | 验收 9/11/12/13/17 绿；空窗 < 1s；崩溃 5s 内自愈；78 限速生效；`oj serve` 行为零变化（回归用例） |
| **P4b** | env `OJ_HANDOFF`（verify-only：不跑迁移/seed）+ `sd_notify(READY/WATCHDOG/STOPPING)` + Windows 专项（`CREATE_NO_WINDOW`、`stop.request`、`oj stop`）+ 父代管 worker 日志落盘 + PoC-4 | 验收 10/14 绿；PoC-4 绿；systemd 下 `Type=notify` 可用；计数器跨进程单调 |
| **P5** | 观测：`generation` 时间线、`/_system/config` 的 `restart_pending` 外显 | 运维可回看每次换代 |

依赖：P0 全部在上游 `oj-bin` + 本仓 `templates`，无新命令依赖；P3/P4 各需一次 oj 发版。**P4a 的唯一前置是 PoC-5**（ready 通路），它不阻塞 P0。

## 11. 风险（诚实账）

| 风险 | 量化/依据 | 处置 |
|---|---|---|
| reload 耗时 | **实测**：release 9 模块/337 文件 **106ms**；dev 336 文件 **3029ms**（斜率 8.9ms/文件） | 生产达标；dev 不宣传亚秒；如需优化，按「只重建变化模块」做，不在 P0 |
| 匿名短路改热点路径 | 每请求一次 `path_matches`，O(路径段数) | 预编译，带基准用例 |
| 启动降级掩盖坏包 | 只降级「目录缺失」，解析/命名错误仍 fail-fast | E10 |
| 卸载后 config 残留匿名 | 启动期条目仍被 guard 静态表放行 | 仅影响同 prefix 换装；preflight 拦截（E8） |
| 换进程空窗 | **实测**中位 0.19s、最坏 0.25s（含插件加载与 seed，**不含**待应用迁移）；仅 T2 有壳形态存在 | 承诺 < 1s；安装改异步 + 客户端断连重试；迁移必须在装进程的 `migrating` 段做完 |
| 换进程无失败保活 | 端口唯一，旧 worker 必须先退，新 worker 失败即无服务 | 已声明不做；父退避（封顶 30s）**永不停止** + `degraded` 标签 + watchdog 交外层 |
| 重启风暴 | 一个能反复触发安装的模块可让服务每 0.19s 断一次 | 壳侧限速 3/60s；单任务 `attempt>3` 判 partial（E19/验收 17） |
| 控制面被伪造 | fs jail 只是路径前缀，不是 OS 沙箱（`bridge/fs.rs:42-44`）；同 uid 主体可读运行时目录 | 只承诺「**降低可达性**」：目录 0700 + owner 校验 + `O_NOFOLLOW` + 启动清残留；最坏是诱导停服，不构成提权；不引入 nonce 冒充安全边界 |
| 父进程崩溃 | worker 继续服务但无人监管；再起父进程时 bind 被拒 | `supervisor lost` 外显；新父不抢端口、点名 worker pid |
| 单实例判定依赖 pid 文件 | 仅 supervise 形态有 pid 文件；pid 复用窗口；macOS 无 `/proc` | 校验 `starttime`；macOS 退化为 `kill(pid,0)` + 命令名；`oj serve` 不查这个文件（零行为变化） |
| 无守护用户看到 `partial` | T1/T3 下换进程类安装从「假 done」变「真 partial」 | 产品口径变更，需要发布说明；文案必须给出重启命令与「热更部分已生效」 |
| 双代 Router 内存 | 只保 1 代，在途毫秒级 | 安装低频 |

## 12. 不做 / 延后

- 不做模块级热补丁（改源码即时生效）——重装走同一链路。
- 不做多进程/多副本——单进程约束。
- **不做零空窗换进程 / 换进程失败保活**：两者是同一能力（父持 socket）的两个面，被判「复杂度 > 1ms 收益」（§5.7.2）。空窗窗口 < 1s，由客户端重试兜住。
- **不做 execve 原地替换**：空窗并不更小（listener CLOEXEC）、无崩溃自愈、静默 re-exec 属改变启动方式（§5.7.2）。
- **不引入 `server.supervisor` 之类配置键**：形态只由命令行决定，壳不读配置。
- **不改 `oj serve` / `oj serve --daemon` 的任何行为**：包括 Windows `--daemon` 不等就绪这个既有缺口——那是另一件事，不在本方案里顺手改。
- 不做 Windows SCM 集成（无 `CreateService`/`ServiceMain`），服务形态由 nssm / winsw / 计划任务托管。
- 不放开特权面热生效：`platform` / `fs` / `db_access` / `db_client` / `audit` 仍必须重启。
- 不做文件监听驱动重扫（NFS/容器卷不可靠）。
- 不做全量 seed 重放。
- 不补跑空窗内错过的 cron 触发（`next_run` 只在内存，`tasks.rs:347`）。
- 不做反向兼容门禁（新 oj + 老模板）：已发布模板不可变，只能靠 oj 保持老语义可用。
- 延后：市场方案的 tasks 进锁（F6）；匿名下沉 Router（B 路线，已否决）。
