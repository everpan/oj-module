# ojm preview 单服务化：实施计划

> 日期：2026-10-19 · 上游设计：docs/prd/20261019-preview-single-service-design.md（方向 2：派生 config 单服务 + 5a：htmlTransform 引导）
> 本计划只写「做什么、怎么验」，不含实现代码；实现时按 Phase 顺序推进，每 Phase 结束跑对应验证。

## 0. 范围

**目标**：ojm preview 只 spawn 一个 oj serve（API + 静态 SPA 同进程），删除 ojm 自建 http server 与 proxy；保留 SPA 深链、preview [port]、migrate 门禁、fail-fast 四查、进程善后。

**非目标**：ojm dev 不动（双服务是开发形态必要结构）；--oj-static flag 直接删除（不为兼容保留 no-op）；生产部署拓扑不变。

## 1. 决策记录（设计文档 §8 未决点的落定）

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| DR-1 | 派生 config 落盘位置 | <project>/api/.ojm-preview.yaml（固定名，非 pid 后缀） | 相对路径（证书/db/api 挂载）天然按 config 所在目录解析，与原件一致；固定名崩溃自愈（下次覆盖），不积累残留；并发同项目 preview 属非常规用法（端口本就会冲突），可接受 |
| DR-2 | 清理策略 | 三路：① oj.ready 拒绝路径先删再抛；② SIGINT handler 内删；③ process.on("exit") 同步 unlink 兜底 | 对齐 dev 的「优雅停机 + exit 兜底」双保险模式（dev.ts 现有范式） |
| DR-3 | 用户已有 / web 挂载 | 覆盖 web 指向、强制 spa: true、保留该条目其他键（如 headers），打日志说明覆盖 | preview 的目标就是预览本站点产物；保留 headers 尊重用户配置 |
| DR-4 | 端口权威 | ojm preview [port] 显式传参 > config server.port（缺省 9778）；派生 config 内覆盖 server.port | 保持今日 CLI 契约；startOj 以派生 config 为 configPath，端口读取自动正确 |
| DR-5 | htmlTransform | 存在性检测：web.config.ts 配了 htmlTransform → 打 WARN 指向 oj server.html_meta / server.html_meta_handler，不加载模块（避免无副作用执行用户代码） | 与设计 5a 一致；单服务形态下 oj 直出 HTML，ojm 侧钩子无从介入 |

## 2. 实施步骤

### Phase 1：核心模块 packages/cli/src/preview-config.ts（新文件）

职责：原 config → 派生 config 的纯变换 + 落盘 + 清理。与 oj 进程编排解耦，便于单测。

- derivePreviewConfigText(configText: string, opts: { siteDir: string, port?: number }): string
  - yaml.parse → doc（解析失败抛人话错，口径对齐 oj-config.ts 的 readServerBlock）；
  - upsert mounts：找 prefix === "/" 且含 web 的条目 → 按 DR-3 覆盖；找不到 → 追加 { prefix: "/", web: <siteDir 绝对路径>, spa: true }；其余挂载条目原样；
  - opts.port 有值 → doc.server.port = port（server 段缺失则建）；
  - yaml.stringify 返回（注释丢失可接受——临时文件；anchors/tags 归一化为已知风险，见 §5）。
- writePreviewConfig(projectRoot: string, opts): { configPath: string, cleanup: () => void }
  - 写 api/.ojm-preview.yaml（resolveConfigPath 同级，固定名）；cleanup = 同步 unlink（幂等，文件不存在不抛）。

### Phase 2：重写 packages/cli/src/preview.ts

previewServer → runPreview(projectRoot, opts): Promise<{ stop: () => Promise<void> }>：

