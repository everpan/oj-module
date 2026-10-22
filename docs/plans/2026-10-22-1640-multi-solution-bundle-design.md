# 多用户方案：打包排除自带 + ojm new 生成向导 — 设计（评审修订版 v2）

日期：2026-10-22（v2 同日，按六方评审修订）· 分支：`feat/ojm-multi-solution` · 预计版本：**0.2.23**

## 原始需求

1. 脚手架（`ojm init` 产物）的 package.json 增加打包解决方案的 scripts 命令；
2. 打包**只打用户自定义方案，排除脚手架自带方案**；
3. `ojm` 能在脚手架内**快速生成新方案**（含布局骨架），一个脚手架可放**多个**用户方案；
4. 最好能**隐藏**脚手架自带方案。

## 评审记录（2026-10-22，六方独立评审，全部「有条件通过」）

| 评审角色 | 结论 | 主要落地意见 |
|---|---|---|
| 专家工程师 | 有条件通过 | M1 多契约同名静默覆盖产物；M2 new 无布局守卫会打挂 legacy 工程；M3 info 数据源与 new 登记冗余（已核实成立）；M4 usage.ts 帮助必须登记 |
| 专家架构师 | 有条件通过 | M1 名单真源是 init.include.yaml 而非 init.ts 常量；M2 旧工程清单陈旧；M3 优先级矩阵三个组合未定义；M4 坏 JSON 行为未定义 |
| 专家产品 | 有条件通过 | M1 new 在非 ojm 工程行为未定义；M2 文档登记点不全（§10.1 命令表才是权威清单）；M3 `--bundle [name]` 形态要定死 |
| 安全专家 | 有条件通过 | M1 name 校验（路径穿越/代码注入）；M2 显式声明非安全边界；建议私钥扫描正则扩面 |
| 技术 leader | 有条件通过 | M1 名单双写漂移；M2 new 历史布局打挂工程；M3 name 查重；建议两段式打包、CHANGELOG 条目 |
| 发布工程师 | 有条件通过 | M1 名单派生或钉测试；M2 升级路径回填清单；建议两段式、scripts 子集守卫、索引面说明 |

**已核实事实**：Form B 索引已支持多方案（`market/index-builder` 按 name 分组全量重建，扫描 `cdn/*.tgz`），发布面无改动；`ojm info` 现读登记清单（`info.ts:110` `loadModulesConfig`），module-root 下未登记模块不显示——三位评审交叉确认，v2 修复；`ojm new` 的 web.config.ts 文本插入在扫描制下零收益（0.2.20 起扫描为真源），删除。

## 方案（v2）

### A. 自带模块身份：`src/.ojm-builtin.json`

- **名单派生自 `init.include.yaml`**（单一真源）：取白名单 `src/<name>/(api|web)` 条目的模块名集合生成，不在 init.ts 另立常量；守卫测试钉「派生名单 == 白名单 src 前缀集」。web-only 模块（login/home/oj-market）由 `src/<name>/web` 条目覆盖。
- **写入时机**：init 生成脚手架时写；**重跑 init 时缺失才补写（copyIfAbsent）、已存在不动**——用户对该文件有完全控制权（删名 = 恢复该模块参与打包/显示，加名 = 折叠自己的模块）。想刷新名单：删掉文件重跑 init。文件头注释写明「由 ojm init 生成，可手改/删除」。
- **解析语义**：文件缺失 → 空名单（旧工程兼容，B6）；**坏 JSON / modules 非数组 → fail-fast**（报文件路径与错因），不静默降级——与本仓「坏清单出不了包」哲学一致。
- **非安全边界（显式声明）**：该文件只活在源工程、**永不入包**（tgz 组装只有契约/api 产物/web 产物三处拷贝）；伪造/删除它的最坏后果是打包侧自我排除或误打自带方案——安装侧信任链（签名 + 信任库 + TOFU，fail-closed）原样挡住，**信任判定与 builtin 标记无关**。

### B. 打包：多方案（`bundle.ts` 复数化 + 两段式）

