# system 管理前端模板模块 · 设计文档

- 日期：2026-10-16 15:26
- 状态：设计评审中
- 需求来源：用户提供的规格书（本文件 §1 摘录，原文以会话记录为准）
- 关联：`49ad2a5f`（oj-wiki 迁移指南）、devkit manual §2/§3、cli 0.2.0

## 1. 需求摘要

0.2.0 已完成后端管理面（`/api/system/*` + `/api/auth/*`）但未随框架发布管理前端；业务工程（oj-wiki）删除自建管理页后出现 UI 空窗。本阶段以**模板模块**形态补齐：`packages/cli/templates/web/src/system/`（entry.ts + pages/ + locales/），随 `ojm init` 复制并登记 `web.config.ts`；版本建议 0.2.1（纯增量）。

页面清单与端点映射（规格书 §3）：

| 页面 | 路由 | 端点 | 备注 |
| --- | --- | --- | --- |
| 用户管理 | `/system/users` | GET/POST `/system/users`；PUT `/system/users/forbidden?uid=`；PUT `/system/users/password?uid=` | 建号/重置默认 must_change=1，前端提示首登改密 |
| 成员资格 | `/system/users/:uid/roles` | PUT `/system/users/roles?uid=` | 仅 superadmin；回显见 §3.2 |
| 角色/权限 | `/system/roles` | GET `/system/roles`、`/system/permissions` | 只读视图，不暴露建/删角色 |
| 操作日志 | `/system/oplog` | GET `/system/oplog?action=&username=&module=&limit=` | data 形状 `{list,total,truncated}` |
| 站点设置 | `/system/settings` | GET/PUT `/system/settings` | 只动框架键，业务自定义键不进入 |
| 登录方式 | `/system/login-methods` | GET `/system/login-methods` | 只读展示 local/ldap/sso |

红线（规格书 §5）：模块名/前缀固定 `system`；不 import 业务模块；业务自定义配置走业务自己的 admin 页；模板不带 `__client`，init 后 `oj openapi` + `ojm api` 生成；模板代码按 strict 口径自查。

## 2. 探查结论（代码库核实，2026-10-16）

1. **无现成参照**：`apps/playground-oj/web/src/system` 是旧 mock 版（user/role/menu/dept + runtime `SystemApiProvider`），与新规格 6 页（oj 后端 `/system/*`）完全不同，不迁移、不参照。
2. **`/system/users/roles` 只有 PUT**（`templates/api/src/system/users/roles/api.ts` 仅 `put`）。规格书写的 GET/PUT 中 GET 不存在——成员资格页当前角色回显改从 `GET /system/users` 的 `UserRow.roles` 取（见 §3.2）。
3. **settings 键名与规格书字面不符**：seed 实际为 `framework.site_title`、`ldap_base_dn`（无 `ldap.` 前缀）等，且含业务工程会追加的自定义键。「只动框架键」按 **`module` 字段过滤**实现（见 §3.3）。
4. **模板不带 `__client` 与手册一致**：devkit manual §2.2 明文「生成前 import `./__client/api` 必然 ts 报红……产物还没生成」。fresh init 未生成时 system 模块经 module-loader 标 `error`、app 正常启动，属预期降级；在模板 README 补首次使用说明，不改 `init.ts`。
5. 其余核对无冲突：端点出参形状（`UserRow`、`OplogPage{list,total,truncated}`、`RoleRow`、`SettingGroup`、`{methods}`）；`assertSystemAdmin` 403；`create_time` 为毫秒（`Date.now()`）；runtime user store 含 `roles`；client 方法名由 operationId camelCase 推导（如 `systemUsersGet`、`systemOplogGet`）；cli/runtime 当前 0.2.0，发版 0.2.1 合理。
6. **冒烟可行性**：`apps/playground-oj/bin/oj`（v0.1.69）可复用，临时工程验证不依赖联网下载 bin。

## 3. 设计决策（规格书未细化部分）

### 3.1 模块骨架与 client 接线

