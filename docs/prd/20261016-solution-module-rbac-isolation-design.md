# 解决方案模块的角色/权限点 CRUD 与跨模块隔离（设计）

> 状态：设计稿（待评审后实现）。关联：`docs/devkit/manual.md` §2.8 模块边界、模板 `api/src/_platform/_shared/service/{roles,solution-perms,access,guard}.ts`。
> 背景诉求：每个解决方案模块都要对自己声明的角色与权限点做 CRUD；**解决方案 A 不能修改解决方案 B 的权限数据**；runtime 必须对外暴露契约接口（不 import `#src/*`）。

## 1. 现状（已实现的部分）

- `sys_role.module` / `sys_permission.module` 列已存在；权限点约定 `code = "<module>.<action>"`（首段即模块名）。
- `moduleOf(code)`（`guard.ts`）从 code 首段解模块；`decideAccess` 据此支持 `<module>.admin` 自动放行整模块——**权限命名空间天然按模块隔离**。
- `solution-perms.ts` 的 `upsertSolutionPerms(m)` 已按 `m.module`（解决方案真实名）把声明角色/权限点落库（`module = m.module`），安装/升级期同步；卸载走 `uninstallSolution(module)` 双维度级联清理。
- 但**自服务 CRUD 不存在**：当前角色/权限的读写全集中在 `system/roles`（GET/POST/DELETE）+ `system/permissions`（GET），统一 `assertSystemAdmin()`：
  - `createRole` 把 `module` 硬编码写死为 `"custom"`（所有自建角色都归到 `"custom"`，不区分解决方案）；
  - handler 里**拿不到「当前调用方是哪个模块」**（`http.module` 之类的请求级模块身份不存在），无法做服务端按模块收敛；
  - 因此一个解决方案能在 `system` 管理面改到另一个解决方案的权限数据——**无隔离**。

## 2. 设计（方案）

核心思路：用**请求级调用方模块身份**做服务端按模块收敛，所有角色/权限读写都被钉在 `callerModule` 上；前端只传本模块名，真正的隔离由后端强制，不信任客户端 `module`。

### 2.1 原语：调用方模块身份（框架新增，一处改动）

模块路由分发器在调用 handler 前，把「路由归属模块名」注入请求上下文，使 handler 可读：

```ts
// 框架模块路由分发处（伪码）
http.module = moduleDef.name;   // 路由 owner 的模块名，handler 内只读
```

这是隔离的锚点。今天缺它，所以补这一处。

### 2.2 每解决方案模块自服务的 RBAC 端点（scope = callerModule）

需要自服务角色/权限 CRUD 的解决方案，在其自身前缀下挂 RBAC 子路由（框架提供可挂载的 `rbac` 子路由，或模块自己声明均可）。**所有读写一律按 `callerModule = http.module` 收敛**：

| 端点 | 行为 | 隔离规则 |
|---|---|---|
| `GET /api/<module>/rbac/roles` | 列本模块角色 | `WHERE module = callerModule` |
| `POST /api/<module>/rbac/roles` | 建角色 | `module` 强制 = `callerModule`（忽略任何客户端 `module`）；`name` 走 `custom.<slug>` 或 `<module>.<slug>` 命名空间 |
| `PUT /api/<module>/rbac/roles/bindings?name=` | 改绑定 | 先断言该角色 `module === callerModule`，否则 404/403 |
| `DELETE /api/<module>/rbac/roles?name=` | 删角色 | 同上（builtin 硬拒沿用现有 `assertNotBuiltin`） |
| `GET /api/<module>/rbac/permissions` | 列本模块权限点 | `WHERE module = callerModule` |
| `POST/PUT/DELETE /api/<module>/rbac/permissions` | 权限点 CRUD | 强制 `moduleOf(code) === callerModule` |

### 2.3 隔离保证（服务端强制，结构性不可能越界）

后端在每条写路径校验「目标行的 `module === callerModule`」，读路径 `WHERE module = callerModule`：

