# Phase 4 — home 图表 / notification 通知 / upload 上传 真实化

> 阶段目标（计划 §5）：home 模块饼图/折线图走真实统计端点；notification 模块经 D9 注入通知列表端点；personal-center 头像上传走 multipart → base64 写库回显。
>
> 完成标准：home 图表、通知列表、头像上传回显三模块端到端通过（`ram api --check` 绿 + `pnpm typecheck` 通过 + 三模块冒烟全 PASS）。

## 执行步骤

| 步骤 | 动作 | 关键产物 | 验证 |
|---|---|---|---|
| P4-1a | home 数据层：manifest 加 `tables:[home_pie,home_line]` + `schema.yaml` + 迁移 + seed | `api/src/home/{manifest.yaml,schema.yaml,migrations/0001__create_home_tables.sql,seed.sql}` | `oj migrate` home:1 |
| P4-1b | `pie` handler：按 `category` 聚合 `home_pie` → `[{code,value}]` | `api/src/home/pie/api.ts` | 冒烟 5 类目 |
| P4-1c | `line` handler：range→窗口天数，按 `day` 聚合 + 缺天补 `0` + 全窗口为 0 时合成回退 | `api/src/home/line/api.ts` | 冒烟 7 点（含补 0） |
| P4-1d | 前端 `pie-chart`/`line-chart` 改从 `./api/client` 导入生成 `fetchPie`/`fetchLine`；`entry.ts` `onInit` 调 `bindRequest` | `modules/src/home/{entry.ts,pages/components/pie-chart.tsx,line-chart.tsx}` | 契约驱动 |
| P4-2a | notification 数据层：manifest 加 `tables:[notifications]` + `schema.yaml` + 迁移 + seed | `api/src/notification/{manifest.yaml,schema.yaml,migrations/0001__create_notifications.sql,seed.sql}` | `oj migrate` notification:1 |
| P4-2b | `notifications` handler：`ORDER BY id DESC`，`is_read`→布尔 | `api/src/notification/notifications/api.ts` | 冒烟 4 条 |
| P4-2c | `entry.ts` `onInit` 注册 `notificationsApi` provider（`action`/`fetchNotifications`） | `modules/src/notification/entry.ts` | 消费点经 `getNotificationsApiProvider` 委托 |
| P4-3a | `web` 迁移补 `avatar_base64` 列 | `api/src/web/migrations/0002__add_avatar_base64.sql` | `oj migrate` web:2 |
| P4-3b | `upload` handler：multipart → base64 → 写 `users.avatar_base64`（按 `http.user.id`） | `api/src/personal-center/upload/api.ts` | 冒烟 data URL |
| P4-3c | `entry.ts` 注册 `uploadApi` provider（`action=/api/personal-center/upload`，headers 带真 Bearer） | `modules/src/personal-center/entry.ts` | form-avatar-item 经 registry 取 action/headers |
| P4-3/1/2 | `ram api --check` + `pnpm typecheck` 绿；三模块冒烟 | 终端 | 0 error / 0 warn |

## P4-1：home 图表（饼图 / 折线）真实化

### 动机

home 页的饼图/折线原是前端 `mock` 数据。P4-1 把它接成 oj 后端的两个统计端点，演示"聚合查询 + 时间窗口补全"这类典型 BI 后端写法。

### 数据层（P4-1a）

- `home_pie(id, category, value)`：5 个类目，种子各带值。
- `home_line(id, day, value)`：`day` 是"自纪元起的天数"（`Math.floor(Date.now()/86400000)`），便于窗口计算。**种子必须围绕"当前 epoch-day"生成**——用固定历史天（如 20570）会在约 110 天后彻底落到窗口外，导致折线全空（见 gotchas 第 4 条）。

### 两个 handler（P4-1b / P4-1c）

- **`pie`**：`SELECT category, SUM(value) AS v FROM home_pie GROUP BY category` → 映射成 `[{code:category, value:v}]`。轻量聚合，无坑。
- **`line`**：
  - range→天数：`week:7 / month:30 / year:365`；窗口 `[today-days+1, today]`。
  - `SELECT day, SUM(value) AS v ... GROUP BY day`，再对窗口内**每一天**取 `out[day] ?? 0` 补 0，保证 series 长度恒等于 `days`、且缺数据的天显示 0 而非断点。
  - **合成回退**：当整窗 `out.every(v=>v===0)`（种子可能随系统时间漂移而全 0），按正弦合成 `50 + 40*sin(d/3) + (d%7)*3` 填出一条有起伏的曲线，避免页面出现"纯平直线"。

