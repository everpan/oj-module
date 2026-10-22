# 403 无权页面快速直出「无权限」面板（修 toast 刷屏）

- 日期：2026-10-22 20:46
- 分支：`fix/403-forbidden-toast-storm`
- 状态：已完成（20:53 并入 feat/ojm）

## 背景与问题

viewer 角色（无任何权限点绑定）访问无权管理页（users / roles / settings / oplog…）时：

1. 页面并发发出 N 个 query（如 settings 页 3+ 个）；
2. runtime 请求层 `handleErrorResponse` 对**每个** 403 响应各弹一条全局 `message.error`（信封 msg 为 `forbidden`）；
3. query 落定后页面才渲染 `ForbiddenPanel`（「无权限」面板）。

结果：用户先看到数条 403 toast 刷屏，再看到本应直接出现的「无权限」面板——双重反馈、体验差。

`must_change` 403 已在 `must-change.tsx` 采用「请求层抑制逐条 toast」策略（主动弹引导框），普通 403 漏了同款处理。

## 方案

`handleErrorResponse` 对 **403 一律抑制全局 toast**（与 must_change 同一层、同一理由）：

- query 403 → 页面 `isForbidden` 分支渲染 `ForbiddenPanel`，无需 toast；
- mutation 403 → 页面 `onError: explainError` 自行 toast（模板内全部 mutation 已覆盖，见下）。

### 连带修正（抑制后防静默）

| 文件 | 问题 | 处理 |
|---|---|---|
| `templates/src/system/web/pages/users/roles.tsx` | `saveMut` 缺 `onError`，抑制全局 toast 后其 403 静默 | 补 `onError: explainError` |

### 已知边界（不在本期范围）

- `system/web/pages/login-methods`：仅一个 query、无 403 分支，viewer 访问为「静默 loading」——与现状（toast+loading）相比不更差，后续可补 `ForbiddenPanel`。
- 非 JSON 体 403（网关态）同样抑制：AC-D16 下应用错误恒为信封，网关 403 极罕见，且页面 `isForbidden` 按 `response.status` 判定仍生效。

## BDD 用例

### 请求层 403 抑制（tests/runtime/error-response.test.ts 追加）

| 用例 | 场景 | 给定 | 当 | 那么 |
|---|---|---|---|---|
| AC-403-1 | 信封 403 不全局 toast | 响应 `{code:403,msg:"forbidden"}`，status 403 | `handleErrorResponse` | `message.error` **不调用**，response body 仍可读 |
| AC-403-2 | must_change 403 维持弹窗 | 响应 `{code:"must_change",msg:"password change required"}` | 同上 | 走 `openMustChangeModal`（既有行为不回退） |
| AC-403-3 | 非 403 错误不受影响 | 响应 `{code:400,msg:"boom"}` | 同上 | `message.error` 以 `boom` 调用（既有 t2 用例回归） |

### 页面层 mutation 兜底（templates，静态约定 + 既有 spec 回归）

| 用例 | 场景 | 给定 | 当 | 那么 |
|---|---|---|---|---|
| AC-403-4 | 成员资格保存 403 有人话反馈 | admin（非 superadmin）在 `/system/users/:uid/roles` 点保存 | service 层 403 | 页面 toast `system:err.forbidden`（`explainError`） |

## 任务清单

- [x] 文档（本文件）
- [x] TDD：error-response 403 用例（先红后绿）
- [x] runtime `error-response.ts` 抑制 403 toast
- [x] `users/roles.tsx` 补 `saveMut.onError`
- [x] 回归：runtime error-response 测试（7 passed）+ tests/runtime 全量（256 passed）+ templates 套件（612 passed）
- [x] 本地重建 runtime dist + shell-dist（宿主带修复）
- [x] 更新本文档状态与总结

## 总结

关键过程：定位刷屏根因为 runtime 请求层对**每个** 403 响应弹全局 toast（`error-response.ts`），
无权页面的并发 query 叠加出 toast 风暴，随后页面才渲染 `ForbiddenPanel`——`must_change`
已有同款抑制先例，普通 403 漏配。TDD 先补 3 个 403 用例（红）→ `handleErrorResponse`
对 403 一律提前 return（绿，含非 JSON 体分支）。连带发现 `users/roles.tsx` `saveMut`
缺 `onError`（抑制后其 403 会静默），补 `explainError` 兜底。本地重建 runtime dist 与
cli shell-dist，宿主产物已携带修复（`ojm dev` 即刻生效）。

耗时：约 25 分钟（调查 10' + 文档 5' + TDD 与实现 5' + 回归与重建 5'）。

### 追加记录（反常规点）

- ESLint `test/prefer-lowercase-title` 会把用例标题 `AC-403-1` 改成 `aC-403-1`（只小写化首字母，
  反而更难看）——与仓内先例一致，用文件头 `eslint-disable` 保留 AC 编号大写。
