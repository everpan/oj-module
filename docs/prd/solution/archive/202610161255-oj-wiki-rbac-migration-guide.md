# oj-wiki 迁移指南： onto RBAC/账号/通讯录框架（oj-module 0.1.21 → 0.2.0）

> 读者：oj-wiki 工程维护者。前置阅读：`docs/devkit/manual.md` §1.7（handler 四红线）。
> 迁移后 wiki **删除一批自建实现**（登录链/用户管理/LDAP 入口），全部改走框架出口；
> 空间特权（`space_user`）、外部联系人簿（`mw_contact`）、业务日志（`mw_log`）属 wiki
> 业务面，**保留不动**。
> 基线：oj-module feat/ojm（0.2.0，2026-10-16 合并）；oj binary ≥ 0.1.73（冒烟基准 0.1.74）。

## 0. 总览：什么消失、什么保留

| wiki 自建件 | 框架替代（0.2.0 模板） | 动作 |
|---|---|---|
| `users.roles` JSON 列（isGlobalAdmin / user-info / users service 三处消费） | `sys_user_role` 唯一权威源（D10） | **数据迁移**（Step 2），列由迁移 0003 DROP |
| `auth/login|logout|refresh` + `auth/_shared/session.ts` | `/api/auth/*` + 模板 session（JWT 仅 sub、refresh 轮换、must_change 悬挂） | 删除并轨；**MD5 兼容经 deps 注入保留**（Step 3） |
| `wiki/account/`（ldap-login、login-methods） | `/api/auth/ldap-login` + `GET /system/login-methods` | 删除；配置迁 `sys_setting`（Step 4） |
| `wiki/system/api.ts` 用户管理五端点 + users service | `/api/system/users*`（roles/password/forbidden 子端点） | 删除（Step 5） |
| `isGlobalAdmin`（读 users.roles 含 "admin"） | `assertSystemAdmin` / `assertSuperAdmin` | 换数据源（Step 6） |
| `mw_config` 的 `ldap_*` 四键 | `sys_setting`（`ldap.enabled` / `ldap_base_dn` / `ldap_uid_attr` / `ldap_email_attr`） | 键改名迁移（Step 4） |
| `wiki/system` 的 logsGet（mw_log 管理面） | 框架 `GET /system/oplog`（sys_oplog）二选一 | 建议审计走框架，mw_log 业务日志保留（Step 9） |
| `web/src/wiki/pages/admin-users.tsx` 等管理页 | 框架 `web/system` 模块四页 | 删页、manifest 注册 system 模块（Step 11） |
| `web/user-info`（wiki 定制版） | 模板版（roles 走 sys_user_role JOIN + must_change） | 用模板版（Step 12） |
| `space_user` 空间特权 / `hasAnyEditorRole` | —（wiki 业务级判权） | **保留** |
| `mw_contact` 外部联系人簿（name/mobile/email/position） | 框架通讯录 = users 表（用户目录） | **保留**（语义不同：外部联系人对用户目录） |
| `wiki/sso/`（HTTP 表单 SSO） | 框架 SSO 未落地（演进方向） | **保留**；签发改调模板 session `issueExternal`（Step 13） |
| `mw_config` 的 system_name / send_email_open / auto_follow_doc_open | 框架未覆盖（wiki 业务配置） | **保留** mw_config 与 configsGet/Post；仅 ldap_* 迁出 |

## 1. 依赖与 vendor 升级

```bash
# package.json：@oj-module/cli 与 @oj-module/runtime 精确版本 → 0.2.0
# pnpm-workspace.yaml 允许版本同步放开 0.2.0
pnpm install
ojm vendor            # 拉 oj ≥ 0.1.73（冒烟基准 0.1.74）
ojm info              # 核对版本组合
```

## 2. 迁移账本并轨（**先做，顺序敏感**）

wiki `_platform/migrations` 已有 0001–0006，与模板 0001–0009 **重号不同名**。oj 账本按
**文件名**记账，重号不冲突，但同义迁移会被重复执行（加列二次 ALTER 直接报错）。并轨表：

| wiki 现有 | 模板对应 | 处置 |
|---|---|---|
| 0001 create_users / 0002 avatar_base64 | 同名同义 | 保留 wiki 版（文件名一致，账本已应用，互跳） |
| 0003 versions | （模板 0003 是 users_source_display_name） | wiki 0003 保留；**新增模板 0003/0004/0005 时改名让号**：wiki 侧把模板文件复制为 0007–0009 序号（账本只看文件名，顺序按号） |
| 0004 email / 0005 is_forbidden / 0006 must_change | 模板 0007 email / 0006 is_forbidden / 0005 must_change | wiki 已应用，**不复制模板同义文件**；把模板 0004__sys_rbac（六表）落为 wiki 的 0007 |

落地序列（wiki _platform/migrations 终态）：

