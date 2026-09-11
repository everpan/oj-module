# 实战演练：从零构建一个 oj 前后端应用（books 图书管理）

> **配套手册**：[`framework-development-guide.md`](./framework-development-guide.md)（四个包的职责与原理）。本文只讲「怎么一步步做出来」。
> **产出**：一个可登录、可查询、可新增的「图书管理」全栈应用（前端模块 + oj 后端 + SQLite）。
> **前置**：Node 18+、pnpm、会 React + TypeScript。**不需要**先懂 oj 或本框架内部。

### 你会走的完整链路

```
浏览器
  └─ shell（importmap：react/antd/runtime 单例）
       └─ runtime（加载 books 模块、跑生命周期、渲染页面）
            └─ books 模块（pages → 生成的 client）
                 └─ /api/books/*（Bearer token 自动带上）
                      └─ oj 后端（api/src/books/** 目录镜像路由）
                           └─ SQLite（books 表）
```

---

## 0. 演练总览

我们要做的功能：

| 功能 | 前端 | 后端 | 契约 |
| --- | --- | --- | --- |
| 图书列表（关键词过滤） | 表格 | `GET /api/books/list` | `listBooks` |
| 新增图书 | 表单提交 | `POST /api/books/create` | `createBook` |

演示的顺序刻意是 **后端 → 契约 → 前端**：先把数据与接口做实，再生成前端 client，最后写页面。这是本框架推荐的开发顺序（契约是前后端的边界）。

---

## 1. 创建工程

```bash
# 方式一：用发布到 npm 的脚手架（包内 bin 名是 ram）
npx --yes --package @react-antd-module/cli ram init my-books --yes
# 方式二：本仓库内直接用源码
node packages/cli/bin/ram.mjs init my-books --yes

cd my-books
pnpm install
pnpm dev            # 前端 devServer(5174) + oj 后端，api/src 保存即热更
```

浏览器打开 `http://localhost:5174`，用脚手架种子账号登录：`admin / 123456`（见 `api/src/_platform/seed.sql`）。

> `ram init` 是**幂等补缺**：对已有工程重跑只补缺失文件。首次会联网下载 oj 二进制到 `bin/oj`（sha256 校验），并用 `oj-cert gen` 现场签发本地 dev 证书。
>
> ⚠️ **若 `ram build` / `ram dev` 报 `Failed to initialize a JsRuntime: No such file or directory`**：这是**发布版 oj 二进制**的已知缺陷（CI 构建把构建机路径烤进了二进制，`bin/oj --version` 仍正常）。处置：换成自建 oj（`cargo build --release` 后把 `target/release/oj` 覆盖到 `bin/oj`）。**cli ≥ 0.1.4 会在 `ram init` / `ram vendor` 安装后自动做这项自检并打印告警**，无须等到 `ram build` 才发现。完整判定与复现见 [`framework-verification-playbook.md`](./framework-verification-playbook.md) §3。

### 1.1 脚手架目录

```
my-books/
├── package.json           # scripts: dev/build/preview/info/typecheck（都委托给 ram）
├── modules.config.ts      # 前端模块清单（name + entry）
├── pnpm-workspace.yaml    # allowBuilds: esbuild
├── tsconfig.json
├── global.d.ts            # 后端 oj 全局（db/json/http…）的类型声明
├── .claude/skills/oj-api-dev/   # 后端开发 skill（按需读手册）
├── api/                   # 后端（oj）
│   ├── config.yaml        # 服务/DB/鉴权配置
│   ├── db.sqlite          # 自动创建（相对 config 目录）
│   ├── config/            # 本地 dev 证书（public.pem / cert.jws）
│   └── src/               # 后端模块源码
│       ├── _platform/     # 框架级共有表（users）——普通模块但无路由
│       ├── auth/          # login/refresh/logout（业务路由）+ _shared/session.ts
│       ├── web/           # 框架内置端点的参考实现：
│       │   ├── hello/             # 演示业务端点（Bearer 保护）
│       │   ├── user-info/         # 当前用户信息
│       │   └── get-async-routes/  # 动态路由/菜单
│       └── notifications/ # root 级 /api/notifications（runtime 通知铃兜底，表 + 种子）
├── modules/               # 前端
│   ├── src/home/          # 首页模块：提供 /home（shell 预构建的 HOME 目标）
│   ├── src/demo/          # 演示模块（entry.ts / pages / locales）
│   ├── src/login/         # 登录模块：提供 /login 路由（shell 不挂内置登录兜底）
│   └── dist/              # 构建产物（完整站点，dev/build 后出现）
└── bin/oj                 # oj 可执行文件（init 下载，不入库）
```

