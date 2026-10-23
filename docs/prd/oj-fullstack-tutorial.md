# 实战演练：从零构建一个 oj 前后端应用（books 图书管理）

> **配套手册**：[`framework-development-guide.md`](./framework-development-guide.md)（包的职责与原理）。本文只讲「怎么一步步做出来」。
> **产出**：一个可登录、可查询、可新增的「图书管理」全栈应用（前端模块 + oj 后端 + SQLite）。
> **前置**：Node 18+、pnpm、会 React + TypeScript。**不需要**先懂 oj 或本框架内部。
> **布局口径**：本文按当前脚手架（cli ≥ 0.2.20）的 **module-root 布局**写——工程根一份 `config.yaml`，唯一源码树 `src/<name>/{api,web}`。旧平铺布局（`api/src` + `web/src`）见 devkit 手册 §3.10 迁移指南。

### 你会走的完整链路

```
浏览器
  └─ shell（importmap：react/antd/runtime 单例）
       └─ runtime（加载 books 模块、跑生命周期、渲染页面）
            └─ books 模块（pages → 生成的 __client）
                 └─ /api/books/*（Bearer token 自动带上）
                      └─ oj 后端（src/books/api/** 目录镜像路由）
                           └─ SQLite（books 表）
```

---

## 0. 演练总览

我们要做的功能：

| 功能 | 前端 | 后端 | 生成的 client |
| --- | --- | --- | --- |
| 图书列表（关键词过滤） | 表格 | `GET /api/books/list` | `booksListGet` |
| 新增图书 | 表单提交 | `POST /api/books/create` | `booksCreatePost` |

演示的顺序刻意是 **后端 → 契约 → 前端**：先把数据与接口做实，再把接口钉成契约生成前端 client，最后写页面。这是本框架推荐的开发顺序（契约是前后端的边界）。

---

## 1. 创建工程

```bash
# 方式一：用发布到 npm 的脚手架（包内 bin 名是 ojm）
npx --yes --package @oj-module/cli ojm init my-books --yes
# 方式二：本仓库内直接用源码
node packages/cli/bin/ojm.mjs init my-books --yes

cd my-books
pnpm install
pnpm dev            # 前端 devServer(5174) + oj 后端（9778），src/** 保存即热更
```

浏览器打开 `http://localhost:5174`，用脚手架种子账号登录：**superadmin / 123456**（四个内置角色账号 superadmin/admin/editor/viewer，账号名=角色名、口令均 123456、免首登改密，见 `src/_platform/api/seed.sql`；生产部署须改密或删除）。

> `ojm init` 是**幂等补缺**：对已有工程重跑只补缺失文件。首次会联网下载 oj 二进制到 `bin/oj`（sha256 校验），并现场签发本地 dev 证书（`config/` 三件套）。
>
> ⚠️ **若 `ojm build` / `ojm dev` 报 `Failed to initialize a JsRuntime: No such file or directory`**：这是**发布版 oj 二进制**的已知缺陷（CI 构建把构建机路径烤进了二进制，`bin/oj --version` 仍正常）。处置：换成自建 oj（`cargo build --release` 后把 `target/release/oj` 覆盖到 `bin/oj`）。**cli ≥ 0.1.4 会在 `ojm init` / `ojm vendor` 安装后自动做这项自检并打印告警**，无须等到 `ojm build` 才发现。完整判定与复现见 [`framework-verification-playbook.md`](./framework-verification-playbook.md) §3。

### 1.1 脚手架目录

