# 解决方案模块的角色/权限点 CRUD 与跨模块隔离（设计）

> 状态：设计稿 **v2**（已过一轮四方评审：工程师 / 架构 / 产品 / 安全）。待评审遗留项落地后方可实现。
> 关联：`docs/devkit/manual.md` §2.8 模块边界、模板 `api/src/_platform/_shared/service/{roles,solution-perms,access,guard,audit}.ts`、迁移 `0004__sys_rbac*.sql`。
> 前提：模块路由分发注入只读 `http.module.name` / `http.module.version`
> —— **✅ 已于 oj v0.1.76 落地**（原「尚未落地，需先 POC」的 POC 前提消除）。
> 出处：`api-manual.md:1047,1056`、`global.d.ts:130`、`README.md:40-49`；
> 四条经核验的语义（注入来源 / 可为 null / 只读强度 / version 勿回显）见 **§3**。

### 文档关系（自洽阅读起点）

| 关系 | 文档 | 状态 |
|---|---|---|
| 上游 PRD | [`docs/prd/solution/202610152345-solution-marketplace-framework-prd.md`](solution/202610152345-solution-marketplace-framework-prd.md) | 解决方案市场框架 |
| **上游设计（已定稿，本文档需与之对齐）** | [`docs/prd/solution/202610160908-rbac-auth-design.md`](solution/202610160908-rbac-auth-design.md)（D1–D14、§4A） | 已定稿 2026-10-16 |
| 上游实施 | [`docs/prd/solution/202610160952-rbac-implementation-plan.md`](solution/202610160952-rbac-implementation-plan.md) | **A6 角色管理 API、C2 角色管理页 均「已完成」** |
| 外部依赖 | [`docs/prd/202610170016-oj-table-write-guard-requirement.md`](202610170016-oj-table-write-guard-requirement.md) | oj 表级写守卫（OJ-7，待提交；**oj 0.1.76 复核仍未落地——当前 oj 侧唯一遗留阻塞项**，授信基座 `http.module` 已就位） |

> ⚠️ **本文档存在一处未决的政策冲突，须先裁决才能开工**：见下方 §0.5。

---

### 0.5 裁决记录（2026-10-17）：部分推翻上游 D8

对上游 `202610160908-rbac-auth-design.md` 的 **D8 / §4A（line 169）**"新建角色只能在框架角色管理页…解决方案无任何建角色接口"，裁决为**部分推翻**——拆成两条独立裁决：

| 议题 | 裁决 | 对应上游条款 |
|---|---|---|
| **角色：模块能否自建** | ✅ **推翻**——模块**可以**管理角色，**但只能管理自己的**（`<module>.<slug>` 命名空间 + 仅绑本模块权限点） | 推翻 D8 / §4A line 169 前半段 |
| **权限点：能否运行期创建** | ❌ **保留原有设定**——**模块的权限点必须注册**（安装期 manifest 声明 + 安装器 upsert），**不存在任何运行期注册/删除权限点的接口** | 保留 **Q10**（§4A line 146「运行期注册权限点仍禁止」）、D8 后半段「权限点来源仍 manifest-only」 |

由此得到**三类角色的不同权限表现**（本次裁决的核心）：

| 角色类别 | 命名空间 | 谁建 | **谁可改绑定** | 绑定范围 |
|---|---|---|---|---|
| **模块角色** | `<module>.<slug>` | 模块自服务（本次新增） | 模块自己；**且 admin/superadmin 亦可覆盖**（见下） | 模块自己改 → 仅本模块；**管理员改 → 可跨模块** |
| **管理面角色** | `custom.<slug>` | admin / superadmin（既有路径三） | admin / superadmin | **可跨模块** |
| builtin | `superadmin`/`admin`/`editor`/`viewer` | seed | ❌ 任何人不可改绑（D5 隐式超集、不出现在绑定编辑中） | — |

### 0.6 裁决追加（2026-10-17）：**admin/superadmin 可改模块自建角色的绑定**

> **裁决**：containment（§5.2）对模块纬是从业红线，**但管理员可例外覆盖**——admin/superadmin 可在管理面直接编辑模块自建角色（如 `A.manager`）的绑定，包括绑上**别模块**的权限点。

**为什么这不构成权限放大**（重要，回应 reviewer 的第一反应）：admin 既能建立 `custom.*` 角色绑 `B.*` 再把人拉进去，**早已具备**「让人获得 B 能力」的手段。允许其改 `A.manager` 的绑定**没有给 admin 任何新权力**，只是把这件事做成「通过模块自己的角色表达」，省掉绕 third-party custom 角色的一圈。

**因此这是便利性与 blast radius 的取舍，而非安全边界的放宽**——必须配三条约束：

