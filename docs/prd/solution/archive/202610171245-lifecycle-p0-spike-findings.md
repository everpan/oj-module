# 生命周期 P0 · C1 共享根裁决 spike 实测记录

- 任务：设计文档 `202610171138-solution-lifecycle-implementation-design.md` §9 的 S1-1/2/3/5/6/7 六项逐一实测裁决（S1-4 不在本 spike 范围）。
- 环境：`oj` 0.1.76（`~/.local/bin/oj`）；上游源码 `../oj-bin`（只读，行号引用以该工作区为准）；scratch 全部在 `/tmp/oj-lifecycle-spike/`（以 `apps/playground-oj/api` 为基座：7 个 0.1.0 模块的 release 树 `dist/` + ts 源 `src/`）。
- 方法：全部结论来自实测（scratch 可复现命令见各节）或 oj-bin 源码行号引用；未做到的实验显式标注。
- P0 红线遵守：未改 `packages/`、`web/`、`apps/`、`../oj-bin` 任何文件。

## 总裁决一览（结论先行）

| ID | 一句话结论 | 设计动作 |
|---|---|---|
| S1-1 | **共享根 release 形态自洽可行**：单 api 挂载多模块合法（锁驱动、扁平 `<module>-<version>`）；同类前缀重复启动即拒；空锁拒启、缺锁翻 dev 模式报 name 失配；安装 = 「写版本目录 → upsert 锁 → 改 config 任一语义值 → reload」，**无需改 mounts** | D3 定稿为单 release 共享根 + `_platform` 独立挂载（platform.root） |
| S1-2 | **exec.run tar 范式成立**：`-tvzf` 首列可辨 symlink(`l`)/hardlink(`h`)（bsdtar 实测）；解压忠实还原链接 → list→validate→extract 三步为**必需**而非优化；下载推荐 `fetch`→`fs.writeFile`（平台 fs 扩展），tens-of-MB 内可行 | P1 T3 按场景 34 三步范式实现；下载走 fetch+fs |
| S1-3 | **锁写原子但读-改-写无互斥**：728k+ 并发读零撕裂（tmp+rename 实测 inode 换新）；但 `oj build` 的 load→save 窗口会**吞掉**并发外部写（实测 1 次 erasure）→ 安装器 `.lock` 挡不住 oj 自身写者 | 安装器写锁后必须**读回校验 + 重试收敛**；不能假设 oj 尊重安装器锁 |
| S1-5 | **reload_api 全链路可用**：`POST {base}/_system/config` 存在、auth 配置时需 Bearer（401 文案实测）、空 body 强制；unchanged/applied 两形态实测；JS `server.reloadConfig()` 同 executor 同锁，返回五键形状；`_system/health` 匿名可用 | T7/T8 冒烟走真实登录 token + `_system/health`；匿名路径不可热加（auth 段 restart_pending） |
| S1-6 | **M003/M004 均实测复现**：锁指新版+账本落后 → M004 拒启（exit 1，文案含 `oj migrate` 指引）；账本超前产物 → M003 拒启（exit 1）；`oj migrate --format json` = stdout 单行 `{results:[{module,ok,applied,error?}]}` + 任一失败 exit 非 0、逐模块 continue-and-collect | D11 状态机入口按 M003/M004 文案分类对账；安装器解析 json results 驱动逐模块迁移 |
| S1-7 | **oj tasks 轴不可用**：池化任务调 `exec.run` 实测 `NotCapable: exec requires module ownership`；且 tasks 目录是站点级（首个 api 挂载树下），市场模块无法携带任务 | **定稿：分段执行 + 状态文件续跑**（HTTP 触发逐阶段推进），长段用 `server.route_timeouts` 提额 + exec `timeoutMs`（上限 600s） |

---

## S1-1 共享根挂载形态（D3 裁决）

### S1-1.1 同类 api 前缀重复 → 启动拒绝 ✅

实验：

```bash
cd /tmp/oj-lifecycle-spike/site
oj serve -c dup-prefix.yaml --console-log   # mounts 含两条 prefix: /api 的 api 挂载
```

观测（exit 1）：

