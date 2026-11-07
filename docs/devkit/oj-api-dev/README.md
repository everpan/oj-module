# oj DevKit——TS API 开发手册 + agent skill

给用 oj 框架写业务项目的人和 AI agent 看的。本目录是发布交付物：发行包
（`oj-v<version>-<triple>.tar.gz` / `.zip`）里的 `devkit/` 就是它，由仓库
`docs/devkit/` 经 `cargo xtask build` 归置到 `bin/devkit/` 产出。

## 里面有什么

| 文件 | 用途 |
|---|---|
| `api-manual.md` | 完备开发手册（14 章；§14 MCP 与 JSON-RPC——agent 接入，v0.1.110）：模块开发、全局对象 API（含 §6 命名 MQ 客户端 Kafka/RabbitMQ 与长任务池、**池化任务与 cron（v0.1.28）**、**邮件投递 `Mail`/`mail`**、**LDAP 目录与鉴证（v0.1.28）**、**部署期常量 `vars`（v0.1.25）**、静态站点与 per-route meta、大整数与 i64、3xx 重定向原语 `json.redirect`（v0.1.26）、`_name_` 目录段（v0.1.27）、多静态站点（v0.1.27）、**嵌套 handler 组 + 组级 `.route`（v0.1.64；非动词键挂子组、动词/子组判别红线、handler 链派发）**、**WS 房间原语 `ws.join`/`broadcast`/`roomSize`（v0.1.30）**、**blob 上传直传 `blob.uploadUrl` + `PUT {base}/blob/{key}` 路由 + Range 206（v0.1.30）**、**`atob`/`btoa`/`crypto.getRandomValues` wasm 胶水面（v0.1.30）**、ext_boot.js 运行时扩展）、鉴权租户（含 **cookie 会话 + CSRF 双提交 + WS 握手守卫（v0.1.30）**）、测试、配置（含 **`route_timeouts`/`blob_upload_max_bytes`/`response_headers`（v0.1.30）**、**凭据密封 `secrets:` 段与 `oj secret keygen/seal/open`（v0.1.33；X25519 信封，v1 RSA 已移除）、**远程 dist 挂载 `mounts[].api` URL + sha256 完整性锚（v0.1.77）**、**`oj build --bundle`（v0.1.77）****、**资源根 key 多源选择 `--redis/--blob/--es/--broker/--kafka/--rabbit`（v0.1.34；`es`/`broker` 配置段放宽为命名 map，单对象写法兼容）**、**流式响应 / SSE（`json.stream`/`json.sse`，v0.1.35；绕过信封、心跳保活）、CORS（`server.cors` 段，v0.1.35；`credentials` 需显式 `origins`）、应用层 AES-GCM（`crypto.aesGcmEncrypt`/`aesGcmDecrypt`，v0.1.35；仅 AES-128/256）**、**流式查询 `db.stream`（v0.1.37；逐行拉取大结果集，回调 `onRow` + 异步迭代器两种形态、`AbortSignal` 取消；v0.1.38 起第一方 db 插件真流式，第三方插件没有逐行能力时静默回落全量）**、**multipart 大文件流式落 blob（v0.1.38；`http.files[i].key`/`.url`，`http.file(i)` 仅小文件）**、构建发布（含 `oj exec`（v0.1.29；内联代码 `-e/--code` 与交互式 `--repl` v0.1.50；v0.1.60 无需 config 静默回落 + `-e`/REPL 单表达式回显））、**SQL 执行追踪与 dev 信封 `_sql` / `db.sqlProfile()`（v0.1.51；dev 默认开、参数脱敏）、**本地文件 `fs.*`（v0.1.53；jail 到 `fs.root`，未配置/越界抛 `NotCapable`，无 fd 流式）**、**外部命令执行 `exec.run`（v0.1.75；`platform.exec` argv 模板白名单 + 路径占位符校验，无 shell，缺省全 deny）+ 流式形态 `exec.spawn` 句柄 / `exec.run` 回调（v0.1.78）**、运维、安全红线、**目录自省 `db.listTables` / 整表清空 `truncate` / `count(distinct)`（v0.1.82；orIgnore×fromSelect 的 sqlite 限制同时明文进错误/限制表）**、**结构化数据库错误面 `e.code`/`e.retryable`/`e.sessionDisposition`/`e.data` 与方言能力边界（v0.1.88；ABI 12，开放方言名 + 能力位，插件 `describe()` 协商）**、**库级访问控制 `db_access:` 段 + `db.allowed()` 自省（v0.1.89；库级授权 / 风险分类 / 只读位 / 危险写门 / `max_rows` 限额；默认 off 零行为变化）**、**动态数据源登记的实例化能力 `db.client.register`（L4 v0.1.92；框架只提供实例化、持久化由应用侧负责）**、**方言读侧解码扩展（v0.1.94；mysql `DECIMAL`/时间/`JSON`/`BIT` 与 PG `numeric`/时间/`json(b)`/`uuid`/一维数组直接可读，新增类型只读）**、**跨请求事务会话 `db.session`（v0.1.95；id 即凭据、默认关、与 `db.tx` 互斥、host 回收）**、**未解码类型降级契约（v0.1.111，REQ-07a）：`$<type>:<base64>` 前缀标量 + `X-OJ-Degraded` 响应头 + `exportStatus.degraded`（权威判定面是清单不是前缀；PG 落地、MySQL GEOMETRY 维持报错；db-guide §10.6 契约小节）**、**入站传输 h2c（HTTP/2 prior knowledge，v0.1.118；明文端口与 HTTP/1.1 同端口共存、无 `Upgrade: h2c` 路径、WS 握手仍走 1.1——§13 限制表 + 第 4 章 ws.ts 注）**、**静态压缩缓存目录分层（v0.1.119；缓存文件按 `<键前 2 hex>/` 子目录落盘、旧版平铺文件启动时自动迁入，配置与语义不变——配置 `static` 行）**、**mysql 两步取 id 钉同连接（v0.1.120；`returning(['id'])` 池路径自动包短事务、事务外也安全，无需再包 `db.tx`——db-guide §7）** |
| `scenarios.md` | **场景速查（照抄就能跑）**：公开分享页按租户读数据（`db.asTenant`）、SPA 深链回落与每页 meta、静态+动态 meta handler、`oj test` 测试库隔离、LIMIT 分页陷阱、匿名路径通配形态、多库项目按库迁移与对账（`--db`）、雪花 id 生成/精确回写、302 到 blob 预签名 URL、路径参数路由 `_name_` vs `.route`、池化长任务 + cron（v0.1.28）、`oj exec` 数据修复（v0.1.29）、**大文件直传绕开 10MB/30s（v0.1.30）**、**cookie 会话 + CSRF + WS 握手守卫（v0.1.30）**、**WS 房间广播/presence（v0.1.30）**、**`exports`/pnpm 包解析约定（v0.1.30）**、**wasm 引擎包兼容性清单（v0.1.30）**、**流式响应 / SSE（v0.1.35）**、**前端跨域 CORS（v0.1.35）**、**应用层 AES-GCM（v0.1.35）**、**大表流式导出 `db.stream`（v0.1.37）**、**multipart 大文件流式落 blob（v0.1.38）**、**`oj exec` 内联代码与 REPL（v0.1.50；v0.1.60 无需 config + 单表达式回显）**、**SQL 执行追踪与 `db.sqlProfile()`（v0.1.51）**、**handler 读写本地文件 `fs`（v0.1.53）**、**新增登录来源：HTTP 表单 / CAS SSO（场景 28，含 JIT 建号与匿名路径）**、**引擎原生全文检索 `_shared/search`（场景 29）**、**内容版本化 CAS 修订/diff/回滚 `_shared/versions`（场景 30）**、**一个文件多个同动词端点：嵌套 handler 组 + 组级 `.route`（场景 31，v0.1.64）**、**特权模块受控挂载 + tar 解压安全落位（场景 33/34，v0.1.75；platform 段 + `exec.run` 三步范式）+ exec 流式形态：`exec.spawn` 句柄 / `exec.run` 回调，实时日志 + 中途 kill（场景 39/40，v0.1.78）**、**按模块版本观测打点与兼容分支 `http.module`（场景 36，v0.1.76；只读模块身份）**、**模块卸载清理与整表清空：`db.listTables` / `truncate` / `count distinct` + 构造器分页工厂（场景 42，v0.1.82）**、**数据库错误分流与有界重试（场景 44，v0.1.88；`e.code` 分类 / 幂等冲突 / 只重试 `retryable`）**、**给库上访问控制：只读库 / 谁可以访问哪个库 / 定时任务授权 / `db.allowed()` 库选择器（场景 46，v0.1.89）**、**运行期动态登记数据源 + 应用侧持久化配方（场景 42，v0.1.91 / 实例化 L4 v0.1.92）**、**读写十进制/时间/JSON/UUID/数组列（场景 48，v0.1.94；读免 cast、写须 `?::type`、`42804` 排障）**、**多步表单跨请求事务 `db.session`（场景 49，v0.1.95；id 存取 + 提交/回滚 + 常见坑）**、**跨请求取消长导出 `db.cancel`（场景 50，v0.1.96；executionId 存取 + 幂等取消 + 发起方观感）**、**慢查询护栏与结果集大小闸：语句级超时 + `max_result_bytes` + `it.info()`（场景 53，v0.1.103）**、**任务式导出大表 `db.export` 三件 + blob 产物 TTL（场景 54，v0.1.104）**、**库/schema 层对象树 `listSchemas`/`listDatabases`/`forSchema`（场景 55，v0.1.105）**、**跨方言执行计划归一 `db.explain`：统一计划树 + 绑定参数 + 护栏先行（场景 56，v0.1.108；pg/mysql，sqlite 结构化报错）****、**DDL 生成：正向 `catalog("ddl")` 取源码 + 反向 `db.ddlDiff` 出 ALTER 集（场景 57，v0.1.109；缺省维度=不参与/空数组=DROP 全量，pg/mysql，sqlite 结构化报错）**、**给 agent 开接口：MCP 双线路（serve 内建 `{base}/mcp` 自动反映 + `oj mcp` 离线生成 stdio server）与裸 JSON-RPC `{base}/rpc`（场景 58，v0.1.110；tool 名=净化 operationId、白名单 fail-closed、isError 映射、OJ_BASE/OJ_TOKEN/OJ_TENANT）**、**读含未解码类型列的表：降级清单消费（`X-OJ-Degraded` 头 / `exportStatus.degraded`）+ base64 解码（场景 59，v0.1.111）**、**改列名不动数据 `previousName` 产 `RENAME COLUMN` + 结构 diff 的 `warnings`/`renamed` 消费 + 跨 schema 定向 `schema` 段（场景 60/61，v0.1.112）**、**数据库会话排障 `catalog("processlist"/"users"/"roles"/"triggers")`（场景 62，v0.1.112；全实例语义拒 scope，truncated 信令）**、**建表保真 `partitionBy`/`options` 与 catalog 逆运算（场景 63，v0.1.113；MySQL 分区 DDL 须 raw 重放）**、**非表对象建改 `objectType` 扩 view/index/sequence/routine/trigger（场景 64，v0.1.113）**、**表改名 `previousName` 表级 `RENAME TO`（场景 65，v0.1.113）**、**非流式长查询取消按钮 `onOpen` + `db.cancel` 池执行（场景 66，v0.1.114）**、**大导出实时进度条 `db.stream` 的 `onProgress`（场景 67，v0.1.114）**、**CSV 批量导入 + 取消按钮组合 `db.import` 三件（场景 68，v0.1.115；blob 流式读/多值 INSERT 批事务/import_under_guard 守卫矩阵/sqlite 全单事务特例）**、**零配置静态站优化：压缩 + 两档缓存 + HEAD 探针（场景 69，v0.1.116）**、**直连 HTTP/2（h2c）验证与客户端要点（场景 70，v0.1.118；`curl --http2-prior-knowledge` / `node:http2`、升级式客户端回落 1.1、WS 须 1.1）**——每篇给「配置 + 代码 + 验证 + 常见坑」 |
| `SKILL.md` | Claude Code 等 agent 的 skill 入口：工作流、红线、checklist、陷阱速查，按章节号引用手册 |
| `deploy-tunnel-recipe.md` | **部署级隧道配方**（v0.1.100；U-16 动工前置零成本项）：跳板机后的库经 `ssh -L`/autossh/socat 接入 oj 的两个可复制配方 + 安全要点（只绑 127.0.0.1、`PermitOpen` 最小权限、`ENC[...]` 照常）；平台不管理隧道进程，隧道断开 = 普通连接失败 |
| `sql-builder-guide.md` | **SQL 构造器专题指引**（v0.1.88）：`db.table` 的能力矩阵、三方言差异（受影响行数 / `orIgnore` / `fromSelect` / 字面量列 `CAST` / 模糊搜索转义）、**构造器只覆盖 `sqlite`/`mysql`/`postgres`——其他方言 `OJ_DB_UNSUPPORTED`**、红线与逃生舱、从 `db.query` 迁移路径。`api-manual` 的「查询构造器」章只列 API 契约，背景与口径来这里 |
| `oj-test-guide.md` | **oj test 测试专题指引**：L1 测试的实操走读——文件收集规则（递归 + `_` 跳过）、一次运行的完整生命周期、测试库隔离口径（`db.test` / `--db` / WARN 回落）、可照抄样板（多 describe 内联准备 / 匿名公开面 / WS 帧）、fixtures/seed 纪律与幂等门禁、CI 接入、常见坑速查。`api-manual` §9 只列契约（旗标 / 注入 API 表），「怎么写、怎么跑、怎么不脏库」来这里 |
| `global.d.ts` | handler 全局对象（json/http/db/kv/blob/bus/es/mail/Kafka/RabbitMQ/tasks…）的 TS 类型声明；拷进项目源码根即获得编辑器/agent 类型提示。与 oj 仓库 sample 项目同源；由发布流程 `cargo xtask build` 与本目录文档一同归置到 `bin/devkit/` |
| `oj-modules.d.ts` | **`#` 导入别名的 ambient 兜底**（`declare module "#*"`）：oj 的 `#x`/`#/m/x` 是「引用方模块」相对别名，TS `paths` 无法表达，无法静态定位的 `#` 导入会被兜底为 `any`（不再报 TS2307）。**非模块** `.d.ts`，须与 `global.d.ts` 一并拷入项目并纳入 tsconfig `include` |

