# 应用自主管理角色/权限控制点验证 + 权限点 title_key 断链修复

日期：2026-11-06 10:46 · 分支：`feat/perm-title-key`（并入 `feat/ojm`） · 基线：0.2.68 / oj 0.1.124

## 1. 背景与目标（SMART）

- **S**：验证「应用（方案）自主管理角色/权限」全链路控制点及其多语言（zh-CN/en-US）展示。
- **M**：guard-drill 演练环境（/tmp/ojm-verify-guard/guard-drill，release 形态 oj serve）实测 API 矩阵；
  repo 内 vitest/e2e 回归钉住展示与落库规则。
- **A**：声明面 = C2 `solution.yaml`；安装器 = register/upsert 出口；管理面 = `/api/system/*`；展示面 = `/system/roles` 页。
- **R**：缺陷当场修复（TDD），文档回写防漂移。

## 2. 机制图谱（代码溯源结论）

| 层 | 位置 | 机制 |
| --- | --- | --- |
| 声明面 | 方案 `solution.yaml`（C2 manifest，**不是** `api/manifest.yaml`） | `permissions[]`（code 强制 `<name>.` 前缀 + title_key 必填 `<name>:perm.*`，C2-15）；`roles[]`（name `<name>.<role>` + title_key 必填 + permissions ⊆ 声明权限，C2-16） |
| 构建面 | `packages/cli/src/bundle.ts` | R5：`routes` 由 entry.ts handle 派生覆写进契约；模块级 `api/manifest.yaml` 只查 name/version 一致 |
| 安装面 | `_lifecycle/steps/extract.ts` | OJ-X 七键白名单只守 **oj 原生清单**（name/desc/version/config/db/tables/deps）；C2 契约（`ctx.manifest`）另路解析 |
| 注册面 | `steps/register.ts` → `service/domain/solution-perms.ts` | R1/R4：role title 按站点默认语言（sys_setting site.language，缺省 zh-CN）从包内 locale 解析；R3：升级重解析（title/title_key 元数据覆盖）；声明绑定 insert-if-absent（AC1-15）；声明消失标 deprecated（AC2-3/4）；卸载双维级联（AC2-6） |
| 管理面 | `api/system/roles/api.ts` + `roles/bindings/api.ts` + `permissions/api.ts` | assertSystemAdmin 判权（H2）；custom 角色 `custom.<slug>` 强制；builtin 绑定/删除硬拒（AC1-19）；占用禁删（AC1-20 holders>0 → 409）；绑定调整写后按持有者失效判权缓存（AC1-30） |
| 判权面 | `service/infra/access.ts` | sys_user_role 唯一权威源（D10）；users/roles 整集替换端点（AC1-7） |
| 展示面 | `web/system/pages/roles/index.tsx` | R2：solution 角色 `t(title_key, { defaultValue: title })` 实时翻译；builtin 回退 `system:rolesPage.roleTitle.<name>`；custom 原样 title；权限点 title_key 翻译、不命中回退 code（R6） |

## 3. 实测记录（guard-drill，release 形态）

环境：demo-solution 0.1.1（真实包，声明 2 权限点 + 1 角色，双语 locale 随包）经 CDN 发布→`ojm install` 一次通过。

