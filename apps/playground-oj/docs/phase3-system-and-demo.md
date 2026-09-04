# Phase 3 — system CRUD 与 demo 真实化

> 阶段目标（计划 §5）：system 模块接管角色/菜单类端点（D9 注入），后端 CRUD 落 system 表；demo 模块接真实数据层（todos），页面真实读。
>
> 完成标准：system 六项端点经 D9 接管、CRUD 往返落库且跨 `oj` 重启持久；demo `/demo/todos` 真实读 + keyword 过滤 + Bearer 守护。

## 执行步骤

| 步骤 | 动作 | 关键产物 | 验证 |
|---|---|---|---|
| P3-1a | 契约 `menuItem` 扩到 18 字段（对齐 `MenuItemType`），`menuType` 改 `0\|1\|2\|3` 联合 | `api/src/system/contract.ts` + `ram api` 重生 `client.*` | `ram api --check` 绿 |
| P3-1b | `menus` 表扩列：`type`→`menu_type`（0 菜单/1 目录）+ UI 列；同步 `schema.yaml`/`seed.sql`/`get-async-routes` | `migrations/0001`、`schema.yaml`、`seed.sql`、`api/src/web/get-async-routes/api.ts` | `oj migrate` 建表；seed 落库 |
| P3-1c | 实现 6 个 handler：role-list（分页过滤）/role-item（增改删+绑菜单）/role-menu（扁平全字段）/menu-by-role-id/ menu-list / menu-item（增改删） | `api/src/system/{role-list,role-item,role-menu,menu-by-role-id,menu-list,menu-item}/api.ts` | 冒烟逐项 PASS |
| P3-1d | `entry.ts` `onInit` 用 `bindRequest(ctx.utils.request)` + `ctx.register.systemApi(provider)` 接管系统 API | `modules/src/system/entry.ts` | 消费点经 `getSystemApiProvider` 委托 |
| P3-1e | 框架对齐：runtime `role` 契约 `menuItem` 扩到 18 字段 + 重建 runtime dist（消除 D9 边界类型差） | `packages/runtime/src/api/system/role/contract.ts` + `packages/runtime/dist/**` | typecheck 通过 |
| P3-1f | `pnpm typecheck` + `ram api --check` 绿 | — | 0 error / 0 warn |
| P3-1g | system CRUD 冒烟（增删改 + 角色绑菜单 + 跨重启持久化） | `scripts/smoke-system.py` | 全 PASS |
| P3-2a | demo 数据层：manifest 加 `tables:[todos]` + `schema.yaml` + 迁移 + seed | `api/src/demo/{manifest.yaml,schema.yaml,migrations/0001__create_todos.sql,seed.sql}` | `oj migrate` demo:1 |
| P3-2b | `todos` handler 真实化（keyword 过滤 title，done 映射布尔） | `api/src/demo/todos/api.ts` | 冒烟 PASS |
| P3-2c | demo 冒烟（真实读 + 过滤 + 无 Bearer 401） | 终端脚本 | 全 PASS |

## P3-1：system CRUD + D9 注入

### 动机（D9）

system 角色/菜单类端点原本硬编码在 runtime 根级（`/role-list` 等）。D9 让模块通过注册表接管这些端点，收敛到自身 `apiPrefix`（此处 `/system`），消费点（role/menu 页）在运行时经 `getSystemApiProvider()` 委托，未注册时回落内置实现。

页面（`modules/src/system/pages/*`）仍从 `@react-antd-module/runtime` 导入 `fetchRoleList`/`fetchMenuList` 等——这些是"委托入口"，内部 `getSystemApiProvider()?.xxx() ?? builtinXxx()`。模块只要在 `onInit` 注册 provider，页面零改动即走模块后端。

### 契约扩列（P3-1a）

复制进来的菜单页消费完整 `MenuItemType`（18 字段），故把契约 `menuItem` 从 4 字段扩到 18 字段，并把 `menuType` 设为 `z.union([0,1,2,3])` 以对齐 `MenuItemType.menuType` 的字面量联合类型。改契约后 `ram api` 重生 `modules/src/system/api/client.schemas.ts`，handler 的 DEV 校验随之收紧。

### 表扩列（P3-1b）

`menus` 原 `type TEXT` 承载"菜单/目录"，扩为整型 `menu_type INTEGER`（0 菜单/1 目录/2 iframe/3 外链按钮），并补 `current_active_menu/iframe_link/keep_alive/external_link/hide_in_menu/ignore_access` 等 UI 列。注意：

