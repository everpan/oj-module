# ojm new --api 骨架 ping handler 产出零路由（scaffold 形状错误）

- 日期：2026-10-23 11:44
- 分支：fix/ojm-new-api-scaffold-route
- 状态：已完成（2026-10-23 11:50）

## 问题记录

1. oj 内省只读 default export（`bridge/mod.rs` introspect 测试：未进 default 的导出缺席），链尾非 HTTP 动词在 `RouteTable::build` 被 METHODS 白名单跳过——两个白名单叠加使「裸命名导出」形状恒产零路由，且 oj build 不报错（1 api file(s) 照打），错误要到装后 smoke 才爆：故障延迟最长。
2. 同类形状的 dist 夹具（lifecycle 测试 `ping/api.js`）是自包含假产物，不受影响。

## 总结

本阶段把 `ojm new --api` 骨架的 ping handler 从「裸命名导出」改为「default-export 嵌套组 + `ping.get.response`」形状，生成即可路由（GET /api/<name>/ping）且出参契约入 openapi.json。关键过程：市场链路演练发现 erp 打包后 routes.js 为空 → 定位到 oj 内省/METHODS 双白名单 → 红测试（new-scaffold.test.ts）→ 模板修复 → cli 410 全绿。耗时约 10 分钟。

## 需求

`ojm new <name> --api` 生成的 `src/<name>/api/api.ts` 骨架在打包/装配后 `routes.js` 为空，
装后探活 `GET /api/<name>/ping` 必然 404——骨架必须是「生成即可用」的。

## 根因（2026-10-23 市场链路演练实证）

oj 的路由内省只读 **default export**（oj-bin `bridge/mod.rs` introspect 族测试：
`export default { get, del }` 才有 leaf；命名导出不进 default 即不内省），
且链尾必须是 7 个 HTTP 动词之一（`serve/src/routes.rs` METHODS 白名单，
非动词键在 `RouteTable::build` 被跳过）。

现骨架（`new.ts` 的 `apiTs`）只产出**裸命名导出**：

```ts
export async function ping() { json.ok({ pong: true, module: "x" }); }
```

零 default export → 零 leaf → 空 routes.js。0.2.23 §7.5 首跑只验到「erp 含 api 段、
打包通过」，未走到装后探活，故潜伏至今。

## 方案

骨架改为嵌套组形状（链 `ping.get` → `GET /api/<name>/ping`），并落实注释承诺的
「出参挂平级 .response 即入 openapi.json」：

```ts
const ping = {
	async get() {
		json.ok({ pong: true, module: "<name>" });
	},
};
ping.get.response = { type: "object", required: ["pong"], properties: { pong: { type: "boolean" } } };
export default { ping };
```

## 测试用例（BDD，TDD 先红）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 骨架可路由 | `createSolution(root, "crm", { api: true })` | 读 `src/crm/api/api.ts` | 含 `export default { ping }`、链上挂 `.get`、`ping.get.response` 声明 pong:boolean |
| 旧形状回归 | 同上文件 | 检查 | 不再有「裸 `export async function ping` 而无 default export」形态 |

演练侧（本手册 §7.1–§7.3 复跑）：手工把 my-books 的 erp 骨架改为等价形状后继续
市场链路（scaffold 修复与 market 机制验证解耦）。

## 任务

- [x] 建分支 fix/ojm-new-api-scaffold-route
- [x] TDD：new 骨架红测试（先红）
- [x] 修 new.ts apiTs 模板
- [x] cli 测试全绿 + lint
- [x] 合入 feat/ojm（--no-ff）并删分支
- [x] 更新本文档状态与总结