```text
oj serve: load config: dup-prefix.yaml: mounts[1]: duplicate api mount prefix "/api"
(same-kind duplicates are rejected; one api + one web on the same prefix is allowed)
```

源码双保险：`src/config.rs:705-716`（config 层校验）与 `oj/src/app.rs` `resolve_mounts`（装配层重复校验）。

结论：同一站点**不可能**用两条同前缀 api 挂载拼「dev 区 + release 区」。D3 的共享根必须整体单一形态（整树 dev 或整树 release，由该目录是否存在 `manifests.yaml` 决定，`oj/src/serve_cmd.rs:1178-1180` `is_release`）。同前缀「一条 api + 一条 web」合法（api 优先），不影响本裁决。

### S1-1.2 空锁拒启 ✅（含一个顺序性新发现）

实验：`base.yaml` 指向 `dist`（release 树），`migrate_on_start: off`。

- 空锁（`: > dist/manifests.yaml`）→ exit 1：

```text
oj serve: release mode: /private/tmp/oj-lifecycle-spike/site/dist/manifests.yaml
missing or empty — run `oj build` first
```

- 缺锁（删文件）→ 目录翻 dev/ts 模式 → 首层扫描版本目录 → exit 1：

```text
oj serve: manifest name "notification" != directory name "notification-0.1.0"
(in /private/tmp/oj-lifecycle-spike/site/dist/notification-0.1.0)
```

源码：`oj/src/app.rs:1538-1548`（`lock.is_empty()` → Err）。

**新发现（装配顺序）**：seed 重放先于路由表构建（`oj/src/app.rs:1500-1520`：迁移门禁 → seed → ext_boot → 锁检查），且 `seed::collect` **不看锁**、直接扫首层目录的 `seed.sql`（`oj/src/seed.rs:21-36`）。实测：`migrate_on_start: off` + 空库 + 空锁时，启动死在 seed（`no such table: todos`），根本走不到空锁检查。影响：安装器落盘的版本目录若带 `seed.sql`，即使锁条目尚未写入/被摘除，重启也会重放其 seed（幂等 INSERT 语义，一般无害，但 D11 对账需知道这层「锁外目录并非完全不可见」）。

### S1-1.3 单 mount 多模块 ✅；嵌套一层不可行 ✅

实验：基线锁 7 模块 → 启动成功，逐模块打印 `module <name> v<ver> — <desc>`；路由前缀 = 各模块 routes.js 自声明 pattern 挂到挂载前缀下：

| 探测 | 结果 |
|---|---|
| `POST /api/auth/login`（匿名） | 500（路由命中并执行，业务层报错） |
| `POST /api/home/line`（无 token） | 401（路由装配 + Bearer 守卫生效） |
| `GET /api/nonexistent/zzz` | 404（对照组） |

即：**路由前缀来自各模块自己的声明**（`{mount}{module}/{路径}` 是 playground 模块的声明约定，oj 不自动插模块名段；`oj/src/app.rs:1592` `pattern: format!("/{b}/{}", e.pattern)`）。

嵌套一层（`dist/modules/wiki-0.2.0/` 带 manifest）实测：

- release：启动正常、仍 7 模块、`/api/wiki/*` 404 —— **锁驱动、静默忽略嵌套目录**（锁只能指 `<mount>/<module>-<version>`，`module` 白名单禁 `/`，`oj/src/manifest.rs:25-34`）。
- dev：`oj serve: module 'modules' missing manifest.yaml`，exit 1（首层扫描，`oj/src/manifest.rs:75-107`）。

结论：共享根布局**只能扁平**：`<mount>/manifests.yaml` + `<mount>/<module>-<version>/{manifest.yaml,routes.js,...}`。目录名必须恰为 `<module>-<version>` 且 manifest 的 name/version 与之逐一相符（启动强校验，`oj/src/app.rs:1557-1580`）。