**name 校验（安全 M1）**：`--bundle <name>` 与 `ojm new <name>` 共用正则 `/^[a-z0-9][a-z0-9-]*$/`，先校验再拼路径——挡住 `../` 穿越与引号/换行注入。

**优先级矩阵（架构 M3，写死）**：

| 场景 | 行为 |
|---|---|
| `--bundle <name>` | 先找 `src/<name>/solution.yaml`（无则 manifest.yaml 回退）；没有则比对工程根契约的 `name === <name>`，命中打根契约；都不中 → 报错。内置名 → 拒绝并提示（第一方请在框架仓模板工程打包——那里无 builtin 清单，走全量路径） |
| 无参 + 工程根 solution.yaml | 只打根契约（B1 旧行为零变化）；src 下存在被跳过的用户契约时打一行 hint；根契约 name 命中内置名单时 warn（不阻断） |
| 无参 + 无根契约 | 收集 `src/*/` 模块级契约（solution.yaml 与 manifest.yaml 回退**同样参与**，同样排除内置）；内置项跳过并逐条日志「框架自带，跳过」；用户契约为零 → 友好报错指向 `ojm new` |
| 任意收集路径 | 契约 `name === 目录名` 强校验（fail-fast）；**跨契约 name+version 查重**（fail-fast，防 dist/ 静默覆盖） |

**两段式（发布 S2 / leader 建议6）**：先对全部目标契约跑完契约+表集+双语校验（纯读，零写盘），全绿才开始逐个写 tgz——校验类失败 dist/ 零增量（发布者不会把半截批次扫进 CDN 索引）。组装期失败（I/O 等）：保留已完成产物，报错指名失败方案。

**私钥扫描扩面（安全建议4，顺手）**：`FORBIDDEN_MEMBER` 增补 `.env.*`、`*.p12`、`*.pfx`。

### C. `ojm new <name>`：新方案生成向导

**前置守卫（全 fail-fast）**：
1. 非 ojm 工程（无 `web.config.ts` 且无 `src/`）→ 「这里不是 ojm 工程，先 `ojm init`」；
2. **非 module-root 布局**（存在历史 `web/src` 树）→ 拒绝 + 迁移指引（生成 module-root 骨架会触发双源码树互斥报错，把 build/dev 打挂）；
3. name 未过正则 / 与现存目录或内置名撞车 → 拒绝，附自助指引（`ojm info --all` 看自带名单；想改自带模块：`ojm new <新名>` 后复制代码，builtin 按目录名判定，复制即脱离）。

**生成物**：`src/<name>/solution.yaml`（身份段 + web 段；`--api` 加 api 段）+ `web/{entry.ts,pages/index.tsx,locales/双语}` + 可选 `api/{manifest.yaml,api.ts}`。**不做 web.config.ts 文本插入**——module-root 扫描自动收录（0.2.20 起登记仅为可选排序覆盖）；info 侧配合 D 修复保证可见。

**原子性**：任一步失败 best-effort 删除已建 `src/<name>/`，不留半截目录触发扫描坏目录报错。

**交互清单（非 TTY 无 name 直接报错）**：name → layout（container/none，默认 container）→ 是否带 api（默认否）→ 确认。生成后打印下一步：`pnpm dev` 看效果 · `ojm build --bundle <name>` 打包 · `#/<name>/*` 别名随下次 build/dev 生成。

### D. `ojm info`：默认隐藏自带 + 数据源修复

- **数据源修复（工程师 M3）**：module-root 下改用 `mergeModuleList(scanModules, 登记覆盖)`（与 build 同源），未登记的用户模块也可见；历史布局保持 `loadModulesConfig`。
- 分组渲染：用户模块全列；自带折叠一行「框架自带：N 个（`--all` 展开）」；无清单文件 → 平铺（兼容）。

### E. 脚手架 scripts（init.ts + templates/package.json 双写钉测试）

```jsonc
{
  "new": "ojm new",               // 交互生成新方案骨架
  "bundle": "ojm build --bundle"  // 打包全部用户方案（自带自动排除）
}
```