### 前端接驳（P4-1d）

`pie-chart.tsx` / `line-chart.tsx` 原从 `@oj-module/runtime` 导入 `fetchPie`/`fetchLine`——改为从本模块 `./api/client` 导入（契约生成物），`entry.ts` `onInit` 调 `homeClient.bindRequest(ctx.utils.request)`。与 P3 的 D9 不同：home 不是 runtime 内置端点，前端**直接持有**生成的 client，无需 registry 委托。

## P4-2：notification 通知（D9 注入）

### 动机（D9 复用）

通知列表端点原硬编码在 runtime 根级（`/notifications`）。P4-2 复用 P3 的 D9 模式：notification 模块注册 `notificationsApi` provider，让 runtime 消费点（顶栏铃铛）经 `getNotificationsApiProvider()` 委托。

### 数据层 + handler（P4-2a / P4-2b）

- `notifications(id, avatar, date, is_read, message, title)`；种子 4 条（id=3 `is_read=1`）。
- `notifications` handler：`ORDER BY id DESC`（最新的在前），`isRead: Number(r.is_read)===1` 把整型标志映射布尔。

### 注入（P4-2c）

```ts
async onInit(ctx) {
  notificationClient.bindRequest(ctx.utils.request);
  const provider: NotificationsApiProvider = {
    fetchNotifications: () => notificationClient.fetchNotifications(),
  };
  ctx.register.notificationsApi(provider);   // 先到先得
}
```

`NotificationsApiProvider` 接口只有一个方法 `fetchNotifications`，比 P3 的 `SystemApiProvider`（10 个方法）简单——但注入机制完全一致（registry 单例 + 消费点 `??` 回落）。

## P4-3：upload 头像上传（multipart → base64）

### 动机（D7/F4）

personal-center 头像上传走 `multipart/form-data`。oj 的 `http.files` 给出上传元数据，`http.file(i)` 异步取字节；后端把图片转 base64 data URL 存进 `users.avatar_base64`，前端读该字段回显——**绕开独立文件存储**，用"库内 base64"演示最小可用的上传闭环。

### 迁移（P4-3a）

`web` 模块 seed 只建了 `users` 基础列。补列走显式迁移 `0002__add_avatar_base64.sql`：`ALTER TABLE users ADD COLUMN avatar_base64 TEXT NOT NULL DEFAULT '';`。

> 注意：这是**累加迁移**，`web` 已经是 `0001`，`0002` 顺序连续、唯一（S007 闸门要求迁移序号连续唯一）。

### handler（P4-3b）

```ts
const user = http.user;                  // Bearer 守护，无则 401
if (!user) return json.fail(401, "未登录");
const files = http.files;                // multipart 文件元数据数组
if (!files || !files.length) return json.fail(400, "无文件");
const bytes = await http.file(0);        // 异步取第 0 个文件字节（Uint8Array）
const b64 = toBase64(bytes);             // oj 无 Buffer，手写查表法 base64
const url = `data:${files[0].content_type};base64,${b64}`;
await db.exec("UPDATE users SET avatar_base64 = ? WHERE id = ?", [url, user.id]);
return json.ok(url);   // 直接返回 data URL 字符串（不是 {url} 对象）
```

`toBase64` 用 `String.fromCharCode` + `btoa` 的分块写法（oj 运行在 V8/deno_core，无 Node `Buffer`）。

### 注入（P4-3c）

```ts
async onInit(ctx) {
  const provider: UploadApiProvider = {
    action: "/api/personal-center/upload",
    headers: (): Record<string, string> => {
      const token = useAuthStore.getState().token;       // 从 auth store 取当前 token
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  };
  ctx.register.uploadApi(provider);       // D9：上传组件经 registry 取 action/headers
}
```

`headers` 必须**返回 `Record<string,string>`**（不能返回 `Authorization?: undefined` 的联合），否则 typecheck 在 `as` 边界仍报不兼容——用显式返回类型注解收口（见 gotchas 第 5 条）。

## P4 冒烟结果（`scripts/smoke.sh` 节选）

