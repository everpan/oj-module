# oj test 测试专题指南（L1）

> 本文是 `api-manual.md` §9「测试」的**专题指引**：旗标表、注入 API 契约表（client /
> describe / expect / ws 面）在 api-manual 同章——只列签名与形态。写测试的**实操走读**：
> 文件收集规则、一次运行的完整生命周期、测试库隔离口径、可照抄样板、fixtures/seed 纪律、
> CI 接入与常见坑，集中到这里。两处交叉引用，不重复。

## 1. 两层测试，一句话分工

**L2 vitest（`unit/`）测 handler 纯逻辑**：mock 全局、毫秒级，断言「输入 X 得 Y /
发出了什么 SQL / bus 发布了什么」。**L1 `oj test` 测端到端**：进程内真实 v8 + 真实
路由/鉴权/租户管线 + 真实后端（零 TCP；仅 WS 测试面惰性起 `127.0.0.1:0` 本地服务），
断言「HTTP 进、信封出」。**开发期 L2 快速回归，CI 用 L1 守契约；两层都绿才发布。**
避免双写的分工判据见 api-manual §9「与 L1 分工」；L2 的桩用法同章「L2：vitest 纯 mock」。

## 2. 测试文件放哪、怎么被收集

- 放 `tests/*.test.ts`。目录经 `-t/--tests` 指定，**相对 config 所在目录**（默认 `tests`）。
- **递归收集**（v0.1.52）：子目录里的用例也会跑（此前只扫首层是静默丢失）；
  **`_` 前缀目录跳过**（与路由私有目录约定同形）——helper / 共享代码放 `_shared/`，
  别放在会被当用例收集的位置。
- 文件内可用的 `describe/it/beforeEach/expect` 与全局 `client` 由 `oj test` 运行时注入，
  类型声明在 `global.d.ts`「oj test L1 测试 SDK」段（编辑器即有补全）。

## 3. 一次 `./bin/oj test` 的完整生命周期

1. **装配**：读 config → 装载插件 → 构建路由表（与 serve 同一套装配层）。
2. **库切换**（v0.1.20）：目标库取值优先级 `--db <name>` > config `db.test` >（都没有）
   **WARN 并继续跑 default**——不静默，但测试会落在开发库上（见 §8 头号坑）。stderr
   打印 `oj test: using db "..."`；字面 `default` 的库调用**请求期重定向**到测试库，
   业务代码零改动。
3. **数据准备**：迁移 → `seed.sql` 重放 → `fixtures/*.sql` 灌入，全部跟随测试库。
4. **执行**：进程内起 App oneshot（零 TCP），按路径排序顺序收集执行收集到的用例。
5. **报告**：`--format human`（默认）/ `tap` / `junit` / `json`；`--output` 落盘，
   省略打 stdout（机器格式保持 stdout 纯净）。**全绿退出码 0，任一失败 1**——可直接做
   CI 门禁。

> `oj test --db` 与 `oj migrate --db` **同名不同义**：前者重定向「字面 default 的库调用」，
> 后者是整轮迁移的目标库（api-manual §9 提示框）。

## 4. 测试库隔离（别脏开发库）

- config **声明 `db.test`** 是隔离的正道（如 `test: "sqlite://db_test.sqlite"`）；
  两者都没给时看启动那行 WARN——用例正在跑开发库。
- `--db ci_scratch` 给 CI 一块一次性场地：名字必须在 `config.db` 段声明，
  **未声明 fail-fast**（列出可用名，不静默回落）。
- 测公开面 handler 加 `--anonymous`：等同生产 `tenant.anonymous_paths` 命中的匿名请求。
- config 启用 tenant / auth 后的两道门禁（每请求 `X-TENANT-ID`、非匿名路径 Bearer）
  见 api-manual §9「两个必知约束」——L1 走真实管线，缺头就是真实 400/401。
- 多源同理：`--redis/--blob/--es/--broker/--kafka/--rabbit` 把命名 profile 烘焙为
  `default`（JS 代码零改动）；选错名 fail-fast，其余轴**没有** db 那条 WARN 回落特例。

## 5. 可照抄样板

### 5.1 多 describe 文件：每个 it 内联准备

`beforeEach` 是**单一全局钩子**——第二个 `describe` 里再注册会覆盖前者。多 describe
文件别依赖它，每个 `it` 自己准备（登录 + 租户样板见 api-manual §9 示例；`client.login`
失败抛错，让用例自然失败即可）：

