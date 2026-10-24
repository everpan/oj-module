---
name: oj-api-dev
description: 在 oj (only-js) 框架业务项目中开发 API 模块时使用——新增或修改 api.ts / ws.ts handler、manifest.yaml、模块测试，或排查路由/信封/鉴权/租户行为时。触发场景：写 handler、建模块、目录镜像路由、.route 参数路由、json 信封、db 查询、多源资源选择（`--db/--redis/--blob/--es/--broker/--kafka/--rabbit` 选 profile，v0.1.34）、多库迁移与对账、Kafka/RabbitMQ 消费任务、tasks 长任务、oj test。
---

# oj API 模块开发

oj（only-js）是一个低代码后端框架：你用 JS/TS 写 handler，框架负责 HTTP 服务、路由、
数据库、鉴权、多租户。路由按目录镜像生成——`src/user/profile/api.ts` 就是
`GET {base}/user/profile/`，不用手写路由表。业务响应统一走 `{code,msg,data}` 信封
（`json.ok` / `json.fail`），框架替你写回 HTTP。

本 skill 与参考手册 `api-manual.md`、场景集 `scenarios.md` 同目录。**按章节号按需读章，不要盲读全文。**

## 工作流

1. **读章**：新项目/新模块 → 手册 §2；写 handler → §4 + §6；用鉴权/租户 → §8；
   写测试 → §9；配置问题 → §10；构建发布 → §11。**要扩展全局对象（`json.page()`
   之类）→ §6 末「ext_boot.js」，不要去改 handler。**
   **命中下面这些典型需求时，先读 `scenarios.md` 照抄**（配置 + 代码 + 验证 + 常见坑四段）：
   公开分享页按租户读数据（`db.asTenant` + `tenant.allow_as_tenant`）/ SPA 深链回落与每页
   meta（web 挂载 `spa: true` + `html_meta` 构建期 JSON / `html_meta_handler` 按数据注入，v0.1.25）
   / 部署期常量不硬编码（顶层 `vars:` + `vars.get`，v0.1.25）/ `oj test` 测试库隔离与 `--db`、`--anonymous` /
   列表 LIMIT 分页与 `X-OJ-Row-Limit` / `anonymous_paths` 通配四形态 /
   多库项目按库迁移与对账（`oj migrate --db <name>`）/ 大整数 id 的生成与回写（`toBigInt`）。
   **接 Kafka/RabbitMQ 或写长任务 → §6「命名 MQ 客户端与长任务」**（任务文件放
   `src/tasks/`，命名 `task_{name}.*` / `{name}_task.*`）。**每轮被驱动的轮询/心跳/
   cron 任务 → §6「池化任务与 cron」**（命名导出 `setup`/`loop_body`/`teardown`，
   crontab.yaml，管理面 `{base}/tasks`，v0.1.28）。
   **发邮件 → §6「mail」**（配置顶层 `smtp:` + `oj-mail` 插件；`send/sendSync/enqueue/result/sendRaw`；
   **发件人/收件人白名单 fail-closed**，空表即拒；附件用 `{blobKey}`/`{path}` 引用，勿内联 base64）。
   **跑外部命令 → §6「exec」**；实时日志流式（`exec.spawn` 句柄）/ 中途 kill（整组击杀）→ scenarios 场景 39/40（v0.1.78）。
   完整手册见仓库 `docs/mail-smtp.md`。
   **LDAP/AD 登录鉴证或目录查询 → §6「ldap」**（配置顶层 `ldap:` + `oj-ldap` 插件；
   v0.1.54 起调用面为 `axis("ldap").bind/search/search_paged/whoami/compare`，reject 模型，
   仅 `bind` 凭据错返回 `false`；filter 用户输入**必须转义**）。完整手册见仓库
   `docs/ldap-integration.md`，可照抄代码见 `scenarios.md` 场景 11。
   **新增登录来源（企业 HTTP 表单 / CAS SSO）→ 不改 oj-auth 插件**——它只是守卫
   （验签 + 匿名路径 + CSRF），登录端点全是普通业务模块；照抄 `src/oidc/`，
   可照抄代码见 `scenarios.md` 场景 28。
   **全文检索（不上 ES）→ §6「db.dialect」+ `src/_platform/_shared/search.ts`**
   （三引擎原生 FTS 统一面；ensureIndex 禁入 db.tx；sqlite 短词自动 LIKE 回退），可照抄
   代码见 `scenarios.md` 场景 29。   **内容版本化 / 历史 / diff / 回滚 →
   `src/_platform/_shared/versions.ts`**（CAS 去重 + UNIQUE 乐观锁 + 行级 diff；
   撞版本 409），见 `scenarios.md` 场景 30。
   **模块要放任意深度目录 / monorepo 聚合 / URL 前缀要改名 → `--module-root`
   + manifest `prefix`**（v0.1.85，递归发现，身份取 name），见 `scenarios.md` 场景 43。
2. **脚手架**：模块 = `src/<模块名>/`（首层子目录），内放 `manifest.yaml`
   （`name` 必须等于目录名，违反启动失败）+ 子目录 `api.ts`。
   **v0.1.85 起模块可放任意深度目录**：`oj serve/build --module-root <目录>` 在该子树
   内递归发现 `manifest.yaml`，模块身份取 manifest 的 `name`（目录名只作定位）；
   此时 `name` 不必等于目录名，URL 前缀由 manifest 可选 `prefix` 决定（缺省 = `name`）。
3. **写 handler**：遵守下方红线；响应一律 `json.ok` / `json.fail` 统一返回。
4. **测试**：先 L2 vitest 测逻辑（快，不起服务），再 L1 `oj test` 测端到端（真，连真实 DB）。
   两层都绿才算完（§9）。`oj test` 的写法走读（生命周期 / 测试库隔离 / 照抄样板 / 坑）
   见 `oj-test-guide.md`。
5. **发布检查**：`oj build` → 确认 `dist/manifests.yaml` 锁与版本目录产物（§11）。
   release 启动默认 `migrate_on_start: verify`，**先 `oj migrate`**；config `db:` 段有命名库时
   逐个 `oj migrate -c config.yaml -d dist --db <name>`（未声明库名会报错，不会回落 default）。

## 红线（不可违反）

- **SQL 注入**：动态标识符（表名/列名）**只**来自 `db.table()` 查询构造器（白名单），
  绝不来自 JS 字符串拼接；值**只**通过绑定参数（`db.query("... where id = ?", [id])` 或构造器的 `value`）。
- **方法名**：DELETE 的方法名是 `del`，不是 `delete`（`get/post/put/del/patch/head/options`）。
- **信封**：业务响应只经 `json.ok(data)` / `json.fail(code, msg, data?)` 写回，
  HTTP 状态 = `code`（0→200）；标准协议端点（对外契约 JSON）可用 `json.raw(data)`
  出裸 JSON 200（§6）。
- 路径参数（`http.param`）已 percent-decode，仅用于参数化查询与类型转换，
  **勿拼接文件路径 / URL**。
- **消费门禁**：MQ 消费方法（`poll/commit/ack/nack`）**只在 `src/tasks/` 任务文件里
  用**；HTTP/WS handler 里调用直接报错——HTTP 侧发消息用 `send`/`publish`。
- **任务等待**：运行时无 timer 全局，`setTimeout/setInterval` 不可用；任务里等待
  一律 `await tasks.sleep(ms)`，循环退出条件一律 `!tasks.stopping()`。
- **大整数（雪花 id / i64）**：DB 的 `|v| > 2^53-1` 的整数读出来是**十进制字符串**（不是
  number）；**绝不用 `Number()`**（会静默坍缩成 f64 网格值 → 主键 dup 500，即 U38 事故），
  运算与回写一律 `toBigInt(row.id) + 1n` 并把结果直接当参数传回（§6「大整数与 i64」）。
  **取号优先用 `db.nextSeq(name)`**（v0.1.24，原子且并发安全），别再自己写 `max+1`；
  无符号 64 位（仅 MySQL `BIGINT UNSIGNED`）用 `toUBigInt()`。

## 新模块 checklist

- [ ] `src/<模块>/manifest.yaml` 存在且 `name` = 目录名
- [ ] 目录映射核对：`src/<模块>/<路径>/api.ts` ↔ `GET {base}/<模块>/<路径>/`
- [ ] 方法名映射核对（特别是 `del`）
- [ ] 用了 `.route`？→ 确认镜像路径已按替换语义放弃；确认 build 会剥 `.route`
- [ ] 响应全部走 `json.ok`/`json.fail`（重定向走 `json.redirect`，别用 `header`+`fail` 拼）；错误码符合 §7 场景表
- [ ] SQL 全部参数化；动态标识符全部走构造器
- [ ] 共享代码用别名（`#_shared/x` 本模块根 / `#/user/_shared/x` src 根），不再数 `../`；
      跨模块别名已在 `manifest.deps` 声明；本地导入目标都是 `.ts`。
      **跨模块导入首选 `#/m/x`**（`m` = 模块名，v0.1.85 起与目录名无关）——不随目录
      结构调整失效，dev/release 同解析；相对路径留给目录固定且相邻的存量代码
