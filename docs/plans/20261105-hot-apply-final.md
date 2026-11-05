# 方案：解决方案免重启生效（安装 / 卸载 / 异常三轴）

> 状态：**定稿方案**（2026-11-05）。生产 oj 为单进程常驻服务，市场安装/卸载方案后当前要求重启进程。本文给出最终设计与分期，不含历史演进与评审台账。

## 0. 结论

热装载是主路，换进程是少数特例。方案分两层：

1. **热装配修复（P0）**：修复四个既有缺陷，使「锁变化能真正触发装配、卸载/回滚能生效、cron 不静默停摆、失败可精确补偿」。绝大多数安装/卸载走此路径，PID 不变、亚秒级生效。
2. **换进程路径（P4，可选）**：仅当变更涉及特权面（platform/fs/db_*/audit）、插件 ABI、`server.*` 时才需换进程。提供纯壳 `oj supervise`，父进程只做四件事（spawn / 收 ready / 看退出码 / 退避重启），不持 socket、不读配置、不开 HTTP。

**默认形态字节级不变**：`oj serve` / `oj serve --daemon` 行为一字不改。无守护形态下，需换进程的安装任务判 `partial + restart.required:true` 并给出重启命令，不再伪装成 `done`。

## 1. 目标

- **G1（P0）**：安装完成——新路由 200、声明匿名端点 200、`generation+1`、PID 不变。
- **G2（P0）**：卸载完成——该模块路由立即 404、`modules.json` 无条目、其他模块不受影响、PID 不变（WS 主动断开在 P1）。
- **G3（P0）**：任一步失败——上一代继续服务，任务 `partial`，错误含失败段与原因，可重试。
- **G4a（P4，T2 有壳）**：`oj supervise` 下，需换进程的变更由 worker 请求换进程，自动续跑。承诺 supervisor pid 不变、worker pid 变化、`(boot, generation)` 单调、**常规重启空窗 < 1s（实测中位 0.19s、最坏 0.25s）**、崩溃自愈、正常停机不误重启。明确**不承诺**零空窗、零连接中断、换进程失败时旧 worker 保活。
- **G4b（P0，T1/T3 无壳）**：需换进程的安装如实标 `partial + restart.required:true`，不得判 `done`；热装载能覆盖的部分照常立即生效。

移出承诺：seed 随装（P3）、cron 随装（后续项）、WS 主动断开（P1）。

## 2. 总体架构（三轨）

| 轨 | 形态 | 安装结果 |
|---|---|---|
| **T1 无守护** | `oj serve` / `--daemon` | 热装载照常；需换进程 → 任务 `partial + restart.required` |
| **T2 有壳** | `oj supervise` | 调 `_system/restart` 自动换进程，续跑 smoke，`done` |
| **T3 外部管理器** | systemd/k8s/nssm 托管 `oj serve` | 同 T1；外层 `Restart=always` 时人工/外层重启后生效 |

判定只有一处：`reload` 返回的 `restart_pending` 非空 → 调 `POST /_system/restart`；空 → 正常 `done`。T1/T2 差异只体现在端点的两种响应（202 / 409），安装器不自己探测有没有壳。

## 3. 热装配核心（P0）

### 3.1 换代身份

`do_reload` 幂等键从 `sha(config)` 扩为：

```
generation_key = sha256(归一 config 文档) ⊕ sha256(dist/api/manifests.yaml 原文)
```

- 锁（manifests.yaml）变化即产生新 `generation_key`，卸载摘锁后自动触发装配 → 解决「卸载空转」。
- `diff_configs` 返回新增 `modules` 段（锁增删按 `+name@ver` / `-name@ver` 计入 `applied`）。
- 不引入 HTTP `scope` 参数（少一个对外契约面）。

### 3.2 匿名表随代（HTTP）

走「每代 anon 表 + dispatch 短路」（路线 C，否决重建守卫/Router 标记）：

