---
name: ojm-module-dev
description: 用 ojm 开发前后端一体工程时使用——新增/修改前端模块（entry.ts、pages、locales）、写契约 contract.ts 与 oj handler、跑 ojm api 生成 client、注册 provider/布局/插槽、改 web.config.ts，或排查「模块没加载 / 注册不生效 / 请求未绑定 / 铃铛按钮灰」时。触发场景：建模块、加页面、加接口、抢通知或上传、换布局、ojm dev 起不来。
---

# ojm 模块开发

本 skill 与参考手册 `manual.md` 同目录。**按章节号按需读章，不要盲读全文。**

后端 handler 本身的写法（`json` 信封、`db` 查询、`manifest.yaml`、`oj test`）属于
**`oj-api-dev` skill** 的范围——本 skill 只讲它到前端这一侧的接线。

## 工作流

1. **读章**：建模块 → 手册 §2；加接口（契约→handler→生成→接线）→ §3；
   抢通知/上传/菜单 → §4；换布局或加插槽 → §5；排查 → §8。
2. **建目录**：前端 `web/src/<模块名>/`（`entry.ts` 必备，`pages/`、`locales/` 按需）；
   后端 `api/src/<模块名>/`（`contract.ts` + 目录镜像路由的 `api.ts`）。
   `entry.ts` 是模块元数据**唯一来源**——没有单独的 `package.json` / `meta.json`。
3. **接线四步流水线**（加接口就背这条）：
   ```
   写契约 contract.ts → 写 handler api.ts → ojm api 生成 client → entry.ts 的 onInit 里 create<Module>Client(ctx) + 注册
   ```
4. **登记**：往工程根 `web.config.ts` 的 `modules` 数组加一项。**漏了这步模块静默不加载、全程不报错。**
5. **验证**：`pnpm dev`（前端 devServer **5174** + oj 后端 **9778**，端口以 `api/config.yaml` 为准）
   → 登录 `admin / 123456` → 按 §8.1 五步清单核对。

## 红线（不可违反）

- **登记**：模块必须在 `web.config.ts` 里 `enabled: true`。文件写完 ≠ 模块会跑。
  清单**先后顺序就是抢活优先级**（同一入口先到者赢，无优先级数字可填）。
- **`home` / `login` 模块必须保留**：shell 预构建把 `/` 重定向到 `/home`，且宿主只消费
  模块路由、不挂内置登录页。删掉它们 → 登录回跳落错误边界、`/login` 无路由可跳。
- **布局级路由 handle 必写 `layout: "container"`**：不写页面会裸渲染（无侧边栏/页签），
  且 `keepAlive` 失效。`"container" | "parent" | "none" | 自定义名`。
- **注册时机**：一切 `ctx.register.*` 必须在 `lifecycle.onInit` 内、且在 onInit 返回前完成。
  拖到 `onActivate` 或某个异步回调里注册不保证生效。
- **一模块一 client**：`create<Module>Client(ctx)` 只在 onInit 里创建一次。
  页面/组件/事件回调里**不要**再创建——会覆盖 request 单槽。页面里直接 import 裸函数调用。
- **只认领自己的 client**：A 模块的 onInit 里创建 B 模块的 client 会 DEV 告警。要别家接口，
  走「B 自己注册 provider、A 消费 provider」的正路。
- **要抢就全抢**：`ctx.register.*Provider` 的方法一个都不能少，不做「只接管读、写还用框架的」。
- **生成物勿手改**：`web/src/<模块>/client/**`、`routes.json`、`openapi.yaml` 重跑即覆盖
  （eslint 已忽略）。改需求 = 改契约，重跑 `ojm api`。唯一例外是 `api/**/api.ts` stub——
  文件头带 `// ojm-api:stub` 指纹的 stub 被人工动过后，工具**永不写永不删**。
- **契约前缀（AC-D9）**：uni-dev 形态下每个端点的 `apiPrefix` 必须**字面等于**后端模块
  目录名（`api/src/order/contract.ts` → `/order`，**不是** `/api/order`），不符即人话报错。
- **不返回数据的接口不写 `data`**：`data: z.null()` 过不了类型白名单，直接省略该字段。
- **上传文件用契约的 `form`，不要绕过 client 手写请求**：`form: { fields: z.object({...}), files: [{ name: "avatar", required: true }] }`；`form` 与 `body` 互斥，文件部件只写 `name`/`required`/`multiple`（二进制不进 zod），`content-type` 由运行时按 boundary 自动补。
- **前端模块的 import 只有三类**：`@oj-module/runtime`、宿主 importmap 提供的共享依赖、
  自身相对路径。共享依赖不进工程 `dependencies`（宿主提供单例，模块不得打包副本）。
