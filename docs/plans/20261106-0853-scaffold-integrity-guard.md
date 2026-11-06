# 脚手架完整性门禁：内置模块自治契约（ojm build 拦截本地修改）

日期：2026-11-06 08:53
上游决策记录：`~/.claude/plans/nested-swimming-jellyfish.md`（用户选定「必须先同步上游」策略）

## 需求与用户故事

1. 作为下游开发者，`ojm init` 搭出的工程里，框架默认模块（`src/app` 内置模块、`src/oj-market`）
   属上游自治：`ojm build` 必须检测对它们的本地修改并拒绝打包，报错引导「需求提交上游」，
   避免升级时功能漂移或悄悄丢失。
2. 作为下游开发者，`ojm init --yes` 是默认方案的显式恢复入口：用当前 CLI 携带的上游版本
   覆盖上述默认模块；不得触碰下游自定义模块与工程配置。
3. 作为上游维护者，CLI 升级后工程里的旧版默认模块（即使非用户手改）即视为漂移，
   必须先 `ojm init --yes` 同步再构建（「必须先同步上游」，用户已确认）。

## 设计决策

- **上游模板即基线**：逐文件比较工程 `src/app`、`src/oj-market` 与当前 cli 包内 templates
  （init.include.yaml 白名单限定保护集）。不新增哈希 lock 文件（可被下游手改的第二真源，否决）。
- **保护集无占位符不变量**：init 拷贝时会做占位符替换与 demo-only 区间剥离；保护集内模板文件
  两者皆无（用例钉住），故模板与脚手架产物逐字节一致，比较免变换。
- **门禁开关**：`src/.ojm-builtin.json` 存在才启用（新脚手架 init 必写；缺失 = 旧工程，退化现状）。
  门禁不是安全边界：删开关文件即退回旧行为，错误信息如实告知。
- **三类漂移**：modified（CRLF 归一防 autocrlf 误报）/ missing（白名单文件缺失）/ extra（保护根内
  模板没有的文件）。自定义模块目录（src 下其余）不参与。
- **仅约束打包链路**：`ojm build`（普通 + --bundle，cli.ts build action 分支前）与
  `ojm market publish --real`（publish.ts）。dev 不拦。失败零产物。
- **--yes 恢复范围**：仅覆盖保护根内白名单文件 + 删除保护根内 extra 文件 + 重写
  `.ojm-builtin.json` 为上游名单。config.yaml / web.config.ts / package.json / 自定义模块不动。

## BDD 验收用例

### Scenario：门禁开关

| Given | When | Then |
| --- | --- | --- |
| 无 `src/.ojm-builtin.json`（旧工程） | build 门禁 | 收集返回 null，不拦，即使内容已改 |
| `.ojm-builtin.json` 存在 | build 门禁 | 三类漂移逐文件检测 |

### Scenario：漂移判定

| Given 工程侧状态 | Then |
| --- | --- |
| 白名单保护集逐字节一致 | 零漂移 |
| 只改行尾（CRLF） | 不误报 |
| 改内容 / 删白名单文件 / 保护根内加文件 | modified / missing / extra 各归其类 |
| 自定义模块 `src/crm/**` | 不参与比较 |

### Scenario：assert 报错

- **Given** 存在任一漂移 **When** `assertDefaultModulesUntouched` **Then** 抛错：
  点名文件、说明上游自治（需求提交上游）、给出 `ojm init --yes` 处置（先备份）。
- **Given** 零漂移 **Then** 不抛。

### Scenario：init --yes 恢复

- **Given** 已 init 工程：魔改 entry.ts、多加 `src/app/web/extra-page.tsx`、
  自定义 `src/crm`、追加 config.yaml
- **When** 再跑 `ojm init --yes`
- **Then** entry.ts 恢复上游、extra 文件被删、零漂移；`src/crm` 与 config.yaml 原样保留。

### Scenario：build 门禁接线

- **Given** 门禁抛错 **When** `ojm build` / `ojm build --bundle` **Then**
  buildBackend / buildModules / buildBundle 均不执行，exit 1。

### Scenario：刚 init 工程基线

- **Given** 全新 `ojm init` 产物 **When** `collectDefaultModuleDrift` **Then** 零漂移
  （门禁对全新工程零假阳性）。

## 实施任务

