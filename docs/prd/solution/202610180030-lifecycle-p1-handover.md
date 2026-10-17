# 方案生命周期 P1 交接文档（给下一位工程师）

> 状态：P1 收尾中 · 日期：2026-10-18 · 分支 `feat/lifecycle-p1` · 写作时 HEAD `28a970d5`（P1-16 在飞，归来后会前进）
> 本文目标：新工程师 15 分钟内知道**现在在哪、接下来做什么、真源在哪、别踩什么坑**。

---

## 1. 这个项目在做什么

oj-module 正在实现**解决方案（solution）模块全生命周期管理**：第三方作者按 C2 契约打一个 `ojm build --bundle` 的 tgz 包，宿主站点在**特权模块 `_platform`** 的 isolate 里跑十阶段安装器（preflight→downloading→verifying→extracting→migrating→lock_commit→registering→deploying_web→reloading→smoke），锁=oj 原生扁平 `manifests.yaml`，禁用/卸载与安装对称（四处同写/同删），市场应用（oj-market 方案）消费编排端点提供卡片/安装/卸载/回滚 UI。三期推进：

- **P1 打包→安装闭环**（当前，16/17 代码任务完成）
- **P2 签名+市场+深检**、**P3 减法与分发**（期门待细化，评估输入已写进计划 §4/§5）

架构与全部决策编号（D1–D14、R1–R31、C2-01~33）以设计文档 v3 为真源，**别凭记忆推断 oj 行为——上游真源是 `../oj-bin` 源码（只读）**。

## 2. 当前位置（三分钟版）

| 项 | 状态 |
|---|---|
| 分支 / HEAD | `feat/lifecycle-p1` / `28a970d5`（P1-16 在飞会前进） |
| 主线 P1-1~P1-14 | ✅ 全部完成（台账逐条有 commit+测试数） |
| 市场侧 P1-15/15a/15b | ✅ 由 **oj-market 接手代理**交付在 `../oj-market` 仓（f05beab/eb84902/28b3bd2，该仓 main 已推进到 28b3bd2） |
| P1-15a-port | ✅ 移植归位（28a970d5）：卸载服务端回 templates + `ojm uninstall` CLI + history.ts 守卫式共享出口 |
| **P1-16（在飞）** | 🔄 已派子代理 p1-16-e2e：marketEnv 生产口径/P1-10 五接线点/market_cdn_url 注册/operator 通道/e2e/真机 AC0-7/占位引导卡。**等它四行回执** |
| 阶段集中审查 | ⏳ 待 P1-16 归来执行（见 §4） |

**测试基线**（任何改动后不得回退）：根套件 697 passed+1 skipped；templates/api 416；`test:cli` 152+1 skipped；typecheck/lint 净。

## 3. 接手后第一件事：处理 P1-16 回报

1. **三证核实**再信任何「完成」：台账（`.superpowers/sdd/202610171207-solution-lifecycle-implementation-plan/progress.md`，唯一恢复源）+ `git log` + 报告文件（`task-P1-16-report.md`）三者对上才算数。
2. 裁决其 CONCERNS（惯例：正确的追认、缺口钉入后续、走查发现的 oj-market 侧问题**只记录不修改**——该仓只读）。
3. 台账补记录 → 进入集中审查。

### P1-16 归来后可能要做的裁量

- **marketEnv 生产口径**：health 404 的根因是 sharedRoot(modules) vs serve 根(dist) 失配——验它的修法是否真对齐 serve 布局。
- **长任务后台启动**：它只出裁决意见不改码——采纳则排 P2，拒绝则留痕理由。
- **AC0-7 走查**：若 oj-market 侧有缺口（如 IndexRow 契约无 CDN 版本列表、回滚候选仅本站旧版），记入 P2 期门输入，不动 oj-market 仓。

## 4. 集中审查（P1 唯一剩余大动作）

用户常设指令（全程适用）：**代码任务先行，每阶段最后一次性集中审查**——全量 diff + 修复波 + 全绿验收；P2/P3 沿用。

- **主区间**：`fd061926..HEAD`（P1-4 起接续；P1-1~P1-3 已审过）。
- **备案池**：台账里各任务「备案→集中审查」条目（P1-3/P1-5/P1-6/P1-7/P1-8/P1-9/P1-10/P1-11/P1-12/P1-13/P1-13b/P1-14/P1-15 系列检验三条等，三十余条）——逐条裁决：修复 / 追认留痕 / 转 P2 期门。
- **P1 DoD**：AC-P1-1~20 全绿（计划 §3 验收表）+ 真机 kill 任一阶段自愈演示 + 本计划 §7 补 P1 阶段小结（关键过程+耗时，照 P0 小结格式）。

## 5. 真源索引（按权威度排序）