- `App::from_config` 每代重建 `AppState.pipeline`，在 `Pipeline` 内置 `anon: Matcher`，由 `auth.anonymous_paths` + `tenant.anonymous_paths` 共同编译。
- `admit()` 在 `guard.verify` 之前短路：命中 `anon` 即跳过验签。
- 匹配按 `ModuleEntry.prefix` 计算（可与模块名不同、可多段），不按「首段=模块名」。
- 保留段黑名单：`_platform` / `_system` / `auth` / `_lifecycle` 下的新增匿名条目一律拒装。
- 删除语义：运行期新增的匿名条目删除即立即失效（免重启）；启动期已在 config 的条目删除后 guard 静态表仍含，需重启才彻底撤销，但其暴露面受「匿名只对已注册路由有效 + 卸载后路由已无」限制。因此规则：**删免重启；但安装 preflight 必须拒绝「目标 prefix 在 config 中存在未被本次 manifest 声明的匿名条目」**（同 prefix 换装不会静默继承）。
- WS 匿名（P1）：每代把 anon 集合注入 `mirror_routes` + 建 `WsRegistry` 支持卸载主动 close；P0 只承诺新连接按新代判定。

### 3.3 cron 存活（P0 前置）

cron 驱动改独立 OS 线程 + current_thread runtime（同 `TaskPool` worker），生命周期随进程而非随 reload 的临时 rt——否则「装完 cron 生效」是假的。旧池停机加超时（保 N-1 代，超时记 warn），避免卡死 worker 挂死整次 reload。

### 3.4 卸载顺序 + 启动降级

**先失去可达性，再失去文件，且 reload 必须成功后才删盘**：

1. 预检（影响面 / 空锁）→ 拒则零改动。
2. DB 级联事务 → sidecar → `modules.json` → **摘锁**。
3. 触发 `reload` → 断言 `applied` 含 `modules`、`restart_pending` 为空。
4. reload 成功后才删版本目录 / staging / `siteModulesDir`（best-effort，失败只 warn，锁是真相）。
5. reload 失败 → 锁写回 → 再 reload 回旧代（幂等）；目录未删，不留缺目录状态。

**启动自检降级**：锁内版本目录/`manifest.yaml` **缺失** → 跳过该模块 + 点名 + `/_system/config` 标 degraded（不再全站拒启）；`manifest.yaml` **解析失败 / name 不符 / version 错位** → 仍 `Err`（构建错误不掩盖）。

### 3.5 安装补偿清单

| 阶段 | 动作 | 失败处置 |
|---|---|---|
| preflight | 契约/冲突/匿名语法 + 保留段 + 同 prefix 未声明条目 + 目标 prefix 与既有匿名残留 | 零痕迹 |
| downloading/verifying/extracting | 拉包、验签、解 staging | 清 staging 重试 |
| migrating | `oj migrate`（子进程，事务/备份） | DB 回滚 |
| lock_commit | rename 版本目录 + 写锁（生效点） | 锁未变 → 撤 rename |
| reloading | seq 自增 + 匿名接线 → `reloadAndAssert`（期望含 `modules`） | 见补偿 |
| smoke | 探首个路由：200/401/403 = 已注册；404/连接失败 = 失败 | `partial` 或按开关回滚 |
| audit/history | oplog | 仅日志 |

**现状缺口**：当前 `runInstall`（`installer.ts:660-663`）在锁后阶段失败时只置 `task.status="partial"` 并 break，**不回滚任何已落盘资产**，反复失败会放大匿名面/残留注册。补偿清单是一套新增机制，目标：锁后失败 → 站点恢复到「装前代」状态（旧代继续服务），任务标 `partial + 可重试`，且幂等。

**资产写入清单（谁写、何处断）**：

