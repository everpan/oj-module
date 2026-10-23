# oj-fullstack-tutorial 刷新：module-root 口径 + 新契约流水线 + 冗余清除

- 日期：2026-10-23 16:15
- 分支：docs/fullstack-tutorial-freshen
- 状态：已完成

## 需求

`docs/prd/oj-fullstack-tutorial.md`（657 行）整体停留在平铺布局（`api/src` +
`web/src`、`api/config.yaml`）与旧契约流水线（`contract.ts` + `client/` +
`routes.json` + `openapi.yaml` + web.config.ts 显式注册）口径。用户要求：检查并
修改过时部分，冗余清除。

## 过时点清单（以 0.2.25 verdaccio 发布态 my-books 实演产物为真源）

1. 目录树：module-root（0.2.20+）——根 `config.yaml` + `config/`、唯一源码树
   `src/<name>/{api,web}`、根 `openapi.json`、方言种子在根、`dist/api`+`dist/web`、
   `cdn/`、`oj-market` 模块。
2. 契约流水线：`contract.ts` 已死 → handler 挂 `.schema`（params/query/body）+
   平级 `.response`；`oj openapi -c config.yaml --module-root src -b /api -o openapi.json`
   → `ojm api` 生成 `src/<name>/web/__client/{api.ts,api.schemas.ts}`；无
   routes.json / openapi.yaml 产物。client 名为 operationId 派生
   （`booksListGet`/`BooksListGetData`），且函数形参必填（`booksListGet({})`）。
3. 模块发现：`src/<name>/web/entry.ts` 扫描即收录，web.config.ts 登记退化为可选
   覆盖——§5.1「注册模块」整节删除改注记。
4. 种子账号：superadmin/admin/editor/viewer = 角色名，123456，must_change=0。
5. FAQ：anonymous_paths/migrate 命令路径改根级；`/api/notifications` 行改 provider
   口径；新增 oj<0.1.86 `--module-root` openapi 缺陷行（症状+处置，见手册 §9）；
   删 AC-D9 apiPrefix 行（契约已死，强约束不复存在）。
6. 附录/脚本清单补 `typecheck:api`/`new`/`bundle`。

## 不动点

- `createBooksClient(ctx)` + `lifecycle.onInit` 接线仍是生成物当前形态（实查
  __client/api.ts 头注），保留。
- 重启边界、JsRuntime 二进制缺陷、S005/S006 纪律、共享依赖矩阵等仍有效。

## 任务

- [x] 计划文档（本文）
- [x] 整篇改写（Write 全量替换 657 行 → 重写版，按上清单）
- [x] 与实演产物/模板逐节对拍（package.json scripts、config.yaml mounts 口径、
      种子账号 superadmin/123456/must_change=0、.ojm-api-exempt.json、
      跨文档引用无失效锚点）
- [x] 人工核对（markdown 不走 eslint）+ 合入 feat/ojm 删分支，更新本文档

## 问题记录

- 无阻塞问题。对拍中确认两点口径：① mounts 无 /api 项是**有意设计**
  （module-root 布局由 `ojm dev --module-root src` / `ojm preview --api-path dist/api`
  供给，与 mounts api 项互斥），教程 §2.2 已按模板原文注释转述，避免读者
  误以为漏配；② `.ojm-api-exempt.json` 是严格 JSON（注释只能写 `_comment`
  字段），教程 §1.1 目录树列入但未展开，细节留模板原文。

## 总结

- 状态：已完成（2026-10-23 17:05 收尾）。
- 关键过程：整篇 Write 重写（保留章节骨架 §0–§8 + 附录，内容全部换到
  module-root 口径）；对拍只做了高风险项（scripts/config/seed/exempt/引用），
  全部一致；改写本身约 20 分钟，对拍+收尾约 15 分钟。
- 遗留：无。oj < 0.1.86 openapi module-root 缺陷的处置指引已在教程 §4 与
  FAQ 双写，待 oj 0.1.86 发布后 FAQ 行可降级为普通版本要求（
  见计划 `20261023-1027` 之后的 MIN_OJ_VERSION 抬升动作）。