**补充（路由冲突语义）**：两模块声明同 method+pattern → 装配期 `route conflict` 硬失败（release 启动 `Err`，`oj/src/app.rs:1600-1602`；`serve/src/routes.rs:464,474`），运行期命中冲突路由为 500 Conflict（`serve/src/routes.rs:534` `Lookup::Conflict`；单测 `table_duplicate_is_conflict_500`，`serve/src/routes.rs:1470`——此句为源码走读，未实测运行期 500）。市场产物无法静默抢注既有路由——安装器预检仍应查重，但最坏情形是拒启/500，不是影子劫持。

### S1-1.4 oj build 在共享根上的行为 ✅

实验（服务运行中）：改 `src/demo/manifest.yaml` version → 0.2.0、新增 `src/demo/spike/api.ts`，执行 `oj build demo -c spike.yaml -d src -o dist`。

观测：

- 退出 0；`dist/demo-0.2.0/` + `demo-0.2.0.tgz` 生成；**锁 upsert**：`demo: 0.1.0 → 0.2.0`，其余 6 条原样保留（`oj/src/build_cmd.rs:482-486`：load → insert → 原子写；oj build 从不 prune 锁内它没建的条目）。
- `manifests.yaml` inode 变化（136029216 → 136029345，同字节数）→ **tmp+rename 原子替换**实测确认。
- 写时序（源码 `oj/src/build_cmd.rs:472-493`）：版本目录/routes.js(3) → 锁(4) → tgz(5)。锁指向的目录先于锁落盘——安装器应采同一顺序（目录 → 锁）。
- 运行中服务不受影响：锁重写后旧路由表原样（S1-5 实测链：`/api/demo/spike` 404 → 改 config reload → 401；期间两次 `oj build` 重写锁）。源码走读：serve 侧文件 watcher 仅证书（`serve/src/certificate_watcher.rs`），锁只在启动/热更装配时读取。

对 D3 的影响：安装器与 oj build 是**对等的锁写者**（都是 upsert），共享根上混用安全（并发例外见 S1-3）。

---

## S1-2 exec.run tar / 下载形态 ✅

实验基座：`platform-modules/_platform`（dev/ts 挂载 `/platform`）+ config：

```yaml
fs: { root: ./data }
platform:
  modules: ["_platform"]
  root: ./platform-modules
  trusted_paths: ["./data", "./dist"]
  exec:
    _platform:
      allow:
        - "tar -tzf ${path:archive}"
        - "tar -tvzf ${path:archive}"
        - "tar -xzf ${path:archive} -C ${path:dest}"
```

### S1-2.1 exec.run tar 可用 ✅

`POST /platform/_platform/tlist`（handler 内 `exec.run(["tar","-tvzf",archive])`）→ 200，`{code:0,stdout:"<tar 列表>",stderr:""}`。环境为宿主 PATH 解析的 `/usr/bin/tar`（bsdtar 3.5.3；**GNU tar -tvzf 首列语义 P1 T3 在 Linux 复验**——见未验证清单 U2，`task-C1-report.md` §3）。

### S1-2.2 `-tvzf` 辨识链接类型 ✅（链接零容忍是硬要求）

观测原文（含 symlink + hardlink 的探针 tgz）：

```text
lrwxr-xr-x  0 ever wheel  0 Oct 17 12:32 ./b.lnk -> a.txt     ← 首列 l
-rw-r--r--   0 ever wheel  8 Oct 17 12:32 ./a.txt
hrw-r--r--   0 ever wheel  0 Oct 17 12:32 ./c.hl link to ./a.txt  ← 首列 h
```

解压实测（`tar -xzf … -C dest`）：`b.lnk` 还原为 symlink、`c.hl` 还原为 hardlink（`ls -la` 链接数 2）——**tar 会忠实重建链接**，故 list→validate→extract 三步是安全必需（校验首列无 `l`/`h`、组件无 `..`），与 devkit 手册场景 34「预检只是快速失败优化，权威校验 = 解压后全量 walk」叠加使用。

越权负例：`archive: /etc/hosts.tgz` → `500 NotCapable: exec ${path:archive}: path outside fs.root and trusted_paths: /etc/hosts.tgz (resolved /private/etc/hosts.tgz)`（`${path:}` 校验集 = `fs.root ∪ trusted_paths`，实测生效）。