> **init 的告警要处理**：若控制台出现「`@types/react` / `typescript` 未在宿主 versions.json 中，模板回退 `"*"`」，`pnpm install` 后请把这两个 devDependency 钉成实际安装版本（`"*"` 不可复现）。

---

## 2. 认识脚手架（动手前先读一遍）

### 2.1 `package.json` 的脚本

```jsonc
{
  "scripts": {
    "dev": "ram dev",         // 开发：前端 + oj，热更
    "build": "ram build",     // 构建：oj build + 前端全站合并到 modules/dist
    "preview": "ram preview",  // 预览：oj migrate → 起 server + 静态兜底
    "info": "ram info",       // 版本矩阵 + 模块清单
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

### 2.2 `api/config.yaml`（oj 服务配置）

```yaml
server:
  host: 127.0.0.1
  port: 9778
  api_prefix: /api            # 所有后端路由挂在 /api 下
db:
  default: 'sqlite://db.sqlite'
auth:
  jwt_secret: <init 随机生成>  # 生产必须更换
  access_token_duration: 2h
  refresh_token_duration: 720h
  anonymous_paths:            # 必须显式匿名的业务路由（否则被自家 Bearer 守卫拦成 401）
    - /auth/login
    - /auth/refresh
    - /auth/logout
```

> **易错点**：`auth` 的 login/refresh/logout 是**业务路由**，不是在框架内部实现的。新工程必须保证它们在 `anonymous_paths` 里，否则登录会 401。

### 2.3 oj 后端的三个基础概念

**① 目录镜像路由**：`api/src/<模块>/<路径...>/api.ts` → `/<模块>/<路径...>`。

```
api/src/web/hello/api.ts        →  GET|POST … /api/web/hello
api/src/books/list/api.ts       →  /api/books/list
api/src/books/create/api.ts     →  /api/books/create
```

**② 端点文件形状**：默认导出一个对象，键是 HTTP 方法，写 `del`（不是 `delete`）：

```ts
export default {
  get() { /* ... */ },
  async post() { /* ... */ },
};
// 方法名对照：GET→get  POST→post  PUT→put  PATCH→patch  DELETE→del
// 写错方法名该请求返回 405
```

**③ 注入的全局**（无需 import）：

| 全局 | 用途 |
| --- | --- |
| `db.query(sql, params)` | 执行 SQL，返回行数组（sqlite 驱动） |
| `json.ok(data)` / `json.fail(code, msg)` | 输出统一信封 `{code,msg,data}` |
| `http.query` / `http.body` | 查询参数 / 请求体（JSON 自动 parse） |
| `http.user` | 已验签用户 `{id, roles, claims}`，未登录为 `null` |
| `http.params` / `http.param(k, d)` | 路径参数（目录镜像路由下恒空） |
| `http.files` / `await http.file(i)` | multipart 上传 |
| `kv.get/set/del/expire` | KV 存储（auth 会话用） |
| `jwt.sign/verify`、`bcrypt.hash/verify`、`crypto.sha256Hex/randomHex` | 令牌与加密 |

### 2.4 `api/src/_platform`（框架级共有表）

```
_platform/
├── manifest.yaml                     # name/_desc/version + tables: [users]
├── schema.yaml                       # 声明式表结构（tables.users.columns…）
├── migrations/0001__create_users.sql # DDL 只写这里
└── seed.sql                          # 数据只写这里（admin / 123456）
```

**两条纪律（会被校验）**：

- **DDL 进 `migrations/`，数据进 `seed.sql`**（S006）。`seed.sql` 每次启动重放，必须幂等（`INSERT OR IGNORE`），按 `;` 朴素切分，注释里也别出现分号。
- **`manifest.yaml` 的 `tables` 与 `schema.yaml` 的 `tables` 必须双向一致**（S005）。

### 2.5 `api/src/auth`（登录链）

`login/refresh/logout` 三个端点 + `_shared/session.ts`（签发逻辑）。跨模块读 `users` 表时，`manifest.yaml` 要用 `deps` 声明归属：

```yaml
# api/src/auth/manifest.yaml
name: auth
desc: JWT 鉴权端点（业务路由）
version: 0.1.0
deps:
  _platform: ^0.1.0     # login 读 _platform.users