## 安装（业务项目）

```sh
# npm 安装（v0.1.13 起）：postinstall 把对应平台的 oj / plugins / devkit/ 落盘 <项目根>/bin/
npm i @oj-bin/oj
# 或一次性运行（不落盘，从子包直接 exec）：pnpm dlx @oj-bin/oj / npx @oj-bin/oj
mkdir -p .claude/skills/oj-api-dev
cp bin/devkit/SKILL.md bin/devkit/api-manual.md bin/devkit/scenarios.md .claude/skills/oj-api-dev/   # agent 用
cp bin/devkit/global.d.ts bin/devkit/oj-modules.d.ts .                       # 类型提示 + `#` 别名兜底
# oj-modules.d.ts 须被 tsconfig 收录（如 include 里含 "**/*.d.ts" 或显式列出），
# 否则 `#` 开头的导入在编辑器里仍会报 TS2307「Cannot find module」。
# 业务项目还需按 oj 的别名规则在 tsconfig paths 里补 `#/*`/`#*`（见 tsconfig.json）。

# 或从发行包解包后取 devkit/，路径同上
```

装好后用法：agent 里说「用 oj-api-dev 开发 xxx 模块」，或在 Claude Code 里用 `/oj-api-dev` 触发。

## 更新

手册与 skill 随 oj 版本一起发布。升级 oj 后，用新包里的 `devkit/` 覆盖旧拷贝即可。
源文件与反馈入口在仓库 `docs/devkit/`。

v0.1.125 已落地部分：**`oj migrate --with-seed`——迁移后同批重放 seed，补齐「装完数据面空」缺口**——
为 `oj migrate` 增加 opt-in 旗标 `--with-seed`（与 `--baseline` 互斥）：迁移全部成功后，对同一批
模块（含 `--module` 过滤）在同一命令、同一目标库连接上紧接着重放各自的 `seed.sql` /
`seed.<方言>.sql`，严格 migrate→seed、幂等可重跑、逐模块作用域不串台。`--format json` 顶层新增
可选 `seed` 对象（不污染 `results`），seed 失败使整条命令退非 0 并在 stderr 前置诊断。新入口有
fail-closed 运行期白名单（只放行幂等 INSERT、执行前全量预扫零副作用）。本轮只交付 oj-bin CLI
能力；下游 `ojm install` 接入（`buildMigrateCmd` / `platform.exec` 白名单 / `MIN_OJ_VERSION`）留待
单独交付。见 api-manual §3「三层 SQL 文件」与 §10「`oj migrate --with-seed`」/ 命令与错误表、
scenarios 场景 73、SKILL 陷阱速查。

v0.1.124 已落地部分：**reload force 值口径收紧**——裸 `?force`（query 中无 `=` 的旗）
视同**未强制**（fail-closed：未记载的输入绝不触发特权强制，对齐「值取 `1`/`true`」的
既有契约）；并钉死 force+busy 串行——持锁下 `?force=1` 仍 409。契约不变，自动化工具
请始终发 `force=1`/`force=true`。见 api-manual §10、SKILL 陷阱速查、scenarios 场景 72。

v0.1.123 已落地部分：**reload force 旁路——强制热更不再需要凑 config diff**——
`POST {base}/_system/config?force=1` 或特权 JS `server.reloadConfig(true)` 跳过 unchanged
幂等闸门强制影子装配换代（零差异也换代，`applied` 可空；busy 409 与空 body 400 不豁免；
force 不改变闸门基线）。`unchanged` 从此是**幂等成功**语义（活代已与盘上一致）——自动化
调用方（如安装器）收到它应正常收尾。不传 force 行为逐字节不变。见 api-manual §10
「配置热更新」/ §6 server、scenarios 场景 72、SKILL 陷阱速查。

v0.1.122 已落地部分：**热装配——reload 覆盖 manifests 锁，release 装/卸模块免重启**——
`server.reload_api: true` 时改 `dist/manifests.yaml` 锁（装/卸/升级）+ `POST
{base}/_system/config` 即换代生效；`applied` 新增模块条目 `+name@ver`/`-name@ver`（升级
成对、按名排序）；幂等判定升级为「config sha **与** 锁双双未变」；空锁 = 卸载全部（reload
放行，冷启动仍 fail-fast）；特权名热装被抢注拦截（400 点名，零副作用）；`GET _system/config`
新 `modules` 键、`ojInfo().build.capabilities` 三能力位。**行为修正两处如实登记**：①
`vars`/`oidc`/`db_query`/`db_trace`/`ws` 冻结段改动由旧版误标 `applied` 改为如实报
`restart_pending`（须重启）；② cron driver 迁独立线程随进程存活 + 换代 resume 闸（reload
后 cron 仍触发且恰一次）。另：`auth.anonymous_paths` 命中即前置管线短路（不再调守卫
verify）、保留段 `_platform`/`_system`/`_lifecycle`/`tasks` 匿名条目 fail-fast 拒装。
见 api-manual §10「配置热更新」「匿名路径」、scenarios 场景 71、SKILL 陷阱速查。

v0.1.121 已落地部分：**seed 按文件名分方言**——`seed.<sqlite|mysql|pg>.sql`（标签同迁移）
存在即胜出、`seed.sql` 兜底，**绝不双跑**；只有别的方言的 seed → 跳过 + warn（不再全库静默
不生效），标签写错（`seed.postgres.sql` / `Seed.Sql` / `seed..sql`）→ warn 提示规范名，`oj check`
S006 报错。S003/S006 覆盖全部变体，幂等判据按文件所属方言（mysql 件可用 `INSERT IGNORE`
+ `ON DUPLICATE KEY`、sqlite 件可用 `OR REPLACE`、pg 件可用 `ON CONFLICT`），注释/字符串里的
关键字不再参与判定；成功日志加 `file=` / `dialect=`。见 api-manual §2「seed.sql / seed.<方言>.sql」、
db-guide、oj-test-guide、SKILL 陷阱速查。

v0.1.92 已落地部分：**动态数据源登记的实例化能力（L4，client 轴）**——把 `db.client.register` /
`reRegister` / `delete` / `list` / `has` / `test`（L3 v0.1.91 引入）正式确立为 **DB 实例的实例化 /
生命周期 API**：`register(name, dsn)` 即 `db = new DB(name, dsn)` 构造实例、`delete` 销毁 + 驱逐缓存、
`reRegister` 替换底层连接。① **框架只提供实例化能力，不自动落盘**——经四路评审初拟的「`default` 库
`oj_client_db_registry` 表写穿 + 回放」方案在**实施前由用户拍板收窄**：持久化是应用模块自己的关切，框架
不引入 `db_client.persistence` 配置、不写 `ClientDbStore`、不碰任何落盘存储介质。② **耐久登记由应用侧负责**：
应用在自己表里存 `(name, ENC[...] 密文 dsn)`（`secret.seal` 密封，绝不存明文），启动初始化 handler 里逐条
`db.client.register` 重建（单条不可达 → 跳过 + warn，不 brick 启动）；存储介质 / 加密 / 备份全是应用关切。
③ 既有安全红线不变：未声明 `db_access.<name>` 的动态库默认 deny、`db.client` 审计、`dsn` 脱敏、`asSystem()`
不豁免登记门。④ 设计文档 `docs/plans/2026-10-28-db-client-axis-l4.md` 记录评审与最终拍板。见 api-manual
§6「db.client」register 行 + §13 限制表、scenarios 场景 42（含应用侧持久化配方）、SKILL 陷阱速查。

v0.1.93 已落地部分：**dbx Web 对齐 · L5（P0 主旅程）**——U-8（sqlite 错误信封化）/ U-6（读侧解码扩展）/ U-1（动态授权运行期生效 + 热更分类）/ U-3（跨 isolate 失效）。① **U-8**：sqlite 全部错误（`accessor_sqlx.rs` 8 处 + `stream_query` 内联）走 `sqlite_err` 映射既有 `DbErrorCategory` 八值，携带 `retryable`/`sessionDisposition`，message 经 `secret::redact` 脱敏（绝不回显 DSN/凭据）。② **U-6**：`column_json` 未知类型由「静默丢值 `Null`」改为**显式报错**（含列类型名），sqlite 路径规范化。③ **U-1**：新增 `db.access.grant(alias, allow, opts?)` / `db.access.revoke(alias)`——运行期把「放行维」(角色/主体四维并集) 注入运行表，零重启即对被授权主体放行（默认只读）；revoke 只回落 config、拒撤销纯 config 项；与 `db.client` 同特权门、必发 `DB_ACCESS_AUDIT`；运行期项只注入放行维、不覆盖 config 的 `enforce`/`read_only`/`max_rows`（防提权）。`db_access`/`db_client` 两段纳入热更 diff 的 `restart_pending`（消除旧授权静默盲区）。④ **U-3**：`db.epoch(name)` + `DB(name)` 每次调用校验 epoch（修复 cache-hit 短路）；host 始终按名重解析 accessor，正确性不依赖 JS epoch。见 api-manual §6「db」`db.access.*`/`db.epoch` 行 + §13 限制表、scenarios 场景 42（grant/revoke + 跨 isolate 失效）、SKILL 陷阱速查。


v0.1.94 已落地部分：**dbx Web 对齐 · L6（U-6 插件侧方言解码）**——mysql 与 postgres 两个第一方
db 插件补齐**读侧受限类型**：`DECIMAL`/`NUMERIC`（→ 十进制**字符串**，不经 f64）、
`DATE`/`TIME`/`DATETIME`/`TIMESTAMP`/`TIMESTAMPTZ`（→ ISO 8601，带时区者以 `Z` 收尾）、
`YEAR`、`JSON`/`JSONB`（→ **JSON 文本**，不自动 `JSON.parse`）、MySQL `BIT(n)`（→ 位串）、
PG `UUID`（→ 规范文本）、PG **一维数组**（→ JSON 数组，元素 `NULL` → `null`）。同时 ① 修掉一个
**静默错值**：MySQL `BIT(n>1)` 过去被 `bool::compatible` / UNSIGNED 的 `u64::compatible` 吃掉，
读成 `true` 或数字——现在最先按类型名短路；② `oj-db-postgres` 的 `query`/`exec`/`tx_*` 从
`sqlx::Any` 换成 typed `Pool<Postgres>`（`Pooled`/`TxInner` 双路枚举，与 mysql 插件同构）——
`Any` 只实现 `bool/i16/i32/i64/f32/f64/String/Vec<u8>` 的解码，上面这些类型在 Any 上取不出，
只修行转换函数会造成「流式能读、查询报错」的分叉；③ PG `numeric` 统一 `normalized()` 去尾零
（sqlx 解 numeric 会丢服务端 dscale，硬算成 4 的倍数，`1.5` 会变 `1.5000`）。**新增类型全部
只读**：写侧无对称编码，回写须显式 `?::numeric` / `?::jsonb` / `?::uuid` / `?::int4[]`。
仍未支持的（GEOMETRY 家族 / `timetz` / `bit`·`varbit` / 范围 / 复合 / 多维数组）继续**响亮报错**
并给 `cast`/`ST_AsText` 指路。见 db-guide §10.6（值契约与边界表）、api-manual §6「db」读侧
边界段 + §13 限制表、scenarios 场景 48（读写范式与 42804 排障）、SKILL 陷阱速查。

v0.1.101 已落地部分：**U-10 运行期凭据轴**——`secret.seal/open`（db-guide
§11.9）：与 config `ENC[...]` 同一套 X25519+AES-GCM 信封开给运行期，handler 可把敏感值
加密后落自有表（方案包「连接凭据入库 + boot 重放」的正路）。公钥装配期加载
（`secrets.public_key_path` 缺省由私钥推导，零新增配置）；open 需部署私钥（seal-only
装配 open 报 `no private key`）；每次 open 落 `SECRET_OPEN` 审计（零凭据）；无密钥装配
fail-closed。同一明文两次 seal 密文不同（不能拿密文判等）。同批：`db_client.max_per_owner`
缺省 8 → 32（单一管理员不再被 per-owner 卡死；示例 `max_entries` 16 → 64）。

v0.1.100 已落地部分：**dbx Web 对齐 P1/P2 第一批（U-11 + U-14 批 a + U-15 M1）**——
① **连接级能力探测**：`db.client.list/register/test` 透出 `serverVersion`/`probedAtMs`
（3s 超时、失败降级 null、开放方言跳过、静态库不透出）；② **`db.catalog(kind, arg?)`**：
目录类内省新一代信封 `{kind, dialect, items}`（views/routines/sequences/ddl/comment/
constraints/stats；能力矩阵 sqlite 仅 views+ddl、mysql 全部、pg 除 mysql 式 sequences——
**unsupported 报错不静默**；L2 三件保持裸数组不动）；③ **管理面 connector 宿主面**
（`mgmt:` 段 + `globalThis.mgmt`）：`mgmt.axes` 收编的泛型轴**不进 `axis()` 公开面**
（特权旁路封堵）、read/write 双档 allow（缺省 fail-closed）、`__ops__`/`__connect__`/
`__disconnect__` 契约（readOnly 插件自报、宿主不可验证——红线）、`MGMT_AUDIT`/`MGMT_DENY`
审计零凭据、并发闸与容量。**已知限制**：mongo 真 connector（M2）与 U-14 批 b 未交付；
跳板机场景走部署级隧道（新增 `deploy-tunnel-recipe.md`，U-16 维持不立项）。见 db-guide
§6/§10/§11.6/§11.8、api-manual §13、SKILL 陷阱速查。

v0.1.99 已落地部分：**dbx Web 对齐 · G9（服务端防护门，op 层三件）**——判据「不经任何方案包
handler、直接打 op 也拦得住」：① **只读会话位** `db.session.begin({readOnly: true})`——
位 begin 时定死不可变，该会话 Write/DDL 在 op 层一律拒（attach 路径与 `db.session.query/exec`
双入口），错误信封 `sessionDisposition: "keep"`（会话保留）；② **写拦截**即①的 op 层强制 +
既有 `db_access.read_only` 文本级拦截（回归锚钉住）；③ **危险语句确认门**
`db_access.<alias>.dangerous_confirm_token`——配置后（即便 `allow_dangerous: true` /
`enforce: off`）危险写须请求头 `x-oj-confirm` 逐字匹配，放行每条落 `DB_DANGEROUS_CONFIRM`
审计（`audit.query` 可检索）；token 只从 config 来，运行期 grant 绕不过；空串装配期拒启。
**边界**：连接级硬保证仍是 DB 账号 GRANT（与 L1 同口径，登记 db-guide）。
见 db-guide §4.5 / §11.5、api-manual §13、SKILL 陷阱速查。

v0.1.98 已落地部分：**dbx Web 对齐 · U-9（安全审计归一 + 可检索存储）**——`DB_CLIENT_AUDIT` /
`DB_CLIENT_DENY` / `DB_ACCESS_AUDIT` / `DB_SESSION_*` 四族散点 stderr 出口归一为**单一事件类型 +
单一 emit 出口**：stderr 行统一 `OJ_AUDIT: kind=… user=… tenant=… alias=… detail="…"`
（**旧前缀退役，日志解析器需更新**）；事件入进程内有界环形缓冲（`audit:` 段，缺省 2000 条 /
24h，条数+年龄双限自动清理，零凭据，reaper 后台判死事件照常入库）。新增全局 **`audit.query(filter)`**
（`kind/user/tenant/alias/sinceMs/untilMs/limit`，最新在前，缺省 100 条硬顶 1000）——检索即导出；
读门 = `audit.allow`（每调用重判，缺省不限制 → 装配期 warn 提示收紧）。**已知限制**：存储不跨
重启、无防篡改（外部 sink 另期）；`SqlEvent`（sql_trace）是 dev 画像不归审计轴（边界见 db-guide
§11.7）。见 db-guide §11.7、api-manual §6 指针、SKILL 陷阱速查。

v0.1.97 已落地部分：**dbx Web 对齐 · U-7（client 轴配额与预算）**——动态数据源补齐三道闸：
① `db_client.max_per_owner`（缺省 32）：单主体（registered_by）登记上限，`delete` 释放名额，
0 或 `> max_entries` 装配期拒启动；② `db_client.max_streams`（缺省 32）：动态库**全局**并发流
预算——所有动态别名的 `db.stream` 游标总数封顶，permit 随流结束（自然/`signal`/`db.cancel`/
close）自动释放，满即拒点名配置键；③ **拨号守卫**：`test/register/reRegister` 的 connect 包
5s 超时，同主体连续 8 次 connect 失败锁退 60s（拨号前即拒，防 `db.client.test` 沦为内网端口
扫描），成功清零；拒绝/锁退统一落 `DB_CLIENT_DENY` 结构化日志。容量规划：真实并发 ≈
`max_entries × (池 + 8)`（算式入 db-guide §11.6）。**已知限制**：查询超时与结果集字节上限未
覆盖（raw `db.query` 平台级无查询超时；行数上限按别名配 `db_access.<name>.max_rows`）。
见 db-guide §11.6、api-manual §13、SKILL 陷阱速查。

v0.1.96 已落地部分：**dbx Web 对齐 · U-5（执行 id 跨请求取消 `db.cancel`）**——`db.stream` 的
`AbortSignal` 只能被同一个请求触发，「请求 A 发起长导出、请求 B 点停止」够不着。现在开流后发放
**执行 id**（`exec_<4hex>_<32hex>`，回调形态 `opts.onOpen(xid)`、迭代形态 `it.executionId()`）：
同一主体的任意请求 `db.cancel(xid)` 即停——重复取消**幂等**（同返回值 `{cancelled, alias}`）；
未知/已结束/他人 id 一律 `execution … not found`（不泄露存在性，id 是 bearer 凭据，日志/错误只出
前 8 字符）。取消后发起方**下一次拉取抛错** `… was cancelled via db.cancel`（不是静默 done，
已交付的行保留）；后端真取消链零改动复用（mysql `KILL QUERY` / pg `pg_cancel_backend`，其余协作式
游标丢弃、连接回池），**ABI 与插件零改动**。**只覆盖流式执行**——非流式 `db.query/exec` 无后端
句柄，登记为已知限制。见 db-guide §3.1（`db.cancel` 条目）、scenarios 场景 50、api-manual §13。

v0.1.114 已落地部分：**REQ-11（非流式取消与执行进度全交付）**——① 回调面：`db.query`/`db.exec`
的 `opts.onOpen(executionId)`/`opts.onProgress({phase,elapsedMs,rows?})`（相位 sent→fetching→done，
done 恒发、100ms 节流；onOpen 抛异常不杀执行），`db.stream` 加 `opts.onProgress({rows,bytes,elapsedMs})`
（bytes 在飞可查）——带回调即走 begin/poll/take 登记模型；② `db.cancel` **受理池执行**（此前
v0.1.96 只覆盖流式）：pg `pg_cancel_backend` / mysql `KILL QUERY` 真杀，被取消连接报废绝不回池；
sqlite = 客户端早停（category 仍 `OJ_DB_CANCELLED`）；新错误码 `OJ_DB_CANCELLED`
（`retryable=false`）与 `OJ_DB_TIMEOUT`（`retryable=true`）区分；③ **挂断即取消（尽力而为）**：
客户端真 FIN 断开 → serve 层按请求执行登记尽力取消在飞语句（已提交结果不写回；不带回调的执行
无句柄、不取消）；④ 插件轴 query 经宿主侧复用 stream vtable 真杀（零 ABI），插件 exec 取消
记 ABI 13 车。见 db-guide §3 / §11.6.5、scenarios 场景 66/67、api-manual §13、SKILL 陷阱速查。

v0.1.120 已落地部分：**mysql `returning(['id'])` 两步取 id 钉同一连接**——`LAST_INSERT_ID()`
是 session 级状态，旧版 insert 与 `SELECT LAST_INSERT_ID()` 各自向池 acquire，并发下会读到
**别的连接**的上一次插入（实测建号返回 59、库内真值 5）。现由宿主在池路径自动把两条语句包
一次短事务（`Exec::Owned`，核心 `SqlxAccessor` 与 FFI 插件两条访问器同一处修复），事务内则直接
用会话；取 id / insert / commit 任一步失败都回滚整条短事务，不再留下「写进去了但没有 id」的
半成品。调用方无需再为串号包 `db.tx`。见 db-guide §7 / §6「insert 取回主键」、SKILL 陷阱速查。

v0.1.117 已落地部分：**Windows `exec.run` 命令解析与编码修复**——① 裸名按 `PATHEXT`
补全扩展名（`tar` → `tar.exe`、`cmd` → `cmd.exe`；只搜 PATH 目录、绝不搜 CWD），修复
Windows 上 `ojm market install` 解包恒报 `command resolve failed`；② 缓冲形态非 UTF-8 输出
改为有损解码（U+FFFD）并与回调形态一致，结果新增 `encoding: "lossy"` 标记（不再抛
`exec: stdout is not valid UTF-8`）。见 api-manual §6「命令解析」「Windows 平台命令形态」、
SKILL 陷阱速查。

v0.1.116 已落地部分：**前端性能专项三件（OJ-9/10/11）**——`oj serve` 静态层按需压缩
（br>gzip 协商 + 产物落盘缓存 + single-flight 并发钳 + 弱比较 304，`server.static:` 子段七键，
默认开）、两档制默认缓存策略（文件名哈希段→immutable 一年、其余一律 no-cache 恒校验，默认开）、
API HEAD 自动镜像 GET（GET 语义贯穿/空体/显式 head 优先/405 带 Allow）。三处默认行为变更 +
前置 CDN 按 Vary 分键要求 + HEAD 探针成本警示：见 CHANGELOG v0.1.116、api-manual §13、
SKILL 陷阱速查、scenarios 场景 69。

v0.1.115 已落地部分：**REQ-12 批量导入三件套**——`db.import` / `db.importStatus` /
`db.importCancel`：① 任务模型镜像导出（`imp_` 前缀、bearer 归属、惰性清扫、审计全量），
源二选一（`blobKey` csv/jsonl 经 `read_range` 1MiB 窗口流式读 / 内联 `rows` ≤ max_rows）；
② 方言路径全多值 INSERT 全参数化——PG `ON CONFLICT (keys) DO UPDATE` 直挂、MySQL
`ON DUPLICATE KEY UPDATE`（需唯一键）、sqlite `INSERT OR REPLACE` 仅 `rowid` 键；replace =
显式 DELETE + 多值 INSERT（truncate 同档确认门）；**sqlite append/upsert 全单事务**
（cancel/fail 整回滚 rows=0，与网络方言「已提交批保留」语义不同，已明写文档）；③ samples
绝对行号（skip 模式坏行进 samples 行不落库，超 maxErrors 整任务 failed）；④ 守卫矩阵：
sql_guard 下已登记且 tenant-scoped 表 fail-closed（Warn 档
`OJ_DB_UNSUPPORTED(capability="import_under_guard")` / Deny 档 `import_under_guard`；
Deny+未登记同裸 SQL 拒）——放行绝不宽于等效裸 INSERT；逐行租户强制登记为未来工作；
⑤ 配额 `db_import:` 段（全局 4/每主体 2/max_rows 100 万/max_bytes 512MiB/batch 5000/TTL
24h），导入与导出互相独立。实测 500k×10 CSV：PG 1.8s / MySQL 3.3s（<60s 预算）。见
db-guide §3.4 / §10.5 能力矩阵、scenarios 场景 68、api-manual §13、SKILL 陷阱速查。

v0.1.95 已落地部分：**dbx Web 对齐 · L7（U-4 跨请求事务会话 `db.session`）**——`db.tx` 的事务边界是
**一个请求**（handler 返回即提交/回滚），多步表单、审批、批量导入确认这类横跨多个人类请求的流程
塞不进去。`db.session` 把事务从「请求内」提升为「进程内按 id 路由」：① `begin(name?)` 在
`DB(name)` 上开会话，返回 `tx_<4hex>_<32hex>` **id**（不是句柄，走不了端口）；② 后续请求
`attach(id)` 绑定，之后 `db.query` / `db.exec` / `db.table()` 构造器 / `nextSeq` / `listTables`
**全部**自动落到那条连接与那个事务上；不绑也可 `db.session.query(id, sql, params)` 逐语句显式执行；
③ `commit(id)` / `rollback(id)` 结束（失败也摘表，不允许续用），`close(id)` 幂等收尾（`finally` 用），
`touch(id)` 只推空闲计时（长表单续期），`closeAll()` 登出清场，`list()` / `info(id)` / `stats()` 观察面
只列本主体。**三道门**：`db_session.enabled` + `allow`（**每个 op 重判**，撤权即时生效）、既有
`db_access` 逐语句授权与风险分类、`require_identity`。**默认关**——不配这段等于能力不存在
（`begin` 直接报错点名怎么开：`cross-request transactions are disabled (set db_session.enabled: true and declare db_session.allow)`），配了还须过装配期 fail-loud（空 allow / 上限为 0 /
`max_per_owner > max_sessions` / `idle_timeout_secs == 0` / `max_lifetime < idle_timeout` 一律拒启）。
**红线**：id 是 **bearer token**（日志与错误只回显 `tx_ab12_…` 前 8 字符；未知 / 他人 / 畸形 id
**同一文案**，不泄露存在性）；会话只锁**一个别名**的一条连接，跨别名报
`attached to db 'x', not 'y'`，判权用会话登记的别名而非当前请求的模块绑定（防「A 库判权、B 库执行」）；
会话内**禁止**事务控制与会话状态语句（`BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE/START/SET/USE/
ATTACH/DETACH/PRAGMA`）——MySQL 这些语句**隐式提交**，会得到假回滚；与 `db.tx` 双向互斥、`db.stream`
不可用；**没有自动提交路径**，空闲 / 超寿命由 reaper 先 `ROLLBACK` 再判死（`DB_SESSION_TIMEOUT`，
连接不归还——状态不可信），`db.client.delete/reRegister` 判死该别名全部会话（`DB_SESSION_DISCARD`），
容量满时拒绝新会话**绝不驱逐他人会话**。会话表挂在进程级 `StableState` 上，故**热更存活**、配置改动
归 `restart_pending`。sqlite 池只有 1 条连接 → 会话独占该别名，装配期 `warn:`，跨请求事务请用
mysql/postgres。见 db-guide §4.5（方法面 / 六条硬规则 / 生命周期）、api-manual §13 限制表与 §6 指针、
scenarios 场景 49（三步向导完整代码）、SKILL 陷阱速查。

v0.1.89 已落地部分：**db 访问控制（`db_access:` 段）**——① 顶层 `db_access:` 段补上库级
授权：谁能访问哪个库（`allow` 四维并集：modules / roles / tenants / sources）、能做什么
（`read_only` / `allow_ddl` / `allow_dangerous`）、最多拿多少行（`max_rows`）；语句按风险
分类（readonly / write / ddl / tx / **unknown 按最严档拒**）。默认 `enforce: off`——**不配
这段与升级前行为完全一致**。② 逐库条目是**覆盖条目**，未声明的键**逐键继承** `defaults`
（避免「全局设防被一次局部微调静默解除」）；`allow` 逐维覆盖。③ 新增自省 API
`db.allowed()`：只列**当前主体有权限**的库别名与能力位（数据面板的库选择器以此为准，
硬编码 `db:` 段别名 = 假入口）。④ 限额：raw `db.query` 超 `max_rows` 截断（响应打
`X-OJ-Row-Limit`）、`db.stream` 达上限**提前终止**、构造器路径取 `min(声明 limit, max_rows)`。
⑤ 决策可观测：`DB_ACCESS_DENY` 前缀结构化日志（按 `(alias, reason)` 聚合计数）+ `SqlEvent`
新增 `risk`/`operator`。⑥ **行为变更**：`db.asSystem()` **不豁免**访问控制（它只绕过租户
防护），`db.asTenant()` 自填的租户在 `tenants` 维**不作数**——升级到 `deny` 档前先查存量
handler。⑦ 它是**宿主侧护栏层**不是数据库权限：`read_only` 是文本级判定（真写防线仍是 DB
账号 GRANT）、`max_rows` 对 `db.query` 是取回后截断（非限流）、**不约束**平台自生成 SQL 与
`oj migrate` 等 CLI 通道。见 api-manual §10「db_access」与 §6「db / DB(name)」、§13 限制表、
SKILL 陷阱速查、scenarios 场景 46。

v0.1.90 已落地部分：**db 结构内省（L2，对齐 dbx 连接树）**——① 新增 `db.listColumns(table)` /
`db.listIndexes(table)` / `db.listForeignKeys(table)` 三个 op，把「表名级」的 `db.listTables`
扩到列/索引/外键三级；三方言**同构返回**（`nativeType` 是方言原始声明文本、零归一化；
`origin` 统一为 `c`/`u`/`pk`；sqlite 外键 `name` 为 null、复合外键按位配对）。② 表名只经**绑定
参数**（零标识符内联），`_`（含 `%`）是字面量等值匹配不是 LIKE 通配符；表不存在/不可见/在别的
schema 一律返回**空数组**（不报错不区分）。③ 未知方言结构化 `OJ_DB_UNSUPPORTED`（`e.data.capability`
点名 `list_columns` / `list_indexes` / `list_foreign_keys`，**绝不回落 sqlite**）。④ 授权：三 op 与
`db.listTables` 一并过 `db_access` 的**授权维**（`granted_only`）——未授权主体连表结构都枚举不到；
`db.asSystem()` 不豁免、`warn` 档放行并落 `DB_ACCESS_DENY`、内省恒只读不受 `read_only` 限制。⑤
表名入参校验：超长 / 含 NUL·控制字符 /（sqlite）含 `.` → 空数组（挡 `other.secrets` 跨库内省、
畸形输入不化 500）。⑥ 每 op 硬上限 1000 行（元数据规模天然小）。⑦ 分类补丁：会话级语句
`USE` / `SET search_path` / `set_config('search_path',…)` / `ATTACH` / `DETACH` 由只读改判为
**写**（池化连接上会污染后续请求、改写内省可见范围），`deny` + `read_only` 站点即被挡。⑧ **红线**：
内省是目录读**不是标识符白名单**，禁止把列名回填构造器或拼进裸 SQL（构造器只认 `SchemaRegistry`）。
见 api-manual §6「db / DB(name)」三方法行 + 类型表 + §13 限制表 + 陷阱清单、scenarios 场景 47、
SKILL 陷阱速查。

v0.1.88 已落地部分：**数据库方言能力模型（ABI 12）+ 结构化数据库错误**——① db 的失败不再
只能读文案：reject 的 Error 自带 `e.code`（`OJ_DB_SYNTAX` / `OJ_DB_CONSTRAINT` / `OJ_DB_TIMEOUT` /
`OJ_DB_CONNECTION` / `OJ_DB_CAPACITY` / `OJ_DB_CANCELLED` / `OJ_DB_UNSUPPORTED` / `OJ_DB_INTERNAL`）、
`e.retryable`（布尔）、`e.sessionDisposition`（`keep`/`reset`/`close`）、`e.data`（**已解析为对象**，
含引擎原始码 `data.vendor_code`）——重试/冲突分流不再解析 message。② 宿主不再叠重复的
`ffi <op>: ` 前缀：`ffi db query: db query: <原文>` → `db query: <原文>`（**升级注意**：曾按
`^ffi db ` 匹配的 catch 要改；改用 `e.code`）。③ 方言契约从封闭三值枚举改为「开放方言名 +
能力位」：插件在 `describe()` 声明 `{dialect, capabilities[]}`，宿主据此装配；`db.dialect()`
返回声明名——此前是封闭三值枚举（未识别的 DSN 前缀被当作 sqlite，`dialect()` 于是报 `"sqlite"`），
现在原样返回真名。
`plugins()` / `ojInfo()` / `GET {base}/plugins` 新增 `caps` 列（与 `describe()` 同词汇；
8 个能力串的语义与三内置方言取值见 api-manual「plugins —— 插件自省」的能力位对照表）。
宿主只为 sqlite/mysql/postgres 生成 SQL——其他方言上一期只开放裸 SQL 路径
（`db.query`/`db.exec`/`db.stream`/`db.tx`），构造器（`query_build`/`query_sql`）/
`listTables` / `nextSeq` / `migrate` / `seed` 一律 `OJ_DB_UNSUPPORTED`
（`e.data.capability` 点名 API，**不再**静默按 sqlite 语义生成错误 SQL）；sample 的
`_shared/search`、`_shared/versions` 各自维护方言白名单，抛同码但 `data.capability`
分别为 `search` / `versions`。④ 插件清单锁
`plugins.lock.json`：增量覆盖残留旧插件 → 拒载点名；建议整体拷贝 `bin/`。见 api-manual
「结构化数据库错误」与 `db.dialect()`「方言边界」、SKILL 陷阱速查、scenarios 场景 44（错误分流）
/ 场景 45（`dialect()` 分支迁移）。

v0.1.87 已落地部分：**WS 路由与 api.ts 同口径 + 挂载清单外显**——① `--module-root` 布局下
`ws.ts` 的路径由模块索引给出（`{prefix}/{模块根内路径}/ws`），不再按挂载根平铺：
`src/wiki/api/ws.ts` → `GET {base}/wiki/ws`（`api` 是模块根即布局分隔符，不是路由段；此前
多出一层 → 文档契约里的 URL 恒 404，且守卫面错位使 `anonymous_paths` 配 `/wiki/ws` 也 401）。
② 启动时打印 `ws: N mount(s)` 清单（路径 + 源文件，命中 `auth.anonymous_paths` 的标
`[anonymous]`）——WS 不进路由表与 `openapi.json`，这是唯一权威面，下游工具据此核对。
③ 两个不同目录的 `ws.ts` 映射到同一 URL → 拒启；扫描跳过点目录/`node_modules`/目录符号链接。
平铺布局 URL 逐字不变；release 仍带版本段（`…/<name>-<version>/ws`，v0.2 已知限制，与 dev
不同源）。见 api-manual §ws.ts 与 §13 限制表、SKILL 陷阱速查、scenarios 场景 43。

v0.1.85 已落地部分：**模块根可配置（`--module-root` + manifest `prefix`）**——
① serve/build/openapi/test/migrate/exec/schema diff 新增 `--module-root <目录>`：子树内
**递归**发现 `manifest.yaml`（命中即停），模块身份取 manifest 的 `name`（目录名只作定位），
monorepo/存量仓库的模块可放任意深度；与 `-d`/`--api-path` 互斥；命中 0 个 manifest 或指向
release 树均非零退出（树内就地 build 过的 `dist/ 会被扫描自动跳过，不重复登记）。
② `manifest.yaml` 新增可选 `prefix`：模块 URL 前缀（可含 `/`
分段），缺省/空串 = `name`，全局唯一——URL 由前缀决定（`<prefix>/xxx/yyy/api.ts` →
`GET <prefix>/xxx/yyy`），dev 与 release 同口径。③ `#/m/x` 跨模块别名按 manifest
`name` 解析（与目录名脱钩），**为跨模块导入首选写法**。不带 `--module-root` 时行为与
v0.1.84 逐字节一致（平铺树构建产物/openapi 生成物实测比对）。见 api-manual §2「源码树/
manifest.yaml」与「模块根可配置」、§5「别名导入」、§11、§13 错误/限制表、SKILL 陷阱速查。