### S1-2.3 二进制下载推荐路径：fetch → fs.writeFile ✅

实验：`python3 -m http.server` 供 568B tgz → `POST /platform/_platform/dl`（`fetch(url)` → `arrayBuffer` → `fs.writeFile`）→ 200 `{size:568,bytes:568}`，落盘字节完整；越狱负例 `dest:"../escape.tgz"` → `500 NotCapable: path escapes fs.root: ../escape.tgz`。

推荐：**isolate 内 fetch + fs.writeFile**（特权模块 fs 面 = `fs.root ∪ trusted_paths`）。tens-of-MB 单体进内存可接受（默认单 isolate 堆 256MiB）；更大体积才需换 `exec.run curl`（cwd=fs.root、env 白名单空表）。fs 轴是一次性 API（整体进内存），GB 级走 blob（手册 §6 fs），生命周期场景不涉及。

---

## S1-3 锁并发 ✅（含关键负结果）

实验设计：`oj build`（0.17s 全量 7 模块）运行期间，外部 node 进程对 `dist/manifests.yaml` 做 RMW（tmp+rename，与 oj 同款原子写），循环检测「我写入的 `ghost-mark` 条目是否被吞」。

观测：

1. **原子性**：三轮实验合计 728k+ 次并发读，**0 次撕裂**（每次读都得到完整合法 YAML）；oj build 写后 inode 更换。`save_lock` = tmp+rename（`oj/src/manifest.rs:66-73`）。
2. **丢失更新（实测 1 次 erasure）**：外部写者写入 `ghost-mark: 9.9.9` 后，oj build 以**陈旧读**做 upsert 写回，条目被吞；外部写者重写后又在其最终一次 save 中再次被吞（`{"reads":32,"erasures":1,"rewrites":1,"torn":0}`）。源码自认：`oj/src/manifest.rs:66` 「ponytail: 多进程并发构建的读-改-写竞争不做锁，标 ceiling」。
3. **对运行中服务无影响**：锁重写期间服务照常；装配失败例如锁含无目录条目（`ghost-mark-9.9.9`）→ reload 返回 400 `lock points to missing version dir: …（先 oj build）`，**旧代继续服务**（实测），但下一次重启会拒启。

结论与修订建议：

- oj 侧不存在可协作的锁——**安装器 `.lock` 无法覆盖 `oj build` 的 save_lock**（设计文档 S1-3 假设「单写者=oj 进程」不成立：oj build 与安装器是两个独立写者）。
- 安装器写锁协议必须含**写后读回校验**（写 → sleep 一个 build 周期量级 → 重读确认自己的条目仍在，被吞则重写；有界重试）。由于 oj build 的 upsert 保序（只 insert 自己的条目），读回+重写收敛。
- 运维序约束写入部署文档：安装/升级窗口避免与 `oj build` 并发；两者都原子 → 最坏损失是「一次安装未生效需重试」，无损坏中间态。

---

## S1-5 冒烟凭证 / reload_api ✅

实验：`spike.yaml` 开 `server.reload_api: true` + `auth:` 段（jwt_secret + anonymous_paths），release 服务 + `_platform` 特权模块。

### S1-5.1 `POST {base}/_system/config` ✅

注意前缀：端点在 `{mount前缀}/_system/config`（本次实测 `/api/_system/config`；裸 `/_system/config` 落入业务路由 404）。

| 请求 | 观测 |
|---|---|
| POST 无 token | `401` `"missing or invalid bearer token"` |
| POST 坏 token | `401` 同上 |
| POST 带 login 换取的 Bearer（config 未变） | `200 {"code":0,"msg":"unchanged","generation":0}` |
| POST 非空 body | `400` `"reload_api POST must have empty body"` |
| GET 带 Bearer | `200 {"config_path":"reload.yaml","sha256":"","loaded_at":"1792211300","generation":0}` |
| `GET /api/_system/health`（无 token） | `200 {"status":"OK","generation":0,"config_path":"reload.yaml"}` |

（观测小癖：GET 摘要 `sha256` 为空串、`loaded_at` 为 epoch 秒字符串——与手册「loaded_at」叙述的时戳形态不同，解析时按实测兼容。）

