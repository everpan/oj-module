# 生成 client 工厂化设计（create<Module>Client(ctx)，构造即 install）

> 日期：2026-09-13 01:28
> 状态：架构师评审**可开工**（4 条最小修订 R1-R4 已全部纳入本文）
> 分支：feat/client-factory
> 前置文档：`docs/202609130035-provider-guide.md`（§3.0/§3.1 的 apiPrefix/bindRequest 两行手写是当前痛点）

## 1. 背景与问题

模块 entry 目前要手写两行「样板接线」：

```ts
ctx.register.apiPrefix("/notification");            // 字面量与契约重复——契约里 defineApi 已写了一遍
notificationClient.bindRequest(ctx.utils.request);  // 忘写则运行时才炸
```

痛点：① 前缀字面量两处维护，写错/拼错靠运行时暴露；② 两件事要记（登记 + 绑定），忘任一个都是新人高频坑；③ 语义上这两行是「生成 client 投入使用的前置条件」，本应由生成物自己保证。

## 2. 目标与非目标

- G1：前缀单一真源——`/notification` 只存在于契约，`entry.ts` 里不再出现该字面量；
- G2：两行样板缩为一行构造，「创建即接线」——不可能出现「绑了 request 没登记前缀」或「登记了前缀没绑定」的半接线状态；
- G3：迁移面仅限本仓库（`apps/` + 根仓 `web/` + `templates/`）；项目当前无外部工程，按新项目设计，不做向后兼容的过渡形态（旧 `bindRequest` 保留但标 `@deprecated`，仅作逃生口）。

非目标：不替用户决定「抢不抢活」——provider 注册仍显式书写；不改 scoped request 的前缀收敛机制本身；`internal` target（runtime 树内生成物）不发射工厂（无 ctx 可收，评审 R3）。

## 3. 方案（评审 R1-R4 已并入）

### 3.1 codegen 产出约定（module target）

生成物 `web/src/<模块>/client/api.ts` 在现有内容基础上增加：

```ts
/** 本模块 API 前缀（ojm api 从契约抽取，唯一真源，勿手改） */
export const API_PREFIX = "/notification";

/**
 * 模块 entry 的 onInit 里一行创建：构造即完成 apiPrefix 登记 + scoped request 绑定。
 * 之后用返回对象上的方法发请求，都自动带 /api/notification/ 前缀。
 */
export function createNotificationClient(ctx: ModuleContext) {
	ctx.register.apiPrefix(API_PREFIX);
	bindRequest(ctx.utils.request);
	return { fetchNotifications, markRead, markAllRead, clearAll };
}
```

- `bindRequest` 保留导出但标 `@deprecated`（注释指路工厂）——不删除，给非常规接线留逃生口；
- 端点函数继续以裸 export 形式存在（tree-shaking 与既有测试快照不变），工厂只是「绑好前置条件的便捷入口」（评审：工厂返回对象 vs 仅工厂——取「裸函数 + 工厂并存」，对 emit-schema/现有快照影响最小）。

### 3.2 关键事实（评审确认，非新约定）

- codegen 已强制 `apiPrefix === "/" + 模块目录名`（`run.ts:107`，AC-D9 uni-dev 校验）——「前缀唯一真源」是把既有事实暴露给 entry，不引入新约束；
- `ModuleContext` 已从 `@oj-module/runtime` 根出口公开（`index.ts:69`）——生成物 import 无缺口；
- 重复构造幂等安全：`registeredApiPrefixes` 是 Map，重复 set 同值无副作用；onInit 每模块只跑一次（HMR/StrictMode 不重复执行 onInit）；
- 生成物内 `let req` 单槽、后绑覆盖先绑是**现状固有行为**，工厂化不恶化——「一模块一 client」作为隐含假设写入文档（评审 R4），同模块建两个 client 属误用。

### 3.3 命名（评审 R1）

- 工厂名 `create<Module>Client`，模块名 camelize：`notification` → `createNotificationClient`；`personal-center` → `createPersonalCenterClient`（连字符目录名逐段首字母大写拼接）；
- `emitClient` 增加入参模块名（`run.ts` 传 `found.module`）。

## 4. BDD 用例

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | 契约含端点、模块名 `notification` | `ojm api` 生成 | api.ts 含 `export const API_PREFIX = "/notification"` 与 `createNotificationClient(ctx)` 工厂 |
| 2 | 模块名带连字符 `personal-center` | 同上 | 工厂名 `createPersonalCenterClient` |
| 3 | 生成物任意一份 | 检查 bindRequest | 仍在导出且带 `@deprecated` 注释 |
| 4 | internal target | 生成 | **不含** API_PREFIX/工厂（无 ctx），形状与现状一致 |
| 5 | entry 用 `createNotificationClient(ctx)` 一行 | onInit 执行 | apiPrefix 已登记 + request 已绑定，接口调用 200 |
| 6 | 忘调工厂直接用裸函数 | 首次调用 | 抛「请求未绑定」明确报错（现状行为不变） |
| 7 | 模板与 playground-oj 重跑 `ojm api` | diff | 生成物确定性一致；template-notification 逐字节比对测试保持绿 |

## 5. 迁移清单（评审 R2，grep `bindRequest` 全仓核对）

- entry 7 处：根仓 `web/home`、playground-oj `notification`/`system`/`home`/`demo`、playground `demo`、模板 `notification`——以实际 grep 为准；
- `packages/cli/templates/web/src/notification/client/` 与 playground-oj 各 client 目录重跑生成；
- 文档：`docs/202609130035-provider-guide.md` §3.1/§3.2 示例与踩坑表（R4：补「onInit 内创建」要求与「一模块一 client」注脚）；
- 测试：`tests/cli/contract-emit-client.test.ts` 快照/用例更新、`template-notification.test.ts` 期望值随生成物刷新。

不受影响：runtime-exports 冻结（无新 runtime 出口）、shell-importmap、RUNTIME_STUB_SOURCE。

## 6. 风险与反常识记录

- 生成物形状变更属**破坏性改动**：将来有外部工程后，升级 cli 重跑 `ojm api` 需同步改 entry——发版说明须标注（0.1.x 阶段可接受）；
- 工厂构造即登记 apiPrefix，意味着「创建 client」与「认领前缀」绑定——一模块一 client 的隐含假设要文档化，误建第二个 client 会把 req 槽覆盖（现状固有，非新增）。

## 7. 执行计划

1. 本文档（docs before code）→ 2. TDD：emit-client 用例先红后绿 + run.ts 接线 → 3. 重跑生成 + 迁移 7 entry + 指南 → 4. 全量验证（含 uni-dev-smoke 真二进制）→ 5. 提交并追加执行小结