v0.1.84 已落地部分：**插件/FFI 层审计修复七项**——rabbitmq bus 面 publish 复用 channel（修逐次
泄漏打满 channel_max 被 broker 杀连接）、推送订阅退避自愈（断连不再 topic 永久停摆，首次搭建
仍同步报错）、kafka 消费错误日志 30s 节流、mysql/postgres 流式游标专用连接并发上限 8（超限报
`too many concurrent cursors (limit 8)`，收口即释放）、blob 直传/上传 pump 断连兜底 abort（s3
不再留计费 orphan parts）、redis expire 的 ttl 越 i64 报错（此前回绕成负数 = 立即删键）、宿主
loader 对空 vtable 的畸形插件轴告警跳过（不再 SIGSEGV）。见 api-manual「db.stream」「bus」
「kv」对应小节与错误文案、SKILL 陷阱速查。

v0.1.83 已落地部分：**三处行为订正（exec stdin 全形态 + 表别名形状门 + fromSelect 归属守卫）**——
① `exec.run` 回调形态与 `exec.spawn` 现在支持 `opts.stdin`（语义与缓冲形态一致：一次性写入后关写端；此前传了被**静默丢弃**，子进程 stdin 恒 null）；② 表别名（`.as(...)` / join 第 4 参 / `"t as u"`）与聚合/CTE 别名走同一道形状门 `^[A-Za-z_][A-Za-z0-9_]*$`，空串等怪形在请求反序列化期报 `illegal alias '<a>'`（此前漏到 SQL 渲染只换回 DB 原生报错）；③ `ownership_guard: deny` 下 `fromSelect` 的**源 select** 同样过归属守卫（此前源表绕过守卫，`INSERT...SELECT` 可跨模块搬运；源表属其他模块需在 manifest 补 `deps:`）；另修 exec Wrapped 模板（`%${raw:N}%`）收到比前后缀还短的 argv 时的宿主 panic（改为命名报错）、dev 目录树里 `preview-0.9` 这类同形模块名不再被 `oj openapi` 误剥成 `preview`。见 api-manual「exec 流式形态」「表别名与归属/租户守卫」「fromSelect」、SKILL 陷阱速查。