1. 四查不变（bin/oj、api/config.yaml、web/dist/index.html、api/dist/manifests.yaml）；
2. htmlTransform 存在性检测（DR-5）：loadModulesConfig 读 htmlTransform 字段，有值 → WARN（不 import 模块）；
3. migrate 用原 config：execOj(["migrate","-c",configPath,"-d",apiDist])，非零即退（不起 oj、不写派生文件——先 migrate 成功后落盘派生 config，失败即退时零残留）；
4. 派生 config：writePreviewConfig(projectRoot, { siteDir: layout.distDir, port: opts.port })（port 仅显式传参时覆盖）；
5. spawn oj：startOj(derivedConfigPath, base, apiDist)——startOj 现有签名不变（-b base --api-path apiDist --console-log 的 CLI 折叠与派生 config 的 api 挂载幂等重合，保留现行为）；不再传 --app-path；
6. ready 拒绝：await oj.stop() 后 cleanup() 再抛（对齐现有 F3 顺序，派生文件不留）；
7. 打印：[ojm] preview 已启动：http://localhost:<port>（必须保持该串——tests/integration 的 startRam 靠正则 已启动：http://localhost:(\d+) 抓端口）；补一行「单服务：API + 静态（SPA 深链回落）由 oj 同进程提供」；
8. 善后：SIGINT → oj.stop() + cleanup() + exit；process.once("exit") 同步 cleanup() 兜底（DR-2③）；
9. 保活说明：runPreview resolve 后进程不退出，依赖 oj 子进程 stdio 管道（ref 状态）+ 已注册的信号 handler；无需额外 handle（实现时真机确认 Ctrl+C 行为）。

删除：http.createServer、serveStatic、proxyApi、decodeReqPath/listenOnFreePort 引用、PreviewOptions.ojStatic、--oj-static 相关分支与日志。

### Phase 3：入口与用法

- packages/cli/src/index.ts（52–57 行）：preview case 去掉 ojStatic: process.argv.includes("--oj-static")；port 语义不变（透传，现由 DR-4 消费）；
- packages/cli/src/usage.ts（23 行）：ojm preview [port]，描述改「migrate → oj serve 单服务（API + 静态 SPA 深链回落）」；
- packages/cli/src/init.ts：SCAFFOLD_GITIGNORE 增加 api/.ojm-preview.yaml（新工程零 git 噪音；存量工程见文档迁移注记）。

### Phase 4：测试

tests/cli/preview.test.ts（重写，契约变更）：

| 用例 | 断言 |
|---|---|
| 派生 config：无 web 挂载 → 注入 | mounts 追加 {prefix:"/", web:<abs siteDir>, spa:true}；其余段原样；原 config 文件不被修改 |
| 派生 config：已有 / web 挂载 → 覆盖 | web 指向 siteDir、spa:true、该条目 headers 保留；其他挂载不动 |
| 派生 config：显式 port → 覆盖 server.port | 派生文件 server.port = 传参值；不传则与原值一致 |
| 派生 config：非法 YAML → 人话报错 | 抛错含「不是合法 YAML」口径 |
| 编排：migrate 用原 config | execOj 收到 ["migrate","-c",<原config>,"-d",<apiDist>] |
| 编排：spawn 用派生 config | ojStarter 收到 cfg = 派生 config 路径、base、apiDist；extraArgs 不含 --app-path |
| 编排：migrate 失败 → 不起 oj、不落派生文件 | started 为空；api/.ojm-preview.yaml 不存在 |
| 编排：ready 拒绝 → 停 oj + 删派生文件 | stop 被调；派生文件不存在 |
| 编排：退出后派生文件已清理 | runPreview resolve → stop() → 文件不存在 |
| fail-fast 四查（保留现有 4 例） | 同现契约 |
| htmlTransform 已配置 → WARN 不加载 | spy console.warn 命中 html_meta 指引；模块不被 import（用会抛错的坏模块路径验证：仅告警不炸） |
| 横幅格式 | 输出含 已启动：http://localhost: |

（原「ojm 静态层 / 反代前缀 / %ZZ 400 / transform 生效」用例随双服务形态一起删除。）

tests/integration/uni-dev-smoke.test.ts（更新 preview 用例）：

- 保留：/ 200、login、带 token /api/web/hello 200；
- 新增：GET /some/deep/route（Accept: text/html）→ 200 且含站点 HTML（单服务 SPA 的核心新断言）；
- 新增：kill 后 api/.ojm-preview.yaml 不存在（清理断言）；
- 端口：继续显式传空闲端口（现经 DR-4 覆盖派生 config 的 server.port，行为不变）。

### Phase 5：文档