| # | 控制点 | 实测 | 结果 |
| --- | --- | --- | --- |
| 1 | 声明→落库（角色） | GET /system/roles | ✅ `demo-solution.analyst`：module=demo-solution、title=**分析师**（R1 zh 解析）、title_key 在、声明绑定 2 条 insert-if-absent |
| 2 | 声明→落库（权限点） | GET /system/permissions | ❌ **title_key=null**（声明了 `demo-solution:perm.*` 却断链，见 §4） |
| 3 | custom 创建 | POST `custom.auditor` | ✅ module=custom + 权限码校验 |
| 4 | 机器名强制 | POST `superadmin` / `demo-solution.fake` | ✅ 400（`^custom\.` schema 拒） |
| 5 | 未知权限码 | POST 带未声明 code | ✅ 400 `unknown permission codes` |
| 6 | 绑定调整 | PUT bindings?name=custom.auditor | ✅ 整集替换成功 |
| 7 | builtin 绑定硬拒 | PUT bindings?name=superadmin | ✅ 403 |
| 8 | builtin 删除硬拒 | DELETE ?name=superadmin | ✅ 403 |
| 9 | 占用禁删 | DELETE ?name=demo-solution.analyst（holders=1） | ✅ 409 + holders 明细 |
| 10 | 无主删除 | DELETE custom.scratch | ✅ 0 + 列表消失 |
| 11 | 判权边界 | viewer GET /system/roles | ✅ 403（assertSystemAdmin） |
| 12 | 用户授权 | PUT /system/users/roles?uid=3 整集替换 | ✅ sys_user_role 落库、holders=1 |
| 13 | 多语言（安装期 R1） | title 落库=分析师 | ✅ 站点默认语言 zh-CN 解析自包内 locale |
| 14 | 多语言（展示期 R2） | locale 双语随包部署 | ✅ dist/web/modules/demo-solution/locales/{zh,en} 就位；展示翻译经 e2e 钉住（§5） |

框架内置对照面：seed 权限点（`platform.org.read.all` 等）title_key=`system:perm.*` 在库、双语词典齐——证明列/读面/展示链路本身通，唯独**方案声明路径**断。

## 4. 缺陷：方案声明权限点 title_key 落库断链

- **链路**：C2-15 强制声明 title_key → `declOf`（installer.ts）只取 `code`（`SolutionManifest.permissions: string[]`）→ `upsertSolutionPerms` insert `{code, module}` → `sys_permission.title_key` 恒 NULL → 展示页永远回退裸 code（R6 兜底），声明形同虚设。
- **反常识点（已记 §7）**：C2-15 把 title_key 定为必填并逐项校验，随后数据面又把它丢掉——校验收藏的字段没人消费。
- **伴生缺陷（同根，顺手修）**：已标 deprecated 的权限点/角色被新版本**重新声明**时不会复位 deprecated=0（settings/routes 注册面均有复位，RBAC 两表没有）——重声明的权限点持续被 UI 标灰、装机告警不消。

## 5. 修复方案（TDD，先红后绿）

| 用例（BDD） | 前置 | 动作 | 期望 |
| --- | --- | --- | --- |
| AC2-1/R2 权限点 title_key 随声明落库 | 空库 | upsert permissions `[{code, title_key}]` | sys_permission.title_key = 声明值 |
| R3 既有权限点 title_key 元数据随升级覆盖 | 行存在（旧 key） | upsert 同 code 新 key | title_key 更新（locale 改进随升级传播） |
| AC2-3 重声明复位 deprecated（权限点） | 行 deprecated=1 | upsert 重声明同 code | deprecated=0 |
| AC2-3 重声明复位 deprecated（角色） | 角色行 deprecated=1 | upsert 重声明同 name | deprecated=0 且 title/title_key 覆写 |
| declOf 透传 | InstallRequest.manifest 带 permissions[].title_key | declOf(req) | decl.permissions 为 `{code,title_key}` 对象数组 |

代码面（最小 diff）：

1. `solution-perms.ts`：新增 `SolutionPermDecl {code, title_key?}`；`SolutionManifest.permissions: SolutionPermDecl[]`；insert 带 title_key；既有行 update `{title_key, deprecated: 0}`；角色 update 追加 `deprecated: 0`。
2. `installer.ts declOf`：permissions 映射为对象透传 title_key。
3. `register.ts`：`SolutionDecl` 类型随基接口自动对齐（无代码改动）。

## 6. 多语言展示回归（e2e）

新增 `tests/e2e/templates/roles-perms-i18n.spec.ts`：/system/roles 页中英文下——
角色 tab 内置角色名走 `roleTitle.*` 译文（系统管理员/Administrator）；权限点 tab 走 `system:perm.*` 译文（组织架构全量读权限 / Org directory: read all）；两语言均不直出键名。语言切换沿 system-settings-i18n.spec.ts 的 localStorage 偏好口径。

## 7. 过程问题分类记录