- `/system` 父路由：`handle.layout = "container"`、`order = 100`、`config.requiredRoles = ["admin"]`；子路由 6 条（成员资格带 `:uid` 参数，`hideInMenu`）。
- i18n：`system:` namespace，`zh-CN.json`/`en-US.json`；settings 的 `label_key`（seed 值 `system:setting.*`）落在本模块 locale。
- client 接线：`entry.ts` onInit 里 `createSystemClient(ctx)`（登记 `/system` 前缀 + scoped request，D11），页面直接 `import { systemUsersGet, ... } from "../__client/api"`——生成函数为模块级导出，onInit 先于路由渲染完成 `req` 绑定（与 notification 模板同款模式）。
- 方法名推导（openapi-ir `camelCaseOperationId`，实现后以真实生成物为准）：`systemUsersGet/Post`、`systemUsersForbiddenPut`、`systemUsersPasswordPut`、`systemUsersRolesPut`、`systemRolesGet`、`systemPermissionsGet`、`systemOplogGet`、`systemSettingsGet/Put`、`systemLoginMethodsGet`。

### 3.2 成员资格页

- 入口显隐：`useUserStore` 的 `roles` 含 `superadmin` 才显示（规格 §4）；路由不加 roles 限制（后端 service 层硬 enforcement 兜底）。
- 当前角色回显：后端无 GET，从 `GET /system/users` 列表按 uid 取 `roles`；保存用 PUT 整集替换。
- 403 主场景：admin（非 superadmin）手输 URL 可进本页，PUT 时后端 `assertMembershipAllowed` 返回 403 → 页面渲染「无权限」面板（§3.4）。
- 自操作防护：目标 uid 为本人时保存按钮禁用（后端 `assertNotSelf` 400 兜底，前端不给会失败的按钮）。

### 3.3 站点设置页

- 过滤规则：`SettingGroup[].items` 中 `item.module ∈ {framework, ldap, sso}` 才渲染——对规格「只动框架键（site_title / ldap.* / sso.*）」的落地；键名不带前缀的 `ldap_base_dn` 等靠 module 字段正确归入。业务键（如 wiki `mw_config`）与 `market.cdn_url`（security 组，super-only 写）不进页面。
- 编辑：`type=bool` → Switch（"1"/"0"），其余 Input；secret 项恒 `***` 只读（后端读取面已掩码）；逐项 PUT 保存。

### 3.4 403 处理与错误文案

- 路由级门禁与页面级 403 分工：`config.requiredRoles = ["admin"]` 使非 admin 根本不注入 /system 路由（B16），直达 URL 落框架兜底页；**页面级 403 面板只服务「路由可进但 API 403」**——主场景是 admin（非 superadmin）手输 URL 进成员资格页后 PUT 被 service 层拒绝。
- 页面数据加载统一 catch `ContractApiError`：`code === 403` 渲染「无权限」面板（模块内小组件），不依赖 error boundary。
- 错误文案：已知业务错误前端 i18n 映射人话（403、password too short、username exists/reserved 前缀、cannot operate on yourself），未知错误透传后端 `msg`。

### 3.5 页面形态

全部为 antd Table/Descriptions/Modal 薄页，零新增依赖。数据层统一用 `@tanstack/react-query`（宿主 importmap 共享单例，manual §2.6 矩阵内）：query key 按端点+参数，mutation 成功后 invalidate 对应 query。

- 用户管理：表格 + 建号 Modal（成功提示「首次登录须改密」）+ 行内禁用 Switch、重置口令动作（确认 Modal）。**本人行**禁用禁用/重置口令动作（后端 `assertNotSelf` 400 兜底）。建号表单校验对齐后端规则：username 必填 trim、拒 `ldap:/`、`sso:/` 前缀（提示为外部身份保留）、password ≥ 6、displayName/email 可选。
- 成员资格：`/system/users/:uid/roles`，角色多选 + 保存。
- 角色/权限：单页上下两块只读表——角色（builtin/deprecated 标灰、holders、permissions tags）+ 权限点全量（deprecated 标灰）。权限点 `title_key` 是跨模块 namespace（如 `wiki:perm.*`），本模块 locale 不命中时回退显示 `code`。
- 操作日志：过滤表单（action/username/module/limit）+ 表格 + `truncated` 提示条。
- 站点设置：按 group 分组卡片表单。
- 登录方式：Descriptions 只读。

### 3.6 临时工程冒烟机制（T6 落地方式）

npm 上 `@oj-module/cli` 最高 0.1.21，0.2.0 未发布——模板 package.json 钉的 0.2.0 直接 install 会失败。机制：