v0.1.80 已落地部分：**`oj secret keygen` 新增 `--alg ed25519`**——为 v0.1.75 的 `crypto.verifyEd25519` 补齐作者侧密钥生成（bundle 签名校验链路：发布方签 → 安装方隔离舱验，此前只能手写 Node 脚本）。`--alg ed25519` 在 `--out-dir` 产三文件：`ed25519-private.pem`（标准 PKCS#8 `BEGIN PRIVATE KEY`，0600）、`ed25519-public.hex`（32 字节**原始公钥**的 64 hex——`verifyEd25519` 只吃 raw 32B，喂 PEM/SPKI 会抛 `key not hex/base64`）、`ed25519-public.fp`（sha256(rawPublicKey) hex，运维核对 / 信任库 mismatch diff）。缺省 `x25519` 行为零变化（`secrets-*.pem`）；**两算法族不可互用**——X25519 是密钥协商（ECDH）做不了签名，ed25519 密钥拿去 `seal`/`open` 会报 `not a OJ X25519 … PEM`。见 api-manual「secrets」与错误/限制表、SKILL 陷阱速查、scenarios 场景 18。

v0.1.81 已落地部分：**`db.table()` 构造器补齐 7 项能力**（下游模板 `docs/sql-builder-missing-capabilities-pr.md` 的 7 条诉求经复核后落地；1 条误报、1 条部分误报、`expr` 任意表达式模板经四路评审砍除）：#1 模糊搜索根治——新增 `contains` / `startswith` / `endswith` 三个 op（全小写，与 `gte`/`isnull` 同族），引擎自动转义 `%`/`_`/`!` 渲染 `LIKE ? ESCAPE '!'`、业务零转义零方言知识，保留 `like` 的 `escape` 逃生舱（白名单 `! / | ~ # @`、显式拒 `\`）；#2 join ON 值条件——`join(t, [{left,right},{left,op,value}])`，op 限比较类；#3 字面量列——`{lit: v, as: "x"}` 走绑定参数按方言 `CAST`（计算列请用现成 `case`）；#4 幂等写入——`orIgnore()` 与 `fromSelect(q, cols)`（mysql 走 `ON DUPLICATE KEY UPDATE <pk>=<pk>` 而非 `INSERT IGNORE`，无主键表直接 Err、`orIgnore+returning` 在 mysql 上 Err，三方言 affected-rows 不一致勿用 `n===1` 判幂等）；#6 动态 WHERE——`whereIf(test, cond)`（`undefined`/`null`/`false`/空数组跳过，`0`/`""` 保留）+ `in []` 守卫；#7 `select(["*"])`（唯一元素、带 join 报错）；#8 表别名——`db.table("x").as("b")` / `join(..., "left", "b")`，仅 select/join 生效、update/delete 带别名报错，并修掉「别名让归属/租户守卫静默失效」缺陷；另 INSERT…SELECT 新嵌套边统一走 `child_reqs()` 单一出口，杜绝跨租户读写漏遍历。见 api-manual「查询构造器」章、SKILL 陷阱速查与 scenarios 场景 41。