### S1-5.2 JS `server.reloadConfig()` 等效 ✅

`_platform` 特权模块内 `await server.reloadConfig()` → `{"generation":1,"unchanged":false,"applied":["mounts"],"restart_pending":[],"kept_listener":[]}`（五键形状，含 `unchanged` 布尔；HTTP 侧是 `code/msg` 信封两形态——同一 executor 两种序列化，解析时注意）。config 解析错时实测返回 500 `server.reloadConfig: HTTP 400: load config: parse …`，旧代继续服务。并发 409 busy 未实测（源码 `serve/src/reload.rs` try_lock → 409；手册明文），实现按「捕获 busy 重试」处理即可。

### S1-5.3 匿名性与 health ✅（含一个负结果）

- 模块路由**默认匿名不可达**：无 token 一律 401（实测多路由）。
- **`auth.anonymous_paths` 新增不可热生效**：实测改 auth 段 → reload 返回 `restart_pending:["auth"]`，路由仍 401（auth 属特权面/后端段，`oj/src/serve_cmd.rs:540-548` diff 分类）。⇒ 冒烟凭证**不能靠运行时热加匿名路径**。
- manifest **无 health 字段**（`oj/src/manifest.rs:7-22` Manifest 结构），设计文档「manifest.health」不成立；匿名 health 只能（a）模块自带路由 + 部署期写进 anonymous_paths，或（b）直接用内建 `{base}/_system/health`（实测匿名 200、含 generation，**推荐**——零配置且能看装配代际）。

---

## S1-6 迁移账本拒启与对账 ✅

实验（release `migrate_on_start: verify` 为缺省门禁）：

1. **M004（锁指新版 + 账本落后）**：`dist/demo-0.2.0` 含新迁移 `0002__add_note.sql`，锁 `demo: 0.2.0` → 启动 exit 1：

```text
oj serve: module demo: M004: 模块 demo 有 1 个待应用迁移（add_note）——verify 模式拒启
  下一步：oj migrate -c <config> -d <dir>
```

2. **M003（账本超前产物 max seq）**：apply 0002 后删 `demo-0.2.0`、锁回指 0.1.0 → 启动 exit 1：

```text
oj serve: module demo: M003: 模块 demo 账本 seq（2）超过产物 migrations 最大 seq（1）——降版部署被禁止（§4.6）
  下一步：部署含最新迁移的产物；人工回退账本须同步回退 DDL 并自担数据风险
```

   另观测：同状态跑 `oj migrate`（非 serve）**不是 M003**，而是 refinery 层错误 `at seq 3: migration V2__add_note is missing from the filesystem`——安装器对「账本超前」要同时识别 serve 的 M003 与 migrate 的 missing-from-filesystem 两种文案。
3. **`oj migrate --format json` 契约**（成功与失败双实测）：

```json
{"results":[{"module":"auth","ok":true,"applied":[]},
            {"module":"demo","ok":true,"applied":[{"version":1,"name":"create_todos"}]},
            {"module":"home","ok":false,"applied":[],"error":"at seq 2: `error applying migration V2__broken`, `sqlx tx exec: …(code: 1) incomplete input`"}]}
```

   - stdout 恰一行 JSON（装配期全局失败时 `error` 字段携带脱敏原因、`results` 空）；exit 0 = 全部成功，**任一模块失败 exit 非 0**；逐模块 continue-and-collect（`oj/src/migrate_cmd.rs:249-253`，实测 home 失败不阻断其余 6 模块）；模块按名排序；DSN 已脱敏。
   - `applied: [{version, name}]` 可直接作为安装器迁移阶段的账据。

对 D11 的影响：入口对账按 M003/M004 文案前缀分类即可精确识别两种失衡；「锁指新版 → migrate → reload」顺序中 migrate 的 json results 是逐模块成败真源；迁移失败保持锁指新版（R2 处置）与 M004 拒启语义自洽——期间全站不可用窗口 = 「已拒启」，与设计预期一致。