- [ ] 用了 `mail`？→ `smtp:` 段已配对应 profile，且 `allowed_from`/`allowed_recipients` **非空**
      （空表 fail-closed）；附件用 `{blobKey}`/`{path}` 引用而非内联
- [ ] L2 + L1 测试跑过并全绿

## 常见陷阱速查

| 症状 | 原因 |
|---|---|
| 命令用了「别人家」的配置 / 行为与预期不符（v0.1.57 起） | `-c` 省略时按 **CWD 逐级向上 → `$HOME/.oj/config.yaml`** 搜索——上级目录甚至 home 兜底有一份 config.yaml 就会被采用。`serve`/`migrate`/`openapi` 等依赖后端配置的场景若回落默认会向 stderr 打 `note: no config.yaml found …`；**`oj exec` / `oj info` 自 v0.1.60 起静默回落、不再打该 note**。排查：怀疑被「别人家」config 影响时显式 `-c` 锁定，或 `oj info` 看实际装配的配置段键名 |
| DELETE 返回 405 | 方法名写成了 `delete`，应为 `del` |
| release 下参数路由 404 | build 剥了 `.route`，路由以 routes.js 为准——确认先 `oj build` |
| 启动/`oj build` 报 `verb key 'x' … expected handler function` 或 `non-verb key 'x' … expected nested group object` | v0.1.64 嵌套组判别红线：动词键必须是函数，非动词键必须是普通对象——组上误挂的 `cccc.foo = []` / `cccc.x = 1` / 函数 helper 一律可操作报错（不再静默丢弃）；`.route`/`.schema` 等元数据只挂 handler 函数 |
| release 启动报 `illegal handler chain` | `routes.js` 的 `handler` 段非法（含 `/`、空段、`__proto__`/`constructor`/`prototype`，或段间多一个 `.`）——手改产物恢复或重新 `oj build`；嵌套上限 4 层、自引用在内省期即失败 |
| 组 `.route` 挂了之后目录镜像 404 | 符合预期：组动词各自替换目录镜像（与顶层 `.route` 同语义）；要镜像可达就别挂 `.route` |
| 端点该拆目录、用嵌套组还是平铺（选型） | 同实体多端点用嵌套组、**以实体对象为根**（组名=实体，子组=子资源）；端点独立演化/多人分权拆目录；≤3 个同形端点平铺——详见 api-manual §4「何时采用」与场景 31 |
| 启动失败 manifest | `name` 与目录名不一致（仅平铺树 `-d`；`--module-root` 递归模式下 name 与目录名无关，v0.1.85） |
| `-d` 与 `--module-root` 同时给报错（v0.1.85） | 两者都是「源码树根」，clap 层互斥（exit 2）——嵌套/任意深度布局用 `--module-root`，平铺树继续 `-d` |
| `--module-root` 报 `no manifest.yaml under module root …`（v0.1.85） | 显式指定却命中 0 个 manifest → 非零退出（防 CI 假绿）。确认指向的是含 `<模块>/manifest.yaml` 的源码树根 |
| `--module-root` 报 `is a release tree`（v0.1.85） | 指向了 build 产物（含 `manifests.yaml`）——`--module-root` 只认源码树；产物树用 `-d dist` |
| `--module-root` 下 URL 不是预期路径 / 404（v0.1.85） | URL 前缀取 manifest 可选 `prefix`（缺省 = `name`），**不再由目录结构决定**：`<prefix>/xxx/yyy/api.ts` → `GET <prefix>/xxx/yyy`。核对 manifest 的 `prefix` 与 `name`（`ws.ts` 同口径，v0.1.87） |
| 启动报 `url prefix '…' declared by both module …` / `illegal url prefix '…'`（v0.1.85） | 两个模块 URL 前缀相同（含默认 = name 撞车）→ 给一个加 `prefix` 改名；`prefix` 形状白名单：分段 `[A-Za-z0-9_-]`，禁空段/`.`/`..`/`\`/首尾斜杠 |
| `#/m/x` 跨模块导入在 `--module-root` 下找不到（v0.1.85） | `m` 是 **manifest `name`** 不是目录名——嵌套布局下按 name 写（`#/user/_shared/x`），勿用目录名 |
| postgres 占位符 | **0.1.67 起三引擎统一用 `?`**（宿主对 postgres 自动改写 `$n`）；存量 `$n` 继续有效（`$n`+`?` 混用按序号续接）。计数不匹配在 PG 上提前报 `placeholder count N != params M`；jsonb 存在性判断用 `jsonb_exists(doc,'key')`，**别写裸 `?` 运算符** |
| 按受影响行数判存在/归属，幂等二写失灵（如「已读」再点误报 403） | `run()` 行数三方言在 oj 上都是**匹配行**——mysql 连接协商了 `CLIENT_FOUND_ROWS`（裸 mysql 客户端默认只算「实际变更行」，同值 UPDATE 得 0，这才是坑的来源；oj 运行时已拉齐）。**别依赖行数**：先 `SELECT` 按 `(id, user_id)` 断言归属，再无条件 UPDATE、行数不读——跨引擎安全的幂等写见 api-manual §6「受影响行数的三方言语义」 |
| 启动即退出 | 证书两路径缺一（必配不可绕过）或 redis 连不上（fail-fast） |
| `oj exec` 报 `module '…' missing manifest.yaml` 或 `service dir not found` | 裸 `oj exec` 在没有 config/mounts/`-d` 时会向上**猜** api 目录——在源码仓根会撞上仓库自己的 `src/`。exec **不需要** config.yaml：纯计算脚本直接 `-e` 跑；要后端就 `-c <项目config>` 或 `-d <api目录>` 显式给（v0.1.58 起探测只认「像业务树」的候选，非业务 `src/` 已跳过） |
| 启动报 `no mounts configured` / `mounts[i]: 挂载目录 … No such file` | 准入门（v0.1.58）：顶层 `mounts:`（config + CLI 折叠后）为空——加一条挂载或传 `--api-path`/`--app-path`；挂载目录存在性由装配期 fail-fast（报错含挂载序号与前缀）。CLI 路径相对 CWD，config 挂载目录相对 config 目录。旧 `server.app_path` 等五键已删，出现即报错并输出迁移 YAML |
| 启动失败报 `invalid \`.schema\` on …` | 三种之一：①用了白名单外关键字（`$ref` / `oneOf` / `format` …）或 pattern 不是合法 Rust regex —— 一律 fail-fast，**不会**静默跳过；②`params`/`query` 声明 array/object（死契约）；③**顶层通道名拼错**（`param` / `bodys` / `responce` …，v0.1.70 起白名单只有 `params`/`query`/`body`/`response`）。报错带 method/pattern/handler/文件 |
| 升级到 v0.1.70 后启动报 `unsupported channel` | 该通道**以前也从未生效**（被静默忽略，接口一直在裸奔）——改名或删除。**不要**用 `schema_validation: false` 绕：该开关只关运行期校验，声明合法性审计不受它影响，绕了还会连带关掉全部入参校验 |
| 请求 400 且 handler 没执行 | 入参违反 `.schema`（校验在 JS 之前）；`params`/`query` 是字符串，声明 integer 时会强转，转不动即 400。逃生门：`server.schema_validation: false`（只关运行期校验） |
| 声明了 `.schema.response`（或平级 `.response`，v0.1.72）但返回字段不合规却没报错 | **这是预期行为**：`response` 只作文档与生成真源（产物带 `x-oj-response-enforced: false`），运行期**不**校验响应（校验失败时请求已执行完，无处可去）。别把它当守卫，也别当脱敏边界。四个声明位并存时优先级：动词 `.response` > 组 `.response` > 动词 `.schema.response` > 组 `.schema.response` |
| 升级 v0.1.73 后下游 client 的 `delXxx()` 编译不过 | `oj openapi`（v0.1.73）把 `del` 动词归一为 OpenAPI 标准 `delete` 操作键，生成函数随之改名 `deleteXxx()`——一次性重命名，调用点全局替换即可；`openapi.json` 里此前手工改的 `"delete"` 不再漂移 |
| `.schema` 里写联合类型 / `format: "email"` 被拒 | 都不在白名单：联合（`oneOf`/`anyOf`/`discriminatedUnion`）改「可选字段 + 单形态」，判别逻辑进 handler；`format` 改 `pattern`。完整对照表见 api-manual「表达力边界：与 zod 的对照表」 |
| 前端 zod 的 `.regex()` 与 oj 侧行为不一致（或 `new RegExp` 直接抛错） | `pattern` 是 **Rust regex** ≠ ECMA-262：lookahead / 反向引用在 JS 里要么编译失败、要么**语义漂移**（Rust 拒的字符串在 JS 放行 = 前端校验被绕过）。只写两边都成立的保守正则，复杂校验下移到 handler |
| `query`/`params` 数值 `enum` 报 `must be one of [1,2], got 1.0` | 旧版根因（已修）：`enum` 按 serde_json 数字变体严格比较，强转得到的 `1.0` 不命中字面量 `1`。**升 v0.1.69+** 即消，**不要**为绕行在 handler 内重校验 / 删 `enum`（那是临时壳，根因已修复——数值 `enum` 现按值比较，`1` 与 `1.0` 等价） |
| CI 里 `oj openapi --check` 非零退出 | 路由表生成的 OpenAPI 与已提交 `openapi.json` 漂移（加了路由/`.schema` 没重新生成）；跑 `oj openapi -c … -d … [--base …] [-o …]` 重新落盘提交即可。`.schema.params` 与路由 pattern 不一致也会在此步 fail-fast。**升 v0.1.70 必须重生成一次**：产物新增 `tags`（模块归属）、`responses.200` 落地、`x-oj-file` 改相对路径 |
| `oj openapi` 报 `operationId … is derived from two different routes` | 两条路由（如 `/user/profile` 与 `/user-profile`）派生出同名 operationId —— 下游 codegen 按它命名符号会静默覆盖；给其中一条设显式 `.route` 改名 |
| seed 没生效/语法错 | `seed.sql` 按 `;` 切分，语句内不得含分号字面量；语句前置 `--` 注释行允许（v0.1.66 起，方言改写判定先剥注释——此前注释打头会让 `INSERT OR IGNORE` 原样下发 mysql → 1064） |
| 模糊搜索想手写 `LIKE '%x%'` | **别手写**——用语义化 op：`contains` / `startswith` / `endswith`（v0.1.81），引擎自动转义 `%`/`_`/`!` 并渲染 `LIKE ? ESCAPE '!'`，业务零转义、零方言知识；`like` 只留作高级/框架内部逃生舱（其 `escape` 仅收单字符白名单 `! / \| ~ # @`，**显式拒 `\`**——mysql 默认 `sql_mode` 下 `ESCAPE '\'` 即 1064） |
| `orIgnore()` 写完用 `if (n === 1)` 判幂等 | **错**：三方言 affected-rows 不一致——mysql 协商 `CLIENT_FOUND_ROWS` 命中重复键返回**匹配行 1**，pg/sqlite `ON CONFLICT DO NOTHING` 返回 **0**；应靠唯一约束/事务保证「不重复写」，行数只读「写几条」 |
| `fromSelect` 列对不齐 / select 自带 tenant | 目标 `cols` 与源 select 列按位置一一对齐，列数不符报 `insert declares N columns but the source select yields M`；`cols` 含 `tenant_id` 直接拒（tenant 由服务端按当前租户注入）；`values` 与 `fromSelect` 二选一 |
| 升级到 v0.1.83 后 `fromSelect` 报跨模块表访问被拒（`ownership_guard: deny`） | 预期收紧：**源 select 也在归属守卫覆盖内**（此前源表绕过守卫，等于 `INSERT...SELECT` 跨模块搬运）——源表属其他模块就在 manifest 补 `deps:` 声明，或改走已授权路径 |
| `.as("")` / 数字开头等怪表别名报 `illegal alias '<a>'` | v0.1.83 起表别名与聚合/CTE 别名**同一道形状门**（`^[A-Za-z_][A-Za-z0-9_]*$`），请求反序列化期点名拒绝——此前漏到 SQL 渲染只换回一句看不懂的 DB 原生报错 |
| sqlite 上 `fromSelect(...).orIgnore()` 运行时报错（v0.1.82 明文） | 构造期即拒：`orIgnore with fromSelect is not supported on sqlite (its upsert clause only follows VALUES)`——sqlite 的 upsert 子句只能跟 VALUES。pg / mysql 组合可用。sqlite 绕行：裸 `db.exec("insert or ignore into … select …", [...])`（`OR IGNORE` 连 NOT NULL/CHECK 违例都静默跳过，数据面更宽，自行权衡） |
| 去重计数用 `distinct().all()` 拉行再 `.length` | **静默漏算**：顶层 select 未给 limit 隐式补 100、显式也被 clamp 到 max_limit（默认 1000）——总数超限就少算。用 `select([{fn:"count",distinct:true,field,as}])`（v0.1.82）：聚合一行返回，与 LIMIT 无关 |
| 「清空整表」写裸 `db.exec("delete from t", [])` | 用 `db.table("t").truncate().run()`（v0.1.82）：命名式明示、可 grep。**租户表上只清当前租户的行**（守卫照常注入，清不出租户边界）——要整库清空在 `db.asSystem` 下执行；带 where 报 `truncate does not accept where` |
| 卸载/巡检要枚举当前库的表，按方言分支 `information_schema`/`sqlite_master` | 用 `db.listTables(prefix?)`（v0.1.82）：方言无关、前缀转义引擎做（绑定参数）、未登记 registry 的表也返回、按名排序。sqlite 内部表（`sqlite_*`）已排除 |
| `select(["*"])` 带 join | 直接报错——全列展开只出基表列，join 列会丢、`undefined` 拿去做授权判断即隐患；要 join 列就显式列名 |
| 上传 413 | 超 `max_upload_bytes`（axum 2x 兜底 + handle 双闸）；**直传路由 `PUT {base}/blob/{key}` 的 413 看 `blob_upload_max_bytes`（默认 1 GiB），两者独立** |
| WS 握手 401 / 连不上（v0.1.30 行为变更） | WS 升级过 oj-auth 守卫了——把 ws 路径加进 `auth.anonymous_paths` 才匿名；浏览器走 cookie 会话天然带 Cookie，CLI 挂 `Authorization` 头 |
| cookie 登录后 GET 通、POST 401 `missing or invalid csrf token` | CSRF 双提交：非安全方法须带 `csrf_header`（默认 `x-csrf-token`），值 = csrf cookie 值；Bearer 命中的请求不查 |
| 登录响应要同时下发 `oj_sess` + `oj_csrf` 两枚 cookie | v0.1.46 起 `json.header` 同名头追加、`Set-Cookie` 合法双发（此前响应头单值，csrf 只能 body 下发 + 前端写 `document.cookie`）；登出记得两枚都 `Max-Age=0` |
| 要接企业 HTTP 表单 / CAS SSO（或任何新登录来源） | 别改 oj-auth 插件——它只是守卫（验签 + 匿名路径 + CSRF），改它 = 动 ABI；登录端点全是业务模块，照抄 `src/oidc/`（场景 28）。**登录端点必须进匿名列表**（无 token 可言，form 与 302 跳转请求都是，`auth.`/`tenant.` 两条都加）；JIT 建号用「`来源:provider:tenant:用户` 键 + `"!<来源>"` 非法占位 hash」（verify 恒 false，锁死密码登录）；CAS 交接 token 不进 URL、302 目标只认 `/` 开头相对路径 |
| `search.ensureIndex` 报 `DDL inside db.tx` | ensureIndex 是 DDL——MySQL 会隐式提交调用方事务；移到事务外，index/remove/query 留在事务内（同连接自动路由） |
| sqlite 全文检索 2 个字查不到 | trigram 对 <3 字符静默零命中——`_shared/search` 自动回退业务表 LIKE；自写 FTS SQL 也要处理该边界 |
| pg 上 `search.query` 报 `placeholder count 1 != params N` | 旧版 `_shared/search` 自写 `$n` 与 v0.1.67 统一占位符计数校验冲突（v0.1.68 已修，升级即消）——业务裸 SQL 同理：**别手写 `$n` 却按 `?` 的个数绑参** |
| `versions.commit` 报 409 `version conflict` | 乐观锁：`expect` 与当前 head 不符或并发撞 `UNIQUE(entity_type,entity_id,version)`——重读 head 重试；省 `expect` 即 last-write-wins |
| 裸 import 报 `Package subpath 'x' is not defined by "exports"` | v0.1.30 起有 `exports` 即封闭语义（Node 一致）：未命中的子路径**不回落** `main`/`module`——检查包的真实导出键，或该包确未导出此子路径 |
| CJS `require("path")` 报 `Node builtin 'path' is not available in oj runtime` | Node 内建不可用——找该包的浏览器/wasm 构建（与 wasm 引擎包同款约定） |
| `blob.uploadUrl` 报 `local blob backend has no upload presign` | local 后端无预签名——s3 才返回预签名 URL；local 用直传路由 `PUT {base}/blob/{key}`（记得带鉴权头） |
| `oj test fixture` 报非幂等 INSERT | fixtures 须幂等写法（`INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`，判据同 S006；v0.1.52 门禁）——改成幂等写法即可重复灌 |
| 子目录里的 `*.test.ts` 没被执行 | v0.1.52 起 `oj test` 递归扫 `tests/`（`_` 前缀目录跳过）——此前只扫首层是静默忽略；升级后注意子目录测试会开始跑 |
| `ws.broadcast` 传对象直接报错 | v0.1.52 起 data 与 `ws.send` 对称：只收 string / ArrayBuffer / Uint8Array，其余报错（此前会发 `"[object Object]"` 垃圾帧） |
| `route_timeouts` 配了不生效 | pattern 匹配**含 base 全路径**（如 `/v1/api/convert/**`），且按声明序首个命中——诊断时先核对全路径与顺序 |
| `{id}.json` 路由没建 | matchit 参数段不得混字面，拆成静态多段 |
| es/blob 调用报错 | config 未配置 `es.endpoint` / `blob:` 段，配置即启用 |
| `fs.*` 报 `NotCapable` | 未配置 `fs:` 段（fail-closed，启用即写 `fs: {root: ./data}`）、路径越出 `fs.root`、或 readonly 下调用写 API |
| `axis("ldap").bind` 一直抛而不是返回 false | 抛 = 连接/协议错；只有 LDAP 拒绝凭据（rc≠0，含 49）才返回 `false`——检查网络/`url`/服务账号，别把 `false` 分支当异常路径 |
| `ldap.*` 报 `ldap not configured` 但 `ldap:` 段已配 | v0.1.54 起 oj-ldap 迁移**泛型轴**——调用面改成 `axis("ldap").<op>(...)`；类型化 `ldap`/`LDAP` 全局是遗留双轨面，装配迁移版插件后报 not configured |
| `axis("x")` 报 `unknown generic axis '<x>'` | 轴没装上（插件未加载/ABI 不匹配）或名字拼错——报错里的 available 列表即当前已注册泛型轴；确认插件在 `plugins:` 清单或扫描目录里 |
| 打包发行版（deploy.sh / npm 启动器）启动报 `no auth plugin loaded`（插件文件齐全）或 `oj serve --daemon` 秒退 | v0.1.55 及更早：glibc 打包形态进程映像是 ld-linux，`current_exe()` 指向加载器，插件发现候选与 daemon re-exec 全部落空——升 v0.1.56+；临时绕法：显式 `OJ_PLUGINS_DIR` |
| `oj serve --daemon` 报 `daemon child (pid N) exited during startup: …` | 子进程启动期失败（config / 证书 / 插件 / 端口任一环节），**真因即冒号后内容**——父进程已从「假成功」改为带因并非零退出，按报错修配置即可；若真因不可捕获（子进程被 kill -9 / 段错误），提示转 server logs 目录 |
| 泛型轴插件撞名（插件作者） | 泛型轴名**避开 9 个保留名**（es/db/blob/bus/kv/auth/mq/mail/ldap）——撞名的泛型轴会被宿主按名字直接当成定型后端处理；同名泛型轴多插件提供 → 装配期 fail-fast |
| `ldap.search` 报 size limit | 服务端返回上限（AD 默认 1000 条）——换 `axis("ldap").search_paged(base, { pageSize: 500 })` |
| ldap 查询结果对不上 | `scope` 默认 `sub`（整棵子树）；只查下一层要显式 `scope: "one"`；`filter` 记得 RFC 4515 转义用户输入 |
| `ldap:` 段改了不生效并报错双配置 | 同时写了顶层 `ldap:` 段与非空 `plugins.ldap` 透传——二选一（透传静默胜出，装配期报错拦截） |
| `start_tls` 配在 ldaps:// 上启动报错 | ldaps 已隐式 TLS，StartTLS 无意义——`ldap://` 口才用 `start_tls: true` |
| `search` 报 `operationsError: 必须先完成 bind` | 匿名绑定被目录拒绝——`ldap:` 段只配了 `bind_dn` 却没给 `bind_pw`，又没在 `search`/`search_paged` 用 opts 的 `bindPw` 补上；服务账号 DN 留 config、密码走运行时参数（`axis("ldap").search(base, { …, bindPw })`），二者合并生效 |
| 服务账号密码不想落配置 | config 只写 `bind_dn`，`bind_pw` 经每次 `search`/`search_paged` 的 opts `bindPw` 传入（与 config 的 `bind_dn` 合并，取一即可）；`whoami`/`compare` 仍需 config 同时有 `bind_dn`+`bind_pw` |
| 启动 stderr 打 `unconsumed config sections: […]`（v0.1.54） | 有顶层 config 段没被宿主也没被任何插件消费——多半是段名拼错（如 `cahce`）或对应插件没装；已加载插件只认 `config: "key"` 自报段与 `plugins:<name>` 非空透传。`oj info` / `ojInfo()` 可复查 |
| 插件 init 收到 `{}`（config key 段已配）（v0.1.54，插件作者） | 三级解析第 2 级：自报 `config: "key"` 的段**未配置就给 `{}`**（段可选是既有语义）——插件 init 必须容忍空 cfg 或自行 fail-fast，别假设段必在 |
| 重编后的新插件在旧宿主上加载（插件作者） | 旧插件无需重编（`oj_plugin_axes` 缺失回落 per-axis dlsym）；但**新插件必须配新宿主**——旧 cdylib 换新宿主、或新 cdylib 配旧宿主都须 `cargo xtask build` 全量联编，勿混跑版本 |
| WS 连上但收不到广播 | 订阅只在 WS 会话内有效（`bus.subscribe` 在 HTTP 路径报错）；release 下 URL 含版本段 |
| 改了 `ext_boot.js` 没生效 | 不做热重载，装配期已冻结 spec——必须重启进程 |
| `ext_boot.js` 里 `await` 报 SyntaxError | 文件无 import/export，被 CJS 启发式包进非 async 函数——加一句 `export {};` |
| fs 相对路径「找不到文件」 | 相对路径解析到 **fs.root** 之下（不是进程 cwd）——想读进程 cwd 的文件请用绝对路径，且绝对路径也必须在 root 内 |
| `fs.readDir` 拿到不是数组 | 返回异步迭代器（Deno 语义）：`for await (const e of await fs.readDir("sub"))` 取 `e.name` |
| handler 里 `await fs…` 顶层报 SyntaxError | run_with/短脚本顶层非 module——包 `(async () => { … })()`；api.ts handler 直接 `async function` + `export default` 即可 |
| `ext_boot.js` 副作用被放大成百上千次 | boot 每个新建 runtime 都跑（模块数 + `pool_size` + WS Worker 数，每路由 `ws.workers_per_route` 个）——只做全局装配，别写库/发广播/打外部接口 |
| `Kafka("x")` / `RabbitMQ("x")` 是 undefined | config `kafkas:`/`rabbits:` 段没配该实例名（或对应插件未装配） |
| poll 报 "requires a task context" | 消费方法只能在 `src/tasks/` 任务文件里用；HTTP/WS 侧发消息用 `send`/`publish` |
| 任务里 `setTimeout` 报 not defined | 运行时无 timer 全局——用 `await tasks.sleep(ms)` |
| `mounts[].api` 填了 URL 但启动报 `URL api requires sha256 integrity anchor` | 远程挂载必须声明 64 hex `sha256` 完整性锚（v0.1.77）——不声明就拒启，别指望它「信任」任何 CDN |
| 远程挂载启动报 `sha256 mismatch` | 下载内容摘要与 config 声明不符——CDN 漂移 / 被篡改 / 缓存损坏都会触发；本地用 `oj build --bundle` 打出并打印 sha256 重新核对 |
| 远程挂载报 `dist root missing manifests.yaml` / `extraction rejected` | dist 根 tarball 解压后须含 `manifests.yaml`；条目若带符号链接 / tar-slip / 特殊文件会被解压器 fail-fast 拒启（与本地 `dist/` 一致，发布前先本地 `oj build` 验证） |
| `oj build --bundle` 报 `manifest not found` 或产物根不对 | `--bundle` 要求先有 `dist/manifests.yaml`；它打的是「整站 dist 根」空前缀包（解压即 dist 根），不是单模块 `*.tgz`——别把 per-module `*.tgz` 当远程挂载源 |
| `--api-path` 传了 URL 启动报错 | 远程挂载的 sha256 只在 config 声明期存在，CLI 折叠期无此上下文——改在 `config.yaml` 的 `mounts[].api` 里声明（v0.1.77） |