| # | 约束 | 说明 |
|---|---|---|
| 1 | **仅管理面可达** | 入口只能是 system 模块的路由 + `assertSystemAdmin()`；模块自己的路由**永远**走 strict，**不存在**任何「请求参数提升权限」的通道（`http.module` 冻结，模块改不了自己的身份，§3③） |
| 2 | **强制留痕** | `recordOp({ action: "role.bindings.update", module: <角色属主>, target, detail: { override: true, crossModule: [...新增的跨域 code] }, level: 4 })`；`level: 4` 与 §7.5 拒绝审计同级别，便于检索 |
| 3 | **仍然硬拒的项** | builtin 角色（`assertNotBuiltin`）永远不可改；`superadmin` 专属操作按 **D11 不建模为权限点**，天然进不了并集，覆盖也不受影响 |
| 4 | **副作用照旧** | 改绑定后 `invalidateHolders`（§8.3）；因为是「给已持有该角色的人批量加跨域能力」，建议在管理面 UI 明示**受影响人数**（与 §10 卸载预检同款口径） |

**影响**：因开辟自服务角色 CRUD，上游实施方案 A6 / C2（已标「已完成」）需追加改动，详见 §14 同步清单。

---

## 0. 修订说明（v1 → v2）

评审推翻了 v1 的三处根基，非文字微调：

| # | v1 主张 | v2 修正 | 依据 |
|---|---|---|---|
| A | §7 越界「结构性不可能」 | **降级为「工程护栏」**，明确声明防不住模块内恶意代码 | 安全评审#1：handler 持全局 `db`，同进程同库无沙箱 |
| B | 隔离规则加在自服务入口 | **必须下沉到 service 单一收口**，且覆盖**安装期** `upsertSolutionPerms` | 工程#2 + 安全#2：`decideAccess` 从不读 module 列，`system.admin` 声明即提权 |
| C | 一次性交付全部 CRUD | **拆 M1/M2**：M1 只做角色 CRUD+绑定，权限点只读 | 产品评审：静态声明已覆盖预置定义，动态权限无实证需求 |

另吸收 20 余条应修（三方言、TOCTOU、缓存失效、卸载残留、否认审计、oplog 滥用面等），散见各节并汇总于 §14 附录。

---

## 1. 结论摘要

| 决策 | 结论 |
|---|---|
| 隔离锚点 | `http.module.name`（服务端派生的调用方模块身份，只读） |
| 隔离维度 | **两层**：行 ownership（module 列）+ 绑定 containment（`sys_role_permission` 无 module 列，须 join） |
| 校验位置 | **单一收口**：`roles-scoped.ts`；`roles.ts` 写函数降级为薄包装；安装期同样收口 |
| 角色命名 | `custom.<slug>` → **`<module>.<slug>`**，前缀由服务端强制，装配权责下沉到 service |
| `version` 定位 | 元数据 / 审计字段，**绝不进隔离键** |
| 能力分期 | M1 角色 CRUD+绑定、权限只读；成员授予与动态权限 CRUD → M2 |

---

## 2. 防护口径（诚实边界声明）

> v1 把这套机制写成「结构性不可能」。这是**夸大**，必须纠正。

### 2.1 它防得住

- **客户端伪造**：请求体/头里的 `module`、`version`、`name` 一律不生效。
- **误伤与配置错误**：模块 A 手滑写错命名空间时，不会被静默写进 B 的域。
- **单一 recovered 越界路径收敛**：合法 API 面上不再存在「A 改写 B」的写入口。

### 2.2 它防不住

handler 持有全局 `db`，可 `db.query` / `db.exec` **直写** `sys_role_permission`、`sys_user_role`（插一行 `superadmin` 即可），还可以 `db` 删 `sys_oplog` 抹掉痕迹。模块与主程序**同进程、同一数据库、无沙箱**。

> **残余风险（须向使用者明示）：单模块沦陷 = 全平台沦陷。**

因此本设计的定性是 **防误伤的工程护栏**，**不是安全边界**。真正的安全边界必须来自模块准入：供应链管控、代码审计、安装前 manifest 审查——那是另一条战线，不在本文范围内。后续所有「不可能」措辞均按此口径理解。

> **升级路径（外部依赖）**：已向 oj 提出「表级写守卫」需求——把 `ownership_guard` 升级为「写需属主授权」，使写入面收窄到本模块 `manifest.tables` + 属主 `export_writes` 放行项。届时本设计可从「工程护栏」升级为**真正的能力边界**，且能顺带解决 §4 的混淆代理人问题。
> 需求规格见 `docs/prd/202610170016-oj-table-write-guard-requirement.md`（**阻塞依赖 oj 落地**）。

---

## 3. 原语：`http.module.{name,version}`（只读）— **✅ 已在 oj 0.1.76 落地**

> **前提状态：已从阻塞项解除。** 2026-10-17 核验本地 `oj 0.1.76`（`oj --version`）+ devkit
> `~/.local/share/oj/devkit`（`global.d.ts:130`、`api-manual.md:1047,1056`），确认已实现。