| 资产 | 写入 stage | 回滚原语 |
|---|---|---|
| `manifests.yaml`（锁） | `lock_commit` → `commitLockEntry` | `writeLock(lockPath, lockBefore)` |
| `config.yaml` 匿名条目 + seq | `reloading` → `patchConfigAt`→`appendAnonymousPaths`/`bumpInstallSeq` | 新增 `removeAnonymousPaths`（逆操作）；**seq 不回滚**（单调无害） |
| `config.yaml` preview 派生 | `reloading` → `patchConfigAt(...,true)` | 同上（optional 跳过） |
| DB: route/role/permission/setting | `registering` → `registerSolution` | 复用卸载 DB 事务：`db.tx` 删 route + `uninstallSolution` |
| `modules.json` 条目 | `deploying_web` → `upsertModulesJson` | `removeModulesJsonEntry` + 断言 version |
| `siteModulesDir/<name>` web 树 | `deploying_web` → `copyTree` | best-effort `f.remove(siteModulesDir/<name>)` |
| sidecar `state` | **不在 pipeline 内**（仅终态块写，失败前根本没写） | 无需回滚 |

→ 失败点只在 `registering` / `deploying_web` / `reloading` / `smoke` 四段，全部锁后。

**新增 / 复用原语**：

- `text-edit.ts` 加 `removeAnonymousPaths(content, paths): {content, removed}`：逆 `appendAnonymousPaths`，按精确行 `- <path>`（trim 匹配）删除，幂等（无则 no-op）。
- 复用 `uninstall.ts` 的 DB 事务，抽 `revertRegistrations(name)` = `db.tx(t => { t.table("sys_solution_route").where(module).delete(); uninstallSolution(name, t); })`；它会级联删角色/权限——正是所需。
- 复用 `lock.ts` `writeLock` 回写 `lockBefore`（`runInstall` 起始已捕获 `lockBefore`，`installer.ts:564-572`）。
- 新增 `removeModulesJsonEntry(name, path)`：读→filter→原子写；并断言写出后该 name 条目已不存在（装前态本无此条目，断言防并发写者插回）。
- web 树移除：best-effort。

**补偿过程 `compensate(req)`（逆序、每步记 partial）**：`runInstall` 起始已持有 `lockBefore`；`reloading` 段已把本次新增匿名路径存入 `req.deferredAnonymous`（`installer.ts:395`）。

```
1. config:  removeAnonymousPaths(deferredAnonymous) 对 config + previewSibling 各一次
2. lock:    writeLock(lockPath, lockBefore)
3. modules.json: removeModulesJsonEntry(name) + 断言
4. DB:      revertRegistrations(name)
5. reload:  reloadConfig 并断言 unchanged===true（旧代仍在服务，非安装式「applied」断言）
```

- 顺序纪律同卸载「先失可达性再失文件」：先撤匿名（缩暴露面）→ 撤锁（停装配）→ 撤清单/DB（缩 web+路由面）→ reload 让旧代生效。
- 每步 `try/catch`：失败记该步 `partial` 并继续其余步；最终 `task.status="partial"`，`message` 汇总各步 ok/failed。
- **reload 断言改用 `unchanged===true`**：当前 `reloadAndAssert`（`reload.ts:56-62`）把 unchanged 当失败，那是安装式断言；补偿要的是「回到装前代 = 无 swap」，需单独的 `reloadToPrevious()` 或加 `expectUnchanged` 开关。

**接线点**：`runInstall` 的 `!r.ok` 分支（`installer.ts:660-663`）当前 `task.status="partial"` 后直接 break。改为——若 `!PRE_LOCK_STAGES.has(def.name)`，先 `await compensate(req)`，把结果并入 `task.stages`/`message`，再 break。
- **不复用 `cancelCleanup`**（U5 取消）：取消语义是「回到装前且删版本目录」；补偿是「回到装前代但留版本目录供重试」——二者 intentionally 不同。

**幂等 / 可重入**：所有 remove 原语天然幂等（缺则 no-op）；`writeLock(lockBefore)` 锁已相等时仍是幂等重写；`revertRegistrations` 删不存在行是 no-op。故补偿可被重试端点反复调用。