1. monorepo 内构建 cli（含 `shell-dist` 宿主产物）与 runtime；
2. `node packages/cli/dist/index.js init /tmp/ojm-smoke` 出临时工程；
3. 临时工程 `pnpm.json` overrides 把 `@oj-module/cli`、`@oj-module/runtime` 指向本地 `file:` 路径后再 install；
4. 预拷 `apps/playground-oj/bin`（oj v0.1.69，本地已有）进临时工程，init 幂等跳过联网下载；
5. `pnpm dev`（起 oj 后端）→ `oj openapi -o openapi.json` → `ojm api` 生成 `__client` → 按 §4 点检。

### 3.7 改动面

| 位置 | 动作 |
| --- | --- |
| `packages/cli/templates/api/src/system/**/api.ts` | **9 文件补 `.schema`/`.response` 契约**（round2 R9：无契约端点生成的 client 无参不可用；逻辑零改动） |
| `packages/cli/templates/web/src/system/**` | 新增（entry.ts + pages/×6 + locales/×2 + shared.tsx） |
| `packages/cli/templates/web.config.ts` | 登记 system 模块项 |
| `packages/cli/templates/README.md` | 补「系统管理模块首次使用」生成说明 |
| `docs/plans/2026-10-16-*` | 本文档 + 实现计划 + 任务状态更新 |

不动：runtime、init.ts、api 模板（端点已有 rbac-*.spec 覆盖）。

## 4. BDD 用例

### 4.1 模块装载（静态可验）

```gherkin
Feature: system 模板模块随 init 分发
  Scenario: 新 init 工程包含 system 模块
    Given cli 模板含 web/src/system/entry.ts 与 6 个 pages、2 份 locales
    And 模板 web.config.ts 登记 { name: "system", entry: "web/src/system/entry.ts", enabled: true }
    When 在空目录执行 ojm init
    Then web/src/system/ 全部落盘且 web.config.ts 含 system 项

  Scenario: 未生成 __client 时的降级
    Given 工程未跑 oj openapi + ojm api
    When ojm dev 启动
    Then app 正常启动，system 模块标 error（单模块失败不致命）

  Scenario: 生成 __client 后可用
    When 依次执行 oj openapi -o openapi.json、ojm api
    Then web/src/system/__client/api.ts 生成且方法名含 systemUsersGet、systemOplogGet 等
    And ojm dev 重启后 6 页可访问
```

### 4.2 权限门禁（浏览器冒烟）

```gherkin
Feature: 管理页门禁
  Scenario: admin 可见可用
    Given admin 登录新 init 工程
    When 打开菜单「系统管理」
    Then 6 页全部可访问且数据可加载

  Scenario: 非 admin 不可达（路由级）
    Given 非 admin 角色用户登录
    When 打开菜单或直达 /system/* 任意页
    Then 菜单无「系统管理」，直达 URL 落框架兜底页（路由未注入，B16），非报错边界

  Scenario: admin 触碰 superadmin-only 操作（页面级 403）
    Given admin（非 superadmin）手输 URL 进入 /system/users/:uid/roles
    When 提交角色修改
    Then 渲染「无权限」面板（ContractApiError 403），非报错边界

  Scenario: 成员资格入口仅 superadmin
    Given admin（非 superadmin）登录
    Then 用户管理页不出现成员资格入口，本人行禁用/重置口令动作不可用
    When superadmin 登录
    Then 成员资格入口可见并可保存角色；本人行同样禁用自操作
```

### 4.3 页面行为（冒烟点检单）

| # | 页面 | Given | When | Then |
| --- | --- | --- | --- | --- |
| 1 | 用户管理 | admin 登录 | 建号 user1/123456 | 列表出现 user1，提示首登改密；user1 登录被要求改密；短密码/ldap: 前缀用户名被前端拦截 |
| 2 | 用户管理 | 列表含 user1 | 禁用切换 | is_forbidden 翻转；被禁用户登录被拒 |
| 3 | 用户管理 | 列表含 user1 | 重置口令 | must_change=1；旧口令失效 |
| 4 | 成员资格 | superadmin | 勾选 editor 保存 | GET /system/users 中 user1.roles 含 editor；对自己保存被禁用 |
| 5 | 角色/权限 | admin | 打开页面 | 角色表含 superadmin/admin/editor/viewer；deprecated 权限标灰；无增删按钮 |
| 6 | 操作日志 | 已有操作记录 | 按 action=username 过滤 | 列表联动；total 正确；超限时出现 truncated 提示 |
| 7 | 站点设置 | admin | 改 framework.site_title 保存 | 重新 GET 值已变；业务自定义键不出现在页面 |
| 8 | 登录方式 | ldap.enabled=0 | 打开页面 | 仅 local；置 1 后出现 ldap |

