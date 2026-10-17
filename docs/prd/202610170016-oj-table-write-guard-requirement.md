# oj 功能诉求 PR-6（**OJ-7**，P1）：表级写守卫——`ownership_guard` 读写分离 + 属主侧写授权

> **PR 文本，供手动提交。** 编号与格式接续 `docs/prd/solution/202610161500-oj-bin-feature-requests-pr.md`（PR-1~PR-5，已占 `OJ-1`~`OJ-6`），故本诉求编号为 **OJ-7**。
> **编号状态更新（2026-10-17，oj 0.1.76 实测复核）**：上文 PR-1~PR-5 中 4 条已随 oj v0.1.75 落地并关闭
> （OJ-1 归档解压 / OJ-2 热更内部触发 / OJ-3 YAML / OJ-4 验签），OJ-6 迁移内部化降级为可选；
> 新登记 **OJ-8**（Windows 缺 `tar`/`zip` 时的报错契约，见该文档 PR-7）。
> → **OJ-7 仍是当前 oj 侧唯一遗留的阻塞项**（表级写守卫未落地）。
> 提出方：oj-module · 日期：2026-10-17 · 状态：**待评审 / 未提交**
> 基线版本：oj v0.1.73（`packages/cli/src/contract/run.ts:20` 引用的口径）
> 接收方：oj 项目（**外部仓**；本仓库只读、不含其源码——`apps/playground-oj` 只是 oj 的应用示例，非源码，勿投此处）
> 关联：`docs/prd/20261016-solution-module-rbac-isolation-design.md`（§2 防护口径、§5.3 安装期校验）
> **依赖性质：阻塞项**——本需求未落地前，oj-module 侧只能做 service 层纪律收敛，无法获得结构性写隔离。

## 1. 一句话诉求

希望 oj 把现有的表归属守卫（`ownership_guard`）从 **「跨模块访问需声明」** 升级为 **「跨模块写需属主授权」**，使一个模块的 SQL 写入面被收窄到：

> ① 它自己拥有的表（`manifest.tables`）＋ ② 属主显式放行的表（`export_writes`）

**读完所需做的判决只有两点**：这条方向是否认可；若认可，R1–R4 是否可分批交付。

---

### 现状证据（oj **0.1.76** 本地核验，2026-10-17）

本诉求已用 `oj --version` = **0.1.76** 与 `~/.local/share/oj/devkit/`（最新）逐项复核，**结论：仍然成立，未被实现**：

| 核验项 | 结果 |
|---|---|
| `ownership_guard` 语义 | **未变**，`api-manual.md:2997` 仍为「`warn` 跨模块表访问仅告警 / `deny` 未声明 deps 拒绝执行」——**无读写分离、无属主侧授权** |
| `export_writes` / `append_only` / 列白名单 | 全部**不存在** |
| `/* oj:allow-table=x */` 逃生门 | 仍存在（`api-manual.md` 排障表），**不可禁用、不留痕** |
| `manifest.tables` / `deps` / S002 / S003 / S005 | 存在且工作（同 ø 上表） |
| **`http.module.{name,version}`（v0.1.76 新增）** | **已实现**——`global.d.ts:130`：按 handler 文件所在模块目录注入，`Object.freeze` 只读， null 于任务桥/WS/`run_with` |

> **利好**：0.1.76 已把 `http.module` 定为 oj 的**框架授信依据**——「跨模块表归属守卫 / bound_db 重定向 / 平台特权换装」均按它裁决（`api-manual.md:1070`、`README.md:46`）。
> 这意味着本诉求所需的**模块身份基座已经就位**，R1–R4 只需在既有归属图上叠加「写」的判定，不是从零建机制。

---

## 2. oj 现状：零件已经很完备

先说明——oj 已经有多年积累的机制，本需求是**在其上加一层**，不是推倒重来。以下口径以本地 `~/.local/share/oj/devkit/`（**0.1.76，权威**）为准；仓内 `docs/oj-api-dev/` 为其快照副本，可能滞后。

