# 以 tag 5.11 为基准：模块化改造显示差异验证 + e2e 防护（计划）

> 背景：用户报告「样式与头像，以及菜单图标未显示」。要求以 tag 5.11（411e353，
> 模块化架构 v1.0 基线）为基准，验证模块化改造后的显示差异，并以 e2e 固化防护。
> 探针法：playwright 全新 profile，登录后首页截图 + DOM 证据（样式表数/anticon 数/
> 菜单图标数/avatar HTML/img 加载态），逐形态采集。

## 显示差异矩阵（实测证据）

| 形态 | 5.11 基线 | 模块化后（main） | 定性 |
|------|-----------|------------------|------|
| dev（vite :3333） | ✓ 全正常（菜单中文、图标、头像照片、仪表盘） | ✓ **与基线肉眼零差异**（截图对比） | 无回归 |
| playground（ram dev，新形态） | （无此形态） | ✓ 全正常（布局/头像人形图标/favicon，e2e 20/20） | 新形态正常 |
| 生产 preview | **半坏**：模块全 404（manifest 指向 dev 形态 `entry.ts`，生产无此文件）→ 菜单剩 fake 后端路由兜底，但**文案全是原始 i18n key**（`menu.home`/`menu.access`…）且**主内容区落「未知组件」错误页**（P3-5 缺陷模式） | **全坏**：模块产物裸说明符炸（`Failed to resolve module specifier "@ant-design/icons"`，宿主无 importmap）→ 模块路由全挂，**登录后无 header/菜单/头像/样式内容** | 两代生产形态均未工作；main 症状更重（用户报告的现象即此） |
| 生产产物 importmap | 0 处 | 0 处 | 设计（modular-refactoring §5.4/5.5）从未落地，**非回归**：5.11 起生产模块加载就是坏的，坏法不同（5.11=404；main=裸说明符） |

### 结论

1. **dev 链显示无回归**：模块化改造后的 dev/playground 形态与 5.11 基线显示一致。
2. **用户现象的来源是 App 链生产形态**：该形态的模块加载自 5.11 起从未工作；
   main 的 P7.15（module-manifest.json）已修复 5.11 的 404 病，剩 importmap 注入
   这最后一环（宿主侧半边缺失；P7.9 卡口只校验了模块产物 ⊆ shell importmap 键集合）。
3. 5.11 生产「原始 key + 未知组件」的半坏态提示了一类**显示级回归病状**，值得
   e2e 探针化：i18n 菜单文案回退为原始 key、页面落 ExceptionUnknownComponent。

## e2e 防护设计（本次落地）

| # | 防护 | 用例 | 防的病状 |
|---|------|------|----------|
| P1 | 菜单 i18n 文案断言 | 侧边栏首个菜单项文本**不含 `.`/`:` 形态的原始 key**（如 `menu.home`、`home:menu.home`），且等于翻译后文案 | 后端/模块菜单翻译回退（5.11 生产半坏态） |
| P2 | 未知组件探针 | 主内容区不出现 `ExceptionUnknownComponent`/`unknownComponent` 特征节点 | P3-5 型「全站未知组件」回归 |
| P3 | 头像/样式既有断言强化 | icons.spec I1/I2 已覆盖图标与空图；补 avatar 节点存在断言于 M 系列基线 | 头像空白、样式丢失 |
| P4 | 生产形态冒烟（独立脚本，非常规 e2e） | `pnpm build` + preview 后探针：主入口可启动、无 `Failed to resolve module specifier`、登录后 header 可见 | App 链生产形态白屏/模块全挂（当前已知为红，修复方向拍板后转绿并纳入 CI） |

注：P4 当前为「已知红」，以脚本形式存在（`scripts/e2e-prod-smoke.mjs`），待生产形态
importmap 方向拍板并修复后转常规防护。P1-P3 进常规双环境矩阵。

## 遗留决策（待拍板）

> **已拍板并落地（2026-09-01）**：方案 A，见
> `docs/prd/202608312359-app-chain-importmap-plan.md`——prod-smoke 已由
> known-red 转绿（exit 0）。

App 链生产形态修复方向：
- **A. 复用 shell importmap（推荐）**：vite build 共享依赖 external + 拷 shell assets +
  注入 importmap + 导出完整性门禁；与模块 100% 同源单例，复用已验证基建。
- **B. 原设计 manualChunks 自产 importmap**：重踩 CJS 导出合成/子路径映射坑，风险高。
- **C. App 链生产退役**：部署统一 shell 形态，`pnpm build` 加警告；最省但改变部署预期。

## 任务清单

- [x] T1 五形态显示对比取证（本文件矩阵）
- [x] T2 P1+P2 显示防护 spec（TDD：先在人为病状上验红，再绿）
- [x] T3 P3 强化断言
- [x] T4 P4 生产冒烟脚本（标记 known-red，附复跑说明）
- [x] T5 文档回填执行小结

## 执行小结（2026-08-31/09-01）

**关键过程：**

1. **取证（T1）**：playwright 探针逐形态采集样式表数/anticon 数/菜单图标数/avatar
   HTML/img 加载态 + 截图。dev 链（5.11 dev / main dev / playground ram dev）显示
   一致；生产链 5.11 半坏（manifest 指向 dev 形态 `entry.ts` 404 → 原始 i18n key +
   未知组件兜底页）、main 全坏（裸说明符炸 → 登录后无 header）。根因：importmap
   注入设计从未落地，**非回归**。
2. **TDD 防护（T2/T3）**：`e2e/layout/display-parity.spec.ts`（D1 菜单/页签原始
   key 探针、D2 未知组件兜底探针）。红性验证：RAW_KEY_RE 与未知组件文案对 5.11
   生产病状文案（`menu.home`、`home:menu.home`、`unknownComponent`）5/5 全开火；
   对健康文案零误伤。绿态：双环境全绿（playground 22 passed；legacy 21 passed +
   1 skipped，且新 spec 单独跑 2/2 确认非 skip 对象）。
3. **生产冒烟（T4）**：`scripts/prod-smoke.mjs`（S1 console 模块加载失败探针 /
   S2 登录后 header / S3 菜单节点）。在 main 生产上精确复现用户病状：10 项问题
   （8 条模块加载失败 + header 未渲染 + 无菜单），exit 1 = 预期 known-red；脚本
   头部注明 KNOWN-RED 与转绿条件（importmap 方向拍板修复后纳入 CI）。
4. **验证**：typecheck 干净；新文件 eslint 0 error。

**遗留（待拍板）**：App 链生产 importmap 修复方向 A/B/C（见上「遗留决策」节）。
修复落地前 `prod-smoke.mjs` 保持 known-red 状态运行。

**耗时**：取证与根因定性约 60 min，防护 spec 与红性验证约 40 min，冒烟脚本与
lint/typecheck 收敛约 30 min，文档与提交约 15 min，合计约 2.5 h。
