# playground-oj 设计评审报告（架构师 + 开发工程师双角色）

- 日期：2026-09-04 01:42
- 评审对象：`docs/prd/202609040105-playground-oj-design.md`（初版）
- 评审方式：双角色并行评审（架构视角 + 落地视角），findings 合并去重
- 处置结果：设计文档已按本报告修订（见文末处置表）

## 总体结论

**需调整后通过**。总体方向（oj + SQLite + 契约机制 + phase 化迁移）与 uni-dev、契约设计两份前置文档高度一致，不推倒重来；但 F1/F2 为架构级误判，P1/P2 即爆雷，动工前必须拍板（已拍板，见处置表）。

## Findings（合并两角色，按严重程度）

### 阻塞级

**F1. runtime 内部 API 路径无 oj 模块段，与契约机制双重冲突**
- 现状调用方走根级路径：`/api/role-list`、`/api/menu-list`、`/api/notifications`、`/api/upload`（`packages/runtime/src/api/system/*`、`api/notifications/`、`form-avatar-item.tsx:33`；role 已契约化但 `apiPrefix "/"`）。
- oj 强制 `{base}/{module}/{path}`；契约 DSL 禁根绝对（AC-D4）、uni-dev 强制 apiPrefix=目录名（AC-D9）——这些端点在 playground-oj 内**无任何契约覆盖方案**，直接 404 成片，P1 就卡死。
- **处置（用户拍板）**：收敛 URL 到模块段，但 runtime 侧不硬改路径——**新增运行时 hook 注入机制**（仿登录模块 authProvider 方案），runtime 内部 api（system role/menu、notifications、upload）支持由模块注入实现，playground-oj 的模块注入走契约 client 的版本；runtime 默认实现保持根级路径不变（根仓主应用 + fake 零影响）。→ 新决策 D9。

**F2. D6"menus 表即路由树单一来源"在 UI 上不可观测（死链路）**
- `auth-guard.tsx` 的 `filterBackendRoutes` 丢弃与模块碰撞的全部后端路由（10 个模块恰好全覆盖 fake 路由树）；后端路由组件只 glob runtime pages，接不到模块页面；角色过滤实际由模块级 `requiredRoles`（B16）实现。
- **处置（用户拍板）**：**仅记录，下次演进**。menus→async-routes 保留实现但降级为 API 级演示（smoke 断言 admin/common 响应差异）；UI 菜单过滤维持 B16；验收措辞修正；menus 种子缩回 fake 规模。记录为已知限制（设计 §10）。

### 严重级

**F3. login 模块 authProvider 与 scoped client 前缀边界冲突**
- authProvider 全量接管 login/logout/getUserInfo 三件套，但 scoped client 单前缀无法横跨 `/auth` 与 `/web`。
- **处置**：playground-oj 的 login 模块退化为纯页面模块（删 authProvider 注册），runtime 默认登录链已适配 `/auth/*` + `/web/user-info` 零改动即通。

**F4. 上传链路三层错位（路径/协议/body）+ blob local 被误判排除**
- 前端 FormAvatarItem 是 multipart 直传根级 `/api/upload` 且 Authorization 是死串；oj 侧 Bearer 守卫会 401。另 oj 有内置 `blob.driver: "local"`（免插件），D7 排除理由不成立。
- **处置**：线上协议保持 multipart（oj 端 `http.files` 收），base64 仅落存储层（维持用户已选 D7 的存储决策）；FormAvatarItem 的 URL 与 token 注入并入 D9 的注入机制统一解决。

**F5. P2/P3 依赖倒置**：get-async-routes（P2 web）依赖 menus 表（P3 system）。
- **处置**：system 数据层（roles/menus/role_menu migrations + seed）提前到 P2；web manifest 声明 `deps: [system]`（跨模块访问，oj ownership_guard 默认 warn）。

### 中/一般级（全部采纳，细节落入设计修订）

- **F6**：不动通用 init 模板；bcrypt(12345) 一次性外部生成硬编码进 seed.sql 并注释生成配方；seed.sql 分号纪律。
- **F7a**：pnpm workspace 归属——init 后把 devDependencies 改回 `workspace:*`/`catalog:`（照抄 playground），否则验证的是 npm 发布版而非本地代码。→ 新决策 D11。
- **F7b**：验收清单补 `oj build --check`（S 门禁）与"contract.ts 进 dist 无害"确认；`schema.yaml/tables 必配`的实际强制程度列入 P0 spike。
- **F8a**："拷贝 10 模块"实为 8 个引用根仓 + 2 个本地——采纳**全部拷贝自包含**（模块需加注入逻辑，不能污染共享的根仓模块；记录 drift 纪律）。→ 新决策 D10。
- **F8b/F12**：menus 列清单以 fake menu-list 响应为事实源补全（current_active_menu/external_link/ignore_access/iframe_link）；种子显式指定菜单 id（100+ 被 role_menu 引用）；camelCase↔snake_case 逐 handler 映射写入口径；role-menu 实为扁平列表（前端 handleTree 转树）；pie 有 `by` query 参数；line year 口径=当年已过月份天数；`parentId` 根标记类型在契约钉死。
- **F9**：country-calling-codes 无消费方——保留但标注"fake 覆盖面演示端点"。
- **F11**：playground-oj 的 oj 端口改 **9779**（9778 与 playground/其他 oj 工程冲突）；`.gitignore` 模板已覆盖无缺口。
- **行为变化记录**：全栈下 `/api/demo/todos` 受 Bearer 守卫，demo 页需登录（playground 现状免登录）。
- **契约白名单结论**：除递归路由树外全部端点可表达；get-async-routes/user-info/auth 内置列入**契约豁免清单**，`ram api --check` 需豁免能力→按 ram 缺口流程处理（设计 §7）。