| 机制 | 现状语义 | 引用 |
|---|---|---|
| `manifest.tables: [x]` | 本模块**拥有**的表清单（与 schema.yaml 双向一致） | `:185` |
| `manifest.deps` | 跨模块表访问声明 | `:187, :285` |
| `server.ownership_guard` | `warn`（默认）/ `deny`（未声明 deps 拒绝执行，500 附指引） | `:276, :3099` |
| S002 | 表归属唯一——一张表只有一个属主 | `:2846` |
| S003 / S005 | build 期：跨模块 SQL 须声明 deps；tables↔schema 一致 | `:2845` |
| S006 | seed.sql 只碰本模块及 deps 表 | `:2846` |
| `/* oj:allow-table=x */` | 误报逃生门 | `:289` |

**值得强调的好性质**：`ownership_guard: deny` 是**运行时逐条 SQL 拒绝执行并返回 500**，不是 build 期纸面检查。它拦在模块 JS 之下，模块无法用代码绕过——这正是它能成为真正能力边界的原因。另外「共享 service 以调用方身份执行」也是正确行为（见 R1 的收益）。

---

## 3. 为什么现有机制担不起「写边界」

五处硬伤，按严重度排序：

1. **授信方是反的（核心）**。`deps` 是**访问方自证**：模块在自己 manifest 写 `deps: {system: "^1.0.0"}` 即获得访问 system 表的资格。自证不是授权——恶意模块一行配置即可绕过。因此它只能是**耦合声明**，不可能是安全边界。
2. **不区分读写**。声明后读写同开。我们需要的是：读可放开给 deps，**写必须属主点头**。
3. **逃生门无约束**。`/* oj:allow-table=x,y */` 语句级注释即绕过，且不留痕。
4. **无主表不设防**。手册 `:279` 明确「模块未部署时其表无主，运行时不设防」（部分部署/灰度场景）。
5. **无写入模式约束**。对「共享的日志表」只能全开写，无法限制为只追加。

---

## 4. 需求细则（R1–R4，建议可分批交付）

### R1 — 属主侧写授权（核心）

新增属主侧声明 `export_writes`：表属主显式授权谁可以写自己的表。**授信任的一方必须是属主**，而非访问方。

```yaml
# _platform/manifest.yaml
tables: [users, sys_role, sys_permission, sys_role_permission, sys_user_role, sys_oplog]

export_writes:
  users:     { to: [auth, personal-center, web] }
  sys_oplog: { to: "*", mode: append_only }
  # 未列出的 sys_role / sys_permission / sys_role_permission / sys_user_role
  # → 默认仅 system 可写；其余模块的写入在 SQL 层被拒
```

### R2 — 读写分离

| 语句 | 判定依据 |
|---|---|
| `SELECT` | `deps`（**现有语义完全不变**） |
| `INSERT` / `UPDATE` / `DELETE` | 属主自己，或属主的 `export_writes` 放行 |

即：**`deps` 降级为「读 + 耦合声明」，写权限独立**。

### R3 — 写入模式约束（可选，建议随 R1 之后）

| mode | 语义 |
|---|---|
| `full`（默认） | 允许 INSERT/UPDATE/DELETE |
| `append_only` | 仅 INSERT，禁 UPDATE/DELETE |
| `columns: [...]` | 仅允许更新白名单列（配合 `mode: update_only`） |

`sys_oplog` 用 `append_only` 是典型场景：**连日志表都只允许追加，删审计的通路即被堵死**。

### R4 — 逃生门可关闭且可观测

`/* oj:allow-table=x,y */` 需要在 `table_write_guard: deny` 下：

- 默认**不生效**（或提供 `server.allow_table_override: false` 显式禁用）；
- 每次出现在日志/alog 落一条审计记录（含模块名、表、语句指纹）。

---

## 5. 配置与渐进开关

**建议新增独立开关，不改动 `ownership_guard` 现有语义**：

```yaml
server:
  ownership_guard: warn      # 保持现状，行为不变
  table_write_guard: off     # 新增：off（默认，零破坏）/ warn / deny
```

灰度路径：`off` → `warn`（观测现有跨模块写）→ `deny`（收口）。

> 默认 `off` 是刻意的：**本需求对存量用户零破坏**。

---

## 6. 运行时行为

拒绝时的表现建议对齐现有 `ownership_guard` 的成功经验——**500 + 可操作指引**：

```
oj table write denied: module "order" cannot write table "sys_role"
  owner: _platform | need: owner's manifest export_writes -> { to: [order] }
  config: server.table_write_guard=deny
```

