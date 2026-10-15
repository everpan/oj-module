# 上游需求（已实现，oj v0.1.73）：`oj openapi` 应把 `del` 动词归一为 `delete` 方法键

> 状态：**✅ 已由 oj v0.1.73 实现并发布**（2026-10-15 ojm 侧验证：安装二进制
> `~/.local/share/oj/oj` 为 0.1.73；oj-bin 源码 `git log` 见
> `353e7f5 v0.1.73: oj openapi 把 del 动词归一为 delete 操作键`，改在
> `oj/src/openapi_cmd.rs:158` 一处归一）。ojm 侧同步已完成：playground-oj 重跑
> `oj openapi` 干净再生（去掉手工 `del`→`delete` 改写），`--check` 零漂移。
> 原始复核依据（oj v0.1.71）：
> - `oj/src/openapi_cmd.rs:153` —— `let method = row.method.to_lowercase();`，行 242 直接把 `method` 作为
>   OpenAPI path 下的操作键插入（`path_obj...insert(method, ...)`）。
> - `row.method` 来自 `RouteEntry.method`（`oj/src/openapi_cmd.rs:114` 的 `method: e.method`），即内省出的动词名。
> - oj handler 的删除动词是 `del`（`VERBS` 集合含 `"del"`，见 `oj/src/bridge/mod.rs` 内省脚本），故 `row.method` 为 `"del"`，
>   `oj openapi` 会写出 `"del"` 作为 OpenAPI 操作键。
> - 而 serve / bootstrap 层已经做了归一：`oj/src/test_ext/test_bootstrap.js:54` —— `const wire = m === "del" ? "DELETE" : m.toUpperCase();`
>   即运行期 `del` ↔ `DELETE` 是既成事实。OpenAPI 生成侧漏了这步归一。

## oj v0.1.73 实际落地语义（与本草案对照）

- `oj openapi` `generate` 内一处归一：`"del" => "delete".to_string()`（`oj/src/openapi_cmd.rs:158`），
  产出合法 OpenAPI 操作键；`operationId` 同源派生为 `..._delete`（草案期望行为一致）。
- 下游 `__client` 方法名由 operationId 派生，故得 `deleteXxx()` 而非 `delXxx()`（草案背景第 2 条一致）。
- ojm 侧实证（2026-10-15，playground-oj）：`/api/system/menu-item` 的删除端点操作键为 `delete`、
  `operationId` 为 `system_menu_item_delete`、client 导出 `systemMenuItemDelete`。

## 背景 / 问题

- OpenAPI 3.x 的操作键只能是标准 HTTP 方法（`get/post/put/delete/patch/head/options/...`），`del` 不是合法键。
- oj 运行期用 `del` 表达 DELETE（serve `del` ↔ `DELETE` 映射已落地），但 `oj openapi`（≤ v0.1.72）把动词名原样写进
  OpenAPI 操作键，产出 `"del"`，导致：
  1. 生成的 `openapi.json` 在某些严格 OpenAPI 工具 / 生成器下报错或被忽略（非法方法键）。
  2. 下游 `__client` 若按方法键生成调用函数，会得到 `delXxx()` 而非 `deleteXxx()`。
- 曾经的 workaround：在 playground-oj 等工程里**手工**把 `openapi.json` 的 `"del"` 改回 `"delete"`
  （见 `apps/playground-oj/openapi.json` 的 2 处 `delete`）。这导致 `oj openapi --check` 必然漂移报错
  （oj 重生成会写回 `"del"`），CI 门禁无法干净通过。**该手工改写已于 2026-10-15 随 oj 0.1.73 升级删除**。

## 期望行为

`oj openapi` 在生成操作键时，把 oj 的 `del` 动词归一为 OpenAPI 标准 `delete`：

- 建议落点在 `oj/src/openapi_cmd.rs:153` 附近，对 `row.method` 做归一：
  `let method = match row.method.to_lowercase().as_str() { "del" => "delete", m => m };`
- 仅影响 OpenAPI 输出键；不影响运行期 wire（serve 侧 `del`↔`DELETE` 映射不变）。
- 其它动词（get/post/put/patch/head/options）原样输出。

## 兼容性

- 存量 `openapi.json` 里手工写的 `"delete"` 与归一后输出一致，`oj openapi --check` 不再漂移。
- 下游 `__client` 方法名从 `delXxx` 变为 `deleteXxx`——属重命名，ojm 侧 `emitClient` 无需改（它跟着 openapi 走）；
  业务调用方若有按 `delXxx` 命名的调用需同步改名（一次性）。

## 验收

- `oj openapi -d <dir>` 对某 handler 用 `del()` 动词，生成的 `openapi.json` 路径下操作键为 `"delete"`（非 `"del"`）。
- `oj openapi --check` 对「手工修正过 `del`→`delete`」的存量 `openapi.json` 不再报漂移。

## ojm 侧后续同步（oj 实现后）

- 重跑 playground-oj 的 `oj openapi`，确认无手工 `del`→`delete` 改写后 `--check` 通过。
- 顺带：若各工程此前为绕过漂移而关掉 `oj openapi --check` 门禁，可恢复。