```
my-books/
├── package.json           # scripts: dev/build/preview/info/typecheck/new/bundle
├── config.yaml            # oj 服务配置（工程根；config 内相对路径相对本文件）
├── config/                # 本地 dev 证书三件套（public.pem / cert.jws / private.pem）
├── pnpm-workspace.yaml
├── tsconfig.json / tsconfig.paths.json
├── global.d.ts            # 后端 oj 全局（db/json/http…）的类型声明
├── env.d.ts               # import.meta.env 类型
├── openapi.json           # 契约唯一事实源（oj openapi 产物，勿手改）
├── .ojm-api-exempt.json   # 契约对账豁免清单（ojm api --check 用）
├── web.config.ts          # 前端配置（可选覆盖：加载顺序/siteBase/htmlTransform）；模块清单不靠它
├── seed.mysql.sql / seed.pg.sql  # 方言种子（部署到 mysql/pg 用；sqlite 用模块内 seed.sql）
├── .claude/skills/{oj-api-dev,ojm-module-dev}/   # 后端 / 模块开发手册（按需读）
├── src/                   # 唯一源码树：一模块一目录，api/web 恰好一侧有内容
│   ├── _platform/api/     # 框架级共有表（users 等）+ 生命周期引擎 + 平台编排面（无业务路由前缀）
│   ├── auth/api/          # login/refresh/logout（业务路由）+ _shared/session.ts
│   ├── oj-market/         # 市场页（本站点自供市场时的卡片/安装 UI）
│   ├── notification/      # 通知模块（api/ 读写 + web/ 注册通知 provider）
│   ├── system/ personal-center/ web/ demo/   # 框架内置业务模块
│   └── home/web/ login/web/  # 首页 / 登录（shell 预构建的 HOME 与登录路由目标，不可删）
├── cdn/                   # 本地模拟市场源（config.yaml 的 /cdn 挂载直出）
├── dist/api/              # oj build 产物（build 后出现）
├── dist/web/              # 构建全站：index.html + assets/ + modules/ + modules.json + versions.json
├── db.sqlite              # 自动创建（相对 config.yaml 所在目录）
└── bin/oj                 # oj 可执行文件（init 下载，不入库）
```

> **init 的告警要处理**：若控制台出现「`@types/react` / `typescript` 未在宿主 versions.json 中，模板回退 `"*"`」，`pnpm install` 后请把这两个 devDependency 钉成实际安装版本（`"*"` 不可复现）。

---

## 2. 认识脚手架（动手前先读一遍）

### 2.1 `package.json` 的脚本

```jsonc
{
  "scripts": {
    "dev": "ojm dev",            // 开发：5174 devServer（/api、/cdn 反代 oj）+ oj 子进程，热更
    "build": "ojm build",        // 构建：oj build → dist/api + 前端全站合并 → dist/web
    "preview": "ojm preview",    // 预览：oj migrate → oj serve 单服务（API + 静态 SPA 同进程）
    "info": "ojm info",          // 版本矩阵 + 模块清单
    "typecheck": "tsc --noEmit -p tsconfig.json",       // 前端（含生成的 __client）
    "typecheck:api": "tsc --noEmit -p src/tsconfig.json", // 后端
    "new": "ojm new",            // 快速生成方案骨架
    "bundle": "ojm build --bundle"  // 打方案分发包
  }
}
```

### 2.2 `config.yaml`（oj 服务配置，工程根）

```yaml
# 节选（完整文件与逐字段注释看模板原文；config 内相对路径相对本文件所在目录）
mounts:
  - prefix: /cdn
    web: ./cdn            # 本地模拟市场源；生产删掉并把 framework.market_cdn_url 指向真 CDN
server:
  host: 127.0.0.1
  port: 9778
  migrate_on_start: auto   # dev 缺省；release 缺省 verify（账本落后拒启，先 oj migrate）
  schema_validation: true  # 契约 .schema 运行期校验开关（§3 会写 .schema）
db:
  default: 'sqlite://db.sqlite'
auth:
  jwt_secret: <init 随机生成或密封>  # 生产必须更换
  anonymous_paths:            # 必须显式匿名的业务路由（否则被自家 Bearer 守卫拦成 401）
    - /auth/login
    - /auth/refresh
    - /auth/logout
```

> **易错点**：`auth` 的 login/refresh/logout 是**业务路由**，不是在框架内部实现的。新工程必须保证它们在 `anonymous_paths` 里，否则登录会 401。
>
> **为什么 mounts 里没有 /api 挂载**：本工程是 `src/<name>/{api,web}` 布局，源码形态由 `ojm dev` 用 `--module-root src` 供给、产物形态由 `ojm preview` 用 `--api-path dist/api` 供给（两者与 mounts 的 api 项互斥，同时出现会报「module declared in multiple places」）。手写部署（不经 ojm）时才需要自己加回一条 `- prefix: /api` + `api: dist`。

### 2.3 oj 后端的三个基础概念

**① 目录镜像路由**：`src/<name>/api/<路径...>/api.ts` → `/api/<name>/<路径...>`。

```
src/web/api/hello/api.ts        →  GET|POST … /api/web/hello
src/books/api/list/api.ts       →  /api/books/list
src/books/api/create/api.ts     →  /api/books/create
```