```ts
declare const http: HttpApi;
// global.d.ts:130（v0.1.76）
module: { name: string; version: string } | null;

const callerModule  = http.module?.name;     // "order"   ← 注意 nullable
const callerVersion = http.module?.version;  // "1.4.2"
http.module.name = "evil";                   // TypeError: Cannot assign to read only property
```

四条经核验的语义（较 v0.1.76 前的设计假设有四处修正）：

| # | 语义 | 出处 | 对本文的影响 |
|---|---|---|---|
| ① | **按 handler 文件所在模块目录注入**（dev 读 `src/<m>/manifest.yaml`，release 读 `dist/<m>-<v>/manifest.yaml`） | `api-manual.md:1047` | 身份来源是**文件归属**，非请求来源——比设想更可靠 |
| ② | **可为 `null`**：任务桥、WS 帧（含模块目录内的 `ws.ts`）、`run_with`、启动期内省 | `api-manual.md:1047,3921` | `scopeOf()` 必须判空并 **fail-closed**（见 §4.3） |
| ③ | **只读是强保证**：对象 `Object.freeze`；strict 下写/delete 抛 TypeError，`require()` 的 sloppy CJS 写静默无效——**JS 只持快照拷贝，改不了框架状态** | `api-manual.md:3920`、`SKILL.md:267` | §3 三条不变量成立且**强于**原假设：连隐式绕过都不存在 |
| ④ | **`version` 勿回显给外部客户端**（指纹面） | `global.d.ts:128` | version 只用于**服务端审计归因**，不得进任何响应体/前端可见字段 |

> 另注意到 oj 已将 `http.module` 定为**框架授信依据**——「跨模块表归属守卫 / bound_db 重定向 / 平台特权换装」均按它裁决（`api-manual.md:1070`、`README.md:46`）。这为 §14/OJ-7 的表级写守卫提供了现成的授信基座。

**遗留须知**：`db.asSystem()` 是显式**被审计**的系统逃生通道（`global.d.ts:559-561`，用于绕租户注入）。注释明确「业务 handler 不得使用」，但它是可从任何 handler 调用的方法——属 §2.2 残余风险的一部分，且提示**纯 JS 层的收敛终有边界**。

---

## 4. 单一收口：消灭双写路径

这是 v1 最大的结构缺陷——新增了 `roles-scoped.ts`，却保留了 `roles.ts` 自身的规则副本。

### 4.1 问题

| 位置 | v1 后的状况 |
|---|---|
| `roles.ts:33` | 自有 `CUSTOM_NAME` 正则 |
| `roles.ts:95,100` | `createRole` 自带校验 + 硬编码 `module='custom'` |
| `roles.ts:108` | `updateBindings` **仅 `assertNotBuiltin`，无归属校验** |
| 新增 `roles-scoped.ts` | 又一份命名 + 归属规则 |

→ 两套规则必然漂移；且 `roles.ts:100/108` 是无 scope 的可越界出口，留着等于隔离不完整。

### 4.2 收口规则

1. `roles.ts` 的**写函数全部降级为薄包装**（固定 scope = `custom`），不得保留任何独立的命名/归属逻辑。
2. 正则、前缀强制、两个 new 断言，**全局只此一份**，位于 `roles-scoped.ts`。
3. 同步修改 `system/roles/api.ts:48` 的 schema pattern（另一份暗叠的正则）。

### 4.3 scope 不得由调用方自由传入（架构阻塞）

若 service 直接收 `scope: string`，模块 A 的 handler 传 `"custom"` 就能写管理面命名空间——**越界面反而比今天更大**。

```ts
declare const brand: unique symbol;
export type Scope = string & { readonly [brand]: "Scope" };   // 不透明类型

// 唯一合法构造口（0.1.76 后 http.module 可为 null → 必须 fail-closed）
export function scopeOf(): Scope {
	const m = http.module?.name;                 // ?? 而非 .：见 §3 表②（WS/任务桥/null 上下文）
	if (!m)
		throw Object.assign(new Error("no module context"), { status: 403 });
	return m as Scope;
}
/** 仅 system 面：独立授信通道，普通模块不可达（对应 custom 伪模块） */
export function systemScope(): Scope { return "custom" as Scope; }
```

service 签名一律 `scope: Scope`，**禁字面量**（评审建议加 lint 规则 + 单测守护）。

---

## 5. 隔离模型：三层（v1 漏了第三层）

### 5.1 表结构事实（`0004__sys_rbac.sql`）

```sql
sys_role(name PK, module, title, description, builtin, deprecated);   -- module ✓
sys_permission(code PK, module, title_key, deprecated);               -- module ✓
sys_role_permission(role_name, permission_code);  -- ✗ 无 module 列
sys_user_role(user_id, role_name);                -- ✗ 无 module 列
```

### 5.2 第一层 ownership + 第二层 containment