- [x] `packages/cli/src/scaffold-guard.ts`：保护集/漂移收集/assert/extra 清理（含 readInitInclude 迁入）
- [x] `tests/cli/scaffold-guard.test.ts` 12 条单元用例（先红后绿）
- [x] `tests/cli/init.test.ts`：零漂移基线 + --yes 恢复两条集成用例
- [x] cli.ts build action 接线 + `packages/cli/src/__tests__/cli.test.ts` 门禁两条
- [x] market/publish.ts `--real` 链路接线
- [x] `templates/src/README.md`（人话）+ init.include.yaml 条目
- [x] `templates/web.config.ts` oj-market「删目录下线」改为 `enabled: false`
- [x] usage.ts init help「永不覆盖」收窄 + build 门禁说明
- [x] 版本 lockstep 0.2.67 → 0.2.68（runtime/cli + vendor 矩阵）+ CHANGELOG
- [x] 全量回归：CLI 单测 646 通过 / 根单测 924 通过 / typecheck 通过 / lint 0 error
  （lint 3 warning 为 login.tsx 既有问题，与本特性无关）
- [x] 手工链路的等效验证：init → 魔改 → 门禁 → init --yes → 零漂移、`src/crm` 保留全链
  已在 `tests/cli/init.test.ts` / `scaffold-guard.test.ts` / `cli.test.ts` 进程内覆盖；
  真实 `ojm build` 二进制链路（pnpm install + oj 联网装 bin）未跑，模板 e2e 工程自身
  无 `.ojm-builtin.json`（门禁按设计关闭，既有 e2e 不受影响）

## 问题记录

- **反常规（踩坑）**：`copyTemplates` 递归里的 `destRel = path.relative(destDir, dest)` 是
  **当前递归层**的相对路径（到文件层只剩文件名），不是工程根相对路径。原代码只拿它做
  created/skipped 报告标签所以从未暴露；首次拿它做保护根判定（isProtectedRel）即静默失效
  ——恢复分支永远不命中。教训：跨层路径判定必须用已归一的 `srcRel`（模板相对 == 工程相对）。
- **边界澄清**：模板树里的 `src/app/api/home` 是 demo-only（白名单外），整树拷贝夹具会把
  它带进工程被判 extra——夹具必须按白名单拷贝，与 init 等效；这也再次确认 extra 判定对
  「手工拷入的 demo 文件」会如实拦截，符合契约。
- `ojm api` 再生成 `__client` 若与模板快照不一致（生成器升级），门禁如实报 modified，
  由 `ojm init --yes` 恢复——不静默排除生成目录。

## 阶段总结

2026-11-06 08:33–09:05，约 30 分钟（计划定稿于 `~/.claude/plans/nested-swimming-jellyfish.md`，
用户选定「必须先同步上游」策略后批准）。

关键过程：

1. TDD 全程：12 条守卫单测先红后绿；init 集成（零漂移基线 + --yes 恢复）与 cli 接线
   （门禁失败零产物）同样先写失败用例再实现。
2. **反常规踩坑（本次最有价值的发现）**：`copyTemplates` 的 `destRel` 是递归层相对路径
   （到文件层只剩文件名），不是工程根相对路径——拿它做保护根判定时恢复分支**静默不命中**。
   用逐层 console 探针定位（第一轮探针误放 stderr 被测试环境吞掉，白跑一轮）。教训：
   递归拷贝里做路径语义判断必须用模板相对的 `srcRel`（== 工程相对），destRel 只配做标签。
3. **夹具边界**：整树拷贝 `src/app` 会把白名单外的 demo-only `src/app/api/home` 带进工程
   被判 extra——夹具改为按白名单拷贝，与 init 等效；同时钉住「保护集模板无占位符/demo 区间」
   不变量（否则 init 变换必造成门禁假阳性）。
4. 门禁接线三处：cli.ts build action（普通 + --bundle 汇合点之前）、market/publish.ts
   `--real`；dev 链路（buildModules）刻意不放——dev 热重构建共用它。
5. 产物链新鲜度坑复现：版本升 0.2.68 后 11 个依赖 `shell-dist/versions.json` 的测试集体变红，
   `pnpm --filter @oj-module/runtime build && pnpm --filter @oj-module/cli build:shell` 后全绿
   ——gitignored 产物不随源码版本自动更新。
6. 文档面：`templates/src/README.md`（人话契约）、`web.config.ts` 注释改 `enabled: false`、
   usage init/build 帮助双语收窄、devkit manual §1.9 + SKILL.md 排障表、CHANGELOG Unreleased
   四条（Added 3 + Changed 1 + Fixed 2，覆盖本批 runtime 修复）。

遗留（如实）：真实 ojm 二进制全链未跑（见任务表最后一项的等效覆盖说明）；全量 e2e 未复跑
（本特性无浏览器面改动；上一批 runtime 修复的 e2e 结果 21 通过 / 4 既有 wecom 失败已记录）。

