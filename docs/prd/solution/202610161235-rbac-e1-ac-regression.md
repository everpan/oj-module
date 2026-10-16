# E1：AC 全量回归报告（RBAC/账号/通讯录/登录链，feat/rbac-ldap @ 阶段 E）

> 回归基准：设计文档 §8 验收标准（AC1-1~30 / AC2-1~7）。
> 证据形态：`packages/cli/templates/api/tests/*.spec.ts`（142 断言，node:sqlite 真实迁移夹具）+ 真机冒烟（`ojm init` + `ojm dev`，curl 全矩阵）+ 前端导出白名单测试（`tests/runtime/runtime-exports.test.ts`）。
> 结论先行：**AC1 可测 27 项全绿；AC2 规则面 6 项全绿（M5 安装器端到端延后）；AC1-11/14/21 依赖安装器（M5）延后**，其余无缺口。

## 一、AC1 回归明细

| AC | 场景 | 证据 | 结果 |
|---|---|---|---|
| AC1-1 | superadmin 超集 | rbac-guard.spec「AC1-1 superadmin 通过任意 code」 | ✅ |
| AC1-2 | admin 超集 | rbac-guard.spec「AC1-2 admin 通过任意 code」 | ✅ |
| AC1-3 | 模块超集自动推导 + 不外溢 | rbac-guard.spec「AC1-3 持 <模块>.admin…/负例」+ guard.spec 纯函数矩阵 | ✅ |
| AC1-4 | 模块超集不外溢（403 审计归属 module） | rbac-guard.spec 负例 + rbac-audit.spec（module 归属断言） | ✅ |
| AC1-5 | 精确命中绑定 | rbac-guard.spec「AC1-4 角色绑定精确命中」 | ✅ |
| AC1-6 | 无权限 403 + 审计含用户/权限点/模块 | rbac-guard.spec「AC1-5 绑定未命中即 403」+ rbac-audit.spec | ✅ |
| AC1-7 | admin 管日常：sys_user_role 唯一权威源 + 下一次请求生效 | rbac-users.spec「分配/撤销写 sys_user_role；下一次判权即生效（D10）」 | ✅ |
| AC1-8 | admin 不碰成员资格 | rbac-users.spec「AC1-8：admin 分配 superadmin/admin 成员资格 → 403」 | ✅ |
| AC1-9 | superadmin 独占安全项（傀儡角色无入口） | rbac-guard.spec「assertSuperAdmin：admin 也 403（D11）」+ settings.ts SUPER_ONLY_GROUPS 物理判断（market.cdn_url 写须 superadmin，rbac-settings.spec） | ✅ |
| AC1-10 | 最后 superadmin 保护 | rbac-users.spec「AC1-10：自撤角色/自禁被禁止操作自己 400 + 服务端兜底」 | ✅ |
| AC1-11 | bundle 前缀强校验（拒绝裸名） | **延后 M5**（安装器 manifest 校验；命名空间规则已在 AC1-17 服务端建角色侧对称钉死） | ⏳ |
| AC1-12 | LDAP 登录闭环：bind 成功但 is_forbidden=1 → 403 不签发 | auth-ldap.spec「⑧ is_forbidden=1 → 403 不签发」+ 真机信封链 | ✅（真实 bind 待目录环境，§9.4-3） |
| AC1-13 | 吊销收口：撤销/禁用即强退 + refresh 级联 | rbac-guard.spec「D10 撤销即强退」+ rbac-users.spec「禁用：refresh 全删」+ auth-session.spec refresh reuse 全族吊销 | ✅ |
| AC1-14 | 新角色上市 upsert + 下拉可分配 | rbac-solution-perms.spec「AC2-1 …wiki.guest 插入」（规则面）；**安装器端到端延后 M5** | ⏳/✅ 规则面 |
| AC1-15 | 升级不覆写管理员调整 | rbac-solution-perms.spec「AC1-15 重复安装…insert-if-absent」 | ✅ |
| AC1-16 | 框架新建 custom 角色 + 跨模块绑定 | rbac-roles.spec「AC1-16/17：建 custom.reviewer 双写」 | ✅ |
| AC1-17 | 建角色名称冲突 | rbac-roles.spec「AC1-17 保留名/solutions 命名空间/裸名一律 400」 | ✅ |
| AC1-18 | 声明角色绑定可调整 | rbac-roles.spec「AC1-18 声明角色绑定可调整」 | ✅ |
| AC1-19 | 超集/页面门角色不可编辑绑定 | rbac-roles.spec「AC1-19 builtin 角色绑定编辑 403 硬拒」+ 前端 canEditRoleBindings（tests/runtime/rbac-ui-helpers.test.ts） | ✅ |
| AC1-20 | 占用禁删（列持有者） | rbac-roles.spec「AC1-20：有持有者的角色删除被拒并给出人数」 | ✅ |
| AC1-21 | 解决方案无建角色/注册权限点接口 | **延后 M5**（运行期注册通道属安装器职责；服务端仅 upsertSolutionPerms 一个框架出口，见 solution-perms.ts 头注释纪律） | ⏳ |
| AC1-22 | 通讯录登录可读 + 字段收敛 + keyword 红线 | rbac-contacts.spec（目录字段/keyword<2 → 400） | ✅ |
| AC1-23 | 禁用用户不出目录 | rbac-contacts.spec（目录排除 is_forbidden） | ✅ |
| AC1-24 | limit 钳 200 + truncated | rbac-contacts.spec + query-utils.spec（paged 钳制/截断） | ✅ |
| AC1-25 | 后端直调共享 service | contacts service 同 isolate import 直调（handler 与 spec 同源直引，无 HTTP 层） | ✅ |
| AC1-26 | 登录限速 429 + 指数 backoff + 审计 | auth-throttle.spec 6 用例（含落库存证）+ 真机 429 retryAfterMs 30s→60s→120s | ✅ |
| AC1-27 | seed 超管首登改密闭环 | rbac-seed.spec「must_change=1」+ auth-session.spec「B2/AC1-27」+ 前端 must-change-password 内联流程 + 真机悬挂期 403{code:must_change} | ✅ |
| AC1-28 | RBAC 写审计三动作 | rbac-roles.spec「AC1-28 role.create / bindings.update / delete 审计」 | ✅ |
| AC1-29 | 403 审计分钟窗口聚合 | rbac-audit.spec「AC1-29：连续拒绝 3 次 → 1 行 count=3 / 窗口过期另起 / 独立维度」 | ✅ |
| AC1-30 | deprecated 紧急吊销 | rbac-roles.spec「AC1-30 摘绑定 → 下一次判权即 403」+ rbac-guard.spec「deprecated 判权不过滤」双向过滤方向钉死 | ✅ |