`updateBindings` 今天仅 `assertNotBuiltin`（`roles.ts:108`），可将任意 code 绑到任意非 builtin 角色。这不止是「改别人数据」，而是**实打实提权**：A 把 `B.execute` 绑到自己的 `A.manager`，持有者即未经 B 同意获得 B 的能力。

新增两个核心断言（全案核心增量）：

```ts
async function assertRoleOwnedBy(scope: Scope, roleName: string): Promise<void>
async function assertCodesOwnedBy(scope: Scope, codes: string[]): Promise<void>
```

> ⚠️ **containment 的适用边界（2026-10-17 裁决，见 §0.6）**：containment **强制于模块自建角色**
> （`<module>.<slug>`），但 **admin / superadmin 可例外覆盖**——管理面可直接给模块角色绑上跨模块权限点。
> 这不是安全边界的放宽：admin 早已能建 `custom.*` 角色绑 `B.*` 并拉人入伙，本裁决**未赋予任何新权力**（论证见 §0.6）。
>
> 因此 service 需要**三模式旗标**，而不是两个：

| 模式 | 入口 | ownership 断言 | containment 断言 | 审计 |
|---|---|---|---|---|
| `strict` | 模块自己 `/api/<mod>/rbac/*` | 强制 = `http.module.name` | ✅ **强制** | 常规 level |
| `adminOverride` | 管理面 `system/roles/bindings` | 由管理员显式指定**角色属主** | ❌ 放行（可跨模块） | `level: 4` + `detail.override` |
| `unified` | 管理面 `custom.*` 角色 | — | ❌ 放行（既有路径三行为） | 常规 level |

> `adminOverride` 与 `unified` 的差别仅在于「被编辑的角色归谁」：前者改的是**别人的角色**（需 level 4 留痕 + 影响面提示），后者改的是管理员自己的角色。

### 5.3 第三层：**安装期声明**（上游已决策，**实现缺口**）

> 定性校正：安装期前缀校验**不是本文的新发现**——上游 `202610160908-rbac-auth-design.md` 的 **D4**（「解决方案角色名/权限点 code 强制 `<name>.` 前缀，安装期校验拒绝不合规 manifest」）与 **§4A.1**（「声明权 = 命名空间所有权，安装器只能 upsert `module=<name>` 的行」）**早已定此规则**。本文列出的缺口属于**决策未落到代码**，而非设计遗漏，故本章节的正确诉求是「补实现」而不是「立规则」。

**这是 `prd` 级阻塞漏洞**。`decideAccess`（`guard.ts:27`）判权时**从不读 module 列**，只看角色名与 code 首段：

```ts
if (roles.includes(`${moduleOf(code)}.admin`)) return true;   // 只看名字
```

而 `upsertSolutionPerms` **不校验任何前缀**：
- `solution-perms.ts:37` — 角色名直接写 `m.module` 却**不要求** `moduleOf(name) === m.module`；
- `solution-perms.ts:54` — permission code 同样不校验 `moduleOf(code) === m.module`；
- 文件注释把校验「推给安装器」——但安装器不在本库内、且事实上无校验，等同于无人守门。

→ 后果：一个 manifest 声明角色名 `system.admin`，装上即 **跨模块提权**，且完全绕过本文所有运行时规则。

**必须**：
1. `upsertSolutionPerms` 内强制 `moduleOf(role.name) === m.module` 与 `moduleOf(code) === m.module`，不符即拒（安装失败而非静默写入）；
2. 补一次数据修数：找出历史行 `sys_permission.module <> moduleOf(code)` 并修正；
3. 保留字 `custom` / `system` / `framework` 在任何声明路径都不得作 module。

### 5.4 命名空间本身即隔离的一部分

`<X>.admin` 是**提权敏感名**。仅在「前缀由服务端强制」时 A 才不可能造出 `B.admin`。这是把 5.2/5.3 的提权面从「要校验」降级为「装配不达」的关键——但只在 §4 单一收口成立的前提下有效。

---

## 6. 角色命名空间：`custom.<slug>` → `<module>.<slug>`

### 6.1 必须改

1. **`sys_role.name` 全局 PK**：今天名字被钉成 `^custom\.[a-z0-9-]+$`（`roles.ts:33,100`），两个解决方案都叫 `custom.manager` 主键冲突。
2. `<X>.admin` 提权语义（§5.4）。

### 6.2 规则

| 角色来源 | 命名空间 | module 列 | 创建路径 |
|---|---|---|---|
| 解决方案（运行期自服务） | `<callerModule>.<slug>` | `= callerModule` | 服务端强制，M1 |
| 解决方案（安装期声明） | `<m.module>.<slug>` | `= m.module` | **须补前缀校验**（§5.3） |
| 管理面手工（system） | `custom.<slug>` | `custom` | 保留兼容，走 `systemScope()` |
| builtin | `superadmin/admin/...` | `framework` | 硬拒任何写 |