`commit` 与 `current_sha` / tasking 落定顺序调整为「tasking 就绪 → commit → current_sha」，消除 SIGTERM 停不到新池的窗口。smoke 口径修正：匿名端点装完必须 200（删除「anonymous 预期 401」）。

### 3.6 宿主能力门禁（P0）

老 oj + 新模板的失败发生在锁提交之后（最贵的一种）。`ojInfo()` 增 `capabilities` 字段：

```json
{ "capabilities": ["reload.api", "reload.modules_in_key", "anon.per_generation"] }
```

模板侧在 **preflight（锁之前、零痕迹）** 断言所需子集，缺即 `failed(host_capability)` + 文案「请升级 oj 至 ≥X」。不放 market meta（那是模板版本，回答不了宿主能力）；不做反向门禁（已发布老模板不可变，靠 oj 保持老语义可用）。

## 4. 换进程路径：纯壳 supervisor（P4）

### 4.1 入口与职责边界

入口只有一个：`oj supervise [serve 的全部参数]`，通过 `#[command(flatten)]` 复用 `ServeArgs`；`--daemon` 在 supervise 下运行期拒绝（再 daemon 化会变三层进程）。`oj serve` / `oj serve --daemon` 命令行、参数、退出码、打印内容全部不变。

壳职责四件事：① `spawn` worker（argv **逐字节原样**转发，跨代信息走 env）；② 收 **ready**（Unix：继承专用 fd 一行 JSON；Windows：stdout 一行 JSON）；③ 看**退出码**（0/79 正常；78 请求换进程；其它崩溃）；④ **退避重启**并计数（含 78 限速）。

**明确不做**：bind / 持 socket、读 config（一字节都不读，形态只由子命令决定）、解密、连 DB、开 HTTP、装配 App、跑迁移、读写任务状态机、判安装成败。

运行时状态四件，目录优先 `$XDG_RUNTIME_DIR/oj-<hash>/`，无则 `$HOME/.oj/run/oj-<hash>/`（不用 `/tmp`），目录 0700：

| 文件 | 内容 | 谁写谁读 |
|---|---|---|
| `restart.intent` | `taskId + attempt` | 旧 worker 写 → 新 worker 读 |
| `boot.seq` | 整数，每次 spawn 前 +1 | 父写 → 父读（下发 env） |
| `supervisor.pid` | `pid + starttime + boot + config 路径` | 父写 → `oj stop`/单实例判定读 |
| `stop.request` | 空文件 | `oj stop` 写 → 父轮询（**仅 Windows**） |

安全定位（不夸大）：fs jail 只是路径前缀校验、非 OS 沙箱。状态文件移出 jail 仅「降低可达性」——目录 0700 + `st_uid == euid` 校验、`O_NOFOLLOW|O_CREAT|O_EXCL` + 0600、父启动清残留。不引入 nonce（同 uid 可读，无意义）。

### 4.2 形态与空窗

| 形态 | 空窗 | Linux | Windows | 崩溃自愈 |
|---|---|---|---|---|
| execve 原地替换 | ≈0.19s（listener CLOEXEC，exec 时端口释放） | ✅ | ❌ 无 exec | ❌ |
| 父持 socket 传 fd | ≈1ms | ✅ | ⚠️ 需 FFI | ✅ |
| **纯壳 + worker 自 bind** | **0.19–0.25s（实测）** | ✅ | ✅ | ✅ |

采纳纯壳：execve 空窗并不更小且无崩溃自愈、静默 re-exec 即改变启动方式、两套机制违 DRY；父持 socket 代价是父必须解析 config + 跨进程重叠期互斥（迁移/cron/任务池/DB 全要跨进程锁），复杂度 >> 0.19s 收益。0.19s 对「装一个方案」是噪声级。

### 4.3 最小协议（两消息 + 四退出码）