| poll 报 "instance busy" | 同一实例已有活跃 poller（任务上下文单 poller）——别并发 poll |
| 任务收不到消息就退了/killed | `timeoutMs` 应远小于 `stop_grace_secs`；被 killed = 宽限到期看门狗强杀（不响应 `tasks.stopping()`） |
| 重启后整段消息重复消费 | commit 按 offset+1 推进该分区——多分区主题按分区各 commit 一次（at-least-once，处理须幂等） |
| 改了任务文件没生效 | 任务无热重载——重启进程（转译缓存按 mtime 自动失效）；池化任务可用管理面 `POST {base}/tasks/{name}/reload`（v0.1.28） |
| 池化任务跑几轮就 `failed` | 单轮 `loop_body` 超 `tasks.pool.loop_body_timeout_ms`（默认 5s）即 teardown + failed 退避重连——长轮询（>5s 一次的等待）别用池化，继续用 TLA + `tasks.sleep` |
| 池化任务里 `tasks.stopping()` 恒 false | 池化任务由 worker 每轮驱动：`loop_body` 返回即一轮结束，天然无需停机轮询/`tasks.sleep`（v0.1.28） |
| 大文件 `http.file(i)` 报 "was streamed to blob"（v0.1.38） | > `max_upload` 的 multipart 文件被服务端流式直落 blob（内存恒定）——用 `files[i].key` 取；要搬运就 `blob.move(files[i].key, 目标key)`（v0.1.47，**别** `blob.get` + `blob.put`），小文件 `http.file(i)` 照常 |
| `blob.readRange` 拿到的数组比 `len` 短 / 是空的（v0.1.47） | 短读截断是契约：`offset+len` 越尾只读到实际末尾，`offset` 过尾返回空数组——按 `head.length` 判分支，别假设拿满 |
| `blob.readRange` 报 `offset must be a non-negative integer`（v0.1.47） | `offset` / `len` 传了负数、小数或 NaN（数据截断比静默取整安全）——取整后再传 |
| `blob.move` 之后 src 读不到 / `blob.copy` 之后 src 还在（v0.1.47） | 就是语义：`move` = 搬移（src 消失）、`copy` = 复制（src 保留）；`src == dst` 两者都是 no-op |
| `db.stream` 在 `db.tx` 里报 `db.stream within an active transaction is not supported (streaming queries run on the connection pool only)` | 流式查询只走直连池，事务内不支持——先 `db.query` 取 id 集，或把 `db.stream` 挪到 `db.tx` 外 |
| `db.stream` 报 `backend does not support streaming` | 该后端没有逐行拉取能力。**真流式**的是核心 sqlite/mysql/postgres 连接与 `oj-db-mysql` / `oj-db-postgres` 两个插件；其余后端要么回落全量（不报错）、要么直接报这个错——改用 `db.query` + 分页 |
| `db.stream` 没报错但内存照样爆 | 后端不支持逐行拉取时宿主会一次取全量（行为等同 `db.query`，只失去内存优势，**不报错**）——按结果集大小分页，或换到 `oj-db-mysql` / `oj-db-postgres` 后端 |
| `db.stream` 取消在 pg/mysql 下是「真取消」，sqlite 只是「协作式」 | v0.1.42 起：`postgres://`/`mysql://` DSN 游标走**专用连接**，取消 = `pg_cancel_backend`/`KILL QUERY` + 断连 → 服务端慢查询立即终止；core/Any（sqlite 等）无服务端句柄，只能**协作式**（下一批返回 `{"error":"cancelled"}`）。别指望 sqlite 的取消能打断正在跑的查询 |
| `db.stream` 报 `too many concurrent cursors (limit 8)` | v0.1.84：pg/mysql 的 typed 游标每条独占一条池外连接（真取消语义的前提），并发上限 8、超限 fail-loud——并行大导出改串行，或及时 abort/close 释放配额（Any 回退路径走池不占闸） |
| 用了 `json.stream` 又 `json.ok` | 流式响应已接管 body，二者互斥——`json.stream`/`sse` 后 handler 直接 `return`，别再包信封 |
| 启动报 `config has ENC[...] sealed values but no decryption key: …` | config 里有密封值却找不到私钥——设 `OJ_SECRET_KEY`（PEM）/ `OJ_SECRET_KEY_FILE` / `secrets.private_key_path`。**不会**静默把密文当明文用（v0.1.33） |
| `ENC[…]` 解不开 / 报 `aes-gcm open failed` | 私钥与加密用的公钥不是一对（换机器时只拷了 config 没拷私钥） |
| 报 `sealed value is v1 (RSA) — v1 信封已移除` | 手头是旧版 RSA(v1) 密文，新版已不再支持；用 `oj secret seal` 以 X25519 重新加密（v1 已整体移除，密钥配置只认 X25519 一套） |
| 想让密文更短 | 信封本就是 X25519 + AES-256-GCM，密文≈明文+62B；`oj secret keygen --out-dir keys` 生成即可，无需额外开关 |
| 拿 `keygen --alg ed25519` 的产物去 `seal`/`open` | 不行——ed25519 是**签名**密钥（`crypto.verifyEd25519` 的作者侧），密封只认 X25519；报 `not a OJ X25519 … PEM` 就是喂错了密钥。反之 `ed25519-public.hex`（raw 32B hex）才是喂 `verifyEd25519` 的，别喂 PEM（v0.1.80） |
| 想把 `--value` 写进 shell 命令 | 别——命令行参数进 shell history 与 `ps`；用 `echo -n 'pwd' \| ./bin/oj secret seal -k pub.pem`（尾换行会被剥除） |
| `/tasks/{name}/start` 对 cron 任务报 400 | 跨 kind 命令被拒：cron 用 `enable`/`disable`，long 用 `start`/`stop`（v0.1.28） |
| `run-once` 对 long 任务报 400 | `run-once` 仅 cron 任务（v0.1.28）；long 任务的「立即跑一轮」= `reload` 或等下一轮 |
| 任务池 CPU 飙高 / `runCount` 暴涨 | `interval_ms` 太小或为 0（0 = 不限制，压测语义）——默认 100ms≈10 轮/s；实测无节奏 4 任务聚合 24.8 万轮/s、CPU 134%（多核空转）。先算写放大（轮率 × 每轮 IO）再调小（§6「性能特征与调优」） |
| `PATCH /tasks/{name}` 报 400 | 只接受 `{enabled, cron}` 两字段（无用户可传脚本路径入口，结构性白名单） |
| `server.reload_api: true` 改了 `db:`/`redis:`/`plugins:` 等后端段没即时换 | 这些是 `restart_pending`：热更**复用首代连接池与插件后端实例**，不重建后端——返回清单提示，实际生效要**重启进程**（`_system/config` 看 `restart_pending`） |
| `server.reload_api: true` 改了 `server.port`/`host`/证书路径没生效 | `server` 段是 `kept_listener`：listener 永生，改了也下个进程才生效（`_system/config` 看 `kept_listener`） |
| `POST {base}/_system/config` 报 403 | 未配 `auth:` 时只允许**回环**调用；远程调度走 Bearer 守卫须先配 `auth:` 段 |
| `POST {base}/_system/config` 报 409 | 上一次热更还在跑（串行锁占用）——等上一次完成再发 |
| `POST {base}/_system/config` 报 400 且 body 非空 | 该端点**只接受空 body**，改配置请直接改落盘文件再 POST 触发 |
| `--module-root` 下 WS 路由 404 / 握手 401（v0.1.87） | WS 与 api.ts **同口径**：`src/wiki/api/ws.ts`（manifest 在 `src/wiki/api/`）→ `GET {base}/wiki/ws`，`api` 是模块根（布局分隔符）不是路由段；`anonymous_paths` 按守卫面写 `/wiki/ws`。release 仍带版本段（`…/wiki-0.1.0/ws`），与 dev 不同源。新增/删除 `ws.ts` 要重启。**唯一权威面是启动打印的 `ws: N mount(s)` 清单**——别从目录结构推 |
| WS 路由 404（文件明明在） | 文件名必须小写 `ws.ts`/`ws.js`——`WS.ts` 无效（v0.1.5 约定）；路径拿不准就看启动打印的挂载清单 |
| （v0.1.9 已消除）旧帧循环的 const 重复声明 | 新契约为生命周期钩子：模块每 Worker 预载一次——无需处理；可变跨帧状态放 `sess.state`（模块作用域只是只读缓存），见 api-manual §ws.ts |
| WS 帧内 `bus.publish` 自己也收到 | 自回声语义：fan-out 不排除本连接——按字段客户端过滤或发布到别的 topic |
| 查询被拦截 / 启动报 `tenant_id` 相关错（v0.1.15 sql_guard） | `sql_guard: "deny"` 拦截租户条件不匹配的查询（`"warn"` 只告警）：跨租户操作（对账/报表）走 `await db.asSystem()`（请求级 + 审计日志）；共享表须 schema.yaml `tenant: false` **且** config `tenant.shared_allow` 列出，双声明才豁免 |
| 裸 SQL 被 deny 拦「遗漏 tenant_id」 | `db.query`/`db.exec` 的字面检查（best-effort）要求 SQL 显式带租户条件——优先改走 `db.table()` 构造器（自动注入），系统身份走 `db.asSystem()` |
| `db.asTenant` 抛错（v0.1.20） | 三道门禁：`tenant.allow_as_tenant: true` 未开 / 请求不是匿名（未命中 `anonymous_paths` 或已带租户头）/ id 为空；且**请求级只能设一次**（防中途换身份）。公开页正确姿势见 `scenarios.md` 场景 1 |
| 尾 `/*` 匿名路径收不到豁免（v0.1.20） | **auth 侧**尾 `/*` 已统一为**严格一层**（旧 oj-auth 是任意深度）；跨层改 `/x/**`。**租户侧自始就是严格一层，无此变更**。装配期只对 `auth.anonymous_paths` 里「旧式前缀形态（只有尾段一个 `*`、其余段全字面）且确实丢了面（有更深的已注册路由）」的条目打聚合迁移 WARN（v0.1.23 起，结构条目与仅差 `**` 零层的都不再点名）；确属有意一层可写 `- { path: "/x/*", one_layer: true }` 消音。`tenant.` 与 `auth.` 两条匿名列表独立，OIDC 跳转请求要都加 |
| 要 302 跳转只会 `header`+`fail` 拼 | 拼出来的是**失败信封体**（非标准形态）。用 `json.redirect(url[, code])`（v0.1.26）：3xx + `Location` + RFC 9110 §15.4 注记（HEAD 为空 body）；`code` 非 3xx 回落 302 |
| SPA 深链 404 / 只回 100 条数据 | 前者：web 挂载写 `spa: true`（v0.1.58 起逐挂载，默认关，api 挂载前缀下的 404 不被吞）；后者：没写 `limit()` 吃了 `db_query.default_limit`（默认 100，看 `X-OJ-Row-Limit` 头） |
| IM 预览 / 爬虫只看到默认 title（页面上 JS 改了没用——爬虫不执行 JS） | 构建期已知路由 → `server.html_meta` 的 `__meta/<path>.json`；**按数据**（issue 标题/分享页正文）→ `server.html_meta_handler` 指一个 GET handler（v0.1.25，`http.query.path` 是**已剥命中 web 挂载前缀**的站点内路径；返回 `title`/`og:*`/… 或信封），配 `html_cache_control` 防盲缓存。见 `scenarios.md` 场景 2 |
| 注入的 meta「生效了但还是看到旧 title」 | 不会：head 里**同名旧标签会先被摘掉**再放新的（浏览器/爬虫只认第一个，v0.1.25 起替换而非追加）。若真没变：壳的 `<title>` 在 `</head>` 之外，或 head 里是 `<script>` 拼出来的（脚本内容不参与替换） |
| 动态 meta handler 里 `db.asTenant` 抛错 / `http.tenantId` 是 null | 派发**恒匿名**：请求头（含租户头）一律不传递（安全边界：否则 `sql_guard: deny` 会把攻击者指定的租户当过滤条件）。按 URL 派生 id → `db.asTenant(id)`，并开 `tenant.allow_as_tenant: true` |
| 预览卡片只在本地对、生产不对 | oj 只在**自己送静态文件**时注入；生产由 nginx/Caddy/CDN 直出 SPA 的话要么改走 oj 托管（web 挂载），要么在反代层做注入 |
| 启动报 `server.html_meta_handler: "…" 不在路由表` / `未映射 GET 方法` | 动态 meta 源必须命中一个 **GET** 路由（v0.1.25 装配期 fail-fast）——常见错因：路径写错、或该路径只有 POST |
| 日志 `warn: html_meta_handler: …` 但页面照常 200 | fail-open 是设计：handler 非 2xx / 超时 / 非 JSON / 信封 `code != 0` 时按静态结果送出。按 WARN 里的原因修 handler，页面不会 500 |
| `vars.get("X")` 恒 `null` | 只有写进 config 顶层 `vars:` 段的键可读（fail-closed；平台**不**读 OS env，也没有读任意 config 键的口子）。值只能是标量（`PORT: 3000` 读成 `"3000"`，嵌套 map/list 是配置错误） |
| `oj test` 读到/写坏了开发库数据 | 未声明 `db.test`（或未给 `--db <name>`）——`oj test` 默认落 `db.test`，启动日志打印 `oj test: using db "..."`；测公开面 handler 要加 `--anonymous` |
| `oj exec` 脚本输出没看到 | `json.ok(x)` 空转（无 HTTP 消费方）——输出用 `console.log`/`log.*`；但 `console` 仅 exec 可用，同一脚本拷进 handler 是 `ReferenceError` |
| `oj exec` 管道里拿到 `INFO` 前缀 / `log.*` 字段混进结果 | v0.1.55 起通道分离：`console.log`/`info` **原样** stdout（无前缀）；`console.debug`/`warn`/`error` 与 `log.*`（含 info 级）走 **stderr** 带级别标签——管道只收 `console.log` 本体；`--log-file` JSONL 语义不变 |
| `oj exec` 的 `-- -x` 被 clap 拒 / 脚本里 `args` 是空数组 | 透传参数必须放在 `--` **之后**（`oj exec s.ts -c config.yaml -- --dry-run`），经 `globalThis.args: string[]` 注入；`--` 前的都归 CLI 自己 |
| `oj exec` import 报 escapes project root / 找不到 `./util` | 相对导入钳制在项目根（config 所在目录）内且**必须显式扩展名**（`import "./util.ts"`）；脚本放项目外连 `./util.ts` 都导不了 |
| `oj exec -e/--code` / `--repl` 里 `import "./util"` 报找不到 | 内联代码与 REPL 行**无基准目录**，不支持相对 import——要复用抽出的模块请改走 `oj exec <file>` |
| `oj exec` 报迁移相关意外 | exec 迁移默认 **off**（serve dev 缺省 auto，两命令相反）；config 显式 `migrate_on_start` 才执行 |
| `yaml.parse` 报 `node budget exceeded` / `alias budget exceeded` | 输入在 1MB 内但 alias 链式展开超预算（billion laughs 防护，v0.1.75）——压缩引用层数；正常 manifests.yaml（千节点级）远离预算。超 2^53-1 的整数为十进制字符串，不是 number |
| `yaml.stringify` 回写 config.yaml 后注释全丢 | stringify 是 serde_yaml 往返，只保语义不保文本——**禁用于 config.yaml**；回写走文本手术三步模式（`fs.readTextFile` → 只改目标段 → `yaml.parse` 复检 → 写回） |
| `yaml.parse` 报 `non-string mapping key` / `expected a single YAML document` | int/bool/null 键与多文档（`---`）都不接受——需键值对齐 machine 产物形态；重复键后键覆盖（不报错） |
| `oj exec --log-file` 没生成文件 | 打开失败只 stderr warn 一次、不中断脚本——看 stderr 首行 warn（路径不可写等） |
| 并发取号撞主键 / 序号重复 | 手写 `select max(id)+1` 的竞态——改用 `db.nextSeq(name)`（v0.1.24，单语句原子；见 `scenarios.md` 场景 7） |
| `db param: u64 value … is not supported on this path` | 在 PG/SQLite 上用了 `toUBigInt()`（它们的 bigint 是 i64）——改存 text 或换 MySQL `BIGINT UNSIGNED` |
| `db(mysql): column 'x' has MySQL type 'DECIMAL' … does not decode yet` | MySQL 读侧不支持该列类型（`DECIMAL`/`JSON`/`DATE`/`DATETIME`/`TIMESTAMP`/`TIME`/`YEAR`/`BIT`/`GEOMETRY`）——**报错而非静默给 `null`**。在 SQL 里显式转换：`select cast(x as char) as x from t`，别用 `select *`。另：MySQL `BOOLEAN`/`TINYINT(1)` 读出是 `1`/`0`，不是 `true`/`false` |
| `tenant guard: tenant id "…" is not a valid integer for numeric column …` | `tenant_id` 列是数值类型但租户头不是十进制字面量——用数字租户 id，或把列改成 text。**注意：`sql_guard: warn` 也硬失败**（warn 只放行「无法判定」，不放行「判定为不匹配」） |
| 启动 / `oj build` / `oj migrate` 报 `tenant_id` 类型非法（v0.1.24） | `tenant_id` 声明类型只能是 `text` / `integer` / `bigint`——`double`/`boolean`/`blob` 直接 fail-fast（没有「等值租户 id」语义）。数值列上 insert/update 的租户等值接受字符串/数字/`toBigInt`/`toUBigInt` 四种形态 |
| 雪花 id / 大整数算错、主键 dup 500 | i64 超 `2^53-1` 读出来是**字符串**；`Number(row.id) + 1` 会静默坍缩到 f64 网格值（下次分配撞主键）。范式：`toBigInt(rows[0].m) + 1n` → 直接回写 `db.exec(..., [next])`（v0.1.22，见 `scenarios.md` 场景 7） |
| `toBigInt` 抛 `not a safe integer` | 传进去的是已坍缩的 number（多为 `Number(...)` 的产物）——传 DB 原样给出的**十进制字符串** |
| PG 报 `column "x" is of type bigint but expression is of type text` | 回写用了字符串——字符串是文本意图，整数要用 `toBigInt(...)`（PG 不做隐式转换；MySQL/SQLite 会转换但别依赖） |
| 同一 SQL 混合参数类型后报 `invalid byte sequence for encoding "UTF8": 0x00` / `insufficient data left in message` | **v0.1.24 起平台自动按参数形态分缓存键，无需再规避**（PG 插件给 SQL 前置 `/*oj:<形态>*/` 签名；MySQL 无此问题）。若仍出现，检查 PG 插件是否随宿主重建 |
| 多库项目只有 `default` 迁了 / 某库启动报 M004 | `oj migrate` 缺省只作用 `default`——命名库要 `oj migrate -c config.yaml -d dist --db <name>` 逐库各跑一遍（`test fixture` / `schema diff` 同旗标） |
| `oj migrate --db X` 把别的模块的表也建进了 X | `--db` 是**整轮**目标库，不读模块级 `manifest.yaml` 的 `db:` 绑定（那只是运行期路由）——模块绑不同库时用 `--db X --module M` 逐组合跑（`scenarios.md` 场景 6） |
| 生产看 logs 看不到 SQL / 信封里没有 `_sql` | SQL 追踪 dev 默认开、release 默认关（`v0.1.51`）。生产要开就在 config 加 `db_trace.enabled: true`；dev 模式（无 `dist/manifests.yaml`）直接就有，看 `target="oj::sql"` 的日志或响应信封 `_sql` 字段 |
| 追踪日志/画像里 `params` 是 `"3 params"` 看不到真实值 | `db_trace.redact_params` 默认 `true`（防密码/手机号泄漏）。本地排障关掉脱敏：`db_trace.redact_params: false`（值经 JSON 序列化）；**切勿在生产开明文** |
| `db.sqlProfile()` 返回空对象 `{}` | 追踪未开启（release 默认 / `enabled:false`）——dev 模式或 `db_trace.enabled: true` 下才有数据；同一请求内调用，跨请求重置 |
| `--db "x" not declared in config (db keys: […])` | 库名不在 config `db:` 段（键即库名）——工具**故意不回落** `default`，防迁移打在开发库上 |
| `--redis/--blob/--es/--broker/--kafka/--rabbit` 报 `profile 'X' not declared (available: […])` | 选中的资源 profile 不在对应 config 段（如 `--blob` 不在 `config.blob.backends`）；工具**故意不回落** `default`，防误用开发库/错后端。核对报错里的可用 profile 列表，或补上对应 profile |
| 一份 config 想同时接多源、又只跑同一条 `oj test`/`oj exec` | v0.1.34 起各资源根 key 都支持 `--<key> <profile>` 选源（`db`/`redis`/`blob`/`es`/`broker`/`kafka`/`rabbit`），选中的 profile 在装配期别名为字面 `default`，JS 全局无需改代码 |
| WS 二进制帧 `http.body` 是 null | 设计如此（不做 UTF-8 有损转换）——取字节用 `await http.bodyBytes()`（v0.1.16） |
| 回显二进制协议帧型变成 Text | `ws.send` 帧型由参数类型决定：Uint8Array → Binary(0x2)，string → Text(0x1)——别把字节 decode 成 string 再发 |
| `import "#x"` 报「未找到模块根」 | 该文件不在模块内（`tests/` 用例、`src/tasks/` 任务池），或 `--api-path` 在 project root 之外——这些场景用相对路径（v0.1.18 别名锚点 = 向上最近的 `manifest.yaml`） |
| `oj build` 报「别名 #/m/x 跨模块引用 M 未声明依赖」 | S008 门禁：`M/manifest.yaml` 补 `deps: { M: "^<版本>" }`，或把共享代码放进本模块（`#x` 无需声明） |
| `oj build` 报「扩展名不会进产物」 | 本地导入目标是 `.js`/`.json`——产物只转译 `.ts`，改目标为 `.ts` 或内联 |
| `.route = "_id_"` 没参数化（v0.1.27） | `.route` 值是 matchit 语法：`_name_` 在其中是**字面段**；参数写 `{name}`——`_name_` 是**目录**写法（dev/build 会对该形态打 warn） |
| 请求 `/…/_aa_/…` 落进了参数路由（v0.1.27） | `_aa_` 目录转换后不再有静态 `_aa_` 路由；URL 里写 `_aa_` 会被 `{aa}` 当实参吃掉（实参值就是 `"_aa_"`）。`_shared` 无尾下划线不受影响 |
| 多站点 miss 后 404，明明另一个站点有同名文件（v0.1.27） | **不跨站**是设计：最长前缀命中后只在该站解析 + SPA 回落。`/docs/x` 命中 `/docs` 站就不会回落 `/` 站的 `docs/x`；要共享文件请放各自站点的目录里 |
| `oj build` 报「manifest.yaml 只能出现在模块根」 | 子目录里多了 `manifest.yaml`——它会被当成 `#` 别名的新锚点，删掉即可 |
| `mail.send` 报 `mail not configured` | 未配顶层 `smtp:` 段，或 `oj-mail` 插件未加载（`cargo xtask plugin mail`） |
| `mail.send` 返回 `code:5`（白名单） | `allowed_from`/`allowed_recipients` **空表 fail-closed**——显式列出；或发件人/收件人**未全等命中**条目（条目只能是完整地址或 `@domain`，不做子域通配） |
| `mail.send` 返回 `code:5`（附件路径） | `{path}` 越出 project root（`ensure_within` 拒绝）——用仓内相对路径或改 `{blobKey}` |
| `enqueue` 拿不到结果 | 返回的是 `{code:0,data:{jobId}}`——取 `res.data.jobId`（宿主生成，传入的 jobId 会被剥掉）；完成经 `bus.subscribe("mail.result")`。**跨 profile/模块/租户查不到**是设计（`mail.result` 按归属过滤） |
| `mail.enqueue` 返回 `code:4` | 队列满（背压）：调大 `smtp.queue_capacity` / `workers`，或降低并发 |
| `code !== 0` 想自动重试 | **不行**：`2`/`3` 未启用，永久失败与瞬时失败都归 `1`，分不出可重试性——见 `api-manual.md` §6 |
| IDE 报 `Cannot find module '#_shared/x'` | 该文件尚不存在或不在模块内；`paths` 无法表达「模块相对」别名——创建 `<模块>/_shared/x.ts` 即解析（`global.d.ts` 已加 `#*` 通配兜底消除报错） |
| 流式响应收到的是 `{code,msg,data}` 而非裸流 | 用了 `json.ok`——流式必须 `json.stream`/`json.sse`，二者**绕过信封**直接写裸 body（v0.1.35） |
| SSE 客户端收不到帧 | 用了 `json.stream` 却没按 `data: X\n\n` 帧格式——要自动帧化用 `json.sse`；心跳保活 15s（`:\n\n`），静默超 15s 的连接可能被代理掐断（v0.1.35） |
| `json.stream`/`json.sse` 的 `opts` 想设 `event:`/`id:` | 不支持——`opts` 仅 `status`/`contentType`/`fileName`/`disposition`；自定义 SSE 字段自己拼进 `write("event: x\ndata: y\n\n")` |
| 流式写二进制（图片/附件）乱码或不全 | `write` 传了 `string`——会被当 UTF-8 文本而失真（v0.1.65 前根本不支持二进制）。**二进制必须传 `Uint8Array`/`ArrayBuffer`/类型化数组**，走字节通道逐字节无损；`fileName` 一并设 `Content-Disposition` 让浏览器另存为原名（无需 302 到免鉴权 blob 路由）。文本 CSV/JSON/SSE 行仍传 `string` |
| 跨域启动直接报错退出 | `server.cors.credentials: true` 且 `origins` 为空——带凭据的 `*` 非法；配显式 `origins`（v0.1.35） |
| 跨域响应没有 `Access-Control-*` 头 | `server.cors` 段没写（缺省不挂 CORS 层，与旧版一致）；或 `origins: ["*"]` 不展开——放行任意源就把 `origins` 留空（v0.1.35） |
| `crypto.aesGcmEncrypt` 传 24 字节密钥报错 | 不支持 AES-192——密钥仅 16（AES-128）/32（AES-256）字节的 hex 或 base64；应用层加解密，密钥自管不进 config（v0.1.35） |
| `crypto.verifyEd25519` 报 `verifyEd25519: key not hex/base64` | 公钥传了 base64url（含 `-`/`_`）或 PEM——只收 hex/base64 编码的 32 字节**原始** key（PEM/SPKI 不支持）；签名同理只收标准 base64（**base64url 不支持**）。格式错抛错、验签不过返回 `false`（v0.1.75） |
| 特权模块运行时报 `NotCapable: module 'x' is not platform-privileged` | 部署形态陷阱：模块必须部署在 `platform.root` 下**且**该目录列为 `mounts[].api` 条目（归属与路由只能来自挂载 discover），再加 `platform.modules` 名单——三缺一都拿不到特权；`platform:` 段整个不配则报 `platform not configured`（fail-closed，v0.1.75） |
| `exec.run` 报 `NotCapable: … not authorized for exec` / `template mismatch` / `ambiguous` | **exec 授权 ≠ `platform.modules`**（两名单独立，只配一边拿不到另一边）：`platform.exec.<模块>.allow` 里要有匹配的 argv 模板——literal token 逐字相等、`${path:}`/`${raw:}` 占位符恰吸一 token、同一 argv 命中两条模板即歧义拒绝（v0.1.75） |
| `exec.run` 里给子进程传相对路径就以为出不了 jail | cwd 钉在 fs.root 但**不构成隔离边界**——路径越界防线在 `${path:}` 占位符校验（`fs.root ∪ trusted_paths`），别把越出集合的路径交给子进程（v0.1.75） |
| exec 子进程里 `argv[0]` 和模板首 token 不一致 | 预期：宿主侧把首 token 解析为**绝对路径**（"oj"→服务进程自身，其余 PATH 解析）再传给子进程；模板首 token 必须是裸名（路径分隔符直接拒）（v0.1.75） |
| `exec.run` 大 stdin 报 `exec timed out after N ms` | stdin 写入也在超时窗口内：子进程不读 stdin 且输入大时 write 阻塞 → 超时兜底组杀（缺省 30s）——大 DDL / 大输入显式调大 `timeoutMs`（硬上限 600s，超出钳制）（v0.1.75） |
| `exec.run` 回调形态 / `exec.spawn` 里传 `stdin` 没生效 | v0.1.83 订正：此前仅无回调的 `exec.run` 支持 `stdin`，回调 / `spawn` 形态**静默丢弃**（子进程 stdin 恒 null，`sh -c cat` 直接吃空输入）；现在三形态语义一致（一次性写入后关写端）——老代码里为绕过而写的临时方案可以删了 |
| `exec.run` 跑 `oj migrate` 大 DDL 报 `exec timed out after 30000 ms` | 经 `exec.run` 调 `oj migrate` 执行大表 `ALTER`/索引迁移时，30s 默认超时不够（迁移**不**走 stdin 写入，但仍受同一 `timeoutMs` 窗口约束）——显式 `timeoutMs` 调大（< 600s 硬上限），否则超时组杀留下半截账本（v0.1.75） |
| Windows 上 `exec.run(["sh","-c",...])` 必败（`command resolve failed`） | Windows 无 `sh` 可执行、且不自动探测 Git Bash——跨平台模板别写 `sh -c`，改用 `cmd /c`：`["cmd","/c","echo","hello"]` / `["cmd","/c","type","__JAIL__/in.txt"]`；`cmd` 由 resolver 解析为绝对路径（如 `C:\Windows\System32\cmd.exe`）后 spawn（v0.1.75 既有行为，文档补全） |
| Windows 上 exec 输出比对总差一个 `\r` | `cmd /c echo` 恒以 CRLF 收尾、`cmd /c type` 原样吐文件字节（不补行尾），oj **不做** CRLF→LF 归一（与 `Deno.Command.output` / Node 同口径）——跨平台文本比对用 `trimEnd()` / `split(/\r?\n/)`，别写死 `"\n"`（v0.1.79） |
| Windows 上 exec 跑输出中文的命令报 `not valid UTF-8` | 子进程输出是本地代码页（GBK / CP1252），exec 强制 UTF-8 解码 → 抛 `exec: stdout is not valid UTF-8`；把 `chcp 65001` 写进 `cmd /c` 语句。**只有无回调的 `exec.run` 会抛**：带 `onStdout`/`onStderr` 的回调形态改走有损解码（U+FFFD）、`exec.spawn` 给原始字节，都不抛（v0.1.79 订正） |
| Windows 上 `cmd /c echo` 同时配了 `${raw:word}` 和 `%${raw:NAME}%`，`echo %VAR%` 恒报 `exec template ambiguous` | 同一位置的**裸 raw 是 `%…%` 包裹 raw 的超集**：`%X%` 形态 argv 同时命中两条 → 歧义拒绝（不静默择一，报错只给命中条数不给模板原文）。错开办法：其中一条写成全字面模板（`cmd /c echo hello`），或换不同命令名 / 不同 literal 段落（v0.1.79） |
| 安装器靠 `oj migrate --format json` 的 JSON 解析成功就当迁移成功 | json `error` 字段已脱敏（`<scheme>://***@host`，不漏密码），但**退出码**才是成败真源：任一模块失败 json 仍成功解析、只是 `results[]` 里 `ok=false` 且进程退非 0——安装器必须校验 exit code，不能只 `JSON.parse` 成功 |
| 升级后 `crypto.sha256Hex(123)` / `sha256Hex(null)` 抛 TypeError | v0.1.75 行为变更（fail-loud）：非 string/二进制入参旧版经 `String()` 强转求摘要，现直接抛错——旧脚本显式 `String(x)` 再传，或改传 `Uint8Array` |
| `crypto.md5Hex` 用在凭据/签名/完整性校验上 | MD5 已密码学破损——仅限**非安全场景**（缓存键/etag/旧系统兼容），安全用途改 `sha256Hex` 或 `bcrypt`（v0.1.75） |
| 写 `http.module.name = "x"` 抛 `TypeError: Cannot assign to read only property` | 预期（v0.1.76）：`http.module` 是框架授信依据（归属守卫/bound_db/平台特权）故冻结只读。strict（ESM / api 文件 CJS 包装）下写/delete 抛错；`require()` 的 CJS 代码（sloppy）写它静默无效——两条路径都改不了框架状态。只读用即可；测试要伪造身份走真实路由 |
| `http.module` 是 `null`，`http.module.name` 直接 TypeError | 按 handler 文件所在目录判定（非请求来源）：任务桥、WS 帧（含模块目录内的 `ws.ts`）、`run_with`、启动期内省期无模块上下文——先判 `null`（与 `http.user` 匿名同款）；页面 meta 合成派发在模块目录内**有值**（v0.1.76） |
| 把 `http.module.version` 回显给外部客户端 | version 是指纹面——日志/内部打点用即可，勿进响应体/错误消息外发给客户端（v0.1.76） |
| `exec.spawn` 后不 `for await` 消费，子进程卡住不退 | 真实子进程背压：stdout 经有界 mpsc（16 槽 × 8KiB）送达，JS 不拉取 → 通道满 → drain 在 send 挂起 → 子进程管道满 → 子进程自然暂停。不是 bug；先消费（或 break）再 `h.exit()` 才会返回（v0.1.78） |
| `exec.run` 带 `onStdout`/`onStderr` 回调后还想要整段 stdout | 回调形态**其实也缓冲**（v0.1.79 订正：实现把全部分块攒在内存后 merge，返回 `{ code, stdout, stderr }`，只是解码为**有损**、非 UTF-8 不抛）——真正不占内存、拿原始字节的是 `exec.spawn` 逐块消费；用回调形态仍受 10MB 合计上限约束 |
| 拿 `exec.spawn` 的 `rid` 去 kill 别人的进程 | 句柄 rid 是本次 runtime 的 ResourceId，进程内局部；`kill` 只杀自己 spawn 的会话，无 pid 入参，跨模块 / 跨请求不可达（v0.1.78） |
| `exec.run` 带回调 / `exec.spawn` 时超时或输出超限却没抛错，以为跑成功了 | **只有无回调的缓冲形态抛** `exec timed out` / `output limit exceeded`；回调与流式形态是整组击杀后把 `code` 打成 **137** 并截断输出（不抛）。别用 `try/catch` 判成功——必须同时校验 `code`，且别把截断的 stdout 当完整结果（v0.1.79） |

