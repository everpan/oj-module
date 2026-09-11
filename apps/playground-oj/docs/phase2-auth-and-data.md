# Phase 2 — 认证与数据层

> 阶段目标（计划 §4）：login 模块退化纯页面；web 真实化（user-info / get-async-routes / country-calling-codes + 双账号 seed）；system 自管数据层（roles/menus/role_menu）；两账号权限差异可断言。
>
> 完成标准：admin/12345 与 common/12345 的 user-info / get-async-routes 返回可断言不同；system 三张表建好且 seed 落库。

## 执行步骤

| 步骤 | 动作 | 关键产物 | 验证 |
|---|---|---|---|
| P2-1 | login 模块删除自注册 `authProvider` + `apiPrefix`，回落 runtime 默认登录链 | `modules/src/login/entry.ts` 纯页面模块 | dev login 走内置 `auth/login`+`web/user-info` |
| P2-2a | `web/user-info` 真实化：按 `http.user.id` 查 `users` 表，snake→camel | `api/src/web/user-info/api.ts` | 登录后返回当前用户 roles |
| P2-2b | `web/get-async-routes` 真实化：按 `http.user.roles` 过滤 `menus`+`role_menu` 拼路由树 | `api/src/web/get-async-routes/api.ts` | admin/common 返回树不同 |
| P2-2c | `web/country-calling-codes` 静态常量端点（对齐根仓 fake，F9 无消费方） | `api/src/web/country-calling-codes/api.ts` | 返回国家码数组 |
| P2-2d | `web/seed.sql` 改为 admin/12345 + common/12345（bcrypt 配方注头），删模板 admin/123456 | `api/src/web/seed.sql` | 双账号可登录 |
| P2-3 | system 自管数据层：manifest + schema + 单迁移文件 + seed（roles/menus/role_menu） | `api/src/system/{manifest.yaml,schema.yaml,migrations/0001__create_system_tables.sql,seed.sql}` | `oj migrate` 建表；seed 落库 |
| P2-3fix | oj 要求每个模块目录都有 `manifest.yaml`，补 demo/home/notification/personal-center 的极简 manifest | 4 个 `manifest.yaml` | `oj migrate` 不再报 missing manifest |
| P2-4 | curl 双账号冒烟：login→user-info→async-routes，断言树差异 | 冒烟脚本（终端执行） | admin 4 节点 / common 2 节点，断言通过 |

## P2-1：login 退化纯页面

**动机（F3）**：login 模块不再"接管"登录链路，而是纯页面——登录逻辑回落到 runtime 默认链：

- `fetchLogin` → 内置 `auth/login`（oj 的 `users` 表 bcrypt 校验）；
- 守卫 `getUserInfo` → `web/user-info`（本阶段 P2-2a 实现）；
- `useAuthStore().login` 在**无注册 provider** 时走 `fetchLogin`（见 `packages/runtime/src/store/auth.ts`）。

`modules/src/login/entry.ts` 删除 `lifecycle.onInit` 里的 `ctx.register.apiPrefix("/login")` 与 `ctx.register.authProvider({...})`，仅保留 `routes`（声明 `/login` + `handle.login:true` + `layout:"fullscreen"`）与 `i18n`。模块只负责"内容区"，外壳由框架注入。

## P2-2：web 真实化

### user-info（`api/src/web/user-info/api.ts`）

```ts
const rows = await db.query(
  "SELECT id, username, roles FROM users WHERE id = ?", [Number(uid)]);
// roles 列是 JSON 字符串，需 JSON.parse 成数组
json.ok({ id: String(row.id), username: row.username, roles, /* ... */ });
```

- `http.user.id` 是 JWT 里的 uid 字符串；`db.query` 参数用 `Number(uid)` 对齐 integer 主键。
- `roles` 列在库里是 `'["admin"]'` 字符串，handler 内 `JSON.parse` 还原成数组（与 oj `auth/login` 写入时的编码一致）。

### get-async-routes（`api/src/web/get-async-routes/api.ts`）

- 按 `http.user.roles` 用 `JOIN role_menu ON role_menu.menu_id = menus.id` + `WHERE rm.role IN (...)` 取菜单。
- 在内存里按 `parent_id` 拼成嵌套路由树（形状对齐 `AppRouteRecordRaw`：`path` + `handle:{title,icon}`）。
- **跨模块读**：menus/role_menu 归属 system 模块。oj 默认 `ownership_guard=warn`，仅告警不拒绝；生产应在 `web/manifest.yaml` 声明 `deps:[system]` 并切 `deny` 收紧（见阶段小结"反常规点"）。
- 表不存在 / 出错时 `catch` 回落空数组，避免登录链路崩溃。