| 载体 | 内容 | 方向 | 平台 |
|---|---|---|---|
| 专用 fd（`OJ_SUPERVISOR_READY_FD`，机制同 `OJ_DAEMON_READY_FD`，payload 为 JSON） | `{"event":"ready","pid":123,"generation":7}` | worker→父 | Unix |
| stdout（tee 仅 unix，非 unix fd1 即父管道） | 同上 | worker→父 | Windows |
| stdin | `{"cmd":"stop"}` | 父→worker | 两平台 |
| 退出码 0 / 79(drained) / 78(请求换进程) / 其它(崩溃) | — | worker→父 | — |

**ready 不能用 stdout(Unix)**：`logging::init` 在 bind 前把 fd1/fd2 `dup2` 进日志 tee，父管道永远收不到字节也不 EOF；Windows 相反（tee 仅 unix）。复用机制、不复用 env：用新 `OJ_SUPERVISOR_READY_FD`，避免动 `--daemon` 解析逻辑。

必做修复：① worker 拿到写端后就地补 `FD_CLOEXEC`（否则长寿子进程继承写端、父读不到 EOF 只能 30s 超时）；② spawn 前 `remove_var("OJ_DAEMON_READY_FD")`。`serve_cmd::run` 改返回码化 `Result<i32,String>`，`main` 原样透传；**禁止业务层直调 `process::exit`**。

stop 走 stdin 而非信号（Windows `kill()` 是 `TerminateProcess` 无优雅停机、非 unix 只等 `ctrl_c`）；stop reader 必须并入唯一停机入口 `shutdown_signal` 的第 3 个 select 分支（≈20 行），否则分叉 drain 语义。父自收 SIGTERM/SIGINT 后向 worker 写 `stop`、等 79、父以 0 退出，不转发信号给 worker。父若死亡、stdin 关闭：worker 不跟着退，记 `supervisor lost` 继续服务。

### 4.4 换进程时序

```
worker 全部收尾完成（任务落盘→释放任务锁→响应已能发出）
  → JS: POST /_system/restart {taskId}   （platform-only；无 supervisor 时 409 no_supervisor）
  → Rust: 写 restart.intent{taskId,attempt}(fsync) → 先回 202 再排空
  → Rust: graceful shutdown（停 cron→停 accept→等在途请求，上限 30s）→ exit 78
父: 见 78 → boot.seq+1 → 立即 spawn 新 worker（env: OJ_SUPERVISOR=1/OJ_HANDOFF=1/OJ_BOOT_SEQ=n/ready fd；argv 逐字节原样）
新 worker: verify-only（不跑迁移/seed）→ bind → ready → 读 intent → 复核任务 running/partial → 续跑 smoke → done/partial
```

端点是「我已收尾，请你在响应写完后再换进程」——`installer.ts` 是单次 for + finally 释放锁，JS 内 `process.exit` 会打断当前帧。argv 不注入 `--handoff`（用 env 传代际，避免污染参数表）。端口唯一，旧 worker 必须先退，故「新 worker 装配失败」时旧 worker 已退——这是 0.19s 空窗外的第二代价。

### 4.5 失败 / 崩溃 / 退出码与限速

| 情形 | 父行为 |
|---|---|
| 79（父发过 stop，已 drain）/ 0（worker 自判该停） | 不重启，父以 0 退出 |
| 78（请求换进程） | 立即 spawn 新 worker（受限速约束） |
| 崩溃（信号/其它非零，含 bind 失败） | 退避 200ms→…→封顶 30s 重启 |
| 稳定 60s | 退避计数清零 |
| 新 worker ready 超时（默认 60s） | 杀该 worker 按崩溃；期间服务不可用（已声明代价） |
| worker 写 intent 后崩溃 | 下一 worker 拿 taskId 复核阶段：running/partial 续跑，否则删 intent 按普通启动 |
| degraded | 判据「自上次 ready 起持续 60s 未恢复」，仅作标签（外显+停发 watchdog），**继续每 30s 重试、永不自行停止** |