| 文件 | 改动 |
|---|---|
| docs/prd/framework-development-guide.md §4.3 | preview 形态改单服务描述；删 --oj-static；htmlTransform 例外从「仅 --oj-static」改为「单服务 preview 一律不生效，用 oj html_meta/html_meta_handler」 |
| 同上 §4.8 常见坑 | 「IM 链接预览只看到默认标题」条目同步改指向 |
| docs/prd/oj-fullstack-tutorial.md §7 | preview 一行改为「migrate → oj serve 单服务（API + 静态 SPA）」；生产清单补「web 挂载由 preview 自动注入，无需手改 config」 |
| packages/cli/templates/api/config.yaml | mounts 注释更新：preview 自动派生 web 挂载；「生产若由 oj 直出前端」样例保留（生产手动启用与 preview 机制无关） |
| 存量工程迁移注记 | 本计划不涉及存量 config 迁移（原 config 零改动即兼容）；仅提示：preview 运行期间 api/.ojm-preview.yaml 瞬时存在，可加入 .gitignore |

## 3. 验证清单

    # 单测（preview 重写后全绿 + 无回归）
    pnpm test tests/cli/preview.test.ts
    pnpm test tests/cli/oj-process.test.ts tests/cli/html-transform.test.ts

    # 类型与 lint（cli 包）
    pnpm --filter @oj-module/cli exec tsc --noEmit
    pnpm lint

    # 真机手验（playground 或 ojm init 出的工程）
    pnpm build
    pnpm preview            # 默认端口 9778
    curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9778/            # 200
    curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9778/some/route  # 200（SPA 深链，新能力）
    curl -s http://127.0.0.1:9778/api/health                                    # OK JSON
    ls api/.ojm-preview.yaml          # 运行中存在
    # Ctrl+C 后
    ls api/.ojm-preview.yaml          # 不存在（清理）

    # 显式端口
    pnpm preview 4173 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4173/

    # 真二进制冒烟（本地非 CI；CI 自动跳过）
    pnpm test tests/integration/uni-dev-smoke.test.ts

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| YAML round-trip 丢失注释/归一化 anchors | 仅临时文件；启动日志明示「派生 config 为临时产物」；模板 config 不用 anchors（现模板已如此） |
| 派生 config 与用户 config 的 db/证书路径漂移 | 派生文件与原 config 同目录，相对路径解析一致；单测断言「除 mounts/server.port 外 doc 与原 parse 结果深相等」 |
| reload_api 热更读到派生 config | 派生 config 内容与原 config 仅差 web 挂载/port，热更结果无害；且 preview 进程退出即删 |
| runPreview resolve 后进程提前退出 | 已真机确认无需哨兵：oj 子进程 stdio 管道保持事件循环存活，Ctrl+C 走 SIGINT 善后 |
| 双重 SIGINT 杀死清理（2026-10-19 实现期发现） | 终端 Ctrl-C 是进程组信号：外层 bin 转发一份 + 组送达一份，内层收到两个——`once` 首次触发即摘除，第二个走默认动作杀死本进程，清理全没跑（冒烟实测 signal=SIGINT）。修复：preview/dev 的 SIGINT/SIGTERM handler 改 `on` + 幂等守卫吞掉重复信号；preview 侧 `cleanup()` 同步先行，任何后续死亡路径零残留 |
| oj 侧畸形 URL（/%ZZ）行为与今日 ojm 层 400 不同 | 已实测：oj 回 200（按无扩展名路径走 SPA 回落）；设计文档 §6.3 已回填，无测试断言 |
| 存量工程用户依赖 --oj-static | 删除即发布说明 + usage/指南同步；该 flag 行为（无 SPA）本就是被放弃的形态 |

## 5. 完成定义（DoD）

- [ ] Phase 1–3 代码落地，preview.ts 无 http/proxyApi/createStaticHandler 引用；
- [ ] Phase 4 测试全绿（单测重写 + 冒烟更新）；
- [ ] Phase 5 文档四处 diff 与代码行为一致；
- [ ] 验证清单全部通过（含真机手验 + 冒烟）；
- [ ] 设计文档 §6.2/§6.3 的行为差异表与本计划实现的差异为零（发现新差异回填文档）。
