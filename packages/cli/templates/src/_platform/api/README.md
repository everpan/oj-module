# `_platform` —— 平台内核层

本目录是 oj 框架的**平台内核**，不是业务模块（manifest `name: _platform` 仅声明共有表，
不拥有业务路由前缀）。它服务于 `api/src` 下所有第一方内置模块（`system`/`auth`/`home`/…）
以及运行时经方案市场安装的方案包。

## 三层职责

1. **`_shared/service/`** —— 跨模块服务（被业务模块向上 import）。
   - `infra/`：跨模块基础设施（与具体业务无关的通用能力）
     - `guard.ts` 判权决策矩阵（AC1-1~6）
     - `access.ts` 判权 IO 出口（`assertSuperAdmin` / `assertSystemAdmin` / `assertPermission`）
     - `query.ts` 分页/模糊查询工具
     - `rate.ts` 速率限制（登录失败/联系人查询）
     - `audit.ts` 审计原语（`auditOp` / `auditDeny`）
     - `oplog.ts` 操作日志查询（`searchOplog`）
   - `domain/`：管理域共享服务（多模块共用的「系统管理」域逻辑，所有权归 `_platform` 的 `sys_*` 表）
     - `users.ts` / `roles.ts` / `settings.ts` / `solution-perms.ts` / `contacts.ts`
2. **`_lifecycle/`** —— 方案生命周期引擎（安装/卸载/注册/验签/信任的声明式状态机，
   与编排端点 `market/api.ts` 职责分离，见 `market/api.ts` 顶部 ISP 注释）。
3. **编排 API 面** —— 经 oj 扫描 `src/**/api.ts` 暴露，路径前缀即目录名：
   - `contacts/api.ts` → `/api/_platform/contacts`
   - `market/api.ts` → `/api/_platform/market`（方案市场，全 superadmin 门禁，R9）
   - `solutions/api.ts` → `/api/_platform/solutions`（方案路由/验签数据源）

## 边界约定

- 平台内核**不写**业务功能；业务功能归属第一方模块（`/api/<模块>/*`）或运行时方案包。
- `migrations/` / `schema.yaml` / `seed*.sql` 落地平台共有表（`users` + RBAC 六表 + 设置/日志/路由注册 + 信任库）。
- `system` 模块管理这些 `sys_*` 表，但其领域服务在本目录 `domain/`（共享内核），
  非 `system/` 内——避免跨模块 import 私有目录。