slug `^[a-z0-9][a-z0-9-]*$`。展示名用 `sys_role.title`（`description` 列存在但未启用），**命名空间不承载展示需求**。

### 6.3 三方言大小写陷阱（工程阻塞）

`0004__sys_rbac.mysql.sql:45,54` 的 PK 是 VARCHAR 且默认 ci collation → `A.Manager` 与 `a.manager` 在 **MySQL 撞主键**，而 **sqlite/pg 是两行**。校验正则强制小写不够（`roles.ts:33` 只挡小写），须：

- service 层统一 `toLowerCase()` 归一化后再比对与写入；
- 或 MySQL 迁移显式指定 `COLLATE utf8mb4_bin`（推荐，从根上消除方言分叉）；
- 回归用例必须覆盖大小写（见 §12 测试清单）。

### 6.4 不做跨模块复合角色

「A 想把 B 的能力打包给某人」是合理需求，但放宽前缀即摧毁 §5.4 的结构保证。**不做**。未来扩展点：独立 grant 表 + 双方显式 consent，**不动角色命名规则**。

---

## 7. `version`：元数据与审计，不是隔离键

### 7.1 反模式（明确不做）

> ❌ 以 `(module, version)` 作 ownership 复合键

升级时旧版本的 permission 行会成为「上一版本的行」，而角色绑定 / 用户成员资格仍指向它们 → 用户既有授权被静默打折。**ownership 只认 module。**

### 7.2 正确用法

| 用途 | 做法 |
|---|---|
| 审计归因（强制） | oplog 写入服务端自填 `version`，客户端传的不算数 |
| 运营只读信息 | 可选 `sys_permission.declared_version`，仅展示 |
| 升级提示 | 与 `upsertSolutionPerms` 返回的 `deprecated[]` 配对，提示管理员重新分配 |

### 7.3 oplog 写端收紧（含兼容过渡）

现网 `system/oplog/api.ts` 要求 `required:["action","module"]`，`RbacOplogWrite.module` 为必填。若直接改成服务端强制而不同步契约，**所有存量写端 400**。

必须同批修改：① `oplog/api.ts` 的 `post.schema.required` 去掉 `module` ② `runtime/src/api/rbac/types.ts:80` 的 `RbacOplogWrite.module/version` 改可选 ③ `rbac/index.ts:67` 注释同步。

**过渡策略（工程建议采纳）**：先做「客户端传则服务端忽略，不传也不报 400」的宽松期，一个版本后再收紧为忽略。

### 7.4 审计自身的滥用面（安全应修）

仅靠 `currentAccess()`（登录态即写）不足：

| 威胁 | 缓解 |
|---|---|
| 无限刷 oplog 淹没真实审计 | 限流（`rate.ts` 既有）+ 单模块配额 |
| 伪造 `action` / `target` 制造假轨迹 | `action` 白名单前缀 `<module>.*`，`target` 强制非空且受长度约束 |
| `detail` 注入口令/密钥 | schema 限定结构与尺寸；写前敏感键名黑名单 + 脱敏 |

> 注意：`sys_oplog` 可被 `db` 直删——属 §2.2 残余风险，不在本 mitigation 范围内。

### 7.5 被拒绝的越界尝试必须留痕

v1 下越界尝试不落审计 = **攻击无痕**。新增：所有 ownership/containment 拒绝点在返回 404 前 `recordOp({ action: "auth.deny", level: 4, target, detail: { caller: http.module.name } })`。

---

## 8. 服务端实现

### 8.1 `roles-scoped.ts`（唯一收口）

```ts
export async function listRoles(scope: Scope): Promise<RoleRow[]>              // where module = scope
export async function listPermissions(scope: Scope): Promise<PermissionRow[]>  // where module = scope

export async function createRole(scope: Scope, i: { name, title, permissions? }): Promise<{ name, module }>
  // name → 归一化小写 + 强制 `${scope}.${slug}`（客户端任何前缀都不生效）
  // insert ... module = scope
  // 初始绑定 → assertCodesOwnedBy(scope, codes)

export async function updateBindings(scope: Scope, roleName: string, codes: string[]): Promise<void>
  // assertRoleOwnedBy + assertCodesOwnedBy（顺序见 8.2）

export async function deleteRole(scope: Scope, roleName: string): Promise<void>
  // assertRoleOwnedBy + assertNotBuiltin + 占用禁删 + invalidateHolders
```

### 8.2 顺序与方言（工程应修）

**校验顺序必须「先归属、后存在」**：现行 `assertCodesExist`（`roles.ts:45`）先跑会以 **400 泄漏他模块 code 的存在性**。改为先 `assertCodesOwnedBy`，未命中再谈是否存在，统一 **404**。

**实现细节**：
- 取 pr：`SELECT code, module FROM sys_permission WHERE code IN (...)` **一次取回后内存比对**，不要逐条查；
- 空数组 `in ()` 三方言语法错 → 照抄 `roles.ts:46` 的 `if (!codes.length) return;` 短路；
- 占位符上限（sqlite 999 / pg 65535）→ 分批；
- TOCTOU：断言与写入放**同一个 `db.tx`** 且用 `t.query`；写入自身带 scope 并校验影响行数：