- 模块 A 的路由被调用时 `callerModule = "A"`；
- 即使 A 的前端恶意/误传 `name = "B.managerRole"` 或 `module = "B"`，该角色 `module = "B" ≠ "A"` → 后端 404/403 拒绝；
- 因此 A **永远写不到 B 的行**。✓

`createRole` 现有的 `module: "custom"` 硬编码改为「强制 = `callerModule`」；管理面（`system`）以 `custom` 为伪模块同样受 scope 约束（admin 上下文）。

### 2.4 runtime 对外开发接口（契约，不碰 `#src/*`）

`@oj-module/runtime/api/rbac` 导出一个**按模块 scoped 的 client 工厂**，解决方案模块不手拼 URL：

```ts
// runtime 导出（新增）
export interface ModuleRbacClient {
	listRoles(): Promise<RbacRole[]>
	createRole(body: { name: string; title: string; permissions?: string[] }): Promise<{ name: string }>
	updateRoleBindings(name: string, codes: string[]): Promise<void>
	deleteRole(name: string): Promise<void>
	listPermissions(): Promise<RbacPermission[]>
	createPermission(body: { code: string; titleKey?: string }): Promise<void>
	updatePermission(code: string, patch: { titleKey?: string; deprecated?: boolean }): Promise<void>
	deletePermission(code: string): Promise<void>
}
/** 传入本模块名（= defineModule 的 name）；URL 形如 /api/<module>/rbac/...，后端按 callerModule 收敛 */
export function createModuleRbac(module: string): ModuleRbacClient
```

解决方案模块用法：

```ts
import { createModuleRbac } from "@oj-module/runtime";

const rbac = createModuleRbac("order");           // 本模块名
await rbac.createRole({ name: "order.manager", title: "订单管理员", permissions: ["order:read", "order:write"] });
await rbac.updateRoleBindings("order.manager", ["order:read", "order:write", "order:refund"]);
```

- 读（当前用户角色/权限）：沿用既有 `useUserStore(s => s.roles / s.permissions)` + `useAccess` / `AccessControl`，**不变**。
- 审计：复用本次新增的 `fetchRbacOplogPost({ action: "role.create", module: "order", ... })`（见 §3），同一契约模式。
- `system` 管理面端点保留给 superadmin 做跨模块全局管理（按需也可按 `module` 查询/操作，但写入仍走上述 scope 规则）。

### 2.5 与现有声明的分工

`solution-perms.ts` 的 `upsertSolutionPerms` 负责**安装/升级期声明同步**（insert-if-absent、声明消失标 deprecated）；本方案的**自服务 CRUD** 负责**运行期管理员在模块内的调整**（建/删角色、改绑定）。两者都按 `module` 收敛，互补不冲突：声明是基线，运行期调整在其上叠加，且都受「模块不能越界」约束。

## 3. 对外接口清单（runtime 契约总览）

| 类别 | 接口 | 形态 |
|---|---|---|
| 读（身份） | `useUserStore` / `useAccess` / `AccessControl` | 既有 hook/组件 |
| 写（自服务 RBAC） | `createModuleRbac(module)` → `ModuleRbacClient` | 本次新增（方案实现后） |
| 审计 | `fetchRbacOplogPost` / `fetchRbacOplog` | 本次已实现（`system/oplog` POST + GET） |
| 改密/改角色（用户级） | `fetchChangePassword` / `fetchRbacUpdateUserRoles` | 既有 |

## 4. 落地步骤（评审通过后）

1. 框架：模块路由分发注入 `http.module`（§2.1）。
2. 后端：新增 `api/src/_platform/_shared/service/rbac-scoped.ts`（或解耦进模块挂载），实现 §2.2 的 scope 规则；`createRole` 改强制 `module = callerModule`。
3. runtime：`api/rbac` 导出 `createModuleRbac` + `ModuleRbacClient` 类型；受 `tests/runtime/runtime-exports.test.ts` 冻结契约守护。
4. devkit §2.8 增补「场景：解决方案模块自管理角色/权限」并标注隔离红线。
5. 守卫测试：新增跨模块越界用例（A 传 B 的 `name`/`module` → 拒）。