78 限速（防重启风暴）：60s 内第 1/2 次 78 立即重启，第 3 次起按崩溃退避；78 不清零退避；单任务 `attempt>3` → 任务直接判 `partial` 不再自动换进程。父不以 70 退出交外层（`KillMode=control-group` 下 systemd 会误杀退避中 worker），父保持存活、用 watchdog 表达不健康。

### 4.6 跨平台

同一形态无 A/B 之分。Linux/macOS 用继承 fd 握手，Windows 用 stdout 握手；停机统一 stdin；两平台都不做不换 pid 的重启、都不做子进程继承 socket。`CREATE_NO_WINDOW` 必须设（无控制台环境 spawn 控制台子进程会弹窗）。Windows 不做 SCM 集成（`CreateService`/`ServiceMain`），服务形态由 nssm/winsw/计划任务托管 `oj supervise`；bind 失败=非零退出交父退避，worker 不自重试。不需要 `SO_EXCLUSIVEADDRUSE`（std 在 Windows 不设 `SO_REUSEADDR`，二次 bind 本就 `WSAEADDRINUSE`）。

### 4.7 与外部 supervisor 的关系

**无 `server.supervisor` 配置键**，形态只由命令行决定。`sd_notify` 由父发（父知有无健康 worker，worker 不知父存在）：`READY=1` 首次收 ready 后；`WATCHDOG=1` 每 `WatchdogSec/3` 且仅当「有 worker ready 且未在退避」；`STOPPING=1` 收外层 SIGTERM、写 stop 前。**停发 watchdog ≠ 停止重试**。systemd 单元（ExecStart 为 `oj supervise` 时）：`KillMode=mixed`（SIGTERM 只给父，父转 stdin stop）、`TimeoutStopSec=40`（≥drain 30s+余量）、`Restart=on-failure`、`Type=notify` 自 sd_notify 落地起才可用，之前保持 `simple`。

### 4.8 运维面（P4 必须补齐）

- **pid 文件仅 supervise 形态存在**：`supervisor.pid` 放运行时目录，0600，`O_NOFOLLOW|O_CREAT|O_EXCL`，内容 `pid+starttime+boot+config路径`；config 路径取自 argv 的 `-c` 不解析文件，运行时目录 `<hash>` 同字符串算；`oj serve`/`--daemon` 不写（避免默认路径新增失败分支）。
- **采信 pid 前校验**：Linux 比 `/proc/<pid>/stat` 的 `starttime`；macOS 退化 `kill(pid,0)`+命令名；不一致按陈旧清理。不引入 nonce。
- **`oj stop`/`oj restart`（现都不存在）**：Unix 向 supervisor 发 SIGTERM（父→stdin stop→等 79→父退 0）；Windows 写 `stop.request`、父每 1s 轮询后删并走同路径（唯一文件轮询点）。`oj restart`=stop+等 pid 消失+同参重起；无 `--full` 变体（worker 自 bind，改 host/port 只需一次换进程）。
- **单实例保护只作用于 supervise**：启动前查 `supervisor.pid` 指向存活同 config 父进程则拒绝并点名 pid。
- `/_system/config` 增：`supervisor_pid`/`worker_pid`/`boot`/`generation`/`degraded{reason,since}`/`last_restart{reason,taskId,at,ms}`/`restart_pending[]` —— 换进程期间是 on-call 判「正在换代」而非「服务挂了」的唯一依据。
- **`generation` 跨进程单调**：`ReloadState::new` 固定 0，换进程后倒退。父每次 spawn 前 `boot.seq+1` 经 env 下发；上报 `(boot,generation)`，判据从「数值+1」改为「lexicographic 递增」（同 boot 内 `generation==上次+1`，换 boot 时 `boot` 变大、`generation` 从 0 重算）。
- 日志分流：worker 写 `server.log`、supervisor 写 `supervisor.log`，均 0600，父 tail 前过 `redact`；Windows 必须由父代管落盘（非 unix logging 不落盘）。

### 4.9 与热更的关系（分三轨，不替代）