v0.1.79 已落地部分：**exec 模板占位符可带字面前后缀**（同一 argv token 内，用于 Windows `cmd /c echo %VAR%` 的 `%…%` 定界：`cmd /c echo %${raw:NAME}%`；`${raw:}` 校验作用在中间子串上）+ **Windows 上 exec 输出的平台差异文档化**——`cmd /c echo` 恒以 CRLF 收尾、`cmd /c type` 原样吐文件字节（不补行尾），oj 返回子进程**原始字节**、不做 CRLF→LF 归一（与 `Deno.Command.output` / Node `child_process` 同口径），跨平台文本比对请用 `trimEnd()` / `split(/\r?\n/)`；Windows 子进程输出为本地代码页（GBK / CP1252），含非 ASCII 时落 `exec: stdout is not valid UTF-8`（要 UTF-8 就把 `chcp 65001` 写进 `cmd /c` 语句）；**同批订正 v0.1.78 描述**：带 `onStdout`/`onStderr` 的 `exec.run` 实际返回 `{ code, stdout, stderr }`（有损解码、非 UTF-8 不抛、仍全量缓冲受 10MB 上限），且超时/超限在回调与 `exec.spawn` 形态**不抛错**只把 `code` 打成 137 —— 详见 api-manual §6「形态 × 非 UTF-8 / 失败语义」对照表。见 api-manual §6「Windows 平台命令形态」、错误/限制表、SKILL 陷阱速查与 scenarios 场景 39/40。