```
== home/line week (expect real data, gap-filled) ==
status 200 len 7 series [253, 262, 271, 280, 289, 298, 100]
== home/pie (expect 5 categories) ==
status 200 categories [apparel_accessories, beauty_skincare, electronics, food_beverages, home_goods]  (values 求和 [180,95,320,150,210])
== notification/notifications (expect 4, isRead bool) ==
status 200 total 4  isRead=[False, True, False, False]
== upload multipart (avatar) ==
status 200 data prefix data:image/png;base64,iVBORw0K
== upload no-Bearer (expect 401) ==  → 守卫生效
== home/pie no-Bearer (expect 401) ==  → 守卫生效
== notification no-Bearer (expect 401) ==  → 守卫生效

P4 FULL CHECKS PASSED (home pie/line, notification, upload multipart)
```

## 关键 gotchas（教学要点）

1. **`home_line.day` 必须用"当前 epoch-day"**：固定历史天种子会在系统时间推进后落到窗口外，折线全 0 且合成回退兜底成假数据。种子脚本生成时一律 `today = Math.floor(Date.now()/86400000)`，并留 `today-30`/`today-12` 两处故意空缺演示补 0。
2. **time-series 缺天必须补 0**：`GROUP BY day` 只返回有数据的天，窗口内其他天不出现；前端按"index=day"渲染会错位。handler 显式对 `[start..today]` 逐天 `out.push(sum ?? 0)`。
3. **聚合端点要 `??` 兜底 0/空数组**：`SUM` 在「无匹配行」时返回 `null` 而非 `0`，前端 `chart` 收 `null` 会崩；handler 内 `Number(sum ?? 0)`。
4. **seed.sql 分号是边界**：oj 按分号**朴素切分**，`;` 即便在注释里也会断句。home seed 行多、`home_line` 与 `home_pie` 混排，生成时**逐行核对 `INSERT INTO` 表名**——曾出现一行写成 `INSERT INTO home_line (category, value)` 实际要插 `home_pie`，导致饼图少一类、折线多一行脏数据。
5. **`uploadApi.headers` 返回类型要收口**：`() => token ? {Authorization} : {}` 推断为 `{Authorization:string} | {Authorization?:undefined}`，不赋 `Record<string,string>`。给 `headers` 加 `: Record<string,string>` 注解即可（与 P3 `as unknown as SystemApiProvider` 同理，是 D9 边界的"框架类型收口"）。
6. **oj 无 `Buffer`**：`http.file(i)` 返回 `Uint8Array`，base64 用 `btoa(String.fromCharCode(...chunk))` 分块转，不可 `Buffer.from(bytes).toString('base64')`。
7. **`web` 是累加迁移不是重建**：头像列用 `0002` 追加（`ALTER TABLE ... ADD COLUMN`），保留了 `0001` 的 users 基础结构；S007 要求迁移序号**连续唯一**，不能跳号或重复。

## 阶段小结

- P4-1 home 饼图/折线接真实统计端点：聚合 + 时间窗口补全 + 全 0 合成回退，前端改从生成 `client` 导入，契约驱动。
- P4-2 notification 复用 P3 的 D9 模式，单方法 `notificationsApi` provider 注册，`??` 回落消费点。
- P4-3 personal-center 头像走 multipart→base64 写 `users.avatar_base64`，`uploadApi` provider 经 registry 暴露 action/headers（Bearer 由 auth store 动态提供）。
- `ram api --check` 0 error / 0 warn；`pnpm typecheck` 通过；三模块无 Bearer 均 401、有 Bearer 均 200，端到端闭环。

## 反常规 / 反常识点（供 P6 汇总）

- **时间窗口数据要前端"看不见地"补 0**：SQL `GROUP BY day` 只回有数据的天，缺天不出现——handler 必须主动对整窗补 `0`，否则前端按 index 渲染错位。这是 BI 后端的隐藏义务，直觉里"数据库有啥返回啥"会出 bug。
- **种子数据会随系统时间"过期"**：`home_line.day` 用绝对 epoch-day，固定值种子约 110 天后彻底失效——"测试种子"不是一次写好就一劳永逸，时间相关种子需要随当前时间生成。
- **oj 运行在 V8 没有 Node `Buffer`/`require`**：上传转 base64 必须用浏览器式 `btoa` + 分块 `String.fromCharCode`，沿用 Node 写法会在 oj 里直接抛"Buffer is not defined"。
- **D9 provider 的 headers 是"函数"不是"静态对象"**：上传组件每次发请求时调用 `headers()` 实时取 token，因此登出/换号后下次上传自动带新 token——provider 把"动态上下文"封装进 registry，消费点无需关心鉴权细节。