> ⚠️ **语义更新（2026-10-17，c010b202 后）**：上段为改序前旧口径下的解读实录，实测事实（M003/M004 文案、`--format json` 契约）不受影响；现行顺序已改为**迁移成功后才落锁**——迁移失败**锁保持不动（仍指旧版）**，新版目录与 staging 保留供重试（账本去重保证重试幂等），状态机入口另有「锁↔迁移账本对账自愈」（不一致自动回指旧版并隔离新目录）。现行口径见设计 D11。

---

## S1-7 长任务形态 ✅（裁决：分段执行 + 状态文件续跑）

实验：`dist/tasks/task_execprobe.ts`（池化任务，导出 `loop_body`，内调 `exec.run`）→ 启动即循环打日志：

```text
TASK_EXEC_ERR NotCapable: exec requires module ownership (request has no module context)
```

（源码同位：`src/bridge/exec.rs:282`。）

排除 oj tasks 轴的三条独立理由：

1. **特权面在任务上下文恒不可用**：exec / `server.reloadConfig()` / 平台 fs 扩展都以「请求级模块归属」为前提，tasks/WS 无归属 → 恒拒（实测 + `src/bridge/exec.rs:282` + 手册 §10 platform「特权恒不可用」）。安装器的重活恰是 exec（tar/校验）。
2. **tasks 目录是站点级、仅首个 api 挂载树**（`oj/src/serve_cmd.rs:96-99` `find_map` 取第一条 api 挂载；`assemble_tasking(&cfg, &dir, …)` 只扫 `<首挂载>/tasks/`）——市场安装的模块物理上无法携带任务文件（版本目录不挂 tasks）。
3. 任务运行时无 timer 全局（手册 §6「命名 MQ 客户端与长任务」明文 `setTimeout/setInterval` 不可用）；执行形态为 TLA 模式一任务一线程、池化模式共享 worker 轮转（手册 §6「池化任务与 cron」）——无论哪种都拿不到模块归属（理由 1），收益为零。（本条为手册/源码走读，未实测 timer 缺失。）

推荐形态（与设计 §P1 现方向一致，予以定稿）：

- 状态机跑在 `_platform` 特权模块的 **HTTP 路由**内（请求作用域有模块归属 → exec/fs/reloadConfig 全可用）；进度/阶段状态落**状态文件**（`fs` 写 trusted_paths 下的 state 文件）或 DB，前端轮询进度端点（设计 800ms）。
- 单段长耗时的上限管理：默认路由超时 30s（`src/config.rs:97` 起 route_timeouts），对安装路径配 `server.route_timeouts: [{pattern: …/install/**, timeout: 5m}]`（实测该配置形态存在于 config）；`exec.run timeoutMs` 硬上限 600s（手册 §6 exec）。
- 崩溃续跑 = 状态文件里的阶段游标：每次 HTTP 触发从游标推进一段，天然幂等分段，与 D11 失败语义三分（R4）对齐。
- 热更代际可作安装完成信号：reload 成功（`applied` 非空 / generation 前进）+ `_system/health` 的 generation 变化，双确认。

---

## 附：复现索引

| 实验 | scratch 位置 | 关键命令 |
|---|---|---|
| S1-1.1 | `site/dup-prefix.yaml` | `oj serve -c dup-prefix.yaml` |
| S1-1.2 | `site/base.yaml` + `site/dist/manifests.yaml` | `: > dist/manifests.yaml && oj serve -c base.yaml` |
| S1-1.3 | `site/base.yaml`、`site/dev.yaml` | 启动后 curl `/api/auth/login`、`/api/home/line`；`mkdir dist/modules/wiki-0.2.0` / `mkdir src/modules` |
| S1-1.4/S1-3 | `site/`（`oj build demo`；node RMW 循环） | 见 §S1-1.4、§S1-3 |
| S1-2 | `site/spike.yaml` + `site/platform-modules/_platform/` | curl `/platform/_platform/{tlist,txtract,dl}` |
| S1-5 | `site/spike.yaml`（reload_api） | curl `-X POST /api/_system/config`（Bearer）；`/platform/_platform/reload` |
| S1-6 | `site/dist/demo-0.2.0`、`verify.yaml` | `oj serve -c verify.yaml`；`oj migrate -c base.yaml -d dist --format json` |
| S1-7 | `site/dist/tasks/task_execprobe.ts` | 启动后 grep `TASK_EXEC` 日志 |