```ts
// 不要只靠 tx 外前置 SELECT
const n = await t.exec("delete from sys_role where name = ? and module = ?", [name, scope]);
if (n === 0) fail(404, `role not found: ${name}`);
```

- `recordOp` 与业务 tx 的先后：接受「已提交未审计」窗口，但须在设计中显式承认。

### 8.3 缓存失效缺口（工程应修）

`access.ts:4` 注明 oj 每请求重建实例、缓存恒不命中——**该假设一旦变化，失效面立刻不全**。现有缺口：
- `uninstallSolution`（`solution-perms.ts:83-94`）整片删绑定与成员，**完全没有失效点**；
- M2 的成员授予端点缺 `invalidateHolders`。

→ 补：卸载出口统一 `invalidateAllUsers()`；成员写端点走 `invalidateUser(uid)`。

### 8.4 卸载残留（安全应修）

`uninstallSolution` 清绑定按 **code 前缀 LIKE**（`solution-perms.ts:92`），而 ownership 按 **module 列**——两者从未强制相等。若存在 `module='A'` 但 code 不以 `A.` 开头的行，漏清 → **重装后旧授权复活**（该文件自己警告过的场景）。

→ 绑定清理条件改为双向取并：
```sql
-- 现有 LIKE 前缀 之外，补：
delete from sys_role_permission where permission_code in (select code from sys_permission where module = ?);
```

### 8.5 【已消解】运行期新建 permission 与升级互斥

> 本条原为工程评审#6 提出的应修项；现由 2026-10-17 **裁决「模块的权限点必须注册」** 直接消解——
> **不存在运行期创建权限点的接口**，故不存在「运行期建的 code 被下一次升级标 deprecated」的问题。保留本节说明该冲突为何消失（供后续若再提开放动态权限点时参考）。

原冲突描述：`POST /rbac/permissions` 创建的 code 未进 manifest，下一次升级会被 `solution-perms.ts:59-65` 按「声明里没有」标 deprecated。

→ **现结论：M1 及以后均不提供权限点创建/删除/改名**（保留上游 **Q10**：「运行期注册权限点仍禁止」）。权限点的生命周期= manifest 声明 → 安装器 upsert → 卸载清理，与 §9 端点表已同步。

---

## 9. 端点表与实现归属

### 9.1 必须由框架挂载（架构阻塞）

若 N 个模块各自实现这 7 个端点，隔离就退化成「作者自觉」且有 N 份实现。**必须是框架共享 mount**（按模块前缀路由挂载），**模块零实现、零覆写**。

| 端点 | 行为 | 隔离规则 | 分期 |
|---|---|---|---|
| `GET /api/<mod>/rbac/roles` | 列本模块角色 | `WHERE module = callerModule` | M1 |
| `POST /api/<mod>/rbac/roles` | 建角色 | 前缀+module 强制；初始绑定属本模块 | M1 |
| `PUT /api/<mod>/rbac/roles/bindings?name=` | 改绑定 | ownership + containment | M1 |
| `DELETE /api/<mod>/rbac/roles?name=` | 删角色 | ownership + builtin 硬拒 + 占用禁删 | M1 |
| `GET /api/<mod>/rbac/permissions` | 列本模块权限点（**只读**） | `WHERE module = callerModule` | M1 |
| ~~`POST/PUT/DELETE /rbac/permissions`~~ | ~~动态权限 CRUD~~ | **永久不做**——裁决「权限点必须注册」（§0.5），唯一入口是安装期 manifest 声明 + `upsertSolutionPerms` | — |
| `PUT /rbac/roles/members?name=` | 授予席位 | 见 §10.2，**推迟**，且需二次校验 | M2 |

**调用者鉴权**：各端点由 `assertPermission("<callerModule>.admin")` 守卫；`superadmin`/`admin` 按 `decideAccess` 前两级天然放行。

**配套的 management-plane 端点（§0.6 裁决）**：管理面需提供一个**显式的属主参数**入口，供 admin/superadmin 编辑**模块角色**的绑定：

| 端点 | 行为 | 守卫 | 约束 |
|---|---|---|---|
| `PUT /api/system/roles/bindings?name=&owner=<module>` | 改**任意角色**（含模块自建角色）的绑定 | `assertSystemAdmin()` + 路由属主必须是 `system` | `owner` 为服务端按**角色行**查得，不从客户端取；写 `level: 4` 审计并带 `detail.override`（见 §5.2 `adminOverride` 模式） |

> builtin 角色（`superadmin`/`admin`/`editor`/`viewer`）在**任何模式**下都拒改（`assertNotBuiltin`）；`superadmin` 专属操作按 D11 不建模为权限点，不会出现在可绑并集里。