**② 端点文件形状**：默认导出一个对象，键是 HTTP 方法（写 `del` 不是 `delete`）；入参挂 `.schema`（params/query/body），出参挂**平级 `.response`**——oj 运行期按 `.schema` 校验入参（违反即 400），并供 `oj openapi` 生成契约：

```ts
const list = {
  async get() { /* ... */ },
};
list.get.schema = { query: { type: "object", properties: { keyword: { type: "string" } } } };
list.get.response = { /* data payload 的 JSON Schema */ };
export default list;
// 方法名对照：GET→get  POST→post  PUT→put  PATCH→patch  DELETE→del
// 写错方法名该请求返回 405；裸具名导出（export async function get）不在路由表里——必须 default export
```

**③ 注入的全局**（无需 import）：

| 全局 | 用途 |
| --- | --- |
| `db.query(sql, params)` | 执行 SQL，返回行数组（sqlite 驱动） |
| `json.ok(data)` / `json.fail(code, msg)` | 输出统一信封 `{code,msg,data}` |
| `http.query` / `http.body` | 查询参数 / 请求体（JSON 自动 parse） |
| `http.user` | 已验签用户 `{id, roles, claims}`，未登录为 `null` |
| `http.params` / `http.param(k, d)` | 路径参数（目录镜像路由下恒空；params 段路由才有值） |
| `http.files` / `await http.file(i)` | multipart 上传 |
| `kv.get/set/del/expire` | KV 存储（auth 会话用） |
| `jwt.sign/verify`、`bcrypt.hash/verify`、`crypto.sha256Hex/randomHex` | 令牌与加密 |

### 2.4 `src/_platform/api/`（框架级共有表）

```
_platform/api/
├── manifest.yaml                     # name/desc/version + tables: [users, …]
├── schema.yaml                       # 声明式表结构（tables.<表>.columns…）
├── migrations/0001__create_users.sql # DDL 只写这里
├── seed.sql                          # 数据只写这里（四个角色账号等；幂等重放）
├── _lifecycle/                       # 方案安装/卸载/注册/验签状态机（市场链路用）
├── _shared/                          # 平台编排共享原语（站点源/账本 head 等）
└── {market,contacts,solutions}/      # 平台编排 API 面 /api/_platform/*（superadmin 门禁）
```

**两条纪律（会被校验）**：

- **DDL 进 `migrations/`，数据进 `seed.sql`**（S006）。`seed.sql` 每次启动重放，必须幂等（`INSERT OR IGNORE`），按 `;` 朴素切分，注释里也别出现分号。
- **`manifest.yaml` 的 `tables` 与 `schema.yaml` 的 `tables` 必须双向一致**（S005）。

### 2.5 `src/auth/api/`（登录链）

`login/refresh/logout` 三个端点 + `_shared/session.ts`（签发逻辑）。跨模块读 `users` 表时，`manifest.yaml` 要用 `deps` 声明归属：

```yaml
# src/auth/api/manifest.yaml
name: auth
desc: JWT 鉴权端点（业务路由）
version: 0.1.0
deps:
  _platform: ^0.1.0     # login 读 _platform.users
```

### 2.6 迁移与 seed 的应用时机

| 文件 | 何时生效 |
| --- | --- |
| `src/<name>/api/migrations/{seq:04}__{desc}.sql` | 启动（dev `migrate_on_start: auto`）/ `oj migrate`；release 默认 `verify`（账本落后拒启） |
| `src/<name>/api/seed.sql` | **每次启动重放**（仅 default 库且为 sqlite）；必须幂等 |
| `src/<name>/api/schema.yaml` | 加表/加可空列由 reconcile 自动收敛；**类型变更/改名走 migrations** |

### 2.7 模块能 import 什么：共享依赖矩阵

前端模块**只允许 import 三类东西**：`@oj-module/runtime`、**宿主共享依赖矩阵内的包**、模块自身相对路径（框架内部 `#src/*` 构建期会拦）。

矩阵内的包由宿主 importmap 提供**单例**——react / antd / runtime 全站同一实例，避免「双 React」与 Context 撕裂，所以模块工程**不得自带**这些运行时代码。常用清单：