## 5. 任务清单

- [ ] T1 设计文档评审通过（本文档）
- [ ] T2 新建分支 `feat/system-admin-web`
- [ ] T3a api 契约：system 12 端点补 `.schema`/`.response`（round2 R9；实现计划 Task 2）
- [ ] T3 `templates/web/src/system/`：entry.ts + locales + 6 页 + 无权限组件；strict 口径自查（冒烟工程 typecheck）
- [ ] T4 `templates/web.config.ts` 登记 + README 首次使用说明
- [ ] T5 静态验证：模板模块 tsc strict 自查、`pnpm build`、`pnpm test:cli` 回归、`ojm api --check` 零漂移
- [ ] T6 临时工程冒烟：按 §3.6 机制（本地 file: 依赖 + 预拷 bin/oj）init → 起后端 → 生成 `__client` → 按 §4.2/§4.3 点检 6 页
- [ ] T7 文档收尾：任务状态 + 总结段（关键过程与耗时）

## 6. 评审记录

### round1（2026-10-16，产品 / 工程 / 架构三视角复审）

| # | 视角 | 发现 | 处置 |
| --- | --- | --- | --- |
| R1 | 产品 | 原 §4.2「非 admin 访问渲染无权限」表述错误：`requiredRoles` 过滤（B16）后非 admin 无此路由，直达落框架兜底页；页面级 403 只适用「路由可进、API 403」 | §3.4 分工改写，§4.2 拆成路由级/页面级两条 Scenario |
| R2 | 产品 | 成员资格页 403 主场景明确化：admin 手输 URL 进页后 PUT 被 service 拒 | §3.2 补场景 |
| R3 | 工程 | 自操作防护缺失：后端 `assertNotSelf` 400，前端却提供会失败的按钮 | §3.2/§3.5/§4.2/§4.3 补本人行禁用 |
| R4 | 工程 | 建号表单校验无依据 | 对齐后端 createUser 规则（trim、保留前缀、密码 ≥6）写入 §3.5 |
| R5 | 工程 | 数据层未定 | 统一 `@tanstack/react-query`（宿主共享单例），§3.5 |
| R6 | 工程 | 权限点 `title_key` 跨 namespace 不命中会显示裸 key | §3.5 补回退显示 code |
| R7 | 架构 | **npm 最高 0.1.21，0.2.0 未发布**——临时工程按模板 package.json 装 0.2.0 必失败，T6 原写法不可执行 | 新增 §3.6 冒烟机制（本地 file: overrides + 预拷 bin/oj），T6 引用 |
| R8 | 架构 | 错误透传后端英文 msg 不合 i18n 预期 | §3.4 已知码前端映射，未知透传 |

### round2（2026-10-16 15:37，计划期发现）

| # | 视角 | 发现 | 处置 |
| --- | --- | --- | --- |
| R9 | 工程 | **12 个 system handler 均无 `.schema`/`.response`**——emit-client 对无契约端点发无参函数（不传 query/body，`emit-client.ts emitEndpoint`：slots 空 → argDecl 空、opts 空），生成的 client 全部无法携带 uid/过滤参/请求体，前端页面不可用 | handler 按 manual §3.3 补契约（命名函数 + 挂属性，业务逻辑零改动）；服务层已在 listUsers/listRoles 内做 `Number(x)===1` 布尔归一，`.response` 可安全用 `boolean` |
| R10 | 工程 | 页面行类型若模块内手写 interface 会与生成类型漂移 | 行类型从生成类型派生（`type UserRow = SystemUsersGetData[number]`），单一真源（DRY） |

未采纳：合并「登录方式」进设置页（规格书明确 6 路由，维持）；临时工程改 e2e 脚本固化（冒烟属验收动作，成本不值，0.2.x 暂人工点检）。

## 7. 总结

（阶段完成后回填）
