# fixture-invalid · 期望违规清单（P1-5/P1-11 测试的期望真源）

夹具 `manifest.yaml` 故意触发 7 条**内在违规**——定义为「对任意合法 name/version 取值均违规」，与 name 非法引起的连锁衍生失配（如 `demo:*` 命名空间字段）区分开。

## 测试断言约定

1. 双端（Node `validateContract` / isolate `preflight`）各自解析本夹具，断言违规码集合 **⊇** 下表 7 码；不断言「恰好等于」（衍生违规允许存在，允许 fail-fast 提前截断——但被断言的码必须在其截断前可报出，故双端实现均要求**收集全部违规后统一报出**，见契约 §0 唯一真源纪律）。
2. `fixture-valid` 同规则跑双端，断言**零违规**（防误报）。
3. 衍生违规（`demo:menu.demo` 等 namespace 失配）不计入断言，不要求报出或不报出。

## 违规对照表

| ID | 触发点 | 期望违规码 | 契约条款 | 上游依据 | 内在性说明 |
|---|---|---|---|---|---|
| V1 | `name: Demo`（大写） | C2-01 | §2.1 身份 name 白名单 `^[a-z][a-z0-9-]{0,63}$` | R7 预检白名单 | 大写对任意取值均违规 |
| V2 | `version: 1.0.0+build.5` | C2-02 | §2.1 version 禁 `+`（oj validate_version 字符集 `[A-Za-z0-9._-]` 无 `+`） | 契约附录 B-1（oj 相容排除） | `+` 恒被 oj 拒装 |
| V3 | `api.anonymous: [system/health]` | C2-26 | §2.4 匿名路径段内收敛（首段必须 = 本方案段；`system`/`_system` 恒非本方案段） | R8 越段匿名化 + `_system` 禁入 | `system/health` 对任意 name 均越段 |
| V4 | `routes[0].category: personal` | C2-17 | §2.6 路由 category ∈ main\|admin\|hidden（D4 三值） | D4（PRD §5.2 五值废弃） | `personal` 为已删除值 |
| V5 | `settings.groups[0]` 缺 `label_key` | C2-22 | §2.7 组 label_key 必填，指向 `<name>:settings.group.*` | D4 设置组标题契约 | 必填字段缺失 |
| V6 | `settings.groups[0].items[0].key: framework.site_title` | C2-23 | §2.7 键所有权 `moduleOf(key) === name` | R24（防 `framework.*` 污染，跨模块提权同类洞） | `framework.` 前缀对任意方案 name 均越空间 |
| V7 | `roles[0].permissions: [demo.manage]`（未声明） | C2-16 | §2.5 角色 permissions ⊆ permissions[].code | §2.5 悬空引用双端拒绝 | `demo.manage` 不在 permissions[] 中，对任意 name 均悬空 |

## 关联文件

- 契约：`docs/prd/solution/202610171254-lifecycle-manifest-contract.md`（规则编号 §2/§4）
- 合法对照：`../fixture-valid/manifest.yaml`（全字段合法，双端零违规）
- 双端测试约定：`../README.md`