v0.1.78 已落地部分：**exec 流式形态**——`exec.spawn(argv, opts?)` 返回句柄（stdout/stderr 为 `AsyncIterable<Uint8Array>`，`for await` 逐块消费、`h.exit()` 取退出码、`h.kill()` 整组击杀）；`exec.run(argv, opts?)` 扩展 `onStdout`/`onStderr` 回调（逐块转发给回调，**同时攒下全量**，返回 `{ code, stdout, stderr }`——解码为**有损**、非 UTF-8 不抛；v0.1.79 订正，此前文档称「返回 `{ code }`、不缓冲整段」），无回调时与 v0.1.75 行为/返回形状完全一致。两形态复用同一套安全闸门（argv 模板白名单、`${path:}`/`${raw:}` 占位符、整组 kill）。背压经有界 mpsc（16 槽 × 8KiB）实现真实子进程背压——不消费流则子进程在输出填满管道时阻塞（非 bug）；句柄 rid 进 OpState.resource_table，close 同步整组击杀子进程，杜绝跨请求/租户泄漏；rid 仅本 runtime 可达。见 api-manual §6「exec 流式形态」、错误/限制表、SKILL 陷阱速查与 scenarios 场景 39/40。

v0.1.77 已落地部分：**远程 dist 挂载 + `oj build --bundle`** —— `mounts[].api` 支持
`http(s)://` URL：装配期拉取 dist 根 tarball 并解压到内容寻址缓存（`<cache>/<sha256>/`，
`cache` 缺省 `<config_dir>/.oj-cache`），以 release 语义服务；完整性锚 = 声明 `sha256`
（64 hex），下载内容 sha256 不符即拒启（防篡改 / CDN 漂移）；产物根含 `manifests.yaml`
才视为合法 dist 根；解压器逐条目 fail-fast（拒绝 tar-slip / 符号链接 / 特殊文件 / pax·gnu
元数据，并对下载量 512 MiB / 解压总量 4 GiB / 条目数 10 万 / 单条目 1 GiB 设上限防炸弹）；
命中缓存按 sha256 复用、损坏自动重拉、同 URL 物化互斥串行化；`--api-path` 不接受 URL（引导
走 config）。配套 `oj build --bundle`：把整棵 dist 打成空前缀 tarball `<out>/<name>.tgz` 并
打印 sha256，供远程挂载声明完整性锚（手工等价 `tar czf app.tgz -C dist .`）。见 api-manual
§10「mounts」远程 dist 挂载小节、§11「oj build --bundle」、§13 错误/限制表、SKILL 陷阱速查
与 scenarios 场景 37/38。

