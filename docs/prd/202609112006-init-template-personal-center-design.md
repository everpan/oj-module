# ojm init 模板补全：personal-center 模块 + 钉版矩阵收尾

- 日期：2026-09-11 20:06
- 状态：已确认（用户指示：参考 `apps/playground-oj/modules/src/personal-center/` 补入模板；「必要的修改同步到 template」）
- 关联：[[202609111926-vendor-npm-install-design]]（vendor npm 通道）、`framework-verification-playbook.md`（2026-09-11 基线复跑暴露的缺口）

## 1. 背景与目标

验证手册复跑（2026-09-11 基线）暴露三类模板缺口：

1. **个人中心落空**：runtime `user-menu.tsx` 固定导航 `/personal-center/my-profile`（用户名下拉「个人中心」+ 头像点击），但 `ojm init` 模板没有该模块——脚手架工程点击必落空（与当初缺 home/login 同型缺陷）。playground-oj 已有完整 `personal-center` 模块（前端 + 后端 upload），可照抄。
2. **钉版回退 `*`**：`@types/react` / `typescript` 不在宿主 `versions.json`（矩阵只收 `SHARED_DEPS` 运行时共享包），每次 init 都告警要用户手钉。
3. **个人中心依赖 pro-components**：模板页用 `@ant-design/pro-components`（ProForm），它在共享表内（importmap 提供运行时），但生成 devDeps 未登记——typecheck 过不了。

另发现 **playground 现存缺陷**：`personal-center/upload/api.ts` 回写 `users.avatar_base64`，但 `users` 表（`_platform`）从无此列——上传必 SQL 报错。模板侧必须连列一起补，不能照抄一个坏的。

## 2. 决策表

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| T1 | personal-center 前端 | 模板照抄 playground：entry/locales×2/pages×2，注册进模板 `modules.config.ts` | 用户指定；runtime 菜单已有固定跳转 |
| T2 | personal-center 后端 | 照抄 `manifest.yaml` + `contract.ts` + `upload/api.ts`；**不抄**生成的 `routes.json`/`openapi.yaml`（`ojm api` 产物） | 模板不囤生成物 |
| T3 | users 表补列 | `_platform` 加 `migrations/0002__add_users_avatar_base64.sql` + `schema.yaml` 补列；`web/user-info` 返回 `avatar`（读 `avatar_base64`） | 不修列则上传必 500（playground 现状即缺陷） |
| T4 | playground 同修 | playground `_platform` 补同款 migration + schema + user-info | dogfooding 工程不能让 upload 一直坏着 |
| T5 | 版本矩阵 tooling | shell `build.mts` 的 `writeVersionsJson` 追加 `TOOLING_DEPS = ["typescript", "@types/react"]`（同款 `installedVersion` 解析）→ 重建 `shell-dist` → `sync-host-versions` | 矩阵是唯一钉版真源；init.ts 零改动 |
| T6 | pro-components 钉版 | `generatePackageJson` devDeps 加 `"@ant-design/pro-components": pin(...)`（类型用；运行时走 importmap） | 已在 SHARED_DEPS，矩阵自带版本 |
| T7 | exempt 清单 | 不动（personal-center 有契约，不豁免；首跑 `ojm api` 后 `--check` 干净） | 与 playbook §4 顺序一致 |

## 3. 用户故事与用例（BDD）

### US-1 init 工程自带个人中心

```gherkin
Given 执行 ojm init 全新工程
Then 存在 modules/src/personal-center/{entry.ts,pages/my-profile/index.tsx,pages/settings/index.tsx,locales/zh-CN.json,locales/en-US.json}
And 存在 api/src/personal-center/{manifest.yaml,contract.ts,upload/api.ts}
And modules.config.ts 注册 personal-center
And 不存在 api/src/personal-center/routes.json（生成物不进模板）
```

### US-2 头像上传链路可用

```gherkin
Given init 工程
Then api/src/_platform/migrations/0002__add_users_avatar_base64.sql 存在
And api/src/_platform/schema.yaml 的 users 列含 avatar_base64
And api/src/web/user-info/api.ts 返回 avatar（读 avatar_base64）
```

### US-3 钉版无 `*` 残留

```gherkin
Given init 工程
Then package.json devDependencies 含 @ant-design/pro-components 且非 "*"
And @types/react / typescript 均非 "*"（矩阵含 tooling 项）
```

### US-4 e2e（playbook 复跑验证）

```gherkin
Given 新 init 工程 pnpm install 后
When ojm build + ojm dev
Then modules.json 含 personal-center；/modules/personal-center/0.1.0/entry.js 200
And oj 路由表含 POST /api/personal-center/upload
And typecheck 0 error
```

## 4. 问题记录

| # | 问题 | 分类 | 处置 |
|---|------|------|------|
| P1 | playground `personal-center/upload` 写不存在的 `users.avatar_base64` 列，上传必 500——缺陷以「参考实现」身份存在，照抄会带病传播 | 实现与参考不符 | T3/T4：模板与 playground 同步补列（playground 的 users 在 `web` 模块，迁移加在 `web/migrations/0002`） |
| P2 | 版本矩阵语义是「运行时共享包」，tooling（tsc/@types）天然不在内——`pin()` 回退 `*` 是设计缝隙而非配置遗漏 | 反直觉 | T5：矩阵生成处显式加 TOOLING_DEPS 段 |
| P3 | `@types/react` 无 JS 入口，`import.meta.resolve` 裸说明符失败，首轮矩阵缺它 | 边界 | `installedPkgVersion` 直解 `<name>/package.json`（createRequire） |
| P4 | `window.$message` 类型只在 playground `vite-env.d.ts`，模板没有 → personal-center 页 typecheck TS2551 | 模板缺口 | 模板 `env.d.ts` 补 Window.$message 声明（保持脚本形态，不加 `export {}`） |
| P5 | oj `ownership_guard`（S003）：跨模块读 `users` 必须 manifest `deps` 声明——personal-center 与 web（db 化后的 user-info）都踩到 | 外部约束 | 两个 manifest 补 `deps: { _platform: ^0.1.0 }` |

## 5. 总结

- 关键过程：定位 runtime user-menu 固定跳转 `/personal-center/my-profile`（缺口定性）→ 文档定案（T1–T7）→ TDD 补 init 断言（先红 2 例）→ 照抄 playground 模块 + 补 users 列迁移（模板/playground 双侧）+ 矩阵加 tooling + devDeps 加 pro-components → e2e：全新 init（无 `*` 告警）→ typecheck/build 过 → dev 实机验证上传→回读全链路（data URL 往返一致）。
- 验证：`tests/cli/init.test.ts` 8 例全过；全量 90 文件 567 例过；repo + playground typecheck 均 0 error；lint 干净。
- 耗时：约 35 分钟（20:06–20:40，含 shell-dist 重建与 e2e）。