| 分类 | 可 import 的裸说明符 |
| --- | --- |
| 硬共享（必须单例） | `react`、`react-dom`、`react-router`、`@tanstack/react-query`、`@oj-module/runtime`、`@oj-module/runtime/contract/errors` |
| UI | `antd`（含 `locale/*`、`es/locale/zh_CN` 子路径）、`@ant-design/icons`、`@ant-design/cssinjs`、`@ant-design/pro-components`、`antd-img-crop` |
| i18n / 状态 | `i18next`、`react-i18next`、`zustand`（含子路径）、`use-sync-external-store/shim` |
| 时间 / 图表 / 交互 | `dayjs`（含 `/plugin/*`）、`echarts`、`echarts/charts`、`echarts/features.js`、`echarts-for-react`、`motion`、`@dnd-kit/*`、`keepalive-for-react`、`simplebar-react`、`nprogress`、`react-countup`、`react-error-boundary`、`react-jss`、`clsx`、`tailwind-merge`、`spin-delay` |
| 工具 | `ahooks`、`ky`、`pinyin-pro` |

- **查当前版本**：`pnpm exec ojm info` → 「共享依赖版本矩阵」。
- **要让 `tsc` 通过**：矩阵只保证**运行时**由宿主提供，工程 `node_modules` 不一定有这些包 → 把用到的包加进**自己的 `devDependencies`**（版本对齐宿主）。`ojm init` 已为模板用到的那些钉好版本（antd / react / icons / react-router / react-i18next / echarts / echarts-for-react / react-countup / dayjs）。
- 脚手架 `src/home/web/` 的统计卡片 + 折线 / 柱 / 饼图就是矩阵演示（`react-countup` + `echarts` + `echarts-for-react` + `dayjs`）。
- 完整矩阵（含深路径条目与按包新增的步骤）见 [`framework-development-guide.md`](./framework-development-guide.md) §3.4。

---

## 3. 后端：新增 `books` 业务模块

### 3.1 建目录与元数据

```
src/books/
├── api/
│   ├── manifest.yaml
│   ├── schema.yaml
│   ├── migrations/0001__create_books.sql
│   ├── seed.sql
│   ├── list/api.ts
│   └── create/api.ts
└── web/                    # §5 再填
```

`src/books/api/manifest.yaml`：

```yaml
name: books
desc: 图书管理模块（演示：列表 + 新增）
version: 0.1.0
tables:
  - books
```

`src/books/api/schema.yaml`：

```yaml
# 声明本模块拥有的表（与 manifest.tables 双向一致，S005）
tables:
  books:
    pk: id
    columns:
      id: {type: integer, autoincrement: true}
      title: {type: text, null: false}
      author: {type: text, null: false}
      year: {type: integer, null: false}
      create_time: {type: integer, null: false}
```

`src/books/api/migrations/0001__create_books.sql`：

```sql
-- books 模块建表：DDL 只进 migrations（S006）。序号连续且唯一。
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  create_time INTEGER NOT NULL DEFAULT 0
);
```

`src/books/api/seed.sql`（幂等，注释里别写分号）：

```sql
INSERT OR IGNORE INTO books (id, title, author, year, create_time) VALUES (1, '深入理解计算机系统', 'Randal E. Bryant', 2016, 0);
INSERT OR IGNORE INTO books (id, title, author, year, create_time) VALUES (2, '代码之美', 'Andy Oram', 2009, 0);
INSERT OR IGNORE INTO books (id, title, author, year, create_time) VALUES (3, '设计数据密集型应用', 'Martin Kleppmann', 2017, 0);
```

### 3.2 列表端点 `src/books/api/list/api.ts`

```ts
// GET /api/books/list —— Bearer 守卫保护；keyword 模糊过滤 title/author。
// 契约：入参挂 .schema，出参挂平级 .response（oj v0.1.72+ 新约定）。
const list = {
  async get() {
    const kw = http.query.keyword;                       // query 参数（string | undefined）
    const like = kw ? `%${kw}%` : "%";
    try {
      const rows = await db.query(
        `SELECT id, title, author, year FROM books
         WHERE title LIKE ? OR author LIKE ?
         ORDER BY id ASC`,
        [like, like],
      );
      json.ok({                                          // 信封 {code:0, data}
        list: rows.map(r => ({
          id: Number(r.id),
          title: String(r.title),
          author: String(r.author),
          year: Number(r.year),
        })),
        total: rows.length,
      });
    }
    catch (e) {
      json.fail(500, String(e));
    }
  },
};

list.get.schema = {
  query: {
    type: "object",
    properties: { keyword: { type: "string" } },
  },
};

list.get.response = {
  type: "object",
  required: ["list", "total"],
  properties: {
    list: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "author", "year"],
        properties: {
          id: { type: "number" },
          title: { type: "string" },
          author: { type: "string" },
          year: { type: "number" },
        },
      },
    },
    total: { type: "number" },
  },
};

export default list;
```

