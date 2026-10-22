# 多用户方案：打包排除自带 + ojm new 生成向导 — 设计

日期：2026-10-22 · 分支：`feat/ojm-multi-solution`（并入 `feat/ojm`）· 预计版本：0.2.23

## 原始需求

1. 脚手架（`ojm init` 产物）的 package.json 增加打包解决方案的 scripts 命令；
2. 打包**只打用户自定义方案，排除脚手架自带方案**；
3. `ojm` 能在脚手架内**快速生成新方案**（含布局骨架），一个脚手架可放**多个**用户方案；
4. 最好能**隐藏**脚手架自带方案。

## 现状差距

| 需求 | 现状 |
|---|---|
| 多方案共存 | `bundle.ts` 的 `resolveContract` 是单数：多份 `src/<模块>/solution.yaml` 直接报错「无法确定方案归属」 |
| 自带/用户身份区分 | 无任何标记。自带模块（auth/home/login/notification/personal-center/system/web/oj-market/_platform/demo）碰巧都没有 `solution.yaml`，但第一方方案（如 oj-market，见手册 §12.3 发布时序）一旦自带契约，就会被 `--bundle` 全量误打 |
| 脚手架 scripts | `init.ts` `generatePackageJson` 只有 dev/build/preview/info/typecheck，无 bundle/new |
| 隐藏自带 | `ojm info` 模块清单不分组，自带与用户混在一起平铺 |

## 方案

### A. 自带模块身份：`src/.ojm-builtin.json`（隐藏的前提）

- **单个中央清单**（不放逐模块标记文件）：`{ "modules": ["auth","home",…] }`，由 `ojm init`
  生成脚手架时写入（名单是 init 白名单的常量，单一真源在 init.ts）。
- 文件缺失（旧工程/用户删了）→ 视为无内置模块，全部行为退化为现状（向后兼容）。
- 消费方三处：`bundle --bundle`（排除）、`ojm info`（默认隐藏，计数提示）、`ojm new`（拒绝占用内置名）。
- 为什么值得做：让「自带方案不参与用户打包」从"碰巧没有契约"变成**显式身份**——第一方可分发
  方案（自带 solution.yaml）与用户方案从此可区分。

### B. 打包：多方案（`bundle.ts`）

契约解析从单数改复数，规则（向后兼容优先）：

- `ojm build --bundle`（无参）：工程根 `solution.yaml` 存在 → 只打它（旧单方案行为零变化）；
  否则收集 `src/*/solution.yaml` 中**非内置**的全部，逐个校验打包；一个都没有 → 友好报错
  「没有可打包的用户方案（脚手架自带方案不参与打包），用 `ojm new` 创建」。
- `ojm build --bundle <name>`：只打 `src/<name>/` 那份（name 未登记契约/是内置名 → 明确报错）。
- 逐个独立校验（契约 + 表集 + 双语），fail-fast 保持；一个失败即停（与现状哲学一致）。
- 「只入包方案自己的模块」「私钥禁入包」等红线不动。

### C. `ojm new <name>`：新方案生成向导

- 参数：`<name>` 必填（kebab-case；已存在或是内置名 → 拒绝并提示）。`--layout container|none`
  （默认 container）、`--api`（同时生成后端骨架）、`--yes`（非交互确认）。
- 生成（module-root 布局 `src/<name>/{api,web}`）：
  - `src/<name>/solution.yaml`：身份段 + `web` 段最小集（api 段仅 `--api` 时）；
  - `src/<name>/web/entry.ts`：defineModule 最小骨架，一条示例路由（`handle.layout` 按 `--layout`，
    回答"快速搭建布局"）、`pages/index.tsx` 示例页、`locales/{zh-CN,en-US}.json` 双语；
  - `--api` 时：`src/<name>/api/manifest.yaml`（oj 七键）+ `api.ts` 示例 handler（带 `.schema`）；
  - `web.config.ts` 的 `modules` 数组**追加**登记（文本插入，仿既有条目；幂等，已登记跳过）。
