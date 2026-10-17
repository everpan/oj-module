# lifecycle 测试夹具（C2 交付物 · 双端唯一共同真源）

契约：[`docs/prd/solution/202610171254-lifecycle-manifest-contract.md`](../../../../../docs/prd/solution/202610171254-lifecycle-manifest-contract.md)（规则编号 C2-01~C2-33）。

## 用途

manifest.yaml 契约在两个运行时各有一份实现（计划 §1「两运行时取舍」——Node CLI 构建期与 oj isolate 安装预检之间无共享模块机制）：

| 端 | 实现（P1） | 消费夹具的测试 |
|---|---|---|
| Node（构建期，`ojm build --bundle`） | `packages/cli/src/manifest-contract.ts` → `validateContract(m): string[]` | `packages/cli/src/lifecycle/__tests__/manifest-contract.test.ts`（P1-11） |
| oj isolate（安装期 preflight） | `templates/api/src/_platform/_lifecycle/steps/preflight.ts` | `templates/api/tests/lifecycle/preflight.spec.ts`（P1-5） |

**DRY 于夹具而非运行时**：两份实现的一致性由同一组夹具钉住——任何一端正则/规则变更，必须先改契约文档对应条款，再同步另一端与夹具，双端测试全绿后方可提交。

## 夹具清单

```
fixtures/
├── README.md                          # 本文件
├── fixture-valid/                     # 合法样例：双端零违规
│   ├── manifest.yaml                  # bundle 级契约（全字段合法）
│   ├── api/src/demo-solution/         # oj 模块源（manifest/schema/ping 路由/0001__init.sql 建表迁移）
│   └── web/src/demo-solution/         # entry.ts + locales（zh-CN/en-US 全 key 双语）
└── fixture-invalid/                   # 非法样例：双端七码齐报
    ├── manifest.yaml                  # 故意触发 V1–V7
    ├── EXPECTED-VIOLATIONS.md         # 每条违规 ↔ 契约条款对照（P1-5 期望真源）
    ├── api/src/Demo/
    └── web/src/Demo/
```

## 双端测试约定

1. `fixture-valid/manifest.yaml`：`validateContract` 与 `preflight` 均断言**零违规**。
2. `fixture-invalid/manifest.yaml`：两端均断言违规码集合 **⊇** `{C2-01, C2-02, C2-16, C2-17, C2-22, C2-23, C2-26}`，逐条依据见 `fixture-invalid/EXPECTED-VIOLATIONS.md`；衍生违规（name 非法导致的 `demo:*` 命名空间连锁失配）不计入断言。
3. 断言前提：两端实现均**收集全部违规后统一报出**（返回违规列表而非首个即抛），否则截断会使后续码无法报出——此为实现纪律，随 P1-5/P1-11 测试钉住。

## 夹具断言范围之外（勿在此过度断言）

- `web.integrity` 的安装期重算比对（C2-28/R10）针对**构建产物 tgz**，源树夹具中该值为格式样例；
- prefix 占用检测、peerRuntime 对宿主 `versions.json`（C2-09）等需要站点/宿主状态的规则，由 P1-5/P1-11 各自的运行时夹具（内存 state/versions 假数据）覆盖；
- 恶意 tgz 成员（`..`/symlink）用例属 P1-2 `tgz-guard`，独立构造，不入本目录。