```ts
const as = async (u: string, p: string, t = "default") => ({
  Authorization: "Bearer " + (await client.login(u, p, { "X-TENANT-ID": t })),
  "X-TENANT-ID": t,
});

describe("orders", () => {
  it("admin lists all", async () => {
    const h = await as("admin", "admin1234");
    const r = await client.get("/order", { headers: h });
    expect(r.status).toBe(200);
  });
});
describe("refunds", () => {
  it("denies plain user", async () => {
    const h = await as("demo", "demo1234");
    const r = await client.post("/refund", { headers: h, body: "{}" });
    expect(r.status).toBe(403);
  });
});
```

### 5.2 匿名公开面（配 `--anonymous`）

```ts
// ./bin/oj test -c config.yaml -d src --anonymous
describe("public share page", () => {
  it("serves shared doc without auth", async () => {
    const r = await client.get("/share/abc123");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).code).toBe(0);
  });
});
```

### 5.3 WS 帧（v0.1.16 测试面）

`client.ws(path)` 的 `send`/`next`/`close` **任一个都能建连**——服务端连接钩子主动推的
首帧（`ws.send` / bus 广播）可以不先 `send`、直接 `next()` 读。`next(ms?)` 超时返回
`null`（默认 1000ms）；文本帧 `data` 是 string（测试面自带 UTF-8 解码），二进制帧是
`Uint8Array`。取字段前先收窄：`if (!f || f.closed) …`：

```ts
const ws = client.ws("/echo-bin/ws");
await ws.send("ping");                       // string → Text 帧
const f = await ws.next();
if (f && !f.closed && !f.binary) expect(f.data).toBe("ping");
await ws.close();
```

## 6. fixtures 与 seed 的纪律

| 数据 | 灌入时机 | 要求 |
|---|---|---|
| 模块 `seed.sql` | **每次启动**重放（含 serve） | 幂等写法；按 `;` 切分，语句内不得含分号字面量（S006）；语句前置 `--` 注释行允许（v0.1.66 起） |
| 模块 `fixtures/*.sql` | 仅 `oj test` / `oj test fixture` 灌入 | 演示/测试数据，**不进 release 产物**；v0.1.52 起**幂等门禁**：非幂等 INSERT（判据同 S006）灌入前报错——改 `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` 即可重复灌 |

- 断言别依赖「fixtures 恰好只有我灌的行」：`oj test` 重复跑、多人共用一块测试库时
  fixtures 会反复重放，按唯一键 `where` 精确断言自己那行。
- 多库项目（场景 19）：fixtures/seed 跟随所选库，`--db` 切到哪灌到哪。

## 7. CI 接入

仓库既定串（`.github/workflows/plugin-matrix.yml` 的 `sample-tests` job，api-manual §9
「CI 已内置」）：

```
npm ci (unit/) → npm run typecheck → cargo xtask build
  → ./bin/oj test -c config.yaml -d src --format junit（--output 落盘供 CI 收集）
  → npx vitest run（L2）
```

业务项目照抄这个顺序即可：**退出码即门禁**（任一失败 = 1），junit 报告接 CI 测试面板。
`cargo xtask build` 别换成 `cargo build -p oj`（feature 归一化会重编 rusty_v8）。

## 8. 常见坑速查

| 症状 | 原因与解法 |
|---|---|
| 测试读到陌生数据 / 写坏开发库 | 没声明 `db.test` 也没 `--db`——WARN 后落在 default（开发库）。声明 `db.test` 或显式 `--db`，认启动那行 `using db "..."` |
| 子目录里的 `*.test.ts` 没被执行 | v0.1.52 前只扫首层（升级后子目录用例会开始跑）；`_` 前缀目录**永远**跳过——helper 移进 `_shared/` |
| `oj test fixture` 报非幂等 INSERT | v0.1.52 幂等门禁（判据同 S006）——改 `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` 写法 |
| `beforeEach` 在第二个 describe 里失灵 | 单一全局钩子，后注册覆盖前者——各 it 内联准备（§5.1） |
| `--db ci_scratch` 报未知库 | fail-fast 设计：名字必须先在 `config.db` 段声明（`--redis` 等其余轴同样 fail-fast，无回落） |
| 测公开路由收到 401/400 | L1 走真实管线：加 `--anonymous`，或按 §4 给头（租户头 / Bearer） |
| 断言偶发多出别人的数据 | fixtures 幂等重放是常态——断言按唯一键收窄到自己灌的行（§6） |
| 机器格式报告混进日志 | `--format tap/junit/json` 加 `--output <file>`，stdout 留给诊断 |