- **后端方法名是 `del`，不是 `delete`**（写成 `delete` 返回 405）。
- **加一张新表是三件套，不是只写 `schema.yaml`**：`migrations/{seq:04}__*.sql`（DDL 真身，
  S006）+ `schema.yaml`（声明，与 migration 逐字段一致）+ `manifest.yaml` 的 `tables:`
  （S005 与 schema 双向一致）。少一个就建不出表或启动失败。见手册 §1.5。
- **`seed.sql` 每次启动都重放**，必须幂等（`INSERT OR IGNORE`）；它按 `;` 朴素切分，
  注释里不许出现分号字面量。

## 重启边界（最容易卡住新人）

| 改动 | 生效方式 |
|---|---|
| 已有 `api.ts` 的**文件内容** | 保存即热更 |
| **新增/删除**后端模块目录 | **必须重启 `ojm dev`** |
| 改 `schema.yaml` / `migrations/` / `config.yaml` | **必须重启** |
| 前端 `web/src/**` | 模块重建 + 浏览器自动刷新 |

## 新模块 checklist

- [ ] `web/src/<模块>/entry.ts` 默认导出 `defineModule({ name, version, routes, i18n?, lifecycle? })`
- [ ] `web.config.ts` 的 `modules` 里已登记且 `enabled: true`
- [ ] 路由 `handle.layout` 选对了（有页面用 `"container"`；无页面模块 `routes: []`）
- [ ] 菜单标题用命名空间语法 `"<模块名>:menu.<key>"`，且 `locales/<lang>.json` 里有这个 key
- [ ] 有接口 → 契约写了 `apiPrefix` + `route` → `ojm api` 跑过 → onInit 里 `create<Module>Client(ctx)`
- [ ] 抢了活 → provider 方法数与类型定义**一个不差**
- [ ] `pnpm dev` 起来后按 §8 五步排查全过

## 常见陷阱速查

| 症状 | 原因 | 处置 |
|---|---|---|
| 模块像不存在：没路由、没反应、也不报错 | `web.config.ts` 里没登记 | 登记后重启 `ojm dev` |
| 注册了却没效果 | 注册代码不在 `onInit` 里 | 挪进 `onInit` |
| 控制台「重复的 xx provider 忽略」 | 两个模块抢同一入口 | 排前面的赢；调 `web.config.ts` 顺序或撤一处 |
| 铃铛按钮全灰 | 没注册通知 provider，或只写了「拉列表」一个方法 | 4 个方法补齐 |
| 调用报「请求未绑定」 | onInit 里没调 `create<Module>Client(ctx)` | onInit 里先 create 再发请求 |
| 控制台「模块 A 正在认领 /b 的 client」 | A 创建了 B 的 client | 由 B 创建并经 provider 暴露能力 |
| `ojm api` 报「schema 超出白名单」 | 契约里写了 `z.null()` / transform / refine | 不返回数据就别写 `data`；校验放后端 |
| 上传接口报 400「文件字段缺失」 | 文件部件名与后端 `http.files[].field` 不一致 | 契约 `form.files[].name` 对齐后端读的字段名 |
| 上传报「Unsupported Media Type」/ 后端收不到文件 | 手写了 `content-type`（boundary 丢失） | 删掉手写的 header，交运行时按 FormData 自动补 |
| `ojm api` 报「apiPrefix 与目录名不符」 | AC-D9 字面相等约束 | 改 `apiPrefix` 或移动契约目录 |
| 改了契约前端类型没变 | 没重新生成 | 跑 `ojm api`；生成是确定的，diff 应只含你改的部分 |
| 上传报 401 | `headers` 写成了固定对象，token 过期 | 写成方法，用的时候现取 |
| 后端菜单用了我的布局名，页面却没壳 | 注册该布局的模块没加载 | 看控制台 `[layout] 未知名布局` 提醒 |
| 后端下发的组件找不到 | 下发的组件名必须在框架页面目录里 | 自己模块的页面走模块 `routes`，别从后端下发 |
| 下线模块后页面没变 | 已渲染的页面不自动换 | 刷新页面 |
| 新建后端模块目录后 API 404 | 目录镜像路由未热更 | **重启** `ojm dev` |
| DELETE 返回 405 | 方法名写成了 `delete` | 改成 `del` |
| 页面无侧边栏/页签、keepAlive 失效 | 路由 handle 没写 `layout: "container"` | 补上 |
| 登录 401 且 msg 不是 `invalid credentials` | `/auth/*` 不在 `anonymous_paths` | 加进 `api/config.yaml`，重启 |
| 登出/回登录页落空，或登录后落错误边界 | 工程缺 `login` / `home` 模块 | 在 `web.config.ts` 保留两者 |
| 通知铃 404 `no route matched` | 缺 root 级 `/api/notifications` | 补 `api/src/notifications` 模块 |

## 手册

`manual.md`（同目录）共 9 章：1 工程结构 / 2 写前端模块 / 3 契约与代码生成 /
4 抢活（provider）/ 5 布局与插槽 / 6 i18n 与样式 / 7 构建与发布 / 8 排查 / 9 参考。