热装载永远主路，本节只覆盖「热装载覆盖不了的一小截」。不再需要跨进程互斥（任何时刻只有一个进程跑迁移/cron/任务池）；任务锁必须在 `_system/restart` 前释放（新 worker 续跑 intent 时先取同一把锁）；安装接口改后台任务 + 立即返回 `task_id`，客户端按 `task_id` 轮询、容忍一次断连（连接 reset 即重试，非失败）。

## 5. 验收

1. 已装 API-only 方案时安装新方案 → 同 PID、`generation+1`、`GET /api/<prefix>/<health>` 200。
2. 方案声明 `api.anonymous` 安装完成 → 该端点无 Authorization 也 200。
3. 已装模块卸载完成 → 1s 内该 prefix 全 404、`modules.json` 无条目、其他模块仍 200、PID 不变。
4. 上次安装失败后再装同一方案 → config 该 prefix 匿名条目数不增长（幂等）。
5. 锁内某模块目录被删后启动 → 该模块点名跳过、其余 200。
6. 安装 smoke 探活首个路由返回 404 → 任务判 `partial` 不判 `done`。
7. reload 触发 5 分钟后 → 原 cron 任务仍被触发。
8. 卸载 reload 失败 → 模块仍可访问（fail-closed）、任务 `partial` 可重试。
9. `oj supervise` 下装需换进程 → ≤1s 可访问、supervisor pid 不变、worker pid 变、`(boot,generation)` 单调；空窗内客户端拿连接被拒非 5xx。
10. 新 worker 装配失败 → 父按退避重试（封顶 30s）永不自行停止；60s 未恢复转 degraded 停发 watchdog 仍每 30s 重试；恢复后任务判 `partial` 点名阶段。
11. 运行 worker `kill -9` → 5s 内服务恢复、`(boot,generation)` 不回退、无 intent 不误判安装任务。
12. `oj stop` Unix(SIGTERM)/Windows(stop.request) → worker 优雅退出、父以 0 退出不重启、运行时目录清理。
13. 一次换进程跨整分钟 → 新 worker cron 全重新生效、空窗内到点触发至多错过一次不补跑、不双跑（任一时刻仅一 worker）。
14. 已装方案伪造控制（写 intent/stop.request、发 HUP）→ 不构成提权：HUP 未注册；intent 只含 taskId 必复核；最坏诱导一次停服且被日志/`last_restart` 记录。
15. 无守护形态装需换进程方案 → 任务 `partial + restart.required:true` + 重启命令；热装载部分已生效；不出现 `done`。
16. 老 oj（无 `capabilities`）+ 新模板 → **写锁之前**以 `host_capability` 失败、锁与 `modules.json` 零变更。
17. 能反复触发换进程的方案 → 60s 内第 3 次起按退避、单任务第 4 次 `partial`、服务不进 0.19s 循环。

## 6. 分期

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| **P0** | §3.1 换代身份+`modules`进applied；§3.2 路径C(HTTP)+preflight两条新检查；§3.3 cron runtime+停池超时+提交顺序；§3.4 卸载顺序；§3.5 启动降级+补偿清单；§3.6 capability门禁；smoke收紧；无守护判`partial+restart.required` | 验收 1/2/3/4/5/6/7/8/15/16 全绿；reload release<200ms、dev(336文件)<5s |
| **P1** | WS 匿名随代 + `WsRegistry` + 卸载主动 close | 验收 3 的 WS 部分补齐 |
| **P2** | 索引 `ArcSwap`（dev/release 统一）+ StableState 派生面一致 | `ojm dev` 安装免重启 |
| **P3** | 上游 `oj seed -m` + 安装器接线 | 带种子方案装完即读得到 |
| **P4a** | `oj supervise` 子命令（flatten ServeArgs、拒 `--daemon`）；壳四件事；ready=继承fd(Unix)/stdout(Windows)；stop=stdin并入`shutdown_signal`；78/79透传；`POST /_system/restart`；`boot.seq`+`(boot,generation)`；pid文件/单实例/`oj stop`·`oj restart`；安装改异步任务 | 验收 9/11/12/13/17 绿；空窗<1s；崩溃5s自愈；78限速生效；`oj serve`零变化 |
| **P4b** | env `OJ_HANDOFF`(verify-only)+`sd_notify`+Windows专项(`CREATE_NO_WINDOW`/`stop.request`/`oj stop`)+父代管worker日志落盘 | 验收 10/14 绿；systemd `Type=notify` 可用；计数器跨进程单调 |
| **P5** | 观测：`generation` 时间线、`/_system/config` 的 `restart_pending` 外显 | 运维可回看每次换代 |