- **`order` 是 SQL 保留字**，落库沿用 `sort` 列（`MenuItemType.order` → `sort`），handler 内映射，避免关键字冲突。
- `get-async-routes` 里 `SELECT m.type` 同步改为 `m.menu_type`，否则该查询会因"无此列"静默回落空树。
- `schema.yaml` 与迁移必须一致（声明源 + 显式迁移双写），否则 dev 启动 reconcile 会告警或产生漂移。

### 6 个 handler（P3-1c）

- **role-list**：`name/code/status` 过滤 + `current/pageSize` 分页；`COUNT(*)` 总条数 + `LIMIT/OFFSET` 分页；snake→camel 映射。
- **role-item**：`POST` 增 / `PUT` 改 / `DEL` 删（oj 约定 `DELETE` 方法名 `del`）。增改同时按 `b.menus` 重绑 `role_menu`——**先 `DELETE FROM role_menu WHERE role=?` 再逐条 `INSERT OR IGNORE`**。
- **role-menu**：全量读 `menus` 映射成 `MenuItemType`（扁平，前端 `handleTree` 转树）。
- **menu-by-role-id**：`role_menu.role` 存的是**角色 CODE 不是 id**，故先由角色 id 取 `code` 再查 `menu_id`。
- **menu-list**：全量读 `menus` 包成列表信封 `{list,total,current}`。
- **menu-item**：`POST` 增 / `PUT` 改 / `DEL` 删；字段全参数绑定（`?` 占位的列数需与 `INSERT` 列数严格相等，见 gotchas 第 5 条）；删菜单同时清 `role_menu` 中该菜单的绑定。

> 写操作取自增 id 用 `INSERT ... RETURNING id`（SQLite 支持），因为 `db.exec` 只返回受影响行数、不含新 id。

### D9 注入（P3-1d）

```ts
async onInit(ctx) {
  systemClient.bindRequest(ctx.utils.request);   // 注入 scoped request（AC-D8 能力持有者）
  const provider = {
    fetchRoleList: (q) => systemClient.fetchRoleList(q),
    // ... 其余 9 个方法一一委托到生成的 client
    fetchDeleteMenuItem: (id) => systemClient.fetchDeleteMenuItem(id),
  } as unknown as SystemApiProvider;
  ctx.register.systemApi(provider);              // 先到先得；模块卸载自动注销
}
```

`bindRequest` 把 `ctx.utils.request` 存入生成的 client（模块级单例），client 内的 `ensureReq()` 据此发请求——这就是"契约生成物 + 模块 request 能力"的接驳点。

### 框架对齐（P3-1e，关键）

`SystemApiProvider` 接口位于 runtime，其 `fetchRoleMenu` 返回的是 runtime `role` 契约里的 `menuItem`——但那个契约仍是**旧 3 字段投影**（`parentId:number`），而 `fetchMenuList` 返回的是 `MenuItemType`（18 字段、`parentId:string`、`status:1` 字面量）。两者自相矛盾，导致本模块 18 字段 provider 无法静态满足。

修法：把 runtime `role` 契约的 `menuItem` 扩到与 `MenuItemType` 完全同构（18 字段、`parentId:string`、`menuType` 联合），并**重建 runtime dist**（`packages/runtime` 的 `pnpm build`）。重建后：

- dist 的 `FetchRoleMenuData` 变为 18 字段，与契约一致；
- dist 的 `MenuItemType` 含 `permission` 等字段（此前 dist 比 src 旧，缺 `permission`，正是 P3 初版 typecheck 报 "permission missing" 的根因——印证了"**改 runtime/src 必须重建并提交了 dist**"的纪律）。

provider 对象仍用 `as unknown as SystemApiProvider` 在单一注入边界吸收框架遗留的字面量类型差（`status:1`），保持各委托方法按本模块契约严格定型。

## P3-2：demo 真实化

demo 是 route-only 模块（P2 已建极简 manifest）。P3-2 给它接真实数据层：

- `manifest.yaml` 加 `tables: [todos]`（否则 `ownership_guard` 会按"读无主表"告警）；
- `schema.yaml` 声明 `todos(id,title,done,create_time,update_time)`；
- `migrations/0001__create_todos.sql` 建表（`done` 用 `INTEGER(0/1)` 承载布尔）；
- `seed.sql` 插 4 条待办（`INSERT OR IGNORE`，按分号朴素切分）；
- `todos/api.ts` 真实化：`keyword` 模糊过滤 `title`，`done` 由 `Number(r.done)===1` 映射布尔。

页面 `modules/src/demo/pages/index.tsx` 已是"读 `getTodoList({})` → 渲染 `res.list`"的结构，**无需改动**——契约没变（只改了 handler 实现），演示"契约稳定、后端可替换"。