> **冷启动死锁**（产品阻塞）：新装模块没有任何人持有 `A.admin`，自服务无入口。
> → M1 限定由**平台超管**在安装后指认首位 `A.admin`，不开放普通租户自助。

---

## 10. 分期（PM 裁决）

静态 manifest 声明已覆盖「预置角色/权限点定义」，运行期自服务要解决的是**运行时调整**，两者不应重复投资。当前**没有**动态权限点 CRUD 的实证需求。

### M1（本期）
- 隔离闸门：三层校验 + 单一收口 + 安装期前缀校验（§5.3）
- **模块自服务角色 CRUD + 绑定调整**（2026-10-17 裁决开放，§0.5）；containment 按「模块角色 strict」模式强制（§5.2）
- 权限点**只读**——创建/删除**永久不做**，唯一入口仍是安装期 manifest 注册（§8.5）
- 否认审计（`auth.deny`）、卸载影响面预检
- 调用者限定平台超管 → 由其指认首位 `<module>.admin`（冷启动，PM）

### M2（验证后再投）
- 成员授予端点（**越权后果最重**：一处疏漏即可授出 `superadmin` → 全平台沦陷）
- 开放租户级自助
- ~~动态权限点 CRUD~~ —— **已裁决移除**，不再纳入任何阶段（§0.5 / §8.5）

### 卸载影响面预警（PM 应修）
自创角色虽可按 module 清理，但卸载会**批量撤销成员**（`sys_user_role` 级联删）→ 强退一批人。
→ 卸载前预检「受影响角色数 / 用户数」，UI 二次确认后方可执行。

---

## 11. runtime 对外开发接口

```ts
export interface ModuleRbacClient {
	listRoles(): Promise<RbacRole[]>
	createRole(body: { name: string, title: string, permissions?: string[] }): Promise<{ name: string, module: string }>
	updateRoleBindings(name: string, codes: string[]): Promise<void>
	deleteRole(name: string): Promise<void>
	listPermissions(): Promise<RbacPermission[]>
	// M2：createPermission / deprecatePermission / grantMembers
}
export function createModuleRbac(module: string): ModuleRbacClient
```

要点：
- 写参里**不暴露** `module` / `version`（属服务端事实，暴露只会诱导伪造）；
- `name` 传 slug 或全名均可，服务端归一化（推荐示例用全名）；
- **须与 manual §2.8 说明取舍**：既有 `api/rbac` 是 flat `fetchRbac*`（`rbac/index.ts:43-47`）风格，本工厂是第二个客户端范式。因 §9.1 采框架挂载，工厂成立，但**不得两种混搭**（模块勿同时手拼 URL 与 `ojm api` `__client`）。
- 读侧（`useUserStore` / `useAccess` / `AccessControl`）**不变**。

---

## 12. 落地步骤

1. ~~**POC `http.module.{name,version}` 只读语义**~~ → **✅ 已完成（oj 0.1.76，见 §3）**。落地改为「升级 vendor oj ≥ 0.1.76 + 钉 `host-versions`」。
2. 收口改造：`roles.ts` 写函数降级薄包装；同步 `system/roles/api.ts:48` pattern；建立 `Scope` 不透明类型 + 禁字面量守护。
3. `roles-scoped.ts` 实现三层断言 + 端点（含 8.2 的 tx / 方言 / 顺序要求）。
4. **安装期校验补齐**（§5.3）+ 历史行修数。
5. oplog：按 7.3 过渡策略改服务端强制 + 契约三件套同步；按 7.4 加限流/白名单/脱敏。
6. 否认审计 + 卸载清理补正（8.4）+ 卸载影响面预检。
7. runtime 导出 `createModuleRbac`（仅 M1 面），受 `tests/runtime/runtime-exports.test.ts` 冻结守护。
8. devkit §2.8 补「自管理场景」+ 隔离红线 + **两条反模式**（version 不进隔离键；`<X>.admin` 是提权敏感名）。

### 守卫测试清单（在原 6 条基础上补）
- 空 `codes` 数组（三方言 `in ()`）
- 超大批量（占位符上限分批）
- 大小写归一化（MySQL ci collation）
- ~~运行期创建的 permission 升级后不被误 deprecated~~ → 改为断言**无此接口**（§8.5）
- 卸载重装后绑定不复活（8.4 双向清理）
- oplog 旧 client 兼容（不传 module 不 400）
- **安装期**：声明 `system.admin` 必须被拒
- **`http.module` 为 null 的上下文**（WS / 任务桥 / `run_with`，oj 0.1.76）→ 自服务端点必须 fail-closed 403
- **`strict` 模式**：模块 A 把 `B.*` 绑到 `A.manager` → 404；改 `B.manager` → 404
- **`adminOverride` 模式**（§0.6）：管理面给 `A.manager` 绑 `B.execute` → **放行**，且落 `level:4` 审计（`detail.override`），被 A 端后续 `strict` 调用不可撤销性地看到新绑定
- **反向**：A 自己的路由**无论如何**不能触发 `adminOverride`（身份冻结，§3③）——用伪造参数/前缀均无效
- builtin 角色在 `adminOverride` 下同样被拒（`assertNotBuiltin`）

