# 框架 npm 包化实现评审报告（modularization vs main）

> 创建时间: 2026-08-30 09:57
> 评审对象: modularization 分支（P0–P6 全部提交，HEAD 71ffcd0）相对 main
> 基准文档: `202608291025-framework-npm-package-design.md`、`module-development-guide.md`
> 方法: 5 个并行评审 agent（CLAUDE.md 合规 / 浅层 bug / git 历史 / 设计一致性 / 注释契约）产出 41 条原始发现，去重后 36 条，每条由独立 agent 对照源码复核打分（0–100）
> 整改计划: `202608300957-p7-review-remediation-plan.md`

## 评分分布

| 分数档 | 数量 | 含义 |
|--------|------|------|
| 75 | 22 | 已复核确认的真实重要问题（rubric 最高有效档；100 保留给「必然频繁发生」） |
| 50–60 | 10 | 已证实但低影响/潜伏/nitpick |
| 20–40 | 4 | 已拍板设计或合理偏差（误报排除） |

## 确认问题清单（75 分，22 条）

### 安全（6）

| # | 文件 | 问题 |
|---|------|------|
| S1 | packages/shell/src/trust.ts:19-30 | D10 白名单以 `!url.includes("://")` 判同源，`//evil.com/x.js`、`data:`、`blob:` 均放行并直达 `import(entry)` |
| S2 | packages/runtime/src/utils/request/scoped.ts:30-52 | apiPrefix 收敛三绕过：startsWith 无段边界；路径未归一化（`../` 折叠越界）；ky 2.x 逐请求 `prefix` 可覆盖，带 Bearer token 打到任意外域 |
| S3 | packages/cli/src/build.ts:334-353 + packages/shell/src/preload.ts:27-41 | entry chunk integrity 产出后零消费（entry 不进 chunks[]），L2 恰好不保护入口文件，US-6「入口篡改拒绝执行」未落地 |
| S4 | packages/shell/src/csp.ts:28-38 | trustedOrigins 只加进 script-src，漏 style-src/connect-src，跨源模块 CSS 被 CSP 拦截 |
| S5 | packages/runtime/src/utils/iframe-guard.ts:11-18 | 白名单漏 condorheroblog.github.io，modules/outside 的 project-docs（iframeLink）回归空白；csp.ts:37 frame-src 同漏 |
| S6 | .github/workflows/ci.yml | tests/no-fake-in-dist.test.ts 无任何 workflow 执行（§4.8 要求 CI 断言）；且 build/ 不存在时测试静默 skip |

### 功能/契约（11）

| # | 文件 | 问题 |
|---|------|------|
| F1 | packages/shell/src/host.tsx:136-143 | 清单裁剪成 {name, entry}，peerRuntime 零校验，`__SHELL_RUNTIME__` 不存在，US-5 未落地 |
| F2 | 同上 | enabled 字段被丢弃，loadAll 的过滤成死代码，US-9 运维下线失效 |
| F3 | packages/runtime/src/module-loader/index.ts:87-96 | 依赖缺失仅 console.warn，模块半加载且 status 标 loaded，US-9 明文禁止 |
| F4 | packages/cli/src/shared-deps.ts:70-98 | isSharedDep 前缀匹配（`dayjs/plugin/utc` → external）但 importmap 无尾斜杠前缀键，浏览器解析必崩且无构建期提示（B11 换形态复发） |
| F5 | packages/shell/package.json:5 | shell private:true 无 publishConfig，resolveShellDist 在外部工程两路径均找不到，US-1/US-2 第一步即失败 |
| F6 | packages/cli/src/index.ts:18-33 | ram info 未实现（交接文档标 P4 ✅ 完成，记录与实现矛盾）；@react-antd-module/create-module 包不存在（US-1） |
| F7 | packages/runtime/src/index.ts:36-46 | 手册 §7.3 承诺的 unloadModule/useSlotNodes 未从入口导出，外部工程 import 即编译失败 |
| F8 | scripts/build-modules.ts:78-82 | `main().catch(console.error)` 不 exit(1)，模块构建失败 CI 判成功放行坏产物 |
| F9 | scripts/create-module.ts:55-80 | 向导选「不需要国际化」：locales 目录条件创建但 json 无条件写入 → ENOENT + 半成品目录 |
| F10 | scripts/create-module.ts:94-119 | 模板停留在 P2 前契约：`#src/*` 导入、`Component: ContainerLayout`、字符串 icon |
| F11 | packages/runtime/src/router/guard/auth-guard.tsx:148-356 | 守卫硬编码 `/exception/403\|500`，但 exception 已是可禁用模块，禁用后跳转落 catch-all 显示 404 |