### 3.3 新增端点 `src/books/api/create/api.ts`

```ts
// POST /api/books/create —— 事务式写入。
const create = {
  async post() {
    const b = (http.body ?? {}) as { title?: unknown, author?: unknown, year?: unknown };
    const title = String(b.title ?? "").trim();
    const author = String(b.author ?? "").trim();
    const year = Number(b.year ?? 0);

    if (!title || !author || !Number.isFinite(year)) {
      json.fail(400, "title 与 author 必填，year 需为数字");
      return;
    }
    try {
      await db.query(
        "INSERT INTO books (title, author, year, create_time) VALUES (?, ?, ?, ?)",
        [title, author, year, Math.floor(Date.now() / 1000)],
      );
      json.ok({ ok: true });
    }
    catch (e) {
      json.fail(500, String(e));
    }
  },
};

create.post.schema = {
  body: {
    type: "object",
    required: ["title", "author", "year"],
    properties: {
      title: { type: "string" },
      author: { type: "string" },
      year: { type: "number" },
    },
  },
};

create.post.response = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

export default create;
```

> 手写兜底校验（`if (!title…) json.fail(400)`）与 `.schema` 并存不冲突：`.schema` 把关「形状」（缺字段/类型错 → 400 且 handler 不执行），手写把关「语义」（trim 后为空 → 400）。

### 3.4 重启边界（最容易卡住新人的一点）

- 改 `src/**/api.ts` 的内容 → **保存即生效**（oj 热更）。
- **新增/删除后端模块目录**、改 `schema.yaml` / `migrations/` / `config.yaml` → **必须重启 `ojm dev`**。

所以：加完 `src/books/api/` 目录后，先 `Ctrl-C` 再 `pnpm dev`。

### 3.5 先用 curl 自测后端

```bash
# 登录拿 token（auth 已在 anonymous_paths，无需 token）
TOKEN=$(curl -s -X POST http://127.0.0.1:9778/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"superadmin","password":"123456"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.access_token))")

# 列表（带 Bearer）
curl -s "http://127.0.0.1:9778/api/books/list?keyword=设计" -H "authorization: Bearer $TOKEN"

# 新增
curl -s -X POST http://127.0.0.1:9778/api/books/create \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"重构","author":"Martin Fowler","year":2019}'
```

> 端口以 `config.yaml` 的 `server.port` 为准。返回 `{"code":0,"data":{...}}` 即成功。

---

## 4. 契约：把接口钉成契约

契约不再手写 `contract.ts`——§3 里 handler 挂的 `.schema` / `.response` 就是契约。由 oj 汇总成 `openapi.json`，再由 `ojm api` 生成前端 `__client`：

```bash
# 1) 汇总：扫描 src/ 下全部 handler 的 .schema/.response → 工程根 openapi.json
./bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json

# 2) 生成前端 client（产物：src/books/web/__client/api.ts + api.schemas.ts）
pnpm exec ojm api

# 3) 对账（CI 会跑）：生成物同步 / route 双向对账 / routes.js 无 drift
pnpm exec ojm api --check
```

> **oj 版本要求**：`--module-root` 需 oj ≥ 0.1.85；且 openapi 的裸包解析截断缺陷（module-root 下预生成 `__client` 内省 fail-fast）修复在 **0.1.86**。若第 1 步报
> `dev routes: …web/__client/api.ts: cannot resolve '@oj-module/runtime/contract/errors'`
> 即你的 oj 早于该修——`ojm vendor` 重装 ≥ 0.1.86（未发布前用含修复的本地构建覆盖 `bin/oj`）。症状与根因见验证手册 §9。
>
> `ojm api` 只认工程根的 `openapi.json`：找不到即报错指引先跑第 1 步。

---

## 5. 前端：新增 `books` 模块

### 5.1 模块无需注册