---

## 13. 同步清单：部分推翻 D8 后须修订的既有产出

| # | 产出 | 位置 | 须做的修订 |
|---|---|---|---|
| 1 | 上游设计（已定稿） | `docs/prd/solution/202610160908-rbac-auth-design.md` **D8** 与 **§4A line 169** | D8 标注为「**部分被推翻（2026-10-17）**」：模块**可**自管理自身命名空间角色；「权限点 manifest-only」维持。§4A 增加「**路径四：模块自服务角色**」，并给三类角色绑定范围表（见本文 §0.5） |
| 2 | 上游实施计划 | `docs/prd/solution/202610160952-rbac-implementation-plan.md` | **A6 / C2 已标「已完成」需重开**：`roles.ts` 从单一 `custom.*` 语义拆出 `strict` / `unified` 两种模式；新增 `roles-scoped.ts` 与 `_platform` 挂载的自服务端点 |
| 3 | 模板代码 | `packages/cli/templates/api/src/_platform/_shared/service/roles.ts:33,100,108` | `CUSTOM_NAME` 单一正则 → 按 scope 模式分支；`updateBindings` 增 ownership + containment（管理员 custom 路径走 `unified` 放行跨模块） |
| 4 | 契约同步 | `system/roles/api.ts:48` 的 schema pattern | 双写必须同改（既有一条暗叠正则） |
| 5 | 验收用例 | `202610160908-rbac-auth-design.md` §8 BDD（AC1-15~20 等） | 新增三类用例：模块越界建/绑/删返回 404；模块自建角色不得携带他模块权限点；管理员 custom 角色**仍可**跨模块绑定（防回归误伤） |
| 6 | 市场/注册表 | `202610161300-solution-lifecycle-registration-design.md` | 若存在「解决方案能力声明」字段，须登记「是否自管理角色」以便安装期授信 |
| 7 | oj vendor | `packages/cli/vendor/host-versions.json` | 钉 oj ≥ **0.1.76**（`http.module` 依赖） |

> ⚠️ 上表第 1、2 项涉及**修订已定稿文档**——按本文 §0.5 裁决，属有意为之，但需在上游文档留下「已被 X 文档修订」的反向指针以保持上下文自洽。需我代为添加该指针请告知。

---

## 14. 附录：评审意见处理表

| 来源 | 意见 | 处理 |
|---|---|---|
| 安全#1 | 「结构性不可能」夸大 | §2 重写为防护口径 + 残余风险 |
| 安全#2 / 工程#2 | 安装期无前缀校验 × judge 不读 module | §5.3 升为第三层 + §12.4 |
| 架构#2 | scope 可任意传 | §4.3 不透明 `Scope` + 禁字面量 |
| 架构#1 / 安全#7 | 双写路径漂移、`roles.ts:100/108` 是出口 | §4.2 收口、写函数降级 |
| 架构#3 | 端点由谁实现 | §9.1 框架挂载，模块零实现 |
| 架构#4 | 与 §2.8 / flat 风格冲突 | §11 说明取舍、禁混搭 |
| 工程#1 / 架构#5 | oplog 契约不同步即 400 | §7.3 三件套同步 + 过渡策略 |
| 工程#3 | 三方言：ci PK / 空 IN / 占位符 | §6.3 + §8.2 |
| 工程#4 | TOCTOU | §8.2 tx + 影响行数校验 |
| 工程#5 / 安全#8 | 缓存失效缺口 | §8.3 |
| 工程#6 | 运行期 permission 被升级标 deprecated | §8.5 → M1 不做，M2 前置条件 |
| 工程#7 | 迁移：三份 SQL、`custom.*` breaking | §7.2 + 声明 breaking/改名迁移 |
| 工程#8 / 安全#4 | 错误码与枚举泄漏 | §8.2 先归属后存在 + 统一 404 |
| 安全#3 / PM | 拒绝尝试无审计 | §7.5 `auth.deny` level 4 |
| 安全#5 | 卸载 LIKE vs module 不一致 | §8.4 |
| 安全#6 | oplog 淹没/伪造/注入 | §7.4 |
| PM#1 | 无 tenant 维度 + 冷启动 | §9.1 M1 限超管指认首位 admin |
| PM#2/#3 | MVP 范围、成员端点后置 | §10 M1/M2 |
| PM#4 | 卸载批量撤销无预警 | §10 影响面预检 |
| 架构#6 / 安全#8 | 复合角色 / 成员端点 | §6.4 不做 + M2 二次校验 |
| 安全#9 | 先 POC 再称已确认 | §3 + §12.1 |