同时建议：结构化日志字段 `{ module, table, owner, verb }`，便于宿主侧接审计。

---

## 7. 上下文界定（避免误伤）

| 上下文 | 是否受守卫约束 | 理由 |
|---|---|---|
| 模块路由 handler | **是** | 本需求主目标 |
| `_platform` 共享 service（被任意模块 import） | **是**，以**调用方路由身份**执行 | 这正是要的效果（见 §8 收益②） |
| migration / `oj migrate` | 否 | 装配/运维身份 |
| `seed.sql` | 否（S006 已在 build 期约束） | 同上 |
| 安装器 / 市场程序 | 否 | 平台身份 |

> 若 `_platform` 共享 service 也采用同一份 `export_writes` 配置，则只需在第 7 节表里的前两项走守卫。

---

## 8. 收益：为什么值得做

**① 模块市场第三方模块的写隔离**。oj-module 的目标是让第三方解决方案模块进市场。没有这一层，第三方模块的 SQL 写入面是**全库**——只能靠代码审计兜底。

**② 顺手解决「混淆代理人」**。今天 `_platform/_shared/roles.ts` 这类共享 service 可被任何模块 `import` 后直写 `sys_role`。加了表级写守卫后，同一份 service 被 `order` 调用时会以 `order` 身份被 SQL 层拒绝——**不需要改一行 service 代码**，也不需要依赖调用方自律。这是本需求最省事的收益。

**③ 与宿主侧工作是互补而非替代**。oj-module 侧已在做 service 层收紧、安装期 manifest 校验等；本需求落地后可从「请遵守纪律」升级为「不遵守也做不到」。

---

## 9. 验收标准（可直接作为测试用例）

| # | 用例 | 期望 |
|---|---|---|
| 1 | 模块 A 对 `_platform` 的表 UPDATE，无 `export_writes` | 拒绝执行（500） |
| 2 | 模块 A 有 `deps: {platform}` 但无 `export_writes` | SELECT 通过；INSERT/UPDATE/DELETE 拒绝 |
| 3 | `export_writes: { sys_oplog: { to: "*", mode: append_only } }` | INSERT 通过；UPDATE/DELETE 拒绝 |
| 4 | `mode: columns: [avatar_base64]` | 白名单列 UPDATE 通过；改其他列拒绝 |
| 5 | `/* oj:allow-table=x */` 在 `table_write_guard: deny` 下 | 不生效，且落一条审计 |
| 6 | 属主读写自己的表 | 完全不受限（含无 `export_writes` 的情况） |
| 7 | `table_write_guard: off`（默认） | 全通过，与今日行为一致（零回归） |
| 8 | migration / seed 上下文写跨模块表 | 不被误拦 |
| 9 | 错误信息 | 含表属主 + 修复指引（如何加 `export_writes`） |
| 10 | `oj build --check` 新增结构检查 | `export_writes` 指向**非属主**的表 → 报错（与 S002/S005 同族） |
| 11 | 无主表（模块未部署） | 行为需在实现期明确定义；建议 deny + 告警，而非静默放行 |

---

## 10. 明确不在本需求范围内

为避免范围膨胀，以下**不要求** oj 承担：

- ❌ 进程/沙箱隔离。（oj 是 Rust 嵌 V8，本需求不要求再做 JS 隔离）
- ❌ 不改 `deps` 现有语义（仍=读 + 耦合声明）
- ❌ 不改 `ownership_guard` 现有行为（新开关独立灰度）
- ❌ 不接管 migration/seed/installer 上下文
- ❌ 不要求列级细粒度到行级（RLS）；列白名单 R3 已够用，行级由宿主侧 service 承担

---

## 11. 交付依赖

- **提交去向**：oj 项目仓库。（本仓库 `apps/playground-oj` 只是 oj 的**应用示例**，非 oj 源码，勿投此处）
- **阻塞关系**：本需求未落地前，oj-module 的模块间写隔离只能停留在 service 层纪律（见关联设计文档 §2「工程护栏」定性），残余风险为「单模块沦陷 = 全平台沦陷」。
- **可分批**：若 R1+R2 先行落地，已能解决绝大部分隔离诉求；R3、R4 可后置。
