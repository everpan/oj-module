# market CDN 相对路径（本站点自供）+ 脚手架免 setup + 0.2.25 版本抬升

- 日期：2026-10-23 14:06
- 分支：feat/market-cdn-site-relative
- 状态：进行中

## 需求

`framework.market_cdn_url` 支持**不带 http/https 的相对路径**（如 `/cdn`）：
表示 CDN 由**本站点自己**提供（oj 按 config.yaml 的 `/cdn` 挂载直出工程根
`cdn/`）。同时模板与脚手架**自带**该配置（seed 默认 `/cdn`），新工程
**不再需要跑 `ojm market setup`**——setup 降级为「指向外部真 CDN」时才需要
的可选步骤。随本轮抬升双包版本 **0.2.25**。

## 现状与关键事实（踩点结论）

1. **服务端消费面唯一**：`templates/src/_platform/api/market/api.ts` 的
   `fetchOf(env)` 是全部 CDN 拉取（bundles/manifests 索引 + .sig + archive
   tgz）的单一出口（4 处调用点：install 的 resolveCdn、runInstall fetch 闭包、
   indexBody 的两次 fetchIndex）。upload 分支不走它。
2. **原点补全原语已存在**：`_shared/site-facade.ts` 的 `withSiteOrigin`
   （SSRF 钉②：x-forwarded-proto 取首个）正是「相对 URL → 绝对同源 URL」
   的既定机制，深检探针已复用。无请求上下文（无 Host）→ 原样透传。
3. **脚手架 seed 三方言**：`seed.sql`（sqlite）/`seed.mysql.sql`/`seed.pg.sql`
   的 `framework.market_cdn_url` 当前 value=''（INSERT OR IGNORE，存量库
   不受影响；seed 回归 spec 重放真实文件）。
4. **模板 config.yaml 已带 `/cdn` 挂载**（直出工程根 `cdn/`），红线注释
   只缺「默认即本站点自供」口径。
5. **dev 形态的历史坑**（setup.ts 头注释）：dev server（5174）只反代
   `/api`，`/cdn/*` 落静态层回落 index.html。相对基址下服务端按请求 Host
   拉 `/cdn/bundles.yaml` 会拿到 HTML——**必须给 dev server 补 `/cdn` 反代**，
   否则免 setup 在 dev 形态即破。
6. **版本**：双包 0.2.24（lockstep，cli 依赖 runtime 为 `workspace:*`）；
   CHANGELOG 无 [0.2.24] 段，Unreleased 段现存 seed 账号条目。

## 方案（最小完整）

1. **消费侧一行**：`fetchOf(env)` 返回值包 `withSiteOrigin(...)`——相对基址
   按请求源补全；绝对 http(s) 基址正则直通（既有测试零影响）。
   协议相对 `//evil` 也不逃逸：补全后是同源路径，非跨主机。
2. **dev 反代**：`dev.ts` server handler 在静态回落前加分支——
   `resolveCdnLayout(projectRoot).prefix`（config 驱动，不硬编码）命中且
   `ojTarget` 存在 → `proxyApi(ojTarget)`（不剥前缀，与 /api 同形）；无 /cdn
   挂载（try/catch）或纯前端形态 → 回落静态，行为不变。
3. **seed 自带**：三方言 `framework.market_cdn_url` value 与 default_value
   置 `'/cdn'`。新工程起站即市场可用（`cdn/` 空目录时索引 404 → 市场页
   人话错误，属预期空态）。
4. **版本抬升**：双包 → 0.2.25；CHANGELOG Unreleased 转为 [0.2.25] 段并
   收录本特性。
5. **文档同步**：模板 config.yaml 红线注释、cdn-layout.ts 头注释（dev 坑
   已消）、setup.ts 头注释、usage.ts setup 行、devkit playground §4.1 与
   manual.md §10.3（免 setup 口径 + 外部 CDN 才 setup）。

## 测试用例（BDD，先红后绿）

| # | 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- | --- |
| 1 | 相对基址 index | cdnBase 注入 `/cdn`，`http.headers.host=127.0.0.1:9778` | 市场 index | fetchCalls 命中 `http://127.0.0.1:9778/cdn/bundles.yaml`（.sig/manifests 同源头） |
| 2 | 相对基址 install | 同上 | install source=cdn | archive 拉取 URL 为 `http://127.0.0.1:9778/cdn/demo-solution-0.1.0.tgz` |
| 3 | dev 反代 /cdn | 全栈 dev，config 有 `/cdn` 挂载 | GET `/cdn/bundles.yaml` | 反代到 oj（seen 含原路径，不剥前缀），非静态回落 |
| 4 | 无 /cdn 挂载回归 | config 无 /cdn 挂载 | GET `/cdn/x` | 回落静态层，不崩 |
| 5 | 脚手架免 setup | 重放三方言 seed | 查 market_cdn_url | value=default_value=`/cdn`（seed 回归既有钉守顺带覆盖） |

- #1/#2 落 `templates/tests/lifecycle/market-api.spec.ts`（it.each 两场景）。
- #3/#4 落 `tests/cli/dev-fullstack.test.ts`（fullstack fixture config 增
  `/cdn` 挂载；#4 用无挂载的 frontend fixture 请求 /cdn 回落静态即可）。

## 任务

- [x] 踩点消费面/原语/seed/dev/版本（本计划「关键事实」）
- [ ] 建分支 feat/market-cdn-site-relative
- [ ] RED：market-api.spec.ts #1/#2
- [ ] RED：dev-fullstack.test.ts #3/#4
- [ ] 实现：fetchOf 包 withSiteOrigin（消费侧）
- [ ] 实现：dev.ts /cdn 反代分支
- [ ] 实现：seed ×3 置 /cdn
- [ ] 双包 0.2.25 + CHANGELOG
- [ ] 文档同步（config.yaml/cdn-layout/setup/usage/devkit ×2）
- [ ] 模板测试 + cli 相关测试 + 全量测试 + lint
- [ ] 合入 feat/ojm（--no-ff）删分支
- [ ] 更新本文档状态与总结

## 问题记录

（暂无）

## 总结

（待收尾填写）
