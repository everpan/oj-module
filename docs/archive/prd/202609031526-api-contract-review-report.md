# API 契约机制 集中评审报告（Phase 6 / Task 6.2）

> 评审对象：`feat/api-contract` 分支（`git diff feat/ram...feat/api-contract`，118 文件 +60937/-631）
> 评审输入：设计文档 `202609030854-api-contract-design.md`（AC-D1..D16）+ 实现计划 `202609030941-api-contract-implementation-plan.md`
> 评审角色：架构师 / 开发工程师（双代理独立评审，2026-09-03）
> 处置口径：blocker/major 必修，minor 评估后顺手修或记演进点，nit 记录

## 总体结论

两角色一致：**无 blocker**。架构评价 `evaluate → ir → emit-* → run/check` 单向流水线职责切分干净、无过度设计；开发评价快照+行为双轨测试断言有效。但双方**交叉印证**了三处「机制核心承诺在真实路径上失效」的裂缝（date 语义、mock 热载、mock 自违例）——均为单测/快照盲区，首次真实消费（Phase 5 试点）路径上才会现形。

## Findings 汇总与处置

两角色编号已归并（A=架构，D=开发）；✅=本期修复，🔧=演进点记录，📝=文档回改。

| # | 来源 | 级别 | 问题 | 处置 |
|---|------|------|------|------|
| F1 | A-M1 / D-1 | major | `z.date()` 三链语义互斥：emit-schema 发 `z.date()`（期望 Date 实例），emit-meta/mock/stub 按 ISO 串——dev 校验对自家 mock 必误报 | ✅ emit-schema date → `z.iso.datetime()`，与 emit-meta/mock 对齐；补「ISO 串过 safeParse」端到端用例 |
| F2 | A-M2 / D-3 | major | `ram dev` 契约 mock 表启动时装载一次，契约 watch 重生成后 mock 永远过期 → 假「契约违例」，须重启 | ✅ regen 成功后重建 contractMocks 表（可变引用） |
| F3 | A-M3 | major | `@react-antd-module/contract` 硬共享资产搭车全量 zod（726KB）进生产，违 AC-D15「零成本」与 Global Constraints | ✅ contract 包新增 zod-free 子路径出口 `./errors`（ContractApiError + ScopedRequestLike），生成 client 改从子路径 import，SHARED_DEPS 换为深路径资产 |
| F4 | D-2 | major | mock 示例值可违反自家 schema（number 无视 max、string 无视 min_length）→ dev 校验对 mock 误报 | ✅ exampleFromSchema 遵守 min/max/length 约束 |
| F5 | D-4 | major | `mockStatusCode` 把任意业务码（如 10001）当 HTTP 状态 `writeHead` → `ERR_OUT_OF_RANGE` dev 进程崩 | ✅ clamp：非 100–599 归 500 |
| F6 | D-5 | major | emit-stub 指纹依赖 ESLint 但 cli 未声明 eslint 依赖——消费工程无 eslint 即崩 | ✅ stub 模板改为天然 lint-clean（tab/双引号/分号写死），去掉 ESLint 依赖与 fix-before-hash |
| F7 | D-6 | major | raw 端点 + params/query schema → emitSchemas 过滤 raw 整个端点，client.ts 类型引用不存在的键 → 生成物不可编译 | ✅ emitSchemas 保留 raw 端点的 params/query 槽（仅过滤 data）；补 tsc 级用例 |
| F8 | D-7 | major | params schema 键与 route 参数段无交叉校验 → URL 插值 `undefined` | ✅ buildIr 校验 `paramNames ⊆ params shape keys`，人话报错 |
| F9 | A-m4 / D-13 | minor | OPTIONS 定义期合法、发射期才炸；HEAD+data 生成 `.json()` 空 body 必炸 | ✅ defineApi 定义期拒 OPTIONS、拒 HEAD+data |
| F10 | A-m5 / D-10 | minor | emit-schema 静默降级：regex flags 丢失、未点名 string_format 静默放宽、array min/max 不发射 | ✅ 不可保真即拒绝（带 flags 的 regex、未识别 format）；array 补发 `.min()/.max()` |
| F11 | A-m6 | minor | emit-stub 示例值 object 键不引号化（kebab-case 键产语法错误 stub） | ✅ 复用 emit-schema 的 `keyOf()` |
| F12 | D-9 | minor | 请求槽入参类型用 `z.infer`（输出型），带 `.default()` 字段被标必填 | ✅ query/params/body 改 `z.input`；data 保持 `z.infer` |
| F13 | D-11 | minor | 成功路径不检查信封 `code !== 0`（2xx + 业务错误静默通过） | ✅ 生成 client 成功路径加 code 检查抛 ContractApiError |
| F14 | A-m9 / D-20/21/22/23 | minor | 计划/设计文本漂移五处（toApiError 解信封、发现可配置未兑现、internal z 来源分叉、exampleFromSchema 收敛矛盾、openapi 缺错误响应文档） | ✅ 文本回改 + openapi 补 default 错误响应（§6.2 通道 b 入交付物）；「发现可配置」降级为固定两档 |
| F15 | A-m7 | minor | apiPrefix 定义期校验过弱（`/../x`、尾斜杠放行） | 🔧 演进点（现有两道闸门间接挡住） |
| F16 | A-m8 | minor | uni-dev 写 client 不验目标模块存在，目录打错字静默造孤儿目录 | 🔧 演进点 |
| F17 | D-8 | minor | query 序列化 cast 撒谎（array 被逗号拼接、Date 变垃圾串） | 🔧 演进点（IR 收窄 query 字段为标量） |
| F18 | D-12 | minor | mock matcher catch-all 要求 ≥1 段，matchit 允许零段 | 🔧 演进点 |
| F19 | D-15 | minor | 部分接入的 uni-dev 工程被 route-unregistered error 淹没，无豁免机制 | 🔧 演进点（迁移期 `--check` 增量接入） |
| F20 | D-14 | minor | evaluate 的 runtime 空壳 stub 注释与行为不符（误 import 其他具名导出得 esbuild 原生报错） | 🔧 演进点 |
| F21 | A-n10 | nit | 三张 HTTP 方法映射表互为正反映射，可收敛 | 🔧 记录 |
| F22 | A-n11 / D-17 | nit | 双 exampleFromSchema 同名不同签名 | ✅ emit-stub 侧改名 `exampleSourceFromSchema`（F6 重构时顺带） |
| F23 | A-n12 / D-19 | nit | 契约测试挂 ~10s close timed out；`.ram-tmp-` 崩溃残留 | 🔧 记录 |
| F24 | D-16/18 | nit | dev-mock 注释缺换行；demo 页 `getTodoList({}).then` 无 catch | ✅ 顺手修 |
| F25 | D-测试总评 | 建议 | 生成物从未过 `tsc --noEmit`——F7/F8 类问题的一劳永逸兜底 | ✅ 新增 codegen 产物 tsc 兜底测试 |

## 修复验证口径

- 每条 ✅ 附新测试或对存量测试的修改；
- 修复完成后复跑 Task 6.1 全量回归（typecheck/lint/test/build/circular-deps/e2e/双仓 --check）；
- playground dev 冒烟补测「改契约字段 → 页面报契约违例」反馈环（F1/F2/F4 的端到端验证）。
