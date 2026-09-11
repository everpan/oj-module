# 框架端到端验证手册（可重复演练）

> **用途**：框架升级（`contract`/`runtime`/`shell`/`cli` 发新版，或 oj 升级）后，**从零**跑通「脚手架 → 依赖 → 契约 → 后端 → 前端 → 构建 → 运行」，一次确认整条链路没有回归。
> **配套**：[`framework-development-guide.md`](./framework-development-guide.md)（原理）、[`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md)（跟做）。
> **原则**：每一步都有**可判定通过/失败的检查点**，不要只看命令退出码，要核对产物。

### 最近一次基线（记录用，后续对照）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | `cli` `0.1.5`（本次模板修复：home/login 前端模块 + notifications 端点 + 豁免清单；home 用统计卡片 + 折线/柱/饼图演示共享依赖矩阵）+ `runtime`/`shell` `0.1.4` + `contract` `0.1.3`（四包均已按本手册复跑） |
| oj | `0.1.12`（**官方 release**）——v0.1.11 及更早的 release 二进制有构建机路径缺陷，v0.1.12 已修复（见 §3） |
| 结果 | 全链路通过（§1–§7）：release 二进制在非构建机可用，`ojm dev` / `ojm preview` 均正常。发现并修复 4 个脚手架缺陷（模板缺 `api/.ojm-api-exempt.json` → `ojm api --check` 误报；模板缺 `modules/src/login` → `/login` 无路由可跳；模板缺 root 级 `api/src/notifications` → 通知铃 404；模板缺 `modules/src/home` → 登录回跳 `/home` 落错误边界，见 §4/§5）与 2 处手册判据过期（§3 泄漏计数、§4 未注明豁免文件） |

<details>
<summary>上一次基线（0.1.3 / oj 0.1.11 自建）</summary>

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
export OJM_REPO=/Users/ever/git/web/react-antd-module   # 按实际改
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
```

需要：Node 18+、pnpm、**网络**（下载 oj 与 npm 包）。预计 5–10 分钟。

## 1. 脚手架（`ojm init`）

```bash
# 用源码 CLI（验证当前代码）；若验证发布包，改 `npx --package @oj-module/cli ojm init`
node "$OJM_REPO/packages/cli/bin/ojm.mjs" init my-books --yes
```

**检查点**

- [ ] 退出码 0，末行提示 `登录 admin / 123456`
- [ ] 目录齐全：`api/src/{_platform,auth,web,notifications}`、`api/.ojm-api-exempt.json`、`modules/src/{demo,home,login}`、`modules.config.ts`、`tsconfig.json`、`global.d.ts`、`env.d.ts`、`bin/oj`、`bin/.oj-version`、`.claude/skills/oj-api-dev/`
- [ ] `package.json` 的 devDependencies **包含** `@oj-module/{cli,contract,runtime,shell}`，且值**不是 `*`**
- [ ] 若出现「`@types/react` / `typescript` 回退 `*`」告警 → 记下，安装后必须钉版
- [ ] **未出现「oj 二进制自检失败」告警**（cli ≥ 0.1.4 安装后自动冒烟）；若出现，按 §3 换自建二进制

## 2. 安装依赖

```bash
cd my-books && pnpm install
```

**检查点**

- [ ] `node_modules/.bin/ojm`、`node_modules/.bin/tsc` 存在
- [ ] 安装日志里 4 个 `@oj-module/*` 版本与 `versions.json` 一致
- [ ] `pnpm exec ojm info` 输出宿主版本矩阵 + 模块清单，无报错
- [ ] 处理 §1 的 `*` 告警：把 `@types/react` / `typescript` 钉成实际安装版本

## 3. oj 二进制可用性（检查点）

```bash
./bin/oj --version                              # 期望：oj 0.1.12（或更高）
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

**处置**：优先 `ojm vendor` 拉 **≥ v0.1.12** 的 release。若仍报 ENOENT（版本过旧或未换包），
用**自建** oj 覆盖 `bin/oj`（`cargo build --release`，产物在 `only-js/target/release/oj`），
然后重跑这些检查点直到通过。

> **自 cli 0.1.4 起已自动化**：`ojm vendor` / `ojm init` 安装后（以及「已是该版本，跳过」时）
> 会自动执行等价的 `probeOjRuntime` 冒烟；失败打印人话告警与处置指引，**不阻断**安装
> （便于用户直接替换 `bin/oj`）。本节手工探针用于 CI 与不经 cli 的场景。

> 完整根因与修复方案（可转上游）：[`oj-release-binary-defect-report.md`](./oj-release-binary-defect-report.md)。

> 通过后可继续；否则后面的 `ojm build` / `ojm dev` 必然失败。

## 4. 契约 → 前端 client

在 `api/src/books/` 下补 6 个后端文件 + 1 个 `contract.ts`（照抄
[`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md) 第 3–4 节），然后：