## P3-1 冒烟结果（`scripts/smoke-system.py`）

```
[PASS] role-list 200 / has admin (total=2)
[PASS] menu-list 200 / menu_type int / parentId str
[PASS] role-menu 200 / has permission field
[PASS] add role 200 (id=4) ; menu-by-role-id 100&104 绑定成功
[PASS] update role 200 ; 改绑后仅 104
[PASS] add menu 200 (id=108)
[PASS] get-async-routes 200 (paths 含 /system，menu_type 路径正常)
[PASS] delete menu 200 ; delete role 200 ; 删除后查询为空
== 跨重启持久化 == created id=5 → 杀进程重启 → role-list 仍含 'pt' → PERSIST OK
```

## P3-2 冒烟结果

```
== todos 无过滤 == total=4  list=[(1,学习 uni-dev 契约机制,True),...,(4,联调 demo 真实数据层,False)]
== todos keyword=文档 == 仅命中 "编写 P3 教学文档"（total=1）
== 无 Bearer == status=401 code=401  → 守卫生效
```

## 关键 gotchas（教学要点）

1. **`menus.type` → `menu_type` 是改名不是加列**：oj 的"改名"走迁移（不自动 ALTER）。迁移建新列后，`get-async-routes` 的 `SELECT m.type` 必须同步改 `m.menu_type`，否则"无此列"被 `catch` 吞掉、路由树静默变空——这是最隐蔽的一类回归。
2. **`order` 是 SQL 保留字**：菜单顺序落库用 `sort` 列，`MenuItemType.order` 在 handler 映射 `sort`，切勿在 SQL 里直接写 `order` 作列名。
3. **`role_menu.role` 存角色 CODE 不是 id**：seed 写 `'admin'/'common'`，`get-async-routes` 按 `http.user.roles`（CODE 数组）JOIN，`menu-by-role-id` 也先由 id 取 code 再查。若误存 id，权限树会全空。
4. **自增 id 用 `RETURNING`**：`db.exec` 返回受影响行数、不含新主键；`INSERT ... RETURNING id` 才能拿到刚插入的 role/menu id 用于后续绑菜单。
5. **`INSERT` 占位符数 = 列数**：`menu-item` 初版写了 18 个 `?` 却只有 17 列（`create_time/update_time` 重复计数），报 `18 values for 17 columns`。列清单与 `VALUES` 的 `?` 必须逐个数清。
6. **runtime dist 随 src 提交**：改 `packages/runtime/src` 后必须 `pnpm build` 重建 dist，否则 app 看到的是旧类型（如缺 `permission` 的 `MenuItemType`），typecheck 在无缘无故处报错。
7. **D9 边界类型差用单一 `as` 吸收**：框架自身 `fetchRoleMenu`(3 字段) 与 `fetchMenuList`(`MenuItemType`) 类型不自洽，在 `entry.ts` 注入点用 `as unknown as SystemApiProvider` 局部吸收，各委托方法仍按本模块契约严格定型。

## 阶段小结

- P3-1 六项 system 端点经 D9 接管，CRUD 往返落 `system` 表，角色绑菜单（按 CODE）、跨 `oj` 重启持久化均验证通过。
- P3-2 demo `todos` 接真实数据层，keyword 过滤 + Bearer 守卫生效；页面因契约稳定**零改动**，印证 uni-dev 契约的价值。
- `ram api --check` 0 error / 0 warn；`pnpm typecheck` 通过；框架 `role` 契约 `menuItem` 与 `MenuItemType` 完成同构对齐并重建 dist。
- 至此"模块页面 → runtime 委托入口 → 模块 D9 provider → 契约生成 client → oj 后端"的全链路闭环打通，为 P4 业务模块（notification/upload）复用同一 D9 模式铺路。

## 反常规 / 反常识点（供 P6 汇总）

- **框架自身的契约会自相矛盾**：`fetchRoleMenu` 返回 3 字段投影、`fetchMenuList` 返回 18 字段 `MenuItemType`，两者本应一致却长期漂移——D9 注入时被迫在边界用 `as` 吸收，而非"类型天然对齐"。
- **改框架 TypeScript 源码不一定生效**：runtime 以**构建产物 dist** 被消费，`src` 改了 `MenuItemType` 不重建 dist，app 仍看到旧类型——"源码即真相"在打包库里不成立。
- **`role_menu` 用角色 CODE 做外键语义**：既能直接跟 `http.user.roles` 对齐，又意味着"按角色 id 查菜单"要先反查 code，比直觉的"存 id"多一步。
