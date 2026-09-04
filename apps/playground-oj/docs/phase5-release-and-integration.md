# Phase 5 — release 回归 + 集成冒烟（两态）

> 阶段目标（计划 §5）：`ram build` / `ram preview` / `ram api --docs` 全绿；`scripts/smoke.sh` 对 dev + preview 两态做端到端冒烟；root-app 回归（typecheck）无回退。
>
> 完成标准：release 构建通过（含 oj build 闸门 + 全站合并 + 10 模块构建），preview 与 dev 两态冒烟均 10/10，集成脚本可一键复跑。

## 执行步骤

| 步骤 | 动作 | 关键产物 | 验证 |
|---|---|---|---|
| P5-1a | `ram build`：oj build（后端 6 模块）→ 全站合并 → 10 模块构建 → modules.json | `api/dist/manifests.yaml` + `modules/dist/*` | 构建成功 |
| P5-1b | **修复 S003 闸门**：`web/manifest.yaml` 声明 `deps:{system:^0.1.0}`（`get-async-routes` 跨模块读 menus/role_menu） | `api/src/web/manifest.yaml` | `ram build` 不再报 ownership_guard 错误 |
| P5-2 | `ram api --docs`：生成文档站 + 每模块 `openapi.yaml` | `api/docs/index.html` + `api/src/<m>/openapi.yaml` | 文档站生成 |
| P5-3 | preview 态：`ram preview` 起 oj(release)+静态(4173)，跑 `scripts/smoke_all.py` | 终端 | 10/10 PASS |
| P5-4 | dev 态：`ram dev` 起 oj(src)+静态(5174)，跑 `scripts/smoke_all.py` | 终端 | 10/10 PASS |
| P5-5 | `scripts/smoke.sh` 两态编排（build→preview→dev，含进程清理） | `scripts/smoke.sh` + `scripts/smoke_all.py` | 一键复跑两态全绿 |
| P5-6 | root-app 回归：`pnpm typecheck`（应用 + 契约生成物） | 终端 | 0 error |

## P5-1：release 构建与 S003 闸门

### 动机

dev 期 `oj server` 对跨模块读表只 `warn`，但 `oj build` 的 **S003 闸门**把"读他模块表未声明 `deps`"当作硬错误。release 构建才暴露这个潜藏问题——这正是 P5 回归存在的意义。

### 修复（P5-1b）

`web` 模块的 `get-async-routes` 跨模块读 `system` 的 `menus`/`role_menu`（P2-2 真实化时已知，注释里写了"生产可声明 deps"）。`ram build` 初跑即报：

```
S003: api/src/web/get-async-routes/api.ts: SQL 引用他模块表 "menus"（属于 system），模块 "web" 未声明依赖
S003: ... 表 "role_menu"（属于 system）...
```

修法：在 `api/src/web/manifest.yaml` 加 `deps: { system: "^0.1.0" }`。重跑 `ram build` 通过——6 个后端模块编译进 `api/dist`，全站合并进 `modules/dist`，10 个前端模块构建生成 `modules.json`。

> 反差：dev 期同样的跨模块读只 warn、接口照常工作；release 闸门才拦。说明"dev 能跑"不等于"release 能发"，跨模块依赖必须显式登记（设计 §4.2 S003/S005）。

### `ram build` 产物（P5-1a）

```
oj build: 6 module(s) → api/dist/{demo,home,notification,personal-center,system,web}-0.1.0
[ram] 已合并宿主站点 → modules/dist
[ram] 构建 about/access/exception/home/outside/personal-center/route-nest/system/demo/login/notification @...
[ram] 清单已生成 → modules/dist/modules.json
```

## P5-2：`ram api --docs`

生成契约文档站 `api/docs/index.html`（浏览器直接打开）+ 每个模块目录旁 `openapi.yaml`。CI 文档可复跑，无需手写。

## P5-3 / P5-4：两态冒烟

`scripts/smoke_all.py <base>` 覆盖全部模块：登录 → home 饼/折线 → 通知 → demo 待办 → system 角色/菜单 → web 异步路由（跨模块读）→ 头像上传 → 8 个端点无 Bearer 守卫。dev 与 preview 共用同一脚本，证明"生产构建态与开发态行为一致"。

### 冒烟结果（两态）

```
== preview (4173) ==  0 failed, 10 passed
== dev (5174) ==      0 failed, 10 passed
```

关键项：
- `web/get-async-routes` 返回 `['/home','/system','/about','/exception']` → 跨模块读在 release 态也正确（P5-1b 修复生效）。
- 头像上传回显 `data:image/png;base64,iVBORw0K...` 两态一致。
- 8 个受保护端点无 Bearer 均 401，两态一致。

## P5-5：`scripts/smoke.sh` 编排

两态共享 `smoke_all.py`；`smoke.sh` 负责生命周期：

1. `pnpm build`（幂等，失败即退）；
2. `run_state preview 4173`：后台拉起 → 轮询 `/api/health` 至 200 → 冒烟 → SIGINT 回收 ram（ram 优雅停 oj）→ 兜底 `pkill bin/oj` + 强杀残口；
3. `run_state dev 5174`：同上，前态清理后再起，避免 9779 端口冲突（dev/preview 的 oj 都用 config 里的同一端口）。