## 二、AC2 回归明细（升级稳定性；规则面 = 模拟安装器 upsert 逻辑单元测试）

| AC | 场景 | 证据 | 结果 |
|---|---|---|---|
| AC2-1 | 新增声明 upsert；既有绑定不变 | rbac-solution-perms.spec「AC2-1 新增声明…」（after = before + 新角色声明绑定恰 1 行） | ✅ 规则面 |
| AC2-2 | 元数据 title 覆盖，判决不变 | rbac-solution-perms.spec「AC2-2 title 元数据覆盖」 | ✅ 规则面 |
| AC2-3 | 声明消失 → deprecated 保留，绑定继续生效 | rbac-solution-perms.spec「AC2-3 声明消失…判权不过滤」 | ✅ 规则面 |
| AC2-4 | 重命名 → 旧 deprecated + 新插入 + 告警清单 | rbac-solution-perms.spec「AC2-4 重命名…deprecated 清单」 | ✅ 规则面 |
| AC2-5 | 升级零减法 | rbac-solution-perms.spec 多断言含「before ⊆ after」+ 卸载对照组不动 framework | ✅ 规则面 |
| AC2-6 | 卸载双维度级联清理，custom 角色保留 | rbac-solution-perms.spec「AC2-6 双维度删除…custom 本体保留」 | ✅ 规则面 |
| AC2-7 | 卸载不删业务表（运维提示） | 流程项无代码面；卸载出口 uninstallSolution 只触 RBAC 四表（solution-perms.ts 注释声明 Q4 边界） | ✅ 边界声明 |

**延后说明（M5）**：AC2 端到端（真 manifest 走真安装器）、AC1-11（安装器 manifest 前缀校验）、AC1-14 的安装器链路、AC1-21（运行期注册通道的不存在性端到端）。规则已由 `upsertSolutionPerms/uninstallSolution` 两个唯一出口钉死，安装器（M5）实现时必须直接复用，不得另写。

## 三、真机冒烟矩阵（ojm init + oj dev / oj build，oj v0.1.74）

| 检查项 | 结果 |
|---|---|
| admin/123456 登录签发双 token | ✅ |
| 错口令 → 401 统一信封（D14） | ✅ |
| refresh 伪串 → 401 | ✅ |
| must_change 悬挂期访问管理端点 → 403 {code:"must_change"} | ✅ |
| 连败 6 次后第 7 次 → 429 retryAfterMs 指数 30s→60s→120s | ✅ |
| 匿名 /system/login-methods（开关驱动 local/ldap） | ✅ |
| LDAP 未启用 → 400 / 缺 base_dn → 400 / 无上游 → 502 | ✅ |
| `ojm build` 全链（后端 bundle + 前端 + 清单） | ✅（§9.4-1 introspect 红线修复后） |
| uni-dev e2e（init→dev→login→build→preview） | ✅（套件 105 文件 684 断言绿） |

已知波动项：`tests/playground/playground-e2e.test.tsx` 单次偶发路径断言抖动（隔离重跑两次均绿），与 RBAC 变更无涉，记录待观察。

## 四、回归结论

- **可测 AC 全绿**：AC1 × 27 + AC2 × 6（规则面），合计 142 条模板断言 + 前端白名单/纯函数测试 + 真机矩阵。
- **延后至 M5**：AC1-11 / AC1-21、AC2 端到端、LDAP 真实 bind（§9.4-3 前置条件）。
- 回归完成时间：2026-10-16 12:35；执行人：ever + ai。