| 文档 | 位置 | 用途 |
|---|---|---|
| SDD 台账 | `.superpowers/sdd/202610171207-solution-lifecycle-implementation-plan/progress.md` | **唯一进度/恢复源**，每任务 commit+测试数+裁决全文 |
| 实施计划 | `docs/prd/solution/202610171207-solution-lifecycle-implementation-plan.md` | 任务表=唯一跟踪源；AC 表；P2/P3 评估输入 |
| 设计文档 v3 | `docs/prd/solution/202610171138-solution-lifecycle-implementation-design.md` | D1–D14 决策、R1–R31 评审处置 |
| C2 契约 | `docs/prd/solution/202610171254-lifecycle-manifest-contract.md` | C2-01~33 + 附录 A 失败语义 + 附录 B 平台缺面留痕（B-8~B-13） |
| 教学文档 | `docs/prd/solution/202610172100-solution-authoring-tutorial.md` | 作者视角全流程+**宿主四件套配方 §3.4**+八坑速查表 |
| 任务报告 | 同台账目录 `task-P1-*-report.md` | P1-10 五接线点、P1-15a-port、P1-16（在飞产出） |
| 真机走查脚本 | `../oj-market/docs/walkthrough-market-fullchain.md` | AC0-7 市场全链 curl+jq 断言 |
| oj-market 交底书 | `../oj-market/docs/202610172145-agent-handover-market-app.md` | 市场应用需求全文（历史参照） |
| 上游需求稿终裁 | `docs/prd/solution/202610171400-oj-bin-submissions/` | OJ-6/8/9 均终裁不采纳——别再捡起来 |
| devkit 手册提纲 | `202610171333`（docs 内） | 打包/分发章节骨架 |

## 6. 工程纪律（违者返工）

1. **文档先行**：先写计划/用例文档再写代码（CLAUDE.md 铁律）；TDD 先红后绿。
2. **SDD 派发制**：实现走子代理（sonnet；haiku 本环境不存在会 400），lead 集中裁决；**禁止并行多个实现代理**。派发可因上下文压缩丢失——重派前以台账+git log+报告三证核实。
3. **commitlint**：subject 中文或小写英文开头（大写开头被拒）；每个提交尾行 `unix@vip.qq.com ai`。
4. **端口**：9778 主线冒烟保留（被占则 uni-dev-smoke 整组 skip，按设计生效）；其他站点 9781+，**用完即关**。
5. **isolate 排障**：禁 `console.*`（release isolate 抛 BadResource 毒死调用链），异常信息带上下文进任务记录（阶段异常已带首行栈，a2e44ef0）。
6. **模板同步**：`ojm init` 把模板快照进站点——改了 `packages/cli/templates/` 必须手动 rsync 到站点 api/src → 重建 → **重启 oj serve**（缓存已编译模块源）。排障先确认站点跑的是不是新模板（本项目最大时间黑洞，lock_commit 弧线一整天耗在陈旧快照上）。
7. **exec 白名单逐字**：`tar -tvzf` / `tar -xzf` / `oj migrate --format json` 三条，argv 不得增删；0.1.78 起 timeoutMs 缺省 30s，长命令必须显式传（migrate 已传 600_000，**生产包装须转发 opts**——P1-16 在接）。
8. **`../oj-market` 仓只读**：市场应用由接手代理交付终态，主线不回写；发现其缺口记录待办不修。

## 7. 环境速查

```bash
oj 二进制        ~/.local/share/oj/oj   （0.1.78；上游源码 ../oj-bin 只读）
pnpm test              # 根套件（基线 697+1skip）
pnpm test:cli          # CLI 面（基线 152+1skip）
cd packages/cli/templates/api && pnpm test   # templates 套件（基线 416）
pnpm typecheck && pnpm lint
```

**真机宿主四件套**（缺一必挂，配方细节见教学文档 §3.4）：
①`fs: {root: ., readonly: false}` ②`platform: {modules: [_platform], root: dist}` ③exec 白名单三条逐字 ④`dist/versions.json`（peerRuntime 真源）。教学宿主已 teardown，重建照 §3.4；端口用 9781+。

## 8. 集中审查之后：P2/P3 入场

- P2 期门细化前必读计划 §4 两条评估输入：0.1.77 `mounts[].api` URL 挂载（分发形态归一化裁决）、0.1.78 exec 流式（进度/取消能力候选，feature-detect 后用）。
- oj-market 侧遗留滚入对应期：IndexRow 契约扩展（回滚候选源）、schemaVersion 握手+自升级提示（D2 残余）、级联单事务+业务表保留提示（U1 残余）、operator 列 UI 补齐。
- P3 注意 U2/U3 未动（GC 内建 install、`ojm publish`）。

## 9. 高频坑速查（血泪浓缩）

| 症状 | 真因 | 解 |
|---|---|---|
| oj serve 拒启「schema 校验失败」 | 模板 schema.yaml 声明未随新迁移同步 | 改迁移必同步 schema.yaml（5366d4be 先例） |
| 安装 lock_commit `TypeError: invalid_argument` | ①站点跑陈旧模板快照 ②oj fs remove 缺失目标即抛（B-12） | rsync+重启；代码侧 isMissingPath 已收敛 |
| reloading NotCapable | 宿主缺 platform.modules 特权名单 | 四件套② |
| C2-25 fail-fast 缺 i18n | 双语 key 未齐 | zh/en locales 补齐 |
| 首登 403 password change required | 首登强制改密 | login→PUT /api/auth/password |
| 测试整组 skip（9778） | 残留 oj serve 占口 | pkill 残留，skipIf 按设计生效 |
| preview/冒烟打到别人站点 | 缺省端口被占后横幅歧义 | 显式传空闲端口（66b04f20 先例） |
| oj-market 仓 pnpm install 失败 | 依赖 @oj-module/runtime@0.2.4 未发布 npm | 本地 workspace/link 安装；勿升门 |

——以上每条的完整弧线都在台账与教学文档里有实录，动手前先查再踩。