```bash
pnpm exec ojm api
```

**检查点**

- [ ] 输出「契约 1 份；写入 4 个文件」
- [ ] 产物存在：`modules/src/books/api/client.ts`、`client.schemas.ts`、`api/src/books/routes.json`、`api/src/books/openapi.yaml`
- [ ] `client.ts` 导出 `listBooks` / `ListBooksQuery` / `ListBooksData`（命名 = Pascal(端点名) + Query/Body/Data）
- [ ] 工程根存在 `api/.ojm-api-exempt.json`（见下）
- [ ] `pnpm exec ojm api --check` 退出码 0（无 drift）

> **全新工程注意（已记录在案的脚手架缺陷）**：`ojm api --check` 会把脚手架自带的
> `auth/*`（login/refresh/logout）与 `web/*`（hello/user-info/get-async-routes）handler
> 判为「未登记」并各报 error——这些内置端点有意不写业务契约，需在工程根
> `api/.ojm-api-exempt.json` 声明豁免（与 `apps/playground-oj` 同款）：
>
> ```json
> { "modules": ["web"], "paths": ["/auth/*"] }
> ```
>
> **`ojm init` 自 cli 0.1.5 起已内置该文件**（更早版本缺失，属已修复的脚手架缺陷）。
> 旧脚手架/旧工程若缺，手工补上即可——否则 §4/§8 的 `--check` 检查点会因 6 个
> `handler 未登记` 失败。补上后 `--check` 输出 `0 error / 0 warn`。
> 豁免只做 error→skip 降级，不会引入新错误。

> 若报 `Cannot find package '@oj-module/runtime/contract'` → 见 §7 排障（脚手架/依赖问题）。

## 5. 前端模块

补 `modules/src/books/{entry.ts,locales/*,pages/index.tsx}` 并注册进
`modules.config.ts`（照抄 tutorial 第 5 节），然后：

```bash
pnpm exec ojm build
pnpm exec tsc --noEmit -p tsconfig.json     # typecheck
```

**检查点**

- [ ] `ojm build`：`oj build` 列出 5 个模块（`_platform/auth/books/notifications/web`），其中 books `2 api file(s)`、notifications `1 api file(s)`
- [ ] 输出「已合并宿主站点 → modules/dist」「构建 books@0.1.0」「清单已生成」
- [ ] `modules/dist/` 含 `index.html`、`assets/`、`modules/`、`modules.json`、`versions.json`
- [ ] `modules/dist/modules/books/0.1.0/entry.js` 存在（带 `integrity`）
- [ ] `modules.json` 含 `home` / `demo` / `login` / `books`（**`home` / `login` 不可少**：shell 预构建把 `VITE_BASE_HOME_PATH` 定为 `/home` 且不挂 runtime 内置登录兜底，缺则登录回跳 / 登出 / 点 logo 落错误边界）
- [ ] `modules.json` 中 books 条目 `peerRuntime` 与宿主 runtime 版本相容
- [ ] **typecheck 0 error**（含生成的 `client.ts`）

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

- [ ] dev 日志：`seed ok module="books"`、路由表含 `GET /api/books/list` / `POST /api/books/create`、`oj server listening`
- [ ] 登录返回 `code:0` 且 `data.access_token` 非空
- [ ] 登录成功后回跳 `/home` 正常渲染（不落 React Router 错误边界），页面含统计卡片 + 折线/柱/饼图（共享依赖矩阵演示）
- [ ] 列表过滤返回 1 条（`设计数据密集型应用`）
- [ ] 新增返回 `{"ok":true}`，全量列表变 4 条
- [ ] `GET /api/notifications`（带 token）返回 `code:0` + 数组（runtime 通知铃 root 级兜底；缺端点会 404 `no route matched`）
- [ ] 无 token 返回 **401**
- [ ] `http://localhost:5174/` 200，importmap 含 `@oj-module/runtime`，`/modules/books/0.1.0/entry.js` 200
- [ ] `/modules/login/0.1.0/entry.js` 200，且 `/login` 能渲染模块登录页（登出后可跳回；缺 login 模块则落空）

用完停服：`pkill -f "ojm dev"; pkill -f "bin/oj"`。

## 7. 预览（可选，验证 release 形态）

```bash
pnpm exec ojm preview    # oj migrate（verify 门禁）→ server + 静态兜底
```

**检查点**：migrate 成功；站点可访问；release 下路由来自 `api/dist/**/routes.js`（目录镜像不存在）。