module-root 布局（0.2.20 起）以 `src/<name>/web/entry.ts` 扫描为**真源**——目录在、entry 在，build/dev 自动收录。**`web.config.ts` 的模块登记已退化为可选覆盖**（只影响加载顺序），漏登记不会漏构建。所以本节只有一句话：建好 `src/books/web/` 即可。

### 5.2 `src/books/web/entry.ts`

```ts
import { BookOutlined } from "@ant-design/icons";
import { defineModule } from "@oj-module/runtime";
import { createElement, lazy } from "react";

import { createBooksClient } from "./__client/api";

const Books = lazy(() => import("./pages/index"));

export default defineModule({
  name: "books",
  description: "图书管理",
  version: "0.1.0",
  peerRuntime: ">=0.0.0",   // 兼容的宿主 runtime 版本
  routes: [
    {
      path: "/books",
      handle: {
        layout: "container",             // ⚠️ 必填，否则页面会「裸奔」且 keepAlive 失效
        order: 5,
        title: "books:menu.books",
        icon: createElement(BookOutlined),
      },
      children: [
        {
          index: true,
          Component: Books,
          handle: { title: "books:menu.books", keepAlive: true },
        },
      ],
    },
  ],
  i18n: {
    "zh-CN": () => import("./locales/zh-CN.json"),
    "en-US": () => import("./locales/en-US.json"),
  },
  lifecycle: {
    async onInit(ctx) {
      // 构造即接线：登记契约前缀 /books + 把 scoped request 交给生成的 client
      createBooksClient(ctx);
    },
  },
});
```

### 5.3 文案 `src/books/web/locales/zh-CN.json`

```json
{
  "menu": { "books": "图书管理" },
  "title": "书名",
  "author": "作者",
  "year": "年份",
  "keyword": "关键词",
  "add": "新增图书",
  "submit": "提交"
}
```

（`en-US.json` 同结构。）

### 5.4 页面 `src/books/web/pages/index.tsx`

```tsx
import type { BooksListGetData } from "../__client/api";
import { BasicContent, BasicTable } from "@oj-module/runtime";
import { Button, Card, Form, Input, InputNumber, Modal, Space, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { booksCreatePost, booksListGet } from "../__client/api";

export default function BooksPage() {
  const { t } = useTranslation();
  const [list, setList] = useState<BooksListGetData["list"]>([]);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback(async () => {
    const data = await booksListGet({ keyword: keyword || undefined });  // 落 /api/books/list
    setList(data.list);
  }, [keyword]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    const values = await form.validateFields();
    await booksCreatePost(values);                // 落 /api/books/create
    message.success("已新增");
    setOpen(false);
    form.resetFields();
    void refresh();
  };

  return (
    <BasicContent>
      <Card
        title={t("books:menu.books")}
        extra={(
          <Space>
            <Input.Search placeholder={t("books:keyword")} onSearch={setKeyword} allowClear />
            <Button type="primary" onClick={() => setOpen(true)}>{t("books:add")}</Button>
          </Space>
        )}
      >
        <BasicTable
          rowKey="id"
          dataSource={list}
          columns={[
            { title: t("books:title"), dataIndex: "title" },
            { title: t("books:author"), dataIndex: "author" },
            { title: t("books:year"), dataIndex: "year" },
          ]}
        />
      </Card>

      <Modal open={open} title={t("books:add")} onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label={t("books:title")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="author" label={t("books:author")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="year" label={t("books:year")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </BasicContent>
  );
}
```

> **命名规则**：生成函数/类型名 = `camelCase(路径_方法)` 的 operationId 派生——`booksListGet` / `BooksListGetQuery` / `BooksListGetData` / `booksCreatePost`。**函数形参必填**：query 全可选时传 `booksListGet({})` 而不是 `booksListGet()`（TS2554）。

---

## 6. 联调与验证

1. `pnpm dev` 起来，登录 `superadmin / 123456`；
2. 左侧出现「图书管理」，点进去应看到 3 条种子数据；
3. 输入关键词搜索 → Network 里 `GET /api/books/list?keyword=…` 返回 200；
4. 新增一本 → `POST /api/books/create` 200，列表刷新；
5. 缺必填字段 → `.schema` 校验先拦（400，handler 不执行）；trim 后为空的语义错误走手写兜底（同样 400）。

**契约维度的自查**：

```bash
pnpm exec ojm api --check
pnpm exec ojm info          # 版本矩阵 + 模块清单
```

---

## 7. 构建与部署