v0.1.76 已落地部分：**`http.module`**——模块路由分发时注入的**只读**模块
身份 `{name, version}`（dev 取 `src/<m>/manifest.yaml` 的 version，release 取
`dist/<m>-<v>/manifest.yaml`；无模块上下文——任务桥 / WS 帧 / `run_with` / 启动期
内省——为 `null`，页面 meta 合成派发在模块目录内**有值**）。对象已冻结：strict
（ESM / api 文件 CJS 包装）下写 / delete 抛 `TypeError: Cannot assign to read only
property …`，`require()` 引入的 CJS 代码（sloppy）写它静默无效——两条路径都改不了
框架授信面（跨模块表归属守卫 / bound_db 重定向 / 平台特权换装），JS 只持快照拷贝。
release 装配期新增 manifest version 与目录后缀一致性 fail-fast（stale / 手改 dist
不再静默误判版本）。见 api-manual §6「http.module」小节与 §13 限制表、SKILL 陷阱
速查与 scenarios 场景 36。

v0.1.75 已落地部分：`crypto.verifyEd25519`（Ed25519 验签
原语，双层语义——格式错抛错、验签不过返回 `false`；sig 仅标准 base64、公钥仅 32 字节
原始 key 的 hex/base64）与 `crypto.sha256Hex` 二进制扩面（`Uint8Array`/`ArrayBuffer`
入参；**行为变更**——非 string/二进制入参旧版经 `String()` 强转求摘要，现抛 TypeError）；
`platform:` 配置段（特权模块名单 + 受控挂载根 + `trusted_paths` 授权路径根，
fail-closed，装配期抢注/互斥防护）与 **`exec` 全局**（外部命令原语：`platform.exec.<模块>`
argv 模板白名单——literal 逐字 + `${path:}`/`${raw:}` 占位符，无 shell，缺省全 deny；
生效面 = 特权模块 fs 读写范围扩为 `fs.root ∪ trusted_paths` + `exec.run`）。见 api-manual
§6 crypto/fs/exec、§10「platform」、§13 限制表、SKILL 陷阱速查与 scenarios 场景 33/34。

v0.1.74 收敛 v0.1.72 评审发现的边界不一致：`.response` 声明位值为 `null` 现与缺失同义
（回落继承链 / 占位，不再被 audit 以非对象拒启），`.schema.response` 合并同步改为
「null 即未声明」使文档优先级链在边界成立；`global.d.ts` 补组级保留键警告
（`response` 与 `schema`/`route` 同列，命名嵌套子组会静默丢路由）。见 api-manual
「`response` 通道」。

v0.1.73 修复 `oj openapi` 的操作键归一：oj 运行期删除动词是 `del`（serve `DELETE`↔`del`
映射不变），但 OpenAPI 3.x 只认标准 HTTP 方法——生成物此前写出非法的 `"del"` 键，
严格工具/生成器报错或忽略，且对手工修正过的存量 `openapi.json` 必然 `--check` 漂移。
本版归一为 `delete`（operationId 同步 `..._delete`，下游 client 方法名 `deleteXxx()`，
一次性重命名）。见 `api-manual.md` §4「动词 → 方法名映射」与 SKILL 陷阱速查。

v0.1.72 新增与 `.schema` **平级**的出参声明位 `.response`（动词级 `v.response` / 组级
`obj.response`，组级沿嵌套继承）：`.schema` 只放入参，出参独立声明，匹配「handler 逻辑与
契约分离 / 多文件」的演进方向。生效优先级：**动词 `.response` > 组 `.response` > 动词
`.schema.response` > 组 `.schema.response`**；`oj openapi` 生成逻辑不变（取最终生效者裹
`{code,msg,data}` 信封），`.schema.response` 存量零破坏。见 `api-manual.md`「`response` 通道」。

v0.1.66 修复三处用户可见缺陷：`json.stream().write()` 的 `ArrayBuffer`/类型化数组/`DataView`
在分发层转为 `Uint8Array` 后进字节 op（0.1.65 实测仅 `Uint8Array` 可用，其余 TypeError，
手册承诺兑现）；seed 语句前置 `--` 注释行不再使 `INSERT OR IGNORE` 方言改写失效（v0.1.65
会原样下发 mysql → 1064）；sample `_shared/search` 短词 LIKE 回退改统一 `ESCAPE '!'`
（转义 `!`/`%`/`_`——`ESCAPE '\'` 在 mysql 默认 sql_mode 下是 1064）。另修构造器 SELECT
在 mysql 误路由 LAST_INSERT_ID 分支的 panic（0.1.65 上 mysql 全业务面阻断，无对外契约变更）。
见 `api-manual.md` §6 `json.stream`、seed 纪律表与 `scenarios.md` 场景「常见坑」。