### 流程/文档（5）

| # | 文件 | 问题 |
|---|------|------|
| P1 | .github/workflows/ci.yml:4-7 | 分支触发器仍是 feature/pkg-*，modularization 的 60+ push 未触发卡口 |
| P2 | CLAUDE.md:64 | 文档化命令 `pnpm create-module` 不存在（实际 `create:module`） |
| P3 | CLAUDE.md:60 | 仍写「正则解析 entry.ts」，实际已是 esbuild + 真实 import（P3.4/B10） |
| P4 | CLAUDE.md 架构章节 | 11 处 src/ 路径指向已删除目录（代码在 packages/runtime/src/） |
| P5 | manifest.json + vite.config.ts:31 | monorepo 生产构建模块链路不通：entry 为源码根绝对路径、prod base /react-antd-admin/、无改写环节，deploy.yml 演示站模块全 404 且静默 |

## 次要发现（50–60 分，10 条）

| 分 | 问题 |
|----|------|
| 60 | host.tsx 模块 CSS 用 appendChild，与 §4.9「必须在宿主 CSS 之前」硬约束相反（当前 shell 无自有样式表故空转，R16 潜伏） |
| 55 | mergeModuleManifests 无生产消费者（CLI 无命令、host 只取单份清单），R12 同名拒绝不触发 |
| 50 | requiredPermissions 零消费（手册已承诺；实施计划已登记延期） |
| 50 | C8 告警只扫 dependencies，按手册组织的工程（全 devDependencies）永不触发 |
| 50 | 构建期无「lazy chunk 不受 L2 保护」提示（§4.6 明文要求） |
| 50 | 后端路由默认 layout:none 后 fake 数据与菜单表单未补 layout 字段（被 filterBackendRoutes 遮蔽） |
| 50 | getComponentPathByRoute 死分支（两分支同值，4ed730d 清理残留） |
| 50 | 过时注释 4 处：build.ts JSDoc 与实现相反；define-module.ts 仍写 tsx；dev.ts「增量重建」实为全量；shell README 引用已删除的 SHARED_ENTRIES/IMPORTMAP |
| 50 | 深路径共享依赖（react/jsx-runtime 等）版本比对因 package.json 路径不存在被静默跳过（根包兜底，暂无实际风险） |
| 40 | CSP nonce 为构建期静态值（静态托管下 per-request 不可行，注释已自认；可改 sha256-hash 更强） |

## 已排除（误报/已拍板）

- **单模块加载失败静默降级（20 分）**：手册 §6.3 逐字拍板（标 error + getModules() 可观测），非 bug；但与 §4.7「禁止静默」存在文档张力，建议补 telemetry。
- **L2 对动态 import() 的机制性局限**：integrity 失败的 modulepreload 只丢预载结果，随后的 import() 会不带 integrity 重拉篡改内容——设计层缺陷，实现再忠实也达不到 US-6「拒绝执行」，需回写设计文档评估（script 标签注入 / fetch+SRI / L3 SW）。
- main 原样搬运的旧问题（auth-guard result.reason.response、flattenRoutes index key）、ky 2.x prefix 更名（非笔误）等。

## 关键统计

- 22 条确认问题中 **9 条是「文档/注释承诺了但实现漂移」**——根因是承诺没有可执行断言兜底，建议 CI 增加契约断言层（见整改计划 P7.15）。