- **反常规（双文件声明面）**：角色/权限声明属于 C2 `solution.yaml`，而非 `api/manifest.yaml`；后者是 oj 原生七键清单、装 OJ-X 白名单盘查。初测把声明写进 `api/manifest.yaml` 被 C2-31 拒装（零落盘）——错误信息已给出键名但没说「该写在上级 solution.yaml」，指引可改进（挂账，非本批修）。
- **反常识（校验与消费脱节）**：C2-15 必填校验的字段在数据面被丢弃（§4 主缺陷）。
- **与业界不符（版本矩阵门槛）**：演练工程 devDeps 钉 0.2.68（未发布）时，`pnpm exec ojm` 会静默回落 lockfile 里旧版 CLI，触发 C4/D12 严格相等校验失败且报错指向「重新安装」而非「CLI 版本回落」；直接以仓库 `packages/cli/bin/ojm.mjs` 跑通（挂账）。
- **演练环境坑**：`oj build --module-root <dir>` 产物落 `dist/` 根，而 `ojm build --bundle` 期待 `dist/api/<name>-<ver>/`——手工单模块链路须 `oj build --module-root <dir> -o dist/api`；`oj serve` 手工形态须 config mounts 加 `- prefix: /api  api: dist/api` 并配 `--app-path dist/web`，否则拒启/405。

## 8. 任务状态

- [x] 机制图谱与双文件声明面定位（§2）
- [x] guard-drill 实测 14 项（§3）
- [x] 缺陷定位与方案（§4/§5）
- [x] 红用例：rbac-solution-perms.spec.ts 3 例 + register.spec declOf 1 例（4 红）
- [x] 实现：solution-perms.ts / installer.ts 贯通 title_key + deprecated 复位
- [x] 绿：templates vitest 全量 1093 例全过 + typecheck/lint 干净（3 条既有 warning 非本批）
- [x] e2e roles-perms-i18n.spec.ts 落地并跑通（真实浏览器 zh/en 双语言断言）
- [x] drill 环境同步修复后模板重装复测（title_key 落库转绿，同版本重装即 R3 路径实证）
- [x] CHANGELOG + 文档回写（ARCHITECTURE §4.6/§7.2、OPERATIONS §7.2 示例修陈旧）
- [x] 提交并入 feat/ojm

## 9. 阶段总结

**关键推导**：① 声明面双文件定位是本次最大弯路也是最有价值的收获——C2 契约（solution.yaml）
与 oj 原生七键清单（api/manifest.yaml）是两条枚举，OJ-X 白名单守后者；`ctx.manifest` 是前者。
② title_key 断链是「校验收藏了字段、数据面没人消费」的典型：C2-15 必填校验 → declOf 丢弃 →
落库 NULL → 展示回退。修复只动两个文件（solution-perms.ts + installer.ts 的 declOf），形状
契约 `permissions: string[] → {code, title_key?}[]`。③ 同版本重装即走 R3 元数据覆写路径，
存量站点补数据零迁移。④ Map 合并顺序坑：角色裸引用先入、顶层声明（携 title_key）后入覆盖。

**耗时**： recon 约 25min，drill 实测（含环境排障：pnpm 离线回落旧 CLI、serve 挂载形态、
声明错文件被 OJ-X 拒）约 40min，TDD 修复约 20min（红 4 → 绿 1093），e2e 约 10min，
文档与提交约 15min。合计约 1h50m。

**遗留（挂账）**：① OJ-X 拒装错误信息未指引「声明应写在上级 solution.yaml」（§7 反常规）；
② `pnpm exec ojm` 在 devDeps 钉未发布版本时静默回落 lockfile 旧 CLI，C4/D12 报错未点名版本
回落（§7 与业界不符）；③ `oj build --module-root` 产物默认落 `dist/` 根而 bundle 链期待
`dist/api/`，手工单模块链路需 `-o dist/api`（§7 演练坑）；④ wecom e2e 4 例既有失败与本批无关；
⑤ 全量 e2e 未在本分支复跑（新 spec 单独跑绿，templates vitest 全量绿），发布前须跑 §0.5 发布形态全链。