spike 模块源码已入库为附录 A（源码在库，scratch 目录可删；未验证清单见 `task-C1-report.md` §3）。

## 附录 A：spike 模块源码（实测现场入库，docs-only）

### A.1 `platform-modules/_platform/manifest.yaml`

```yaml
name: _platform
desc: C1 spike 特权探针（exec/reload/fs/download）
version: 0.1.0
```

### A.2 `platform-modules/_platform/tlist/api.ts`（tar -tvzf 列表）

```ts
// tar -tvzf 列表（链接类型辨识实验）
const tlist = {
	async post() {
		const archive = String(http.body.archive);
		try {
			const r = await exec.run(["tar", "-tvzf", archive], { timeoutMs: 30000 });
			json.ok({ code: r.code, stdout: r.stdout, stderr: r.stderr });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

tlist.post.schema = {
	body: {
		type: "object",
		required: ["archive"],
		properties: { archive: { type: "string" } },
	},
};

export default tlist;
```

### A.3 `platform-modules/_platform/txtract/api.ts`（tar -xzf 解压）

```ts
// tar -xzf 解压到指定目录（目录须已存在）
const txtract = {
	async post() {
		const { archive, dest } = http.body;
		try {
			const r = await exec.run(["tar", "-xzf", String(archive), "-C", String(dest)], { timeoutMs: 60000 });
			json.ok({ code: r.code, stdout: r.stdout, stderr: r.stderr });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

txtract.post.schema = {
	body: {
		type: "object",
		required: ["archive", "dest"],
		properties: { archive: { type: "string" }, dest: { type: "string" } },
	},
};

export default txtract;
```

### A.4 `platform-modules/_platform/reload/api.ts`（JS reloadConfig）

```ts
// server.reloadConfig()（platform 特权）与 HTTP POST 同源实验
const reload = {
	async post() {
		try {
			const out = await server.reloadConfig();
			json.ok(out);
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

export default reload;
```

### A.5 `platform-modules/_platform/dl/api.ts`（fetch → fs.writeFile 下载）

```ts
// fetch 下载二进制 → fs.writeFile 落盘（isolate 内下载路径实验）
const dl = {
	async post() {
		const { url, dest } = http.body;
		try {
			const r = await fetch(String(url));
			if (!r.ok) {
				json.fail(502, `fetch status ${r.status}`);
				return;
			}
			const buf = new Uint8Array(await r.arrayBuffer());
			await fs.mkdir("dl", { recursive: true });
			await fs.writeFile(dest, buf);
			const st = await fs.stat(dest);
			json.ok({ size: st.size, bytes: buf.byteLength });
		}
		catch (e) {
			json.fail(500, String(e));
		}
	},
};

dl.post.schema = {
	body: {
		type: "object",
		required: ["url", "dest"],
		properties: { url: { type: "string" }, dest: { type: "string" } },
	},
};

export default dl;
```

### A.6 `dist/tasks/task_execprobe.ts`（S1-7 池化任务探针，置于首个 api 挂载树）

```ts
export {};

// S1-7 探针：池化任务上下文里 exec.run 是否可用（手册称 tasks 无模块归属 → 恒拒）
export async function loop_body() {
	try {
		const r = await exec.run(["tar", "-tzf", "/private/tmp/oj-lifecycle-spike/site/data/probe.tgz"]);
		console.log("TASK_EXEC_OK code=" + r.code + " out=" + r.stdout.slice(0, 80));
	}
	catch (e) {
		console.log("TASK_EXEC_ERR " + String(e));
	}
}
```

复现完整 config（mounts/fs/platform/exec/reload_api）见本文 S1-2 节实验基座 YAML 与 S1-5 节 `spike.yaml` 要点；探针 tgz 构造：常规文件 + `ln -s`（symlink）+ `ln`（hardlink）各一，`tar -czf` 打包。
