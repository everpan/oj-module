# 框架端到端验证手册（可重复演练）

> **用途**：框架升级（`contract`/`runtime`/`shell`/`cli` 发新版，或 oj 升级）后，**从零**跑通「脚手架 → 依赖 → 契约 → 后端 → 前端 → 构建 → 运行」，一次确认整条链路没有回归。
> **配套**：[`framework-development-guide.md`](./framework-development-guide.md)（原理）、[`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md)（跟做）。
> **原则**：每一步都有**可判定通过/失败的检查点**，不要只看命令退出码，要核对产物。

### 最近一次基线（记录用，后续对照）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | `contract`/`runtime`/`shell`/`cli` 均 `0.1.3` |
| oj | `0.1.11`（**自建**，见 §4 高危检查点） |
| 结果 | 全链路通过；发现并修复 2 个脚手架缺陷（缺 `contract` 依赖、缺 `env.d.ts`） |

---

## 0. 准备（干净目录）

```bash
export VERIFY_DIR=/tmp/ram-verify
export RAM_REPO=/Users/ever/git/web/react-antd-module   # 按实际改
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
```

需要：Node 18+、pnpm、**网络**（下载 oj 与 npm 包）。预计 5–10 分钟。

## 1. 脚手架（`ram init`）

```bash
# 用源码 CLI（验证当前代码）；若验证发布包，改 `npx --package @react-antd-module/cli ram init`
node "$RAM_REPO/packages/cli/bin/ram.mjs" init my-books --yes
```

**检查点**

- [ ] 退出码 0，末行提示 `登录 admin / 123456`
- [ ] 目录齐全：`api/src/{_platform,auth,web}`、`modules/src/demo`、`modules.config.ts`、`tsconfig.json`、`global.d.ts`、`env.d.ts`、`bin/oj`、`bin/.oj-version`、`.claude/skills/oj-api-dev/`
- [ ] `package.json` 的 devDependencies **包含** `@react-antd-module/{cli,contract,runtime,shell}`，且值**不是 `*`**
- [ ] 若出现「`@types/react` / `typescript` 回退 `*`」告警 → 记下，安装后必须钉版

## 2. 安装依赖

```bash
cd my-books && pnpm install
```

**检查点**

- [ ] `node_modules/.bin/ram`、`node_modules/.bin/tsc` 存在
- [ ] 安装日志里 4 个 `@react-antd-module/*` 版本与 `versions.json` 一致
- [ ] `pnpm exec ram info` 输出宿主版本矩阵 + 模块清单，无报错
- [ ] 处理 §1 的 `*` 告警：把 `@types/react` / `typescript` 钉成实际安装版本

## 3. ⚠️ oj 二进制可用性（**高危检查点，最容易整条链路失败**）

```bash
./bin/oj --version                              # 期望：oj 0.1.11
strings bin/oj | grep -c "/Users/runner"        # 期望：0（>0 高度可疑）
```

**已知缺陷**：GitHub release 的 oj 二进制由 CI 构建，JS 扩展源码被标记为
`LoadedFromFsDuringSnapshot` 且把**构建机路径**烤进二进制；在非 CI 机器上
初始化 JS 运行时报：

```
Failed to initialize a JsRuntime: No such file or directory (os error 2)
```

`./bin/oj --version` **仍会成功**（Rust 侧），所以必须向下走一步才会暴露。
**最小复现探针**（必须有至少一个 `api.ts`，否则 `oj build` 不会初始化 JsRuntime）：

```bash
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello
printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts
printf 'name: web\ndesc: probe\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml
./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out 2>&1 | head -5
# 坏二进制：Failed to initialize a JsRuntime: No such file or directory (os error 2)
# 好二进制：oj build: web v0.1.0 → ... (1 api file(s))
```

**处置**：用**自建** oj 覆盖 `bin/oj`（`cargo build --release`，产物在
`only-js/target/release/oj`），然后重跑这些检查点直到通过。上游修复前，
release 二进制不可用于外部工程。

> 通过后可继续；否则后面的 `ram build` / `ram dev` 必然失败。

## 4. 契约 → 前端 client

在 `api/src/books/` 下补 6 个后端文件 + 1 个 `contract.ts`（照抄
[`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md) 第 3–4 节），然后：

```bash
pnpm exec ram api
```

**检查点**

- [ ] 输出「契约 1 份；写入 4 个文件」
- [ ] 产物存在：`modules/src/books/api/client.ts`、`client.schemas.ts`、`api/src/books/routes.json`、`api/src/books/openapi.yaml`
- [ ] `client.ts` 导出 `listBooks` / `ListBooksQuery` / `ListBooksData`（命名 = Pascal(端点名) + Query/Body/Data）
- [ ] `pnpm exec ram api --check` 退出码 0（无 drift）

> 若报 `Cannot find package '@react-antd-module/contract'` → 见 §7 排障（脚手架/依赖问题）。

## 5. 前端模块

补 `modules/src/books/{entry.ts,locales/*,pages/index.tsx}` 并注册进
`modules.config.ts`（照抄 tutorial 第 5 节），然后：

```bash
pnpm exec ram build
pnpm exec tsc --noEmit -p tsconfig.json     # typecheck
```

**检查点**

- [ ] `ram build`：`oj build` 列出 4 个模块（`_platform/auth/books/web`），其中 books `2 api file(s)`
- [ ] 输出「已合并宿主站点 → modules/dist」「构建 books@0.1.0」「清单已生成」
- [ ] `modules/dist/` 含 `index.html`、`assets/`、`modules/`、`modules.json`、`versions.json`
- [ ] `modules/dist/modules/books/0.1.0/entry.js` 存在（带 `integrity`）
- [ ] `modules.json` 中 books 条目 `peerRuntime` 与宿主 runtime 版本相容
- [ ] **typecheck 0 error**（含生成的 `client.ts`）

## 6. 运行与联调（`ram dev`）

```bash
pnpm exec ram dev        # 默认 5174；oj 9778
# 另一个终端：
TOKEN=$(curl -s -X POST http://127.0.0.1:9778/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"123456"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.access_token))")
curl -s "http://127.0.0.1:9778/api/books/list?keyword=设计" -H "authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:9778/api/books/create -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"title":"重构","author":"Martin Fowler","year":2019}'
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9778/api/books/list   # 期望 401
```

**检查点**

- [ ] dev 日志：`seed ok module="books"`、路由表含 `GET /api/books/list` / `POST /api/books/create`、`oj server listening`
- [ ] 登录返回 `code:0` 且 `data.access_token` 非空
- [ ] 列表过滤返回 1 条（`设计数据密集型应用`）
- [ ] 新增返回 `{"ok":true}`，全量列表变 4 条
- [ ] 无 token 返回 **401**
- [ ] `http://localhost:5174/` 200，importmap 含 `@react-antd-module/runtime`，`/modules/books/0.1.0/entry.js` 200

用完停服：`pkill -f "ram dev"; pkill -f "bin/oj"`。

## 7. 预览（可选，验证 release 形态）

```bash
pnpm exec ram preview    # oj migrate（verify 门禁）→ server + 静态兜底
```

**检查点**：migrate 成功；站点可访问；release 下路由来自 `api/dist/**/routes.js`（目录镜像不存在）。

## 8. 一次通过判据（汇总清单）

- [ ] `ram init` 成功，且 devDeps **含 `contract`**、**含 `env.d.ts`**
- [ ] `pnpm install` 成功，4 包版本一致
- [ ] oj 二进制通过 §3 探针（JsRuntime 能初始化）
- [ ] `ram api` 生成 4 产物；`--check` 无 drift
- [ ] `ram build` 产出 4 后端模块 + 合并站点 + `modules.json`
- [ ] `typecheck` 0 error
- [ ] `ram dev`：登录 / 列表 / 新增 / 401 全对
- [ ] （可选）`ram preview` 通过 migrate 与服务

## 9. 已知坑与处置

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| `Failed to initialize a JsRuntime: No such file or directory` | release oj 二进制烤了构建机路径 | 用自建 oj 覆盖 `bin/oj`（§3）；上游修复前不用 release |
| `ram api` 报 `Cannot find package '@react-antd-module/contract'` | 工程 devDeps 缺 `contract` | 新版 `ram init` 已内置；旧工程手动加并 `pnpm install` |
| `typecheck` 报 `Property 'env' does not exist on type 'ImportMeta'` | 缺 `env.d.ts` / 未进 tsconfig include | 新版 `ram init` 已内置；旧工程补 `env.d.ts` 并加进 `include` |
| `@types/react` / `typescript` 为 `*` | 宿主 versions.json 未收录 | 安装后钉成实际版本 |
| 登录 401 且非 `invalid credentials` | `/auth/*` 不在 `anonymous_paths` | 补进 `api/config.yaml` 后重启 |
| 新增后端模块目录后接口 404 | 目录镜像路由未热加载 | 重启 `ram dev` |
| DELETE 请求 405 | 方法名写成 `delete` | 改为 `del` |
| `ram api` 报 apiPrefix 与目录名不符 | 违反 AC-D9 | 改 `apiPrefix` 或移动契约目录 |
| 迁移账本落后拒启（M004） | release `verify` 门禁 | 先 `oj migrate -c api/config.yaml -d api/dist` |

## 10. 复跑脚本（TL;DR）

```bash
set -e
export VERIFY_DIR=/tmp/ram-verify RAM_REPO=/Users/ever/git/web/react-antd-module
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
node "$RAM_REPO/packages/cli/bin/ram.mjs" init my-books --yes
cd my-books && pnpm install
./bin/oj --version
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello \
  && printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts \
  && printf 'name: web\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml \
  && ./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out   # §3 探针（坏二进制约在此 panic）
# …补 books 后端 + 契约 → pnpm exec ram api → 补前端 → 
pnpm exec ram build && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec ram dev
```

> 每次框架发版后跑一遍本文档，把 §「最近一次基线」更新为新版本与结果。