```bash
pnpm build        # = ojm build：oj build → dist/api；前端全站合并 → dist/web
pnpm preview      # = ojm preview：oj migrate（ver 门禁）→ oj serve 单服务（API + 静态 SPA 同进程，9778）
```

产物与要点：

- `dist/web/` 是**完整站点**（`index.html` / `assets/` / `modules/` / `modules.json` / `versions.json`）；
- `dist/api/` 是 oj build 产物（release 形态，供 `--api-path dist/api` 供给）；
- 生产清单：
  - `config.yaml` 的 `jwt_secret` **必须更换**；证书用 `ojm init`（或 `oj-cert`）重新签发，私钥（`config/private.pem`）绝不出部署机；
  - `server.migrate_on_start` 在 release 默认 `verify`：账本落后会拒启，先 `oj migrate`；
  - 部署包 = `config.yaml` + `config/`（证书三件套）+ `dist/` + `bin/oj`（详见 `.claude/skills/oj-api-dev/` 手册部署章节）。

---

## 8. 常见问题（oj 应用专项）

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `Failed to initialize a JsRuntime: No such file or directory` | 发布版 oj 二进制烤了构建机路径 | 用自建 oj 覆盖 `bin/oj`（cli ≥ 0.1.4 在 `ojm init`/`ojm vendor` 时已自动告警，见 §1 提示与验证手册 §3） |
| `oj openapi --module-root` 报 `cannot resolve '@oj-module/runtime/contract/errors'` | oj 裸包解析截断缺陷（≤ 0.1.85） | 换 ≥ 0.1.86 的 oj（未发布前用含修复的本地构建覆盖 `bin/oj`）；症状与根因见验证手册 §9 |
| `ojm api` 报 `Cannot find package '@oj-module/runtime'` | 依赖未装/未链接 | `pnpm install`（`@oj-module/runtime` 在模板 devDependencies 里） |
| `typecheck` 报 `Property 'env' does not exist on type 'ImportMeta'` | 缺 `env.d.ts` | 补 `env.d.ts` 并加进 tsconfig `include`（新版 init 已内置） |
| 登录 401，且 msg 不是 `invalid credentials` | `/auth/*` 未在 `anonymous_paths` | 补进根 `config.yaml` 后重启 |
| 新增了模块目录但接口 404 | 目录镜像路由未生效 | **重启** `ojm dev`（改 api.ts 内容才免重启） |
| 通知铃请求 `/api/notifications` 404 | root 级兜底端点未随迁 module-root | 当前模板由 `src/notification/web/` 注册 `notificationsApi` provider，端点在 `/api/notification/notifications`；通知读不到先查 provider 是否注册 |
| DELETE 请求 405 | 方法名写成了 `delete` | 改为 `del` |
| 契约（`.schema`/`.response`）改了但前端类型没变 | 忘了重跑生成 | `./bin/oj openapi … && pnpm exec ojm api`；CI 用 `ojm api --check` 兜底 |
| 迁移账本落后 / 启动被拒（M004） | release `verify` 门禁 | `oj migrate -c config.yaml -d dist/api` |
| `schema.yaml` 与 `manifest.tables` 不一致 | 违反 S005 | 双向补齐 |
| 页面图标/关闭 × 空白 | 共享资产图标 default 退化 | 见框架手册 §3.6，重建宿主 |

---

## 附：命令速查

```bash
pnpm dev                 # 开发（5174 + oj 子进程，热更）
pnpm build               # 构建后端 dist/api + 前端全站 dist/web
pnpm preview             # migrate + 生产形态单服务预览
./bin/oj openapi -c config.yaml --module-root src -b /api -o openapi.json  # 汇总契约
pnpm exec ojm api        # openapi.json → src/<name>/web/__client（api.ts + api.schemas.ts）
pnpm exec ojm api --check# 契约三重对账
pnpm exec ojm vendor     # 下载/重装 oj（缺省最新 release）
pnpm exec ojm info       # 版本矩阵 + 模块清单
```

**后端手册**：`.claude/skills/oj-api-dev/`（按章节读：§3 归属/§4 请求响应/§6 上传/§8 鉴权/§10 配置）。
**模块手册**：`.claude/skills/ojm-module-dev/manual.md`（模块开发 / 旧平铺布局迁移 §3.10）。
**框架手册**：[`framework-development-guide.md`](./framework-development-guide.md)。