## 8. 一次通过判据（汇总清单）

- [ ] `ojm init` 成功，且 devDeps **含 `contract`**、**含 `env.d.ts`**
- [ ] `pnpm install` 成功，4 包版本一致
- [ ] oj 二进制通过 §3 探针（JsRuntime 能初始化）
- [ ] `ojm api` 生成 4 产物；`--check` 无 drift（内置 `auth`/`web` 需 `api/.ojm-api-exempt.json` 豁免，见 §4）
- [ ] `ojm build` 产出 4 后端模块 + 合并站点 + `modules.json`
- [ ] `typecheck` 0 error
- [ ] `ojm dev`：登录 / 列表 / 新增 / 401 全对
- [ ] （可选）`ojm preview` 通过 migrate 与服务

## 9. 已知坑与处置

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| `Failed to initialize a JsRuntime: No such file or directory` | ≤ v0.1.11 的 release oj 二进制烤了构建机路径（v0.1.12 已修复） | 用 ≥ v0.1.12 的 release（`ojm vendor`）；旧版用自建 oj 覆盖 `bin/oj`（§3） |
| `ojm init` / `ojm vendor` 末尾出现「oj 二进制自检失败」告警 | release 二进制缺陷，cli ≥ 0.1.4 的安装后冒烟主动暴露 | 同上；v0.1.12 起不应再出现。告警不阻断，`ojm init` 仍已产出工程 |
| `ojm api --check` 报 `handler 未登记`（`auth/*`、`web/*`） | 内置模块有意无契约，而工程缺豁免清单 | cli ≥ 0.1.5 的 `ojm init` 已内置 `api/.ojm-api-exempt.json`；旧工程手工补（`{"modules":["web"],"paths":["/auth/*"]}`，§4） |
| 登出 / 回跳登录落空，`/login` 空白或 404 | 工程缺 `login` 模块——shell 宿主只消费模块路由，不挂 runtime 内置登录兜底 | 保留 `modules.config.ts` 的 `login` 模块（cli ≥ 0.1.5 的 `ojm init` 已内置 `modules/src/login`，§5） |
| 登录后 / 点 logo 跳 `/home` 落 React Router 错误边界 | shell 预构建把 `VITE_BASE_HOME_PATH` 定为 `/home`，而工程缺 home 模块 | 保留 `modules.config.ts` 的 `home` 模块（cli ≥ 0.1.5 的 `ojm init` 已内置 `modules/src/home`，§5） |
| 通知铃请求 404 / `no route matched` | 缺 root 级 `/api/notifications` 端点（runtime 未注册 provider 时走内置兜底） | cli ≥ 0.1.5 的 `ojm init` 已内置 `api/src/notifications`（root 级 handler + 表，参考 playground notification，§5） |
| `ojm api` 报 `Cannot find package '@oj-module/runtime/contract'` | 工程 devDeps 缺 `contract` | 新版 `ojm init` 已内置；旧工程手动加并 `pnpm install` |
| `typecheck` 报 `Property 'env' does not exist on type 'ImportMeta'` | 缺 `env.d.ts` / 未进 tsconfig include | 新版 `ojm init` 已内置；旧工程补 `env.d.ts` 并加进 `include` |
| `@types/react` / `typescript` 为 `*` | 宿主 versions.json 未收录 | 安装后钉成实际版本 |
| 登录 401 且非 `invalid credentials` | `/auth/*` 不在 `anonymous_paths` | 补进 `api/config.yaml` 后重启 |
| 新增后端模块目录后接口 404 | 目录镜像路由未热加载 | 重启 `ojm dev` |
| DELETE 请求 405 | 方法名写成 `delete` | 改为 `del` |
| `ojm api` 报 apiPrefix 与目录名不符 | 违反 AC-D9 | 改 `apiPrefix` 或移动契约目录 |
| 迁移账本落后拒启（M004） | release `verify` 门禁 | 先 `oj migrate -c api/config.yaml -d api/dist` |

## 10. 复跑脚本（TL;DR）

```bash
set -e
export VERIFY_DIR=/tmp/ojm-verify OJM_REPO=/Users/ever/git/web/react-antd-module
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
node "$OJM_REPO/packages/cli/bin/ojm.mjs" init my-books --yes
cd my-books && pnpm install
./bin/oj --version
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello \
  && printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts \
  && printf 'name: web\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml \
  && ./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out   # §3 探针（坏二进制约在此 panic）
# …补 books 后端 + 契约 → pnpm exec ojm api → 补前端 → 
pnpm exec ojm build && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec ojm dev
```

> 每次框架发版后跑一遍本文档，把 §「最近一次基线」更新为新版本与结果。