- 生成后打印下一步提示（`pnpm dev` 看效果、`ojm build --bundle <name>` 打包）。

### D. `ojm info`：默认隐藏自带模块

- 模块清单按内置清单分组：用户模块全列；自带模块折叠成一行
  `框架自带：N 个（ojm info --all 显示全部）`；`--all` 恢复平铺。

### E. 脚手架 scripts（`init.ts` `generatePackageJson` + templates/package.json 同步）

```jsonc
{
  "new": "ojm new",               // 交互生成新方案骨架
  "bundle": "ojm build --bundle"  // 打包全部用户方案（自带方案自动排除）
}
```

（既有工程由 package.json「合并补缺」策略自动补上这两个 script，无需重建脚手架。）

## 涉及代码

- `packages/cli/src/bundle.ts`：契约解析复数化 + 内置排除；
- `packages/cli/src/builtin.ts`（新，~30 行）：读 `src/.ojm-builtin.json`，供 bundle/info/new 共用；
- `packages/cli/src/index.ts`：`build --bundle [name]` 透传 name、`new` 子命令、`info --all`；
- `packages/cli/src/new.ts`（新）：向导与骨架生成；
- `packages/cli/src/init.ts`：生成 `.ojm-builtin.json` + 两个 scripts；
- `packages/cli/templates/package.json`：scripts 同步；
- `docs/devkit/manual.md` §11：多方案语义 + `ojm new` 文档（注意零内部代号守卫）。

## BDD 用例

### 打包（bundle）

| # | 场景 | Given | When | Then |
|---|------|-------|------|------|
| B1 | 旧单方案兼容 | 工程根 solution.yaml | `--bundle` | 只打它，行为与现状逐字节一致 |
| B2 | 多用户方案 | 根无契约，`src/{crm,erp}/solution.yaml` 均非内置 | `--bundle` | 依次打出两份 tgz，各自校验独立 |
| B3 | 自带排除 | B2 + `ojm-market` 也带 solution.yaml 且在 `.ojm-builtin.json` | `--bundle` | oj-market 不出包，日志注明「框架自带，跳过」 |
| B4 | 按名打包 | `--bundle crm` | 打包 crm 一份；`--bundle oj-market` 报「框架自带方案不参与打包」 |
| B5 | 空清单 | 根无契约、无任何用户 solution.yaml | `--bundle` | 友好报错并指向 `ojm new`（非「缺少契约」旧文案） |
| B6 | 旧工程无清单文件 | 无 `.ojm-builtin.json`，多份用户契约 | `--bundle` | 全部打包（无内置概念，兼容） |

### ojm new

| # | 场景 | Then |
|---|------|------|
| N1 | `ojm new crm --layout container` | 生成 §C 骨架；solution.yaml/entry.ts/locales 双语齐备（打包校验直接过） |
| N2 | `--api` | 额外生成 api 骨架，`solution.yaml` 含 api 段 |
| N3 | 重名/内置名（如 `home`） | 拒绝，提示已存在或属框架自带 |
| N4 | 已登记 web.config.ts 再生成 | modules 幂等，不重复追加 |
| N5 | 非 TTY 且无 name | 报错要求显式 name（CI 友好） |

### ojm info

| # | 场景 | Then |
|---|------|------|
| I1 | 默认 | 自带模块折叠为一行计数，用户模块全列 |
| I2 | `--all` | 平铺全部（现状输出） |
| I3 | 无清单文件 | 平铺全部（兼容） |

## 任务

- [ ] 文档（本文件）
- [ ] TDD：B1–B6 / N1–N5 / I1–I3 先红
- [ ] 实现：builtin.ts → bundle 复数化 → new.ts → index 接线 → init/scripts
- [ ] manual §11 更新 + devkit-docs 守卫同步
- [ ] `pnpm test` / lint / typecheck 全绿
- [ ] 合并回 `feat/ojm`，更新任务状态与总结
