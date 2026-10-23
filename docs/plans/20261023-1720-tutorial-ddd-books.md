# oj-fullstack-tutorial 改进：books 端点改 DDD 嵌套 handler 组 + db.table 优先

- 日期：2026-10-23 17:20
- 分支：docs/tutorial-ddd-books
- 状态：已完成

## 需求

`docs/prd/oj-fullstack-tutorial.md` 演练做两点改进：

1. `db.query` 优先级放低，优先采用 `db.table` 构造器（业务读写优先构造器，
   `db.query` 仅作构造器不支持语句的逃生舱，仍须 `?` 绑定——口径同
   `docs/devkit/oj-api-dev/sql-builder-guide.md` §1）。
2. books 端点改用 DDD 嵌套 handler 组写法；目录镜像用法只做说明、不再作为演练代码。

## 真源（已核实）

- 嵌套 handler 组：`docs/devkit/oj-api-dev/api-manual.md` §嵌套 handler 组（v0.1.64）；
  DDD 判据表：`docs/devkit/manual.md` §3.9（同聚合多动词→单文件嵌套组/平铺；
  `del` 保留动词键不能作组名；≤4 层）。
- 先例：`src/demo/api/todos/api.ts`（module-root 单文件动词对象 + `.schema`/
  `.response`）、`src/auth/api/api.ts`（模块根嵌套组 `{login,logout,refresh,password}`）、
  `src/notification/api/api.ts`（聚合注释范式）。
- books = 单一聚合（books 表 = 一致性边界）、2 动词 → 采用 module-root 单文件
  聚合根形态：`src/books/api/api.ts` 一个动词对象挂 get/post（todos 同构），
  路由从 `/api/books/list` + `/api/books/create` 收敛为 `GET /api/books` +
  `POST /api/books`（REST 更自然，且避开「动词命名组/目录」DDD 红线）。
- 构造器语法：`db.table("t").select([...]).where({or:[...]}).whereIf(test,cond)
  .orderBy([...]).all()`；`.insert({...}).run()`；`op:"contains"` 引擎自动转义。

## 改动清单（教程章节）

1. §0 功能表：路由/client 名换 `GET /api/books`→`booksGet`、`POST /api/books`→`booksPost`。
2. §2.3 概念①：目录镜像路由降级为「形态说明」；新增「嵌套 handler 组（推荐）」
   概念 + DDD 判据速查（指向 manual §3.9）。
3. §2.3 全局表：`db.table(...)` 构造器置顶；`db.query` 改逃生舱行（`?` 绑定、
   禁方言特有语法）。
4. §3.1 目录树：`list/api.ts`、`create/api.ts` → 单个 `api.ts`。
5. §3.2/3.3 合并为单文件实现（构造器 whereIf+or+contains、insert），保留
   `.schema`/`.response` 契约与手写语义兜底并存说明；路由变化显式标注。
6. §3.4/3.5 重编号为 3.3/3.4，curl 示例路径更新。
7. §5.4：`booksGet({keyword})`/`booksPost`/`BooksGetData`，命名规则行同步。
8. §6 联调 Network 路径同步；FAQ 重启边界行补「端点文件」一词。

## 任务

- [x] 计划文档（本文）
- [x] 教程分节 Edit（§0 表 / §2.3 概念重排 / §3.1-3.4 合并为单文件聚合形态 / §5.4 / §6 / FAQ）
- [x] 与真源对拍（构造器语法对 todos+sql-builder-guide；嵌套组红线对 manual §3.9；
      全文无 booksListGet 等旧名残留；链接目标存在）
- [x] 合入 feat/ojm 删分支，更新本文档（状态+问题记录+总结）

## 问题记录

- 形态取舍：books 是「单一聚合 + 2 动词」，按 manual §3.9 判据「≤3 动词单一聚合
  可平铺单文件」，与「嵌套组（同聚合多操作，推荐）」两档都合规。最终采用
  **module-root 单文件动词对象**（todos 先例同构），而非再套一层组名——因为
  模块名已叫 books，再嵌 `books` 组会产出 `/api/books/books` 的丑陋路由；真正展示
  「嵌套」的扩展点（子组）以注释形式写在 api.ts 头部。路由因此从
  `/api/books/list|create` 收敛为 `/api/books`（GET/POST），客户端函数名相应变为
  `booksGet`/`booksPost`。
- 「目录镜像只做说明」落实为 §2.3 的两种形态对照表（嵌套组推荐 / 目录镜像适合
  不同聚合），演练代码零目录镜像。

## 总结

- 状态：已完成（2026-10-23 17:40 收尾）。
- 关键过程：真源核实（api-manual §嵌套 handler 组 / manual §3.9 DDD 判据 /
  sql-builder-guide §1 构造器优先 / todos·auth·notification 三个模板先例）→
  计划文档 → 7 处分节 Edit → grep 全文核对旧名零残留。约 25 分钟。
- 遗留：教程 §5.4 页面代码仍未经浏览器实跑；books 单文件形态在 oj openapi
  下按 module-root 扫描与目录形态等价（均产出 RouteRow），无契约侧影响。