```

### 2.6 迁移与 seed 的应用时机

| 文件 | 何时生效 |
| --- | --- |
| `migrations/{seq:04}__{desc}.sql` | 启动（dev `migrate_on_start: auto`）/ `oj migrate`；release 默认 `verify`（账本落后拒启） |
| `seed.sql` | **每次启动重放**（仅 default 库且为 sqlite）；必须幂等 |
| `schema.yaml` | 加表/加可空列由 reconcile 自动收敛；**类型变更/改名走 migrations** |

---

## 3. 后端：新增 `books` 业务模块

### 3.1 建目录与元数据

```
api/src/books/
├── manifest.yaml
├── schema.yaml
├── migrations/0001__create_books.sql
├── seed.sql
├── list/api.ts
└── create/api.ts
```

`api/src/books/manifest.yaml`：

```yaml
name: books
desc: 图书管理模块（演示：列表 + 新增）
version: 0.1.0
tables:
  - books
```

`api/src/books/schema.yaml`：

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

`api/src/books/migrations/0001__create_books.sql`：

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

`api/src/books/seed.sql`（幂等，注释里别写分号）：

```sql
INSERT OR IGNORE INTO books (id, title, author, year, create_time) VALUES (1, '深入理解计算机系统', 'Randal E. Bryant', 2016, 0);
INSERT OR IGNORE INTO books (id, title, author, year, create_time) VALUES (2, '代码之美', 'Andy Oram', 2009, 0);
INSERT OR IGNORE INTO books (id, title, author, year, create_time) VALUES (3, '设计数据密集型应用', 'Martin Kleppmann', 2017, 0);
```

### 3.2 列表端点 `list/api.ts`

```ts
// GET /api/books/list —— Bearer 守卫保护；keyword 模糊过滤 title/author。
export default {
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
```

### 3.3 新增端点 `create/api.ts`

```ts
// POST /api/books/create —— 事务式写入；返回新记录 id。
export default {
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
```

### 3.4 重启边界（最容易卡住新人的一点）

- 改 `api/src/**/api.ts` 的内容 → **保存即生效**（oj 热更）。
- **新增/删除后端模块目录**、改 `schema.yaml` / `migrations/` / `config.yaml` → **必须重启 `ram dev`**。

所以：加完 `api/src/books/` 目录后，先 `Ctrl-C` 再 `pnpm dev`。

### 3.5 先用 curl 自测后端

```bash
# 登录拿 token（auth 已在 anonymous_paths，无需 token）
TOKEN=$(curl -s -X POST http://127.0.0.1:9778/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"123456"}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.access_token))")

# 列表（带 Bearer）
curl -s "http://127.0.0.1:9778/api/books/list?keyword=设计" -H "authorization: Bearer $TOKEN"

# 新增
curl -s -X POST http://127.0.0.1:9778/api/books/create \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"重构","author":"Martin Fowler","year":2019}'
```

> 端口以 `api/config.yaml` 的 `server.port` 为准。返回 `{"code":0,"data":{...}}` 即成功。

---

## 4. 契约：把接口钉成契约

`api/src/books/contract.ts`：

```ts
import { defineApi, z } from "@react-antd-module/contract";

/**
 * books 模块契约（uni-dev 形态）。
 * 硬约束（AC-D9）：apiPrefix 必须字面等于目录名 "books"。
 */

const book = z.object({
  id: z.number(),
  title: z.string(),
  author: z.string(),
  year: z.number(),
});

export const listBooks = defineApi({
  apiPrefix: "/books",
  route: "/list",
  query: z.object({ keyword: z.string().optional() }),
  data: z.object({ list: z.array(book), total: z.number() }),
  description: "图书列表",
});

export const createBook = defineApi({
  apiPrefix: "/books",
  route: "/create",
  method: "POST",
  body: z.object({
    title: z.string(),
    author: z.string(),
    year: z.number(),
  }),
  data: z.object({ ok: z.boolean() }),
  description: "新增图书",
});
```

生成前端 client 与文档：

```bash
pnpm exec ram api
# 产物（uni-dev 形态）：
#   modules/src/books/api/client.ts          前端调用函数 + 类型
#   modules/src/books/api/client.schemas.ts  zod schema（DEV 校验用）
#   api/src/books/routes.json                路由清单
#   api/src/books/openapi.yaml               接口文档
```

对账（CI 会跑）：

```bash
pnpm exec ram api --check     # 生成物同步 / route 双向 / routes.js 无 drift
```

> 契约里 `apiPrefix` 写错（比如 `/book`）时 `ram api` 会直接报错并给出修复指引——这是**故意**的强约束，保证前后端前缀永远一致。

---

## 5. 前端：新增 `books` 模块

### 5.1 注册模块

`modules.config.ts`：

```ts
export default {
  baseUrl: "",
  modules: [
    // home 必须保留且尽量靠前：shell 预构建把 "/" → VITE_BASE_HOME_PATH（=/home）
    // 重定向，缺 /home 路由会让登录回跳 / 点 logo 落错误边界。
    { name: "home", entry: "modules/src/home/entry.ts", enabled: true },
    { name: "demo", entry: "modules/src/demo/entry.ts", enabled: true },
    // login 必须保留：shell 宿主只消费模块路由，不挂 runtime 内置 baseRoutes，
    // 缺它 `/login` 无路由可跳（登出/回跳登录会落空）。
    { name: "login", entry: "modules/src/login/entry.ts", enabled: true },
    { name: "books", entry: "modules/src/books/entry.ts", enabled: true }, // 新增
  ],
};
```

### 5.2 `module entry.ts`

```ts
import { BookOutlined } from "@ant-design/icons";
import { defineModule } from "@react-antd-module/runtime";
import { createElement, lazy } from "react";

import { bindRequest } from "./api/client";

const Books = lazy(() => import("./pages/index"));

export default defineModule({
  name: "books",
  description: "图书管理",
  version: "0.1.0",
  peerRuntime: ">=0.1.0",   // 兼容的宿主 runtime 版本（当前宿主为 0.1.3）
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
      ctx.register.apiPrefix("/books");   // ① 先登记前缀
      bindRequest(ctx.utils.request);     // ② 把 scoped request 交给生成的 client
    },
  },
});
```

### 5.3 文案 `modules/src/books/locales/zh-CN.json`

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

### 5.4 页面 `modules/src/books/pages/index.tsx`

```tsx
import type { ListBooksData } from "../api/client";
import { BasicContent, BasicTable } from "@react-antd-module/runtime";
import { Button, Card, Form, Input, InputNumber, Modal, Space, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { createBook, listBooks } from "../api/client";

export default function BooksPage() {
  const { t } = useTranslation();
  const [list, setList] = useState<ListBooksData["list"]>([]);
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback(async () => {
    const data = await listBooks({ keyword });   // 落 /api/books/list
    setList(data.list);
  }, [keyword]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    const values = await form.validateFields();
    await createBook(values);                     // 落 /api/books/create
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

> 命名规则：生成函数名 = 契约导出名（`listBooks` / `createBook`）；类型名 = 导出名转 Pascal + `Query` / `Body` / `Data`（如 `ListBooksQuery`、`CreateBookBody`、`ListBooksData`）。

---

## 6. 联调与验证

1. `pnpm dev` 起来，登录 `admin / 123456`；
2. 左侧出现「图书管理」，点进去应看到 3 条种子数据；
3. 输入关键词搜索 → Network 里 `GET /api/books/list?keyword=…` 返回 200；
4. 新增一本 → `POST /api/books/create` 200，列表刷新；
5. 加错必填项 → 后端返回 `400`，前端弹 `ContractApiError.msg`。

**契约维度的自查**：

```bash
pnpm exec ram api --check
pnpm exec ram info          # 版本矩阵 + 模块清单
```

---

## 7. 构建与部署

```bash
pnpm build        # = ram build：oj build（生成 routes.js）+ 前端全站合并到 modules/dist
pnpm preview      # = ram preview：oj migrate（ver 门禁）→ 起 server + 静态兜底
```

产物与要点：

- `modules/dist/` 是**完整站点**（含 shell 拷贝的 `index.html` / `assets/` / `modules.json` / `versions.json`）；
- `api/dist/` 是 oj build 产物（release 下**只有 routes.js 路由，目录镜像不存在**）；
- 生产清单：
  - `api/config.yaml` 的 `jwt_secret` **必须更换**；证书用 `oj-cert gen` 重新签发；
  - `server.migrate_on_start` 在 release 默认 `verify`：账本落后会拒启，先 `oj migrate`；
  - 部署包 = `config.yaml` + `dist/` + 可选 `seed.sql`（详见 `bin/devkit/api-manual.md` 部署章节）。

---

## 8. 常见问题（oj 应用专项）

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `Failed to initialize a JsRuntime: No such file or directory` | 发布版 oj 二进制烤了构建机路径 | 用自建 oj 覆盖 `bin/oj`（cli ≥ 0.1.4 在 `ram init`/`ram vendor` 时已自动告警，见 §1 提示与验证手册 §3） |
| `ram api` 报 `Cannot find package '@react-antd-module/contract'` | 工程缺 `contract` 依赖（旧版 init 生成） | 加进 devDependencies 后 `pnpm install`（新版 init 已内置） |
| `typecheck` 报 `Property 'env' does not exist on type 'ImportMeta'` | 缺 `env.d.ts` | 补 `env.d.ts` 并加进 tsconfig `include`（新版 init 已内置） |
| 登录 401，且 msg 不是 `invalid credentials` | `/auth/*` 未在 `anonymous_paths` | 补进 `api/config.yaml` 后重启 |
| 新增了模块目录但接口 404 | 目录镜像路由未生效 | **重启** `ram dev`（改 api.ts 才免重启） |
| 通知铃请求 `/api/notifications` 404（`no route matched`） | 缺 root 级端点——runtime 未注册 provider 时走内置兜底 | cli ≥ 0.1.5 的 `ram init` 已内置 `api/src/notifications`（参考 playground notification）；旧工程补该模块 |
| DELETE 请求 405 | 方法名写成了 `delete` | 改为 `del` |
| `ram api` 报 apiPrefix 与目录名不符 | 违反 AC-D9 | 改 `apiPrefix` 或移动契约目录 |
| 契约改了但前端类型没变 | 忘了重跑生成 | `ram api`；CI 用 `--check` 兜底 |
| 迁移账本落后 / 启动被拒（M004） | release `verify` 门禁 | `oj migrate -c api/config.yaml -d api/dist` |
| `schema.yaml` 与 `manifest.tables` 不一致 | 违反 S005 | 双向补齐 |
| 页面图标/关闭 × 空白 | 共享资产图标 default 退化 | 见手册第 3 章 3.6，重建 shell |

---

## 附：命令速查

```bash
pnpm dev                 # 开发（前端 + oj，热更）
pnpm build               # 构建后端 + 前端全站合并
pnpm preview             # migrate + 生产形态预览
pnpm exec ram api        # 契约 → client/schemas/routes/openapi/stub
pnpm exec ram api --check# 契约三重对账
pnpm exec ram api --docs # 生成自包含接口文档站
pnpm exec ram vendor     # 下载/重装 oj（缺省最新 release）
pnpm exec ram info       # 版本矩阵 + 模块清单
```

**后端手册**：`bin/devkit/api-manual.md`（按章节读：§3 归属/§4 请求响应/§6 上传/§8 鉴权/§10 配置）。
**框架手册**：[`framework-development-guide.md`](./framework-development-guide.md)。