> 进程清理要点：dev/preview 各自 spawn 一个 oj 子进程（config 钉死 9779）。两态顺序跑、前态必须彻底清理（ram SIGINT 仅回收自己的 oj，再用 `pkill` 兜底），否则后态 oj 因端口占用 `ready` 拒绝、ram fail-fast。

## 关键 gotchas（教学要点）

1. **dev 能跑 ≠ release 能发**：dev `oj server` 对跨模块读表 `ownership_guard=warn`，release `oj build` 的 S003 是硬错误。跨模块表读务必在 `manifest.yaml` 声明 `deps`，否则本地联调正常、CI/构建爆 gate。
2. **`deps` 版本要与对方 `manifest.yaml` 的 `version` 对齐**：`web` 写 `system: "^0.1.0"`，必须匹配 system 的 `version: 0.1.0`，否则依赖解析失败。
3. **handler 方法名 = HTTP 动词**：oj 按导出函数名 `get/post/put/del` 映射路由。`demo/todos`/`system/role-list`/`system/menu-list` 都是 `get()`，冒烟用 POST 会 405——冒烟脚本必须按真实方法发请求（曾被误写成 POST）。
4. **两态共享端口 9779**：dev 与 preview 的 oj 都绑 config 的 9779，不能并发；冒烟必须先停一态再起另一态，且清理要彻底（SIGINT + pkill 兜底）。
5. **后台服务跨 Bash 调用不稳定**：`nohup ... &` 在工具进程回收时可能被杀，导致下一调用连不上。集成冒烟必须把"起服务→等健康→冒烟→清清理"放进**同一条 Bash 命令**，服务全生命周期都在该命令内。
6. **`ram preview` 自带 migrate**：preview 起服务前先 `oj migrate` 应用待执行迁移，dev 则靠 `oj server` 启动期 reconcile；两态都不需要手动 migrate，但 release 产物要求先 `ram build`（产出 `api/dist/manifests.yaml`）。
7. **`ram api --check` 不编译 handler，只对账契约**：它查生成物同步 / route 双向 / routes.js 漂移，但**不跑 tsc**。P4 的 `home/line` handler 里 `const out: number[] = []; out.push(map.get(d) ?? 0)` 触发 TS「evolving array」推断——`?? 0` 的 `0` 字面量把 `out` 收窄成 `0[]`，后续 `out.push(number)` 报 `number 不可赋值给 0`。`pnpm typecheck` 才是 handler 编译关卡，必须单独跑。修法：用 `Array.from(..., cb)` 产出明确 `number[]`，绕开 evolving 推断。
8. **`ram build` 编译的是工作树源码，能否进提交另算**：P4 提交时 `personal-center/upload/api.ts` 误夹带了 `ram api` 生成的 stub（`json.ok("示例")`），真实 multipart→base64 实现只在工作树、未入库。P5 经 `git commit --amend` 把真实实现补进 P4 提交，使提交与「头像上传真实化」的承诺一致（教学历史要可复现）。

## 阶段小结

- `ram build` 初跑即暴露 S003 跨模块依赖缺失：`web` 读 `system` 表未声明 `deps`，补 `deps:{system:^0.1.0}` 后通过。这是 P5 回归抓到的真实 release 风险。
- `ram api --docs` 生成文档站与 openapi；`ram build` 产出 api/dist + 合并全站 + modules.json。
- preview 与 dev 两态冒烟均 10/10，`scripts/smoke.sh` 一键复跑两态、含进程清理；`web/get-async-routes` 跨模块读在两态均正确，头像上传与 401 守卫两态一致。
- `pnpm typecheck` 回归抓到 P4 漏网的 handler 编译错误：`home/line` 的 evolving-array `?? 0` 推断（`out` 被收窄成 `0[]`），改用 `Array.from` 产出明确 `number[]` 修复；同时修正 P4 提交误夹 stub 的 `upload/api.ts`（amend 补入真实实现）。
- P4 的四模块（home/notification/upload/web-deps）经 release 构建、两态冒烟、`pnpm typecheck` 三道关卡验证闭环。

## 反常规 / 反常识点（供 P6 汇总）

- **"能跑"和"能发"是两套标准**：同一段跨模块 SQL，dev 只 warning、release 直接 fail。开发者容易在 dev 里"侥幸过关"，直到 CI 的 build gate 才爆——依赖声明不是文档、是发布硬门槛。
- **oj 运行态端口被 config 钉死**：dev 与 preview 都用同一个 9779，无法并行；这与"前端 dev/preview 端口不同（5174/4173）"形成反差——前端端口随命令变，后端端口随 config 不变。
- **后台进程的生命周期掌握在调用方手里**：长驻服务必须在一个命令内完成"起—测—停"，不能依赖跨命令存活；否则会出现"上一命令明明起了服务、下一命令却连不上"的诡异失败。