```
0001__create_users.{sql,mysql.sql,pg.sql}        # 现有
0002__add_users_avatar_base64.{sql,mysql.sql}    # 现有
0003__versions.{sql,mysql.sql,pg.sql}            # 现有
0004__add_users_email.sql                        # 现有
0005__users_is_forbidden.{sql,mysql.sql,pg.sql}  # 现有（内容同模板 0006，文件名沿用 wiki 的）
0006__users_must_change.{sql,mysql.sql,pg.sql}   # 现有（同上）
0007__sys_rbac.{sql,mysql.sql,pg.sql}            # ← 模板 0004 六表 + sys_setting/sys_oplog 全量
0008__sys_refresh_token.{sql,mysql.sql,pg.sql}   # ← 模板 0008
0009__sys_throttle.{sql,mysql.sql,pg.sql}        # ← 模板 0009（限速状态落库，§9.3-3）
0010__users_source_display_name.{sql,mysql.sql,pg.sql}  # ← 模板 0003，**必须排最后**（DROP users.roles）
```

> **顺序红线**：`users_source_display_name` 加 `source`/`display_name` 并 **DROP users.roles**
> ——wiki 的 roles JSON 数据必须**先搬到 sys_user_role**（Step 3 的数据迁移在 0010 之前
> 手工执行，见下）。dev（migrate_on_start: auto）下把 0010 放到最后一次重启再落。

## 3. users.roles JSON → sys_user_role 数据迁移（一次性）

在 0010 迁移应用**之前**执行（roles 列还在）：

```sql
-- 1) JSON 角色落表（sqlite；mysql 用 JSON_TABLE/pg 用 jsonb 数组展开，语义同）
INSERT OR IGNORE INTO sys_user_role (user_id, role_name)
SELECT u.id, json_each.value
FROM users u, json_each(u.roles);

-- 2) "admin" 归一到框架角色（wiki 的 isGlobalAdmin 认 "admin"；框架保留名同为 admin）
--    JSON 里的 "admin" 原样进 sys_user_role 即可（sys_role 种子已有 admin 行）。

-- 3) 外来号规整（如有历史 JIT 号）
UPDATE users SET source = 'ldap' WHERE username LIKE 'ldap:%';
UPDATE users SET source = 'sso'  WHERE username LIKE 'sso:%';
```

验证：`SELECT COUNT(*) FROM sys_user_role` 与各用户 JSON 角色数一致；随后启动应用 0010
（DROP roles），再抽查 user-info 返回 roles 与迁移前一致。

## 4. 登录链并轨（含 MD5 兼容）

- 删除 wiki `auth/logout`、`auth/refresh`、`auth/_shared/session.ts`；`auth/login` 用模板版替换。
- **MD5 存量兼容**（mm-wiki 迁移账户）：模板 `createSession(deps)` 全 deps 注入——wiki 在
  自己工程的 `auth/api.ts` 里定制一处即可：

```ts
// wiki 工程 api/src/auth/api.ts（工程私有改动，模板升级时需 reconcile 的唯一文件）
const g = globalThis as any;
const session = createSession({
  ...runtimeDeps(),
  bcryptVerify: async (pw, h) =>
    (await g.bcrypt.verify(pw, h).catch(() => false))
    || (/^[0-9a-f]{32}$/.test(h) && g.crypto.md5Hex(pw) === h), // MD5 兜底
});
```

  老账户 `must_change=1` 首登走框架改密：旧口令经 MD5 兜底验过 → `bcryptHash` 重写——
  **无需重算迁移，首登即转正**（与 wiki 现行为同口径）。
- `config.yaml`：`anonymous_paths` 对照模板补 `/auth/ldap-login`、`/system/login-methods`；
  保留 wiki 的 `/wiki/sso/login`。

## 5. LDAP 入口与配置迁移

- 删除 `wiki/account/` 整个聚合（ldap-login、login-methods、`_shared/ldap.ts`——框架版
  esc/firstAttr 同形）。
- `mw_config` → `sys_setting` 键改名（值平移）：

```sql
UPDATE sys_setting SET value = (SELECT value FROM mw_config WHERE key = 'ldap_open')       WHERE key = 'ldap.enabled';
UPDATE sys_setting SET value = (SELECT value FROM mw_config WHERE key = 'ldap_base_dn')    WHERE key = 'ldap_base_dn';
UPDATE sys_setting SET value = (SELECT value FROM mw_config WHERE key = 'ldap_uid_attr')   WHERE key = 'ldap_uid_attr';
UPDATE sys_setting SET value = (SELECT value FROM mw_config WHERE key = 'ldap_email_attr') WHERE key = 'ldap_email_attr';
```

- `config.yaml` 顶层补 `ldap:` 连接段（模板注释块原样复制，填 wiki 现值）；wiki 的
  `getBool("ldap_open")` 消费点改读 `sys_setting.ldap.enabled`（`wiki/account` 已删，
  消费点在 wiki 自己的 SSO/LDAP 相关残余处自查）。

## 6. 用户管理并轨

- 删除 `wiki/system/api.ts` 的 usersGet/create/roles/password/forbidden 五端点及
  `wiki/system/_shared/service/users.ts`（`parseRoles` 若 SSO 仍用则保留函数或改读 sys_user_role）。
- 前端删 `web/src/wiki/pages/admin-users.tsx` 及 `/admin` 下对应路由/菜单（框架 system 模块接管）。
- 注意行为差异：框架建号**默认 must_change=1**（wiki 原行为同）；框架重置口令级联吊销
  refresh（wiki 原先无 refresh 表，新获得的能力）。

