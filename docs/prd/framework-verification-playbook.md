# 框架端到端验证手册（可重复演练）

> **用途**：框架升级（`contract`/`runtime`/`shell`/`cli` 发新版，或 oj 升级）后，**从零**跑通「脚手架 → 依赖 → 契约 → 后端 → 前端 → 构建 → 运行」，一次确认整条链路没有回归。
> **配套**：[`framework-development-guide.md`](./framework-development-guide.md)（原理）、[`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md)（跟做）。
> **原则**：每一步都有**可判定通过/失败的检查点**，不要只看命令退出码，要核对产物。

### 最近一次基线（2026-10-15 演练，oj 0.1.74 / cli+runtime 0.1.20，openapi 流水线）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-15 |
| 框架包版本 | `cli`/`runtime` `0.1.20`（源码 CLI 验证；宿主 versions.json 钉版） |
| oj | `0.1.74`（本机安装预置进 `bin/`；npm 通道 `@oj-bin/oj` 当时 latest 仍是 0.1.71，低于 `MIN_OJ_VERSION` 门禁 0.1.73，`ojm vendor`/`ojm init` 的下载步会被门禁拦下——见 §9 新增行） |
| 结果 | **全链路通过（§1–§7）**：`ojm init`（76 项新增，预置 bin/oj 跳过 vendor 下载）→ `pnpm install` → JsRuntime 探针通过 → books 模块（新约定 `.schema` 入参 + 平级 `.response` 出参）→ `oj openapi` 重生成 → `ojm api` 生成 `web/src/books/__client`（导出 `booksListGet`/`booksCreatePost`，`BooksListGetData` 出参类型完整）→ `ojm api --check` 0 error / 0 warn → `ojm build`（7 后端模块含 books 2 api file(s)、6 前端模块、modules.json 含 home/login/books）→ `tsc --noEmit` 0 error → `ojm dev`：migrate/seed 正常、8 个路由方法入参校验激活、登录返回 token、列表/关键字过滤/新增/无 token 401/通知兜底全对 → `ojm preview`（release 形态）：migrate 门禁过、路由来自 `api/dist/**/routes.js`、API 与静态兜底正常、带 dist 的 `--check` 三腿全过。 |
| 新约定检查点 | 契约不再有 `contract.ts`/`routes.json`/`openapi.yaml`：handler 挂 `.schema`（params/query/body）+ 平级 `.response`（oj v0.1.72+），`oj openapi` 产出工程根 `openapi.json` 为唯一事实源；client 函数名 = `camelCase(operationId)`（如 `booksListGet`），非旧人类命名。 |
| 演练中发现并修复 | ① npm 通道 oj 滞后于门禁（预置本机二进制绕过，init 对已有 bin/oj 跳过 vendor）；② 模板残留空目录 `api/src/_shared` 被 init 拷进工程、`oj build` 报 "module '_shared' missing manifest.yaml"——删空目录 + `copyTemplates` 加空目录跳过防护；③ `--check` 第三腿误报：契约侧 fullPath 尾斜杠（`notifications/`）vs dist pattern（`notifications`）键不等，且豁免只过滤「dist 多」不过滤「dist 缺」——双侧规范化 + 豁免对称过滤（含 2 条回归测试）；④ 未发布版本的 `pnpm install` 需 file: 链接 + 手工 symlink（catalog: 协议只对 workspace 成员解析）。 |

### 历史基线（2026-10-11 演练，oj 0.1.60 / cli+runtime 0.1.12）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-11 |
| 框架包版本 | `cli`/`runtime` `0.1.12`（源码 CLI 验证；宿主 versions.json 钉版） |
| oj | `0.1.60`（`@oj-bin/oj` 通道；本环境无 npm registry 网络，把本机 0.1.60 安装预置进 `bin/` 以绕过 `ojm vendor` 下载，效果等价） |
| 结果 | **后端全链路通过**：`ojm init` → 生成 `mounts:` 配置 → `oj serve` 正常启动（migrations/seed 应用、6 模块/12 路由注册、证书有效、`/api/health` 200）→ 登录 `admin/123456` 返回 token、无 token 401、带 token 读 `/notifications`/`/web/hello` 200。`pnpm install` 因沙箱无 npm 网络未完成，§4–§7 前端链路待联网复跑。 |
| 新增验证点 | oj v0.1.58 起 `server.api_prefix` 等 5 键已删除、改顶层 `mounts:`（旧键 fail-fast，见 §9）；`readOjApiPrefix` 改读 `mounts:`，`ojm info` 显示 `base: /api` 正确。 |

### 历史基线（2026-09-11，记录用，后续对照）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | `cli`/`runtime` `0.1.6`（本次验证跑在 `refactor/vendor-npm-install` 分支源码 CLI 上：**vendor 下载源从 GitHub releases 切换为 npm 包 `@oj-bin/oj`**，见 `202609111926-vendor-npm-install-design.md`） |
| oj | `0.1.13`（**npm `@oj-bin/oj` 通道**首验：`ojm init` 临时目录 `npm i` → 落盘 `bin/oj` + `bin/plugins/` + `bin/devkit/`，无构建机路径泄漏，探针通过） |
| 结果 | 全链路通过（§1–§7）。发现并修正 3 处手册判据过期（§1/§2/§8 的四包时代 devDeps 表述 → 两包时代只有 `cli`+`runtime`；§6 curl 直打 `/login` 404 系 SPA 回落需 `Accept: text/html`，非缺陷，已补判据说明）。`@types/react`/`typescript` 回退 `*` 告警依旧，安装后需钉版（本次钉 `19.3.0` / `7.0.2`） |

<details>
<summary>上一次基线（0.1.6 四包收尾 / oj 0.1.12 GitHub release 通道）</summary>

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | `cli` `0.1.5`（本次模板修复：home/login 前端模块 + notifications 端点 + 豁免清单；home 用统计卡片 + 折线/柱/饼图演示共享依赖矩阵）+ `runtime`/`shell` `0.1.4` + `contract` `0.1.3`（四包均已按本手册复跑） |
| oj | `0.1.12`（**官方 release**）——v0.1.11 及更早的 release 二进制有构建机路径缺陷，v0.1.12 已修复（见 §3） |
| 结果 | 全链路通过（§1–§7）：release 二进制在非构建机可用，`ojm dev` / `ojm preview` 均正常。发现并修复 4 个脚手架缺陷（模板缺 `api/.ojm-api-exempt.json` → `ojm api --check` 误报；模板缺 `web/src/login` → `/login` 无路由可跳；模板缺 root 级 `api/src/notifications` → 通知铃 404；模板缺 `web/src/home` → 登录回跳 `/home` 落错误边界，见 §4/§5）与 2 处手册判据过期（§3 泄漏计数、§4 未注明豁免文件） |

</details>

<details>
<summary>更早基线（0.1.3 / oj 0.1.11 自建）</summary>

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | 首次全链路：四包均 `0.1.3`；其后发布 `runtime`/`cli`/`shell` `0.1.4`（`contract` 保持 `0.1.3`） |
| oj | `0.1.11`（**自建**，见 §3 高危检查点） |
| 结果 | 0.1.3 全链路通过；发现并修复 2 个脚手架缺陷（缺 `contract` 依赖、缺 `env.d.ts`），并给 cli 增加 oj 二进制自检探针（0.1.4 起随 `ojm vendor`/`ojm init` 自动执行） |

</details>

---

## 0. 准备（干净目录）

```bash
export VERIFY_DIR=/tmp/ojm-verify
export OJM_REPO=/Users/ever/git/only-js/oj-module   # 按实际改
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
```

需要：Node 18+、pnpm、**网络**（下载 oj 与 npm 包）。预计 5–10 分钟。

> **npm 通道滞后时的两条旁路**（2026-10-15 演练实测）：
> 1. **oj**：`MIN_OJ_VERSION` 门禁钉最新发布版（0.1.20 起为 **0.1.73**），而 npm `@oj-bin/oj` 的 latest 可能仍低于门禁 → `ojm vendor`/`ojm init` 的下载步被拦。旁路：先把本机 oj（≥ 门禁）连同 `devkit/`、`plugins/`、`.oj-version` 预置进工程 `bin/`，`ojm init` 对已有 `bin/oj` 会跳过 vendor（init.ts：bin/oj 存在即 `report.skipped`），效果等价。
> 2. **框架包自身**：待发版本（如 0.1.20 未上 npm）`pnpm install` 会 `ERR_PNPM_NO_MATCHING_VERSION`。旁路：删 devDeps 里的 `@oj-module/cli`（CLI 用源码 bin 直跑），`@oj-module/runtime` 装好后手工 symlink 到仓库 `packages/runtime`（其内部依赖经 realpath 回落仓库 node_modules 解析，与 playground-oj 的 workspace 链接等效）。注意 `file:` 链接不行：两个包都用了 pnpm `catalog:` 协议，只对 workspace 成员解析。

## 1. 脚手架（`ojm init`）

```bash
# 用源码 CLI（验证当前代码）；若验证发布包，改 `npx --package @oj-module/cli ojm init`
node "$OJM_REPO/packages/cli/bin/ojm.mjs" init my-books --yes
```

**检查点**

- [ ] 退出码 0，末行提示 `登录 admin / 123456`
- [ ] 目录齐全：`api/src/{_platform,auth,web,notifications,personal-center,notification}`、`api/.ojm-api-exempt.json`、`web/src/{demo,home,login,personal-center,notification,notifications}`、`web.config.ts`、`tsconfig.json`、`global.d.ts`、`env.d.ts`、`bin/oj`、`bin/.oj-version`、`.claude/skills/{oj-api-dev,ojm-module-dev}/`
- [ ] **工程根有 `openapi.json`**（新流水线唯一事实源，模板随附）+ `web/src/<模块>/__client/` 预生成（`ojm api --check` 开箱即过）
- [ ] handler 契约为新约定：动词挂 `.schema`（params/query/body 入参）+ **平级 `.response`**（出参，oj v0.1.72+）；无 `contract.ts` / `routes.json` / `openapi.yaml`
- [ ] `package.json` 的 devDependencies **含** `@oj-module/{cli,runtime}`（两包时代；`contract` 是 runtime 子路径、shell 已并入 cli），且值**不是 `*`**
- [ ] 若出现「`@types/react` / `typescript` 回退 `*`」告警 → 记下，安装后必须钉版
- [ ] **未出现「oj 二进制自检失败」告警**（cli ≥ 0.1.4 安装后自动冒烟）；若出现，按 §3 换自建二进制
- [ ] npm 通道 oj 低于门禁时按 §0 旁路 1 预置 `bin/oj` 后重跑（init 幂等）

## 2. 安装依赖

```bash
cd my-books && pnpm install
```

**检查点**

- [ ] `node_modules/.bin/tsc` 存在；`@oj-module/runtime` 可解析（发行版走 npm；源码验证按 §0 旁路 2）
- [ ] 安装日志里 `@oj-module/{cli,runtime}` 版本与 `versions.json` 一致（源码验证时 cli 以 bin 直跑、`ojm info` 显示 `cli: unknown` 属预期）
- [ ] `pnpm exec ojm info`（或 `node "$OJM_REPO/packages/cli/bin/ojm.mjs" info`）输出宿主版本矩阵 + 模块清单，无报错
- [ ] 处理 §1 的 `*` 告警：把 `@types/react` / `typescript` 钉成实际安装版本

## 3. oj 二进制可用性（检查点）

```bash
./bin/oj --version                              # 期望：oj ≥ 0.1.73（MIN_OJ_VERSION 门禁；平级 .response 需 0.1.72+，del→delete 操作键归一需 0.1.73+）
strings bin/oj | grep -oE '/Users/runner/work/only-js/only-js/[^"]*\.js'
# 期望：**空**（无泄漏的 JS 构建路径）。注意：`grep -c "/Users/runner"` 不再适用于判据——
# 即便修复后仍会命中 cargo registry 的 panic 路径（如 h2/unsafe-libyaml），属正常。
```

**已知缺陷（v0.1.12 已修复）**：GitHub release 的 oj 二进制曾由 CI 构建，JS 扩展源码被标记为
`LoadedFromFsDuringSnapshot` 且把**构建机路径**烤进二进制；在非 CI 机器上
初始化 JS 运行时报：

```
Failed to initialize a JsRuntime: No such file or directory (os error 2)
```

`./bin/oj --version` **仍会成功**（Rust 侧），所以 v0.1.12 之前必须向下走一步才会暴露。
**v0.1.12 起 JS 源已内嵌进二进制**（`ext:bridge_ext/bootstrap.js` 不再指向构建机路径），
release 产物在非构建机可用。

**最小复现探针**（必须有至少一个 `api.ts`，否则 `oj build` 不会初始化 JsRuntime）：

```bash
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello
printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts
printf 'name: web\ndesc: probe\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml
./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out 2>&1 | head -5
# 期望：oj build: web v0.1.0 → ... (1 api file(s))
# 坏二进制（≤ v0.1.11）：Failed to initialize a JsRuntime: No such file or directory (os error 2)
```

**处置**：优先 `ojm vendor` 拉 **≥ v0.1.12**（下载源为 npm 包 `@oj-bin/oj`）。若仍报 ENOENT（版本过旧或未换包），
用**自建** oj 覆盖 `bin/oj`（`cargo build --release`，产物在 `only-js/target/release/oj`），
然后重跑这些检查点直到通过。

> **自 cli 0.1.4 起已自动化**：`ojm vendor` / `ojm init` 安装后（以及「已是该版本，跳过」时）
> 会自动执行等价的 `probeOjRuntime` 冒烟；失败打印人话告警与处置指引，**不阻断**安装
> （便于用户直接替换 `bin/oj`）。本节手工探针用于 CI 与不经 cli 的场景。

> 完整根因与修复方案（可转上游）：[`oj-release-binary-defect-report.md`](./oj-release-binary-defect-report.md)。

> 通过后可继续；否则后面的 `ojm build` / `ojm dev` 必然失败。

## 4. 契约 → 前端 client

在 `api/src/books/` 下补 6 个后端文件（manifest/schema/migration/seed + 2 handler），
handler 按**新约定**写契约——**无 `contract.ts`**：入参挂 `.schema`（params/query/body），
出参挂**平级 `.response`**（oj v0.1.72+；范本照 `packages/cli/templates/api/src/notification/api.ts`、
`apps/playground-oj/api/src/demo/todos/api.ts`）：

```ts
// api/src/books/list/api.ts
const list = {
	async get() { /* ...db.query...; json.ok(rows) */ },
};
list.get.schema = { query: { type: "object", properties: { keyword: { type: "string" } } } };
list.get.response = { type: "array", items: { /* data payload */ } };
export default list;
```

然后：

```bash
./bin/oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json   # 唯一事实源（工程根单文件）
node "$OJM_REPO/packages/cli/bin/ojm.mjs" api                            # 或 pnpm exec ojm api
node "$OJM_REPO/packages/cli/bin/ojm.mjs" api --check
```

**检查点**

- [ ] `oj openapi` 退出码 0，`openapi.json` 含 `/api/books/list`、`/api/books/create`
- [ ] `ojm api` 输出「契约 N 份；写入 2 个文件」——产物 `web/src/books/__client/{api.ts, api.schemas.ts}`（**`__client` 目录名**，旧 `client/` 已改名）
- [ ] client 导出 **operationId 派生名**：`booksListGet` / `BooksListGetQuery` / `BooksListGetData` / `booksCreatePost`（= `camelCase(路径_方法)`，**不是**旧 `defineApi` 的人类命名如 `listBooks`）
- [ ] **出参类型存活**：`BooksListGetData` 非 `unknown`（`.response` 经 `responses.200.content` 信封进 client——新约定与旧 `.schema.response` 的等价性验证点）
- [ ] **不生成** `api/src/books/routes.json` / `openapi.yaml`（旧产物已清理；`api/docs/openapi.yaml` 仅 `--docs` 时产生）
- [ ] `ojm api --check` 退出码 0：`0 error / 0 warn`（无 dist 时第三腿 routes.js 对账给 hint 不判违规）
- [ ] 工程根存在 `api/.ojm-api-exempt.json`（`{"modules":["web","notifications"],"paths":["/auth/*"]}`，内置 `auth`/`web`/`notifications` 端点有意无业务契约；init 自 cli 0.1.5 起内置）

> `ojm api` 只认 `openapi.json`（项目根或 `api/`）：找不到即报错指引先跑 `oj openapi`。
> 若报 `Cannot find package '@oj-module/runtime'` → 依赖未装/未链接（§0 旁路 2）。

## 5. 前端模块

补 `web/src/books/{entry.ts,locales/*,pages/index.tsx}` 并注册进
`web.config.ts`（照抄 tutorial 第 5 节），然后：

```bash
pnpm exec ojm build
pnpm exec tsc --noEmit -p tsconfig.json     # typecheck
```

**检查点**

- [ ] `ojm build`：`oj build` 列出全部后端模块（`_platform/auth/books/notification/notifications/personal-center/web`），其中 books `2 api file(s)`、notifications `1 api file(s)`
- [ ] 输出「已合并宿主站点 → web/dist」「构建 books@0.1.0」「清单已生成」
- [ ] `web/dist/` 含 `index.html`、`assets/`、`modules/`、`modules.json`、`versions.json`
- [ ] `web/dist/modules/books/0.1.0/entry.js` 存在（带 `integrity`）
- [ ] `modules.json` 含 `home` / `demo` / `login` / `books`（**`home` / `login` 不可少**：shell 预构建把 `VITE_BASE_HOME_PATH` 定为 `/home` 且不挂 runtime 内置登录兜底，缺则登录回跳 / 登出 / 点 logo 落错误边界）
- [ ] `modules.json` 中 books 条目 `peerRuntime` 与宿主 runtime 版本相容
- [ ] **typecheck 0 error**（含生成的 `__client/api.ts`——页面 import 的 `booksListGet`/`BooksListGetData` 等 operationId 派生名须对得上）

## 6. 运行与联调（`ojm dev`）

```bash
pnpm exec ojm dev        # 默认 5174；oj 9778
# 另一个终端：
TOKEN=$(curl -s -X POST http://127.0.0.1:9778/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"123456"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.access_token))")
curl -s "http://127.0.0.1:9778/api/books/list?keyword=设计" -H "authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:9778/api/books/create -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"title":"重构","author":"Martin Fowler","year":2019}'
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9778/api/books/list   # 期望 401
curl -s http://127.0.0.1:9778/api/notifications -H "authorization: Bearer $TOKEN"  # 通知铃兜底（期望数组）
```

**检查点**

- [ ] dev 日志：`seed ok module="books"`、`routes: N method-row(s)`（10 个 api file）、`input contracts: 8 route-method(s) validated before reaching JS`（`.schema` 入参校验激活）、`oj serve listening`
- [ ] 登录返回 `code:0` 且 `data.access_token` 非空
- [ ] 登录成功后回跳 `/home` 正常渲染（不落 React Router 错误边界），页面含统计卡片 + 折线/柱/饼图（共享依赖矩阵演示）
- [ ] 列表过滤按关键字命中（注意种子数据：`keyword=设计` 会同时命中「设计数据密集型应用」与「领域驱动设计」——用更独特的关键字如 `数据密集型` 验证单条过滤）
- [ ] 新增返回 `{"ok":true}`（与 `create.post.response` 声明一致），全量列表变 4 条
- [ ] `GET /api/notifications`（带 token）返回 `code:0` + 数组（runtime 通知铃 root 级兜底；缺端点会 404 `no route matched`）
- [ ] 无 token 返回 **401**
- [ ] `http://localhost:5174/` 200，importmap 含 `@oj-module/runtime`，`/modules/books/0.1.0/entry.js` 200
- [ ] `/modules/login/0.1.0/entry.js` 200，且 `/login` 能渲染模块登录页（登出后可跳回；缺 login 模块则落空）

> **curl 打路由路径 404 不是缺陷**：SPA history 回落要求 `Accept: text/html`（浏览器天然带），
> curl 默认 `*/*` 不触发回落。curl 验证请带 `-H 'Accept: text/html'`。

用完停服：`pkill -f "ojm dev"; pkill -f "bin/oj"`。

## 7. 预览（可选，验证 release 形态）

```bash
pnpm exec ojm preview    # oj migrate（verify 门禁）→ server + 静态兜底（4173）
```

**检查点**：migrate 成功（账本落后会拒启，先 `oj migrate -c api/config.yaml -d api/dist`）；
站点可访问（4173 根 200 + `/modules/books/0.1.0/entry.js` 200）；
release 下路由来自 `api/dist/**/routes.js`（目录镜像不存在）；
API 全链路再通一遍（登录/列表/新增）；
**带 dist 后重跑 `ojm api --check`**——第三腿（routes.js vs openapi.json 契约路由表）此时激活，
应 `0 error / 0 warn`（注意尾斜杠规范化与豁免对称过滤，2026-10-15 已修，见 §9）。

## 8. 一次通过判据（汇总清单）

- [ ] `ojm init` 成功：devDeps 含 `@oj-module/{cli,runtime}`（非 `*`）、根级 `openapi.json` + `__client` 预生成、handler 为新约定（`.schema` 入参 + 平级 `.response`，无 `contract.ts`/`routes.json`/`openapi.yaml`）、`env.d.ts` 在 include
- [ ] `pnpm install` 成功，`cli`/`runtime` 两包版本一致（未发版按 §0 旁路 2）
- [ ] oj 二进制通过 §3 探针（JsRuntime 能初始化），版本 ≥ 门禁 0.1.73
- [ ] `ojm api` 生成 `web/src/books/__client`（operationId 派生名、出参类型存活）；`--check` 无 drift（内置 `auth`/`web`/`notifications` 经 `api/.ojm-api-exempt.json` 豁免，见 §4）
- [ ] `ojm build` 产出全部后端模块 + 合并站点 + `modules.json`（含 home/login/books）
- [ ] `typecheck` 0 error
- [ ] `ojm dev`：登录 / 列表过滤 / 新增 / 401 / 通知兜底全对
- [ ] （可选）`ojm preview` 通过 migrate、服务与带 dist 的 `--check` 三腿

## 9. 已知坑与处置

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| `oj serve` 启动报 `config uses removed server.* site keys (v0.1.58): api_prefix` | oj v0.1.58 起删除 `server.api_prefix`/`app_spa_fallback`/`app_path`/`app_prefix`/`static_sites`，改顶层 `mounts:`（出现旧键即 fail-fast，并输出迁移 YAML） | `api/config.yaml` 用 `mounts:`（ojm init 自本轮起已生成）；老工程把 `server.api_prefix: /api` 改为 `mounts: [{prefix: "/api", api: "src"}]`（devkit `api-manual.md` §10）；ojm dev/preview 的 SPA 深链回落由 ojm 自建静态层负责，无需旧 `app_spa_fallback` |
| `Failed to initialize a JsRuntime: No such file or directory` | ≤ v0.1.11 的 release oj 二进制烤了构建机路径（v0.1.12 已修复） | 用 ≥ v0.1.12 的 release（`ojm vendor`）；旧版用自建 oj 覆盖 `bin/oj`（§3） |
| `ojm init` / `ojm vendor` 末尾出现「oj 二进制自检失败」告警 | release 二进制缺陷，cli ≥ 0.1.4 的安装后冒烟主动暴露 | 同上；v0.1.12 起不应再出现。告警不阻断，`ojm init` 仍已产出工程 |
| `ojm api --check` 报 `handler 未登记`（`auth/*`、`web/*`） | 内置模块有意无契约，而工程缺豁免清单 | cli ≥ 0.1.5 的 `ojm init` 已内置 `api/.ojm-api-exempt.json`；旧工程手工补（`{"modules":["web"],"paths":["/auth/*"]}`，§4） |
| 登出 / 回跳登录落空，`/login` 空白或 404 | 工程缺 `login` 模块——shell 宿主只消费模块路由，不挂 runtime 内置登录兜底 | 保留 `web.config.ts` 的 `login` 模块（cli ≥ 0.1.5 的 `ojm init` 已内置 `web/src/login`，§5） |
| 登录后 / 点 logo 跳 `/home` 落 React Router 错误边界 | shell 预构建把 `VITE_BASE_HOME_PATH` 定为 `/home`，而工程缺 home 模块 | 保留 `web.config.ts` 的 `home` 模块（cli ≥ 0.1.5 的 `ojm init` 已内置 `web/src/home`，§5） |
| 通知铃请求 404 / `no route matched` | 缺 root 级 `/api/notifications` 端点（runtime 未注册 provider 时走内置兜底） | cli ≥ 0.1.5 的 `ojm init` 已内置 `api/src/notifications`（root 级 handler + 表，参考 playground notification，§5） |
| `ojm api` 报 `Cannot find package '@oj-module/runtime/contract'` | 工程 devDeps 缺 `contract` | 新版 `ojm init` 已内置；旧工程手动加并 `pnpm install` |
| `typecheck` 报 `Property 'env' does not exist on type 'ImportMeta'` | 缺 `env.d.ts` / 未进 tsconfig include | 新版 `ojm init` 已内置；旧工程补 `env.d.ts` 并加进 `include` |
| `@types/react` / `typescript` 为 `*` | 宿主 versions.json 未收录 | 安装后钉成实际版本 |
| 登录 401 且非 `invalid credentials` | `/auth/*` 不在 `anonymous_paths` | 补进 `api/config.yaml` 后重启 |
| 新增后端模块目录后接口 404 | 目录镜像路由未热加载 | 重启 `ojm dev` |
| DELETE 请求 405 | 方法名写成 `delete` | 改为 `del` |
| `ojm api` 报 apiPrefix 与目录名不符 | 违反 AC-D9 | 改 `apiPrefix` 或移动契约目录 |
| 迁移账本落后拒启（M004） | release `verify` 门禁 | 先 `oj migrate -c api/config.yaml -d api/dist` |
| `ojm init`/`ojm vendor` 报「上游 @oj-bin/oj 的 latest 是 vX，低于 ojm 要求的最低版本 v0.1.73」 | npm 通道发布滞后于 `MIN_OJ_VERSION` 门禁（门禁钉最新发布版，ojm 不做兼容分支） | 本机已装 ≥ 门禁的 oj 时：把 `bin/{oj,devkit/,plugins/,.oj-version}` 预置进工程再跑 init（bin/oj 存在即跳过 vendor）；否则等上游发布或降级 cli |
| `pnpm install` 报 `ERR_PNPM_NO_MATCHING_VERSION ... @oj-module/cli@0.1.20` | 验证的是未发布版本，npm 上没有 | 删 devDeps 的 cli（源码 bin 直跑）+ runtime 装后手工 symlink 到仓库 `packages/runtime`；勿用 `file:`（两包的 `catalog:` 依赖只对 workspace 成员解析，报 `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`） |
| `oj build` 报 `module '_shared' missing manifest.yaml` | 模板里残留**空目录**（git 不跟踪空目录，删文件不删目录），init 连空目录一起拷进工程，oj 把每个 api/src 子目录当模块 | 删模板里的空目录；cli ≥ 0.1.20 的 `copyTemplates` 已加空目录跳过防护（`dirHasFiles`） |
| `ojm api --check` 报 `routes.js 与契约路由表不一致——dist 缺：GET notifications/` | 契约侧 fullPath 对模块根路径带尾斜杠（`stripBase` 的 `rel || "/"` → `/notifications/`），dist pattern 无斜杠（`notifications`），键不等误报；且豁免原只过滤「dist 多」 | cli ≥ 0.1.20 已修：第三腿双侧尾斜杠规范化 + 豁免对「dist 缺/dist 多」对称过滤（回归测试见 `tests/cli/contract-check.test.ts`） |
| 手工改过 `openapi.json`（`del`→`delete`、operationId 改名）后 `--check` 漂移 | oj ≤ 0.1.72 的 `oj openapi` 产出非法 `"del"` 操作键 | 升级 oj ≥ 0.1.73（`del`→`delete` 归一）后删手工改动重生成；client 用原生 operationId 派生名 |

## 10. 复跑脚本（TL;DR）

```bash
set -e
export VERIFY_DIR=/tmp/ojm-verify OJM_REPO=/Users/ever/git/only-js/oj-module
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
# npm 通道 oj 低于门禁时先预置（§0 旁路 1）：mkdir my-books/bin && cp ~/.local/share/oj/oj my-books/bin/oj
#   && cp -R ~/.local/share/oj/{devkit,plugins} my-books/bin/ && printf 'v0.1.74\n' > my-books/bin/.oj-version
node "$OJM_REPO/packages/cli/bin/ojm.mjs" init my-books --yes
cd my-books && pnpm install
./bin/oj --version
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello \
  && printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts \
  && printf 'name: web\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml \
  && ./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out   # §3 探针（坏二进制约在此 panic）
# …补 books 后端（.schema 入参 + 平级 .response 出参）→ ./bin/oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json
#   → ojm api（+ --check）→ 补前端 →
node "$OJM_REPO/packages/cli/bin/ojm.mjs" build && npx tsc --noEmit -p tsconfig.json && node "$OJM_REPO/packages/cli/bin/ojm.mjs" dev
```

> 每次框架发版后跑一遍本文档，把 §「最近一次基线」更新为新版本与结果。