## 手册

`api-manual.md`（同目录）共 13 章：1 快速开始 / 2 项目结构与模块约定 / 3 模块数据层 /
4 编写 api.ts / 5 导入解析 / 6 全局对象 API 参考 / 7 响应信封与错误码 / 8 鉴权与多租户 / 9 测试 /
10 配置 config.yaml / 11 构建与发布 / 12 运维要点 / 13 安全红线与已知限制。

`scenarios.md`（同目录）场景速查：公开分享页匿名读租户数据 / SPA 深链回落与 meta 注入 /
测试库隔离 / LIMIT 分页 / 匿名路径通配 / 多库项目按库迁移与对账（`--db`）/
大整数 id（雪花）的生成与精确回写 / 302 重定向到 blob 预签名 URL /
路径参数路由（`_name_` 目录 vs `.route`）/ 池化长任务 + cron /
流式响应与 SSE（v0.1.35）/ 前端跨域 CORS（v0.1.35）/ 应用层 AES-GCM 对称加密（v0.1.35）/
泛型轴插件调用（`axis(name)`，v0.1.54）。

类型提示：把同目录 `global.d.ts` 拷进业务项目源码根，编辑器/agent 即获得全局对象
（json/http/db/kv/blob/bus/es/mail/Kafka/RabbitMQ/tasks…）的完整类型。
`#` 开头的导入别名（`paths` 无法表达「引用方模块相对」解析）由同目录 **`oj-modules.d.ts`**
兜底（**非模块** `.d.ts` 里的 `declare module "#*"`，须一并拷贝并纳入 tsconfig `include`）：
已存在的别名仍走真实类型，未创建/不在枚举内的降级为 `any` 且不报 TS2307。

邮件投递完整手册（架构/附件与 `sendRaw` 语义/反馈通道/安全/运维/已知限制）：
仓库 `docs/mail-smtp.md`。
