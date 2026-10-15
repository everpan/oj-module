# 上游需求（已实现，oj v0.1.72）：让 `.schema` 之外的位置可声明响应契约

> 状态：**✅ 已由 oj v0.1.72 实现并发布**（2026-10-15 ojm 侧验证：安装二进制 `~/.local/share/oj/oj`
> 为 0.1.73，含本特性；oj-bin 源码 `git log` 见 `b56ccfd v0.1.72: .response 平级出参声明位
> （introspect gresp 继承链 + 优先级合并）`）。ojm 侧同步已完成：模板 + playground-oj 全部
> handler 从 `.schema.response` 迁到平级 `.response`，`oj openapi --check` 零漂移。
> 实现语义与本需求草案**逐条一致**（含优先级链），下文保留作为需求留档。
> 原始复核依据（oj v0.1.71）：
> - `oj/src/openapi_cmd.rs:219-236` —— `oj openapi` 只在 `.schema.response` 取响应，裹 `{code,msg,data}` 信封。
> - `oj/src/bridge/mod.rs:1318-1323` —— `introspect_module` 的 `mergeSchema` 只从合并后的 `.schema` 读 `.response`。
> - `oj/src/openapi_cmd.rs:215-218` 注释 —— `.schema.response` 即 `json.ok(data)` 的 data payload。

## oj v0.1.72 实际落地语义（与本草案对照）

- 平级 `.response` 声明位：动词级 `v.response` / 组级 `obj.response`，组级沿嵌套层层继承（`gresp` 链）。
- 生效优先级：**动词 `.response` > 组 `.response` > 动词 `.schema.response` > 组 `.schema.response`**（与草案第 2 条一致）。
- `openapi_cmd` 零改动：胜出者由 introspect 浅拷贝写回 `schema.response` 透传，`responses.200.content`
  生成逻辑与信封完全不变（草案第 3 条一致）；任何位置未声明时保持占位无 content（草案第 4 条一致）。
- 兼容性：`.schema.response` 继续生效，两位置并存时 `.response` 优先（草案「兼容性」节一致）。
- v0.1.74 补充（未装机亦可预见）：`null` 统一视为「未声明」（回落继承链），声明了但非法仍 fail-fast。

## 背景 / 问题

- 响应契约（即 `json.ok(data)` 的 data payload）此前只能写在 handler 的 `.schema.response`
  （动词级 `v.schema.response` 或组级 `obj.schema.response`）。
- 入参（params / query / body）与出参（response）被混在同一个 `.schema` 对象里。在「handler 逻辑与
  契约分离 / 多文件」的演进方向下，把出参塞进 `.schema` 既冗长、又混淆了「入参 vs 出参」两件不同的事。
- 期望：`.schema` 只放入参；出参有独立的声明位置。

## 期望行为

1. 新增一个与 `.schema` **平级**的声明位置 `.response`，内省时与现有 `.schema.response` 合并，
   动词级覆盖组级（合并语义与现在的 `.schema.response` 一致）。
2. 生效优先级（建议）：动词级 `.response` > 组级 `.response` > 动词级 `.schema.response` > 组级 `.schema.response`。
3. `oj openapi` 生成 `responses.200.content` 的逻辑**完全不变**：仍从最终生效的 response 生成 data payload，
   外层裹 `{code,msg,data}` 信封（`envelope_schema`）。
4. 任何位置都未声明 response 时，保持当前占位 `{ "200": { "description": "OK" } }` 行为不变（无 content）。

## 建议 API 形态

```js
// 动词级：出参移到 .schema 之外
const handler = {
  async post() { /* ... */ json.ok(url); },
};
handler.post.response = { type: "string" };   // 出参
handler.post.schema   = { body: { /* 入参 */ } };
export default handler;

// 组级默认出参
const group = { get() {}, post() {} };
group.response = { type: "object", properties: { /* 整组默认出参 */ } };
group.schema   = { query: { /* 整组默认入参 */ } };
```

## 兼容性

- `.schema.response` 继续生效，不破坏存量；新 `.response` 与旧 `.schema.response` 可并存，`.response` 优先。
- 下游 `__client` 不受影响（输入仍是 `openapi.json` 的 `responses.200.content`）。

## oj 内部改动点（供实现参考）

- `src/bridge/mod.rs` `introspect_module` 的 `mergeSchema`：当前只从合并后的 schema 读 `over.response` /
  `base.response`（行 1318-1323）。需额外读取动词 / 组对象自身的 `.response`（同级的 `v.response` /
  `obj.response`），并入透传给 `RouteEntry.schema`（或直接作为 `row.response` 字段）。
- `src/openapi_cmd.rs` `generate`：`sc.as_ref().and_then(|s| s.get("response"))`（行 221）的来源要扩展到
  新位置；若 introspect 阶段已把 `.response` 并入 `row.schema` 透传，则此处无需大改。
- 单测补充：在 `without_response_contract_200_stays_placeholder` 之外，新增
  「仅写 `.response`（不写 `.schema.response`）仍生成 enveloped 200」「`.response` 优先于 `.schema.response`」。

## 验收

- `oj openapi -d <dir>` 对只写 `.response`、不写 `.schema.response` 的 handler，生成 `responses.200.content`
  信封 schema（data = 声明的 payload）。
- `oj openapi --check` 不漂移。

## ojm 侧同步（已于 2026-10-15 随 0.1.20 完成）

- 模板 `packages/cli/templates/api/src/**` 与 playground-oj `api/src/**` 全部 handler 的 `response`
  已从 `.schema.response` 迁到平级 `.response`；`oj openapi` 重生成 `openapi.json`
  （模板产物与迁移前逐字节一致，playground-oj 顺带去掉手工 `del`→`delete` 与 operationId 改名），
  `ojm api` 重生成 `__client`，`oj openapi --check` 零漂移、`ojm api` 幂等。
- playground-oj `global.d.ts` 已同步 devkit 版 `Function.response` / `Object`（组级 `.route` /
  `.schema` / `.response`）声明。
- `withSchema` 辅助保持移除（多文件方案仍暂缓：oj loader 拒绝 handler 导入 `@oj-module/runtime`，
  独立 schema 文件导入不稳定）；平级 `.response` 不改变该结论——它只移动声明位，不改变
  「`.schema` / `.response` 必须内联在 handler 对象上」的 oj loader 约束。