v0.1.71 把 `.schema` 的**表达力边界显式化**（无行为变更，纯文档 + 钉死测试）：给出
「`.schema` 关键字 → zod 写法」对照表与**不支持清单**（联合类型 / `format` / `$ref` /
`oneOf` …一律 fail-fast，并给出改写方案），并写清跨语言红线——`pattern` 是 Rust regex
≠ ECMA-262，下游搬进前端 zod 时 Rust-only 语法会编译失败或**语义漂移**（前端校验被绕过）。
另附下游 codegen 三条注意事项（属性名/`enum`/`default` 须 `JSON.stringify` 嵌入；
`required` 项可能不在 `properties` 中）。见 `api-manual.md`「表达力边界：与 zod 的对照表」。

v0.1.70 新增 `.schema` 的**响应通道 `response`**（入参与出参同一处声明），并把 `oj openapi`
的响应侧补齐：`response` = `json.ok(data)` 的 **data payload**，生成物输出**完整信封**
`{code,msg,data}` 并带 `x-oj-response-enforced: false`——**运行期不校验响应**（响应由 JS
产生，校验失败时无所去处），它只作文档与生成真源，不得当脱敏/裁剪边界；`json.raw` /
`json.stream` / `json.sse` 端点无信封，不要声明。产物另新增：operation 级与根级
**`tags: [<module>]`**（下游按它分模块生成 client）、`x-oj-file` 改相对路径（不带本机绝对
路径）。**行为收紧**：`.schema` 顶层键白名单只有 `params`/`query`/`body`/`response`，其余
（拼错的 `param`/`bodys`/`responce`）装配期硬失败——这类键以前被静默忽略，接口一直在裸奔；
且该审计**不受 `schema_validation: false` 影响**（那开关只关运行期校验，不要拿它绕启动
报错）。`oj openapi` 另加两道 fail-fast：生成前审计全部 `.schema`（非法契约不再原样进
spec，release 的第三方 `.tgz` 模块同样兜底）、`operationId` 重复即报错。升级后**必须重生成
一次 openapi.json**。见 `api-manual.md`「入参与出参契约 `.schema`」的 `response` 小节与
`SKILL.md` 陷阱速查。

v0.1.69 修复 `query`/`params` 数值 `enum` 误杀合法浮点值（根因，无对外 API 变更）：
`enum:[1,2]` 配合 `type:"number"/"integer"` 时，`?x=1` 强转得到的 `1`/`1.0` 现按**数值**
命中成员，合法值不再被 `must be one of` 误拒（旧版的 handler 内重校验绕行壳可还原为直接
声明 `enum`）。另 `scripts/install.sh` 支持**第二位置参数指定安装位置**（优先级高于
`OJ_INSTALL_DIR`），该目录须已存在且为空，脚本不主动清空/删除，避免误覆盖含数据目录。
见 `api-manual.md`「入参契约 `.schema`」数值枚举说明与「发行包布局与打包脚本 / 安装脚本」
及 `SKILL.md` 陷阱速查。

v0.1.65 起 `json.stream` / `json.sse` 的 `opts` 新增 `fileName` / `disposition`：`fileName` 写入
`Content-Disposition: <disposition>; filename*=UTF-8''<pct-encoded>`（`disposition` 默认
`attachment`，可传 `inline`），浏览器另存为原名、且**无需 302 到免鉴权 blob 路由**即可把鉴权后
的字节流式回源；`write` 按入参类型分发——`Uint8Array`/`ArrayBuffer`/类型化数组走**字节通道**
（二进制无损），其余当 UTF-8 文本。`contract` 白名单放开 `default`（纯注解关键字，无校验语义，
oj 不替你填值）。sample 引擎原生检索 `_shared/search` 修三处：短词（<3 字符）跨方言统一基表
`LIKE` 回退、sqlite `index()` 根除 FTS 触发器残留旧词、mysql 高亮由每命中一查询改为单次批量
`IN` 取原文。见 `api-manual.md` §6 `json.stream` / 「入参契约 `.schema`」与 `SKILL.md` 陷阱速查。

v0.1.43 起新增 `oj openapi` 子命令（从路由表生成 OpenAPI 3.1，含 `--check`
漂移门禁），见 `api-manual.md` 命令表与 `scenarios.md` 场景 24 的「常见坑」。

v0.1.44 起新增 JS 侧声明面 `.schema`（入参契约，违反 → 400）与
`server.schema_validation` 开关，见 `api-manual.md`「入参契约 `.schema`」
与 `scenarios.md` 场景 24。

v0.1.46 起 `json.header` 为追加语义：同名响应头可重复（`Set-Cookie` 合法双发——
登录端点同响应下发 `oj_sess` + `oj_csrf`，cookie 会话 CSRF 双提交闭环），其余头同名
最后一个生效；sample 登录/登出已改写为双 cookie 形态，见 `api-manual.md` §6
`json.header` 与 §8 cookie 会话段。

v0.1.47 起 blob 增 `copy` / `move` / `readRange` 三件套（服务端搬运与区间读，大文件字节
不再进 V8）：`copy` 保留 src、`move` 删 src、`readRange` 是短读截断；见
`api-manual.md` §6 blob 段与 `scenarios.md` 场景 25。

v0.1.59 起：`plugins()`/`ojInfo()` 输出移除恒空的 `unknown_axes` 字段（键集收敛为
六键）；`oj exec` 等命令的缺省目录探测只认「像业务树」的候选——**`oj exec` 不需要
config.yaml**，纯计算脚本 `-e` 零配置可跑（见 `api-manual.md`「oj exec」与 `SKILL.md`
陷阱速查）。

v0.1.58 起**站点配置升级为顶层 `mounts:` 扁平挂载表**（一行 = 一个 URL 前缀 + 一个
目录，api/web 恰好其一）：五个旧 `server.*` 键（`api_prefix`/`app_path`/`app_prefix`/
`static_sites`/`app_spa_fallback`）已删除，出现即报错并输出迁移 YAML；SPA 回落改为
逐挂载显式 `spa: true`（默认 false）；web 挂载非 GET/HEAD 显式 405；`oj test`/`migrate`/
`exec`/`openapi`/`test fixture` 新增 `--site <prefix>` 选 api 挂载。见 `api-manual.md`
「mounts（v0.1.58）」、`user-manual.md` §3.1 迁移对照与 `scenarios.md` 场景 2。

v0.1.57 起所有子命令的 `-c/--config` 均可省略：省略时按 **CWD 逐级向上 `config.yaml` →
`$HOME/.oj/config.yaml`** 搜索，未找到用内置默认值继续（显式 `-c` 缺失仍 fail-fast）——
`oj build` / `oj openapi` / `oj exec`（纯计算）/ `oj info` / 纯静态 `oj serve` 无需配置即可
运行；`oj secret seal/open` 的 `-c` 缺省同样走搜索。见 `api-manual.md` §10 引言、
`SKILL.md` 陷阱速查首行与 `scenarios.md` 文末附录。

v0.1.54 起新增**泛型插件轴通道**（`axis(name).op(...)`，插件宏 `generic(name) => &VT` 声明，
零 ABI 变更）与 **`ojInfo()` / `oj info` CLI**（同一装配体的五段诊断：build/abi/plugins/
backends/config，config 只出键名、无公共端点）；oj-ldap 迁移泛型轴（JS 调用面改为
`axis("ldap").<op>`，类型化 `ldap.*` 为遗留双轨面）；插件**自报轴清单**（`oj_plugin_axes()`
双发，旧插件免重编回退兼容）与**自报配置键**（宏 `config: "key"`，cfg 三级解析 +
unconsumed 段诊断）。插件作者范式见仓库 `tools/plugin-template`，运维/业务侧细节见
`api-manual.md` §6「axis(name)」「ojInfo()」与 §10「plugins」。

v0.1.52 为评审修复版（无新 API）：`ws.broadcast` 收二进制（与 `send` 对称，非法入参报错）、
`oj test` 递归扫 `tests/`、fixtures 幂等门禁、`oj openapi` dev 内省失败 fail-fast、
`db.tx` rollback 失败不吞业务异常、HTTP 状态对超大 `code` clamp；详见
`api-manual.md` 对应章节与 `SKILL.md` 陷阱速查新增四行。

**版本同步要求（发布前自查）**：每次版本升级，本目录四件（`api-manual.md` / `scenarios.md` /
`SKILL.md` / `README.md`）必须与该版的用户可见变更**逐条对齐**——新增/变更的 API 与报错文案要
进 `api-manual.md` 的对应章节**与错误/限制表**，高频陷阱要进 `SKILL.md` 的陷阱速查，
可照抄的场景要进 `scenarios.md`。发布物 `bin/devkit/` 由 `cargo xtask build` 归置
（含 `global.d.ts` 与 `oj-modules.d.ts` 两份类型声明），
`cargo test --release -p xtask` 的 devkit 契约用例会校验产物与源文件一致。