- **顺手修既有漂移**：`generatePackageJson` 补 `typecheck:api`（模板 package.json 有、生成器缺，而 `src/tsconfig.json` 明明在白名单里）。
- **守卫测试**：生成 scripts ⊆ 模板 scripts（防双写漂移）。
- 措辞：既有工程**重跑 `ojm init` 幂等补齐**（非「自动」）。

### 发布面（发布 S1，零改动确认）

多份 `<name>-<version>.tgz` 平铺落 `cdn/` → 逐包 `ojm sign`（N 方案 = N 次）→ `ojm market build-index` 一次全量重建（已按 name 分组支持多方案）；`ojm publish` 不感知方案数量。

## 涉及代码

- `packages/cli/src/builtin.ts`（新，~40 行）：读/校验 `.ojm-builtin.json`，供 bundle/info/new/init 共用；作用域仅 module-root，历史布局返回空集。
- `packages/cli/src/bundle.ts`：复数契约解析 + name 校验/查重 + 两段式 + 私钥扫描扩面。
- `packages/cli/src/new.ts`（新）：守卫 + 骨架生成 + 交互。
- `packages/cli/src/index.ts` / `usage.ts`：`new` 子命令、`build --bundle [name]`、`info --all` 帮助登记（帮助拦截在子命令前，漏登记即「未知命令」）。
- `packages/cli/src/info.ts`：module-root 扫描并集 + 分组渲染。
- `packages/cli/src/init.ts`：名单派生/写入/回填 + scripts（含 typecheck:api 修复）。
- `packages/cli/templates/package.json`：scripts 同步。
- 文档：manual §1（清单文件）/§7（scripts）/§10.1（`ojm new` 命令条目）/§11（多方案语义）；`docs/guides/solution-dev-build-publish.md` 同步；devkit-docs 测试同步。

## BDD 用例（v2，在 v1 基础上增补）

### 打包（bundle）

| # | 场景 | Given | When | Then |
|---|------|-------|------|------|
| B1 | 旧单方案兼容 | 工程根 solution.yaml | `--bundle` | 只打它，行为与现状逐字节一致 |
| B2 | 多用户方案 | 根无契约，`src/{crm,erp}/solution.yaml` 均非内置 | `--bundle` | 依次打出两份 tgz，各自校验独立 |
| B3 | 自带排除 | B2 + `oj-market` 带契约且在清单 | `--bundle` | oj-market 不出包，日志注明「框架自带，跳过」 |
| B4 | 按名打包 | `--bundle crm` | 只打 crm；`--bundle oj-market` 拒绝并提示第一方路径 |
| B5 | 空清单 | 无根契约、无用户契约 | `--bundle` | 友好报错指向 `ojm new` |
| B6 | 无清单文件 | 无 `.ojm-builtin.json`，多份用户契约 | `--bundle` | 全部打包（兼容） |
| B7 | 跨契约同名同版 | 两份契约 name/version 撞车 | `--bundle` | fail-fast 指名两份契约路径 |
| B8 | name≠目录名 | `src/crm/solution.yaml` 写 `name: erp` | `--bundle` | fail-fast（module-root 强校验） || B9 | 两段式 | 三份契约其一表集校验失败 | `--bundle` | dist/ 零增量，报错指名失败方案 |
| B10 | 旧契约回退 | `src/x/manifest.yaml`（旧方案）非内置 | `--bundle` | 参与收集并出包 |
| B11 | 根契约压 src | 根契约存在 + src 有用户契约 | `--bundle` | 只打根契约 + 一行 hint |
| B12 | 坏清单文件 | `.ojm-builtin.json` 非法 JSON | 任何消费命令 | fail-fast 报路径与错因（非静默降级） |

### ojm new