## 7. 判权接轨

- `space-guard.ts` 的 `isGlobalAdmin`：数据源从 `users.roles` JSON 改为
  `select role_name from sys_user_role where user_id = ?`（认 `admin`/`superadmin`），
  或整体改调框架 `_platform/_shared/service/access` 的 `assertSystemAdmin`
  （推荐后者——DIP 原注释就是这么设计的）。`assertGlobalAdmin` 的调用面零改动。
- `resolvePrivilege` / `hasAnyEditorRole` / `space_user` 全保留——空间特权是 wiki 业务级，
  与框架权限点正交（框架 `assertPermission("wiki.xxx")` 管「能不能进 wiki 的功能」，
  `space_user.privilege` 管「在这个空间里是什么角色」）。

## 8. wiki 角色/权限点上架（M5 前手工）

安装器（M5）落地前，用框架唯一出口手工声明一次（升级稳定性规则随出口钉死，AC2 规则面）：

```ts
import { upsertSolutionPerms } from "../../_platform/_shared/service/solution-perms";
await upsertSolutionPerms({
  module: "wiki",
  roles: [
    { name: "wiki.admin", title: "wiki 管理员", permissions: ["wiki.doc.create", "wiki.space.create"] },
    { name: "wiki.editor", title: "wiki 编辑", permissions: ["wiki.doc.create"] },
  ],
});
```

此后 wiki 业务端点按需挂 `assertPermission("wiki.doc.create")`（H1 hook，import 直调）。
**纪律**：不得直写 `sys_role`/`sys_permission`——一切经 `upsertSolutionPerms` /
`uninstallSolution`（AC2 唯一出口）。

## 9. 审计与日志

- wiki 自己的 `auditOp`（oplog.ts）改委托框架 `_platform/_shared/service/audit` 的
  `auditOp`（sys_oplog，含 403 分钟窗口聚合）；`wiki/system` 的 logsGet 与 `admin-logs.tsx`
  若只想看 wiki 业务日志则保留 mw_log 版，否则删（框架 /system/oplog 页已通用）。
- mw_log 业务日志（文档操作流水）**保留**——sys_oplog 是安全审计面，两者不合并。

## 10. 前端并轨

- `web.config.ts` 的 `modules` 注册 `web/system`（框架四页）与既有 wiki 模块并列；
  wiki 的 `admin-users / admin-logs / admin-configs` 三页与菜单删除
  （`admin-contacts` 对应 mw_contact，保留）。
- 登录页：wiki 工程用框架 login 模块——`login-methods` 自动出现 LDAP 标签
  （wiki 原 login-methods 端点删除后由框架端点接管，Tabs 数据源不变）。
- 重新生成前端 client：`oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json && ojm api`。

## 11. 验收清单

- [ ] `ojm migrate`（release verify 闸）通过；账本 0010 项已应用且 roles 列已 DROP
- [ ] sys_user_role 行数 = 迁移前各用户 JSON 角色总数；user-info roles 与旧版一致
- [ ] admin/123456 首登 → must_change 悬挂（403{code:must_change}）→ 改密 → 正式 token
- [ ] MD5 存量账户首登改密成功（bcrypt 重写）
- [ ] LDAP（若启用）：enabled/base_dn 开关链 400/502 语义对；login-methods 出现 ldap
- [ ] 原 admin 账户仍可进 wiki 管理面（isGlobalAdmin 数据源切换后）
- [ ] 空间特权矩阵回归（space-guard 测试套件全绿）
- [ ] `ojm build` 全链通过（对照 §1.7 四红线自查 wiki 自有 handler）
- [ ] wiki 测试套件全量回归 + `ojm dev` 真机冒烟一轮

## 12. 风险与回滚

| 风险 | 应对 |
|---|---|
| 0010 先应用导致 roles 数据丢失 | 顺序红线：Step 3 数据迁移在 0010 之前完成并抽查；迁移前整库备份 |
| MD5 兜底意外放行 | 兜底仅 `^[0-9a-f]{32}$` 形态哈希且 must_change=1 账户才命中；改密即转正 |
| 账本 reconcile 误删已应用文件 | dev（auto）下删除文件无碍；release（verify）下账本有残留记录会拒启——wiki 迁移期保持 dev 模式，终态再切 verify |
| wiki 对模板的本地定制被升级覆盖 | 已知 reconcile 点仅两处：`auth/api.ts`（MD5 deps）、`config.yaml`（anonymous_paths / ldap: 段）——升级模板时逐 Diff 这两文件 |
| SSO 签发面 | wiki SSO 保留期间把 `issueTokens(uid, roles)` 调用改调模板 session 的 `issueExternal(uid)`（roles 不再进 claims，user-info 统一供给） |

---

来源：oj-module 设计文档 §9.3~9.5（oj 运行时四红线与返工实录）+ RBAC 验收报告
（`docs/prd/solution/202610161235-rbac-e1-ac-regression.md`）。本文随框架 0.2.0 编制，
2026-10-16。