### country-calling-codes（`api/src/web/country-calling-codes/api.ts`）

- 静态常量端点，无前端消费方（F9 演示 fake→oj 迁移对照）。
- 形状对齐根仓 `fake/constants.ts` 的 `COUNTRIES_CODE`（`{cn,en,code}`），取常用子集（约 30 条）足够演示。

### seed.sql 双账号

- 密码统一 `12345`，bcrypt cost=10，前缀 `$2b$`（由 `bcryptjs.hashSync("12345",10)` 生成，与 oj 的 Rust `bcrypt 0.15` 互通）。
- **务必 `;` 分隔多语句**，且注释里也不能出现 `;`（见 gotchas）。

## P2-3：system 自管数据层

三张表（schema.yaml 为声明源，自动收敛；同时给显式迁移便于走完整链路）：

- `roles(id, name, code, status, remark, create_time, update_time)`
- `menus(id, parent_id, name, path, component, icon, sort, type, permission, status, ...)`
- `role_menu(id, role, menu_id, UNIQUE(role, menu_id))`

seed 清单（F8b）：
- roles：admin(1) / common(2)
- menus：100 首页 / 101 系统(catalog)[102 角色,103 菜单] / 104 关于 / 105 异常(catalog)[106 403,107 404]
- role_menu：**admin 全部 8 项**；**common 仅 100 首页 + 104 关于**（演示 F2 API 级权限差异）

## P2-4：权限差异冒烟（结果）

```
[admin]    login ok uid=1 roles=['admin']
[admin]    /web/user-info   username=admin   roles=['admin']
[admin]    /web/get-async-routes  nodeCount=4  paths=['/home','/system','/about','/exception']
[common]   login ok uid=2 roles=['common']
[common]   /web/user-info   username=common  roles=['common']
[common]   /web/get-async-routes  nodeCount=2  paths=['/home','/about']
ASSERT admin(4) != common(2): True  →  PASS
```

## 关键 gotchas（教学要点）

1. **seed.sql 的分号陷阱**：oj 按 `;` 朴素切分 seed 语句，**语句内与注释内都不得出现 `;`**。第一版 system seed 的注释写了"按 ; 朴素切分"，被当成语句分隔符 → `syntax error`。改成"按分号朴素切分"后通过。
2. **INSERT OR IGNORE 不会更新已有行**：改已 seed 的 admin 密码必须**删库重 seed**（dev 库 `api/db.sqlite` 已 gitignore，可直接删）。否则旧行仍在、新 INSERT 被 IGNORE。
3. **每个模块目录都要 manifest.yaml**：`oj migrate`/`oj server` 要求 `src/<module>/manifest.yaml` 存在，否则 `module 'demo' missing manifest.yaml` 直接失败。route-only 模块给极简 manifest（仅 name/desc/version，无 tables）即可。
4. **迁移序号必须连续唯一（S007）**：计划原写三个 `0001__create_*.sql` 会因重复序号报 S007，合并为单文件 `0001__create_system_tables.sql`（三张表并入一个迁移）。
5. **bcrypt 盐不同但明文一致**：admin/common 两个哈希不同（bcrypt 随机盐），但明文都是 `12345`，校验互通——这是正确行为，不是 bug。
6. **跨模块读 ownership_guard**：web 读 system 表默认仅 warn；教学上此处有意不声明 `deps` 以暴露"跨模块取数需声明"的纪律（生产应补 `deps` + `deny`）。

## 阶段小结

- 全部 7 步完成，P2-4 冒烟断言通过：两账号 user-info（roles 差异）+ async-routes（树节点数 4 vs 2）均可断言。
- system 三张表经 `oj migrate` 建好，seed 落库（8 项 role_menu：admin 全量 / common 子集）。
- `ojm api --check` 仍 0 error / 0 warn（web 模块整体豁免契约对账）。
- 登录链路完成"模块化登录页 → runtime 默认链 → oj 内置 auth + web 端点"的闭环，为后续 P3 系统 CRUD、P4 业务模块真实化铺好数据底座。

## 反常规 / 反常识点（供 P6 汇总）

- **seed 同时承担"建数据"与"改数据"语义，但 INSERT OR IGNORE 只管前者**：改已存在行的字段必须删库或用 UPDATE——与直觉"改 seed 即生效"相悖。
- **迁移序号 S007 强制连续唯一**，导致"一个模块多张初始表"不能拆成多个同号迁移，必须合并或顺号——与"一表一迁移"的直觉相悖。
- **oj 按 `;` 切分 seed，连注释都不放过**：SQL 注释里写 `;` 也会引发语法错误，是其它 ORM/迁移工具不会有的行为。