| # | 场景 | Then |
|---|------|------|
| N0 | 非 ojm 工程目录 | 拒绝：「先 `ojm init`」，零写入 |
| N1 | `ojm new crm --layout container` | 生成骨架，打包校验直接过（round-trip） |
| N2 | `--api` | 额外生成 api 骨架，solution.yaml 含 api 段 |
| N3 | 重名/内置名/非法名（大写、`../`） | 拒绝 + 自助指引 |
| N4 | ~~web.config.ts 幂等登记~~ **删除**（扫描自动收录） | 由 I4 覆盖 |
| N5 | 非 TTY 且无 name | 报错要求显式 name |
| N6 | 历史布局工程（存在 web/src 树） | 拒绝 + 迁移指引，零写入 |
| N7 | 生成中途失败 | 不残留半截 `src/<name>/` |

### ojm info

| # | 场景 | Then |
|---|------|------|
| I1 | 默认（module-root） | 自带折叠计数行，用户模块全列 |
| I2 | `--all` | 平铺全部 |
| I3 | 无清单文件 | 平铺全部（兼容） |
| I4 | 用户模块未登记 web.config.ts | 仍出现在清单（扫描并集，数据源修复验收） |

### init

| # | 场景 | Then |
|---|------|------|
| T1 | 生成脚手架 | `.ojm-builtin.json` 名单 == 白名单派生集（守卫测试） |
| T2 | 旧工程重跑 init 且清单缺失 | 补写清单；已存在则不覆盖用户手改 |
| T3 | 生成 scripts | 含 new/bundle/typecheck:api，且 ⊆ 模板 scripts（守卫测试） |

## 任务（阶段跟踪，进行中）

- [x] 文档（v1 → v2 六方评审修订）
- [x] **Phase 1 基础设施**：`builtin.ts`（读/校验 `.ojm-builtin.json`，历史布局返回空集）+ init 名单派生/写入/copyIfAbsent 回填 —— T1/T2/B12 ✅（10 用例，含 init 接线，无回归）
- [x] **Phase 2 打包复数化**：name 正则、优先级矩阵、name===目录名、两段式、内置跳过日志、私钥扫描扩面 —— B1–B12 ✅（两段式重构 + `--bundle <name>` 接线，382 用例全绿；B7 决策见文末）
- [ ] **Phase 3 `ojm new`**：守卫（工程/布局/name）、骨架生成、原子性、交互、`usage.ts`/`index.ts` 接线 —— N0–N7
- [ ] **Phase 4 `ojm info`**：扫描并集数据源 + 自带分组折叠 + `--all` —— I1–I4
- [ ] **Phase 5 scripts**：`generatePackageJson` 补 new/bundle/typecheck:api + 模板同步 + 子集守卫测试 —— T3
- [ ] **Phase 6 文档与发版**：manual §1/§7/§10.1/§11 + guides 同步 + devkit-docs 守卫 + CHANGELOG 0.2.23 + lockstep bump
- [ ] **统一审查**：全部阶段完成后一次性代码审查（不在阶段中途审）
- [ ] `pnpm test` / lint / typecheck 全绿
- [ ] 合并回 `feat/ojm`，更新任务状态与总结

BDD 用例风格遵循 INVEST：各用例相互独立（无顺序依赖）、可协商、有价值、可估算、小、可测试；
实现遵循 SOLID（单一职责：builtin/bundle/new/info 各司其职，依赖注入可测）与 DRY
（name 正则、名单读取、扫描清单等共享逻辑单点定义）。

## 评审后风险备注

- N1「骨架打包校验直接过」是重验收断言（entry.ts 需一次通过定义读取 + 契约校验），实现时若卡壳是工作量风险而非设计风险，允许拆分先行落地骨架再补 round-trip 断言。
- `--bundle [name]` 同时接受 `--bundle crm` 与 `--bundle=crm`；--help 示例固定推荐 `--bundle <name>` 形态。
- **实现期决策（B7）**：跨契约 name+version 查重与 B8（name===目录名）组合后撞车向量不可达
  （目录名在单一 src/ 层唯一 ⇒ name 唯一），故不实现独立查重，B7 用例改为记录该决策；
  若未来放松 name===目录名 校验，必须先恢复跨契约查重。
