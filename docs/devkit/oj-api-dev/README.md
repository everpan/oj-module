# oj DevKit——TS API 开发手册 + agent skill

给用 oj 框架写业务项目的人和 AI agent 看的。本目录是发布交付物：发行包
（`oj-v<version>-<triple>.tar.gz` / `.zip`）里的 `devkit/` 就是它，由仓库
`docs/devkit/` 经 `cargo xtask build` 归置到 `bin/devkit/` 产出。

## 里面有什么

| 文件 | 用途 |
|---|---|
| `api-manual.md` | 完备开发手册（13 章）：模块开发、全局对象 API（含 §6 命名 MQ 客户端 Kafka/RabbitMQ 与长任务池、**池化任务与 cron（v0.1.28）**、**邮件投递 `Mail`/`mail`**、**LDAP 目录与鉴证（v0.1.28）**、**部署期常量 `vars`（v0.1.25）**、静态站点与 per-route meta、大整数与 i64、3xx 重定向原语 `json.redirect`（v0.1.26）、`_name_` 目录段（v0.1.27）、多静态站点（v0.1.27）、**嵌套 handler 组 + 组级 `.route`（v0.1.64；非动词键挂子组、动词/子组判别红线、handler 链派发）**、**WS 房间原语 `ws.join`/`broadcast`/`roomSize`（v0.1.30）**、**blob 上传直传 `blob.uploadUrl` + `PUT {base}/blob/{key}` 路由 + Range 206（v0.1.30）**、**`atob`/`btoa`/`crypto.getRandomValues` wasm 胶水面（v0.1.30）**、ext_boot.js 运行时扩展）、鉴权租户（含 **cookie 会话 + CSRF 双提交 + WS 握手守卫（v0.1.30）**）、测试、配置（含 **`route_timeouts`/`blob_upload_max_bytes`/`response_headers`（v0.1.30）**、**凭据密封 `secrets:` 段与 `oj secret keygen/seal/open`（v0.1.33；X25519 信封，v1 RSA 已移除）、**远程 dist 挂载 `mounts[].api` URL + sha256 完整性锚（v0.1.77）**、**`oj build --bundle`（v0.1.77）****、**资源根 key 多源选择 `--redis/--blob/--es/--broker/--kafka/--rabbit`（v0.1.34；`es`/`broker` 配置段放宽为命名 map，单对象写法兼容）**、**流式响应 / SSE（`json.stream`/`json.sse`，v0.1.35；绕过信封、心跳保活）、CORS（`server.cors` 段，v0.1.35；`credentials` 需显式 `origins`）、应用层 AES-GCM（`crypto.aesGcmEncrypt`/`aesGcmDecrypt`，v0.1.35；仅 AES-128/256）**、**流式查询 `db.stream`（v0.1.37；逐行拉取大结果集，回调 `onRow` + 异步迭代器两种形态、`AbortSignal` 取消；v0.1.38 起第一方 db 插件真流式，第三方插件没有逐行能力时静默回落全量）**、**multipart 大文件流式落 blob（v0.1.38；`http.files[i].key`/`.url`，`http.file(i)` 仅小文件）**、构建发布（含 `oj exec`（v0.1.29；内联代码 `-e/--code` 与交互式 `--repl` v0.1.50；v0.1.60 无需 config 静默回落 + `-e`/REPL 单表达式回显））、**SQL 执行追踪与 dev 信封 `_sql` / `db.sqlProfile()`（v0.1.51；dev 默认开、参数脱敏）、**本地文件 `fs.*`（v0.1.53；jail 到 `fs.root`，未配置/越界抛 `NotCapable`，无 fd 流式）**、**外部命令执行 `exec.run`（v0.1.75；`platform.exec` argv 模板白名单 + 路径占位符校验，无 shell，缺省全 deny）+ 流式形态 `exec.spawn` 句柄 / `exec.run` 回调（v0.1.78）**、运维、安全红线、**目录自省 `db.listTables` / 整表清空 `truncate` / `count(distinct)`（v0.1.82；orIgnore×fromSelect 的 sqlite 限制同时明文进错误/限制表）** |
| `scenarios.md` | **场景速查（照抄就能跑）**：公开分享页按租户读数据（`db.asTenant`）、SPA 深链回落与每页 meta、静态+动态 meta handler、`oj test` 测试库隔离、LIMIT 分页陷阱、匿名路径通配形态、多库项目按库迁移与对账（`--db`）、雪花 id 生成/精确回写、302 到 blob 预签名 URL、路径参数路由 `_name_` vs `.route`、池化长任务 + cron（v0.1.28）、`oj exec` 数据修复（v0.1.29）、**大文件直传绕开 10MB/30s（v0.1.30）**、**cookie 会话 + CSRF + WS 握手守卫（v0.1.30）**、**WS 房间广播/presence（v0.1.30）**、**`exports`/pnpm 包解析约定（v0.1.30）**、**wasm 引擎包兼容性清单（v0.1.30）**、**流式响应 / SSE（v0.1.35）**、**前端跨域 CORS（v0.1.35）**、**应用层 AES-GCM（v0.1.35）**、**大表流式导出 `db.stream`（v0.1.37）**、**multipart 大文件流式落 blob（v0.1.38）**、**`oj exec` 内联代码与 REPL（v0.1.50；v0.1.60 无需 config + 单表达式回显）**、**SQL 执行追踪与 `db.sqlProfile()`（v0.1.51）**、**handler 读写本地文件 `fs`（v0.1.53）**、**新增登录来源：HTTP 表单 / CAS SSO（场景 28，含 JIT 建号与匿名路径）**、**引擎原生全文检索 `_shared/search`（场景 29）**、**内容版本化 CAS 修订/diff/回滚 `_shared/versions`（场景 30）**、**一个文件多个同动词端点：嵌套 handler 组 + 组级 `.route`（场景 31，v0.1.64）**、**特权模块受控挂载 + tar 解压安全落位（场景 33/34，v0.1.75；platform 段 + `exec.run` 三步范式）+ exec 流式形态：`exec.spawn` 句柄 / `exec.run` 回调，实时日志 + 中途 kill（场景 39/40，v0.1.78）**、**按模块版本观测打点与兼容分支 `http.module`（场景 36，v0.1.76；只读模块身份）**、**模块卸载清理与整表清空：`db.listTables` / `truncate` / `count distinct` + 构造器分页工厂（场景 42，v0.1.82）**——每篇给「配置 + 代码 + 验证 + 常见坑」 |
| `SKILL.md` | Claude Code 等 agent 的 skill 入口：工作流、红线、checklist、陷阱速查，按章节号引用手册 |
| `sql-builder-guide.md` | **SQL 构造器专题指引**（v0.1.82）：`db.table` 的能力矩阵、三方言差异（受影响行数 / `orIgnore` / `fromSelect` / 字面量列 `CAST` / 模糊搜索转义）、红线与逃生舱、从 `db.query` 迁移路径。`api-manual` 的「查询构造器」章只列 API 契约，背景与口径来这里 |
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