依赖：P0 全在本仓 + `oj-bin`，无新命令；P3/P4 各需一次 oj 发版。P4a 前置为 ready 通路验证（Unix 继承 fd 在 tee 生效前提下父侧读到 EOF 且长寿子进程不继承写端）。

## 7. 风险

| 风险 | 依据 | 处置 |
|---|---|---|
| reload 耗时 | 实测 release 9模块/337文件 106ms；dev 336文件 3029ms（斜率 8.9ms/文件） | 生产达标；dev 不宣传亚秒 |
| 匿名短路改热点路径 | 每请求一次 `path_matches` O(段数) | 预编译+基准用例 |
| 启动降级掩盖坏包 | 只降级「目录缺失」，解析/命名错误仍 fail-fast | 验收 5 |
| 卸载后 config 残留匿名 | 启动期条目仍被 guard 放行 | 仅影响同 prefix 换装；preflight 拦截 |
| 换进程空窗 | 实测中位 0.19s、最坏 0.25s（含插件加载与 seed，不含待应用迁移） | 承诺<1s；迁移必须在装进程 `migrating` 段做完；安装改异步+客户端重试 |
| 换进程无失败保活 | 端口唯一，旧 worker 必须先退 | 已声明不做；父退避封顶30s永不停止+degraded+watchdog |
| 重启风暴 | 反复触发安装可每0.19s断一次 | 壳侧限速3/60s；单任务attempt>3判partial |
| 控制面被伪造 | fs jail 非 OS 沙箱、同 uid 可读运行时目录 | 只承诺「降低可达性」；最坏诱导停服不构成提权；不引 nonce |
| 父进程崩溃 | worker 继续服务但无人监管；再起父 bind 被拒 | `supervisor lost` 外显；新父不抢端口、点名 worker pid |
| 单实例依赖 pid 文件 | 仅 supervise 有；pid 复用窗口；macOS 无 `/proc` | 校验 starttime；macOS 退化 `kill(pid,0)`+命令名 |
| 无守护用户看到 `partial` | T1/T3 换进程类从假 done 变真 partial | 发布说明；文案给重启命令+「热更部分已生效」 |
| 双代 Router 内存 | 只保1代，在途毫秒级 | 安装低频 |

## 8. 不做 / 延后

- 不做模块级热补丁（改源码即时生效）——重装走同一链路。
- 不做多进程/多副本——单进程约束。
- 不做零空窗换进程 / 换进程失败保活（同一能力两面的「父持 socket」被判复杂度 > 1ms 收益）。
- 不做 execve 原地替换（空窗不更小、无崩溃自愈、静默 re-exec 改变启动方式）。
- 不引入 `server.supervisor` 之类配置键（形态只由命令行决定，壳不读配置）。
- 不改 `oj serve` / `oj serve --daemon` 任何行为（含 Windows `--daemon` 不等就绪的既有缺口）。
- 不做 Windows SCM 集成（无 `CreateService`/`ServiceMain`）。
- 不放开特权面热生效（platform/fs/db_access/db_client/audit 仍必须重启）。
- 不做文件监听驱动重扫；不做全量 seed 重放；不补跑空窗内错过 cron 触发；不做反向兼容门禁（新oj+老模板靠 oj 保持老语义）。
- 延后：市场方案 tasks 进锁；匿名下沉 Router（B 路线，已否决）。
