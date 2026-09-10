# ram api --docs 产物自包含单页

日期：2026-09-03 20:41
分支：feat/ram-api-docs-standalone
前置：docs/prd/202609032019-ram-api-cwd.md（api 目录参数）

## 背景

`ram api [dir] --docs` 已把目录下所有契约聚合进一个 `index.html`（paths 合并、模块 tag），但产物不是"一个静态页面"：

- redocly `build-docs` 生成的 HTML 通过 `<script src="https://cdn.redocly.com/redoc/v2.5.3/bundles/redoc.standalone.js">` 外链渲染器——离线/内网打开是白页。
- `@redocly/cli` 依赖树里没有 redoc bundle 本体，无法直接本地内联。

## 需求（BDD）

### Feature: 自包含文档单页

| # | 场景 | 输入 | 期望 |
|---|------|------|------|
| S1 | 多契约聚合一页 | 目录下 ≥2 份契约 | 单个 index.html 含全部端点（现状保持，补测试） |
| S2 | 无外部依赖 | 生成后断网打开 index.html | 正常渲染（HTML 内不含 http(s) 外链脚本） |
| S3 | 构建机离线 | 拉取 redoc bundle 失败 | 人话报错、非 0 退出，不留半成品 |
| S4 | bundle 含 `</script>` | 内联任意 JS | 转义 `</script` → `<\/script`，不截断页面 |

## 设计

- redocly 渲染后**后处理**：从 HTML 里提取 CDN `<script src>` 的 URL（版本随 redocly 模板走，不硬编码），fetch 该 bundle 内联回 HTML，产物即单文件。
- 抽纯函数 `inlineRedocScript(html, load)`（load 可注入 stub，测试不落网）；默认 loader 用全局 `fetch`。
- `runApiDocs(cwd, { redocBin?, fetchJs? })` 增加 `fetchJs` 注入点；既有测试改注入 stub，避免测试依赖 CDN。

非目标：不自研 API 文档渲染器（redoc 渲染质量保留）；不引入 `redoc` 依赖本体（约 1MB 运行时依赖换一次性 fetch 不值）。

## 任务

- [x] 文档（本节）
- [x] 测试先行：`inlineRedocScript` 单测 + 多契约聚合用例 + 既有用例改 stub
- [x] 实现 `run.ts` 后处理
- [x] 测试 / typecheck / lint 通过
- [x] 冒烟：playground 重新生成，grep 确认无 cdn 外链，浏览器可开

## 问题记录

- **反常识（已修）**：`String.replace(pattern, string)` 的替换串会解释 `$&`/`$1` 等 `$` 模式——redoc bundle 内含 Prism 正则（大量 `$&`），首版字符串替换导致 CDN script 标签被重复插回 3 处。改用替换函数 `replace(m[0], () => ...)` 按字面插入，补 `$&/$1` 单测防回归。
- **lint 规则冲突**：`test/prefer-lowercase-title` 要求小写开头，`--fix` 把 "S3：..." 改成 "s3：..."、"CDN" 改成 "cDN"——标题改为中文起头（无大小写）规避。
- 冒烟发现既有行为已满足"多契约聚合一页"（paths 合并 + 模块 tag），本次真正缺口只是 CDN 外链；补了多契约聚合的回归测试。

## 总结

- 关键过程：冒烟定位真实缺口（聚合已存在，产物依赖 cdn.redocly.com 外链，离线白页）→ 文档 → 测试先行（inlineRedocScript 4 单测 + 多契约聚合 + 失败路径，fetchJs 注入 stub 不落网）→ run.ts 后处理（提取 CDN script URL 随 redocly 模板版本走、fetch 内联、`</script` 转义、替换函数防 `$` 模式陷阱、失败人话报错）。
- 验证：CLI 测试全量 32 文件 207 用例通过；typecheck 0 错误；lint 0 error；真实冒烟 playground 产物 1.19MB 单文件、`cdn.redocly.com` 与 integrity 外链计数均为 0、文件尾部 `</html>` 完整。
- 耗时：约 25 分钟。
