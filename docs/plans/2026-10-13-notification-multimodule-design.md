# 通知面升级：按人真实通知 + 跨模块发射原语

日期：2026-10-13
分支：feat/ojm
关联：上游 PR「通知铃支持多模块发送」

## 1. 目标与范围

把当前示例级通知面（全局共享表 + 4 端点 + 单一 provider 槽位）升级为：

- **A. runtime 文档澄清**（零破坏）：明确 `NotificationsApiProvider` 是「铃的数据通道」（消费端，先到先得＝单通道事实，非模块竞争特权）。**不做**多 provider fan-in。
- **B. sample 按人真实通知**（必做）：表加 `user_id/link/category`，四端点按 `http.user.id` 过滤归属，非本人 403。
- **C. 跨模块发射原语**（必做）：runtime 导出 `notify.*` facade，委托给注册的 notifications 后端；sample 模块提供具体实现。任何模块可 `import { notify } from "@oj-module/runtime/api/notify"` 发通知，无需抢 provider。

## 2. 已确认架构决策

1. **C 落点**：runtime 定义 `notify` 契约/类型 + 导出 facade（委托给 `getNotificationsApiProvider()`）；sample `notification` 模块实现存储（两表）。
2. **广播避免信息爆炸 → 两表 + 回执**：
   - `notifications`：按人（私信/@我），`user_id` 必填，`is_read` 列。
   - `notifications_broadcast`：全局一行（通知/公告），无 `user_id`。
   - `notifications_broadcast_read(user_id, broadcast_id)`：广播已读回执。
3. **id 命名空间**：`NotificationItem.id` 改为字符串 `"u:<id>"`（按人）/`"b:<id>"`（广播）。`markRead` 按前缀路由到正确表。这是 v2 id 命名空间契约的提前落地。
4. **三类消息**：`category` ∈ `notice`(通知/广播) / `pm`(私信) / `mention`(@我占位)。私信＝按人通知；广播走 broadcast 表；@我仅占位不做特殊逻辑。

## 3. 数据模型（migrations）

`0002__notifications_user.sql`（三方言可移植：可空/DEFAULT ADD COLUMN + 索引）：
```sql
ALTER TABLE notifications ADD COLUMN user_id INTEGER;
ALTER TABLE notifications ADD COLUMN link TEXT;
ALTER TABLE notifications ADD COLUMN category TEXT NOT NULL DEFAULT 'notice';
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);
UPDATE notifications SET user_id = 1, category = 'notice' WHERE user_id IS NULL;
```

`0003__notifications_broadcast.sql`：
```sql
CREATE TABLE IF NOT EXISTS notifications_broadcast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  avatar TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  link TEXT,
  category TEXT NOT NULL DEFAULT 'notice',
  create_time TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS notifications_broadcast_read (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  read_time TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_broadcast_read ON notifications_broadcast_read (user_id, broadcast_id);
```
既有演示行经 0002 归主（user_id=1），不丢数据、不再全员可见。

## 4. Runtime 层改动（架构适配：前后端双运行时）

**关键约束**：前端模块（`web/src`）有 `ctx.register.notificationsApi`（HTTP 消费契约，铃用）；
后端 API 模块（`api/src`）无 `ctx.register`/lifecycle，是 handler 文件，直接用环境全局 `db`/`http`
（`db` 仅由 `apps/.../bin/devkit/global.d.ts` 类型化，不在 runtime 包内）。因此**发射原语必须落在后端**。

故「both」映射为：
- **Runtime（契约 + 前端 facade）**：导出 `notify` 类型（`PushInput`/`PushBroadcastInput`/`NoticeItem`）
  + 前端 `notify` facade（委托给前端 provider 的发射方法，经 HTTP 落到后端）；Part A 文档澄清。
- **Sample 后端（实现）**：`api/src/_shared/notify.ts` 用 `db` 直写两表，是后端模块真正 import 的原语；
  `api/src/notification` 拥有表（migrations）+ 暴露 `push`/`push-broadcast`/`del` 端点（薄包同一 helper）。

`packages/runtime/src/store/api-provider.ts`：扩展 `NotificationsApiProvider`：
```ts
// 消费端（铃，作用于当前用户，内部读 http.user）
fetchNotifications(): Promise<NotificationItem[]>
markRead(id: string): Promise<void>
markAllRead(): Promise<void>
clearAll(): Promise<void>
// 发射端（服务端原语，显式 userId）
push(input: PushInput): Promise<string>            // 返回 "u:<rowid>"
pushBroadcast(input: PushBroadcastInput): Promise<string>  // 返回 "b:<rowid>"
del(id: string, userId: string | number): Promise<void>
noticesFor(userId: string | number, opts?: { offset?: number; limit?: number }): Promise<NotificationItem[]>
markReadFor(id: string, userId: string | number): Promise<void>
markAllReadFor(userId: string | number): Promise<void>
clearNotices(userId: string | number): Promise<void>
```
（`markRead(id)` 实现内调 `markReadFor(id, http.user.id)`，存储逻辑共享，无重复。）

新增 `packages/runtime/src/api/notify/index.ts`：导出 `notify` facade + 类型 `PushInput`/`PushBroadcastInput`/`NoticeItem`。facade 委托给 `getNotificationsApiProvider()`；未注册时抛 `NotificationsBackendNotRegistered`。

`packages/runtime/src/layout/widgets/notification/types.ts`：`NotificationItem` 增 `link?`、`category?`、`scope: 'user'|'broadcast'`，`id` 改 `string`（命名空间）。破坏性变更（仅本仓消费），发版说明标注。

## 5. Sample `notification` 模块改动

`apps/playground-oj/api/src/notification/`：
- `migrations/0002`, `0003`（见上）。
- `notifications/api.ts`：列表 = 广播(LEFT JOIN 回执算 is_read) UNION 按人(`WHERE user_id = http.user?.id`)，`ORDER BY date DESC`。铃走 provider 同逻辑；root 回落端点同样按人过滤。
- `read/api.ts`：`markRead(id)` → 解析命名空间，`u:` 置 `is_read=1`（校验 user_id=当前用户，否则 403）；`b:` upsert 回执。
- `read-all/api.ts`：当前用户全部按人 `is_read=1` + 全部广播 upsert 回执。
- `clear/api.ts`：删当前用户按人行 + 删其广播回执（列表消失）。
- 新增 `push/api.ts`（`POST /notification/push`，Bearer 守卫）：`body={userId,title,message,link?,avatar?,category?}` → provider.push。
- 新增 `push-broadcast/api.ts`（`POST /notification/push-broadcast`）：→ provider.pushBroadcast。
- 新增 `del/api.ts`（`POST /notification/del`）：`body={id,userId}` → provider.del，user 项校验归属 403；broadcast 项仅删本人回执。
- `contract.ts`：增 `push`/`pushBroadcast`/`del` API；`notificationItem` 增 `link?`/`category?`/`scope`。
- `schema.yaml`：加列；`routes.json`/`openapi.yaml`：补路由。
- `seed.sql`：既有行由 0002 接管，无需改。

## 6. 兼容性 / 迁移 / 测试

- A 文档级零破坏；`NotificationItem.id` 改 string 为本仓内部破坏性，发版说明标注。
- 0002 既有行 `UPDATE user_id=1` 归主，不丢数据。
- 三方言迁移：sqlite ALTER ADD COLUMN + DEFAULT + 索引可移植；mysql/pg 同形。`_oj_migrations` 账本登记。
- 测试点：A push 后 B 列表不可见；B `markRead(id)`→403；`markReadFor(id, wrongUser)`→403；广播一行全员可见且各自已读独立；`oj schema diff` 无漂移。

## 7. 版本

锁步包 runtime/cli/editor-standalone/kit：0.1.16 → 0.1.17；core 对齐 0.1.13 → 0.1.17（如锁步惯例要求）。

## 8. 可选增强（非 v1）

- 铃 UI 按 `category` 分 tab（通知/私信/@我占位）；`link` 点击跳转。
- 广播 HTTP 端点加角色/空间鉴权（v1 仅 Bearer，发送方自担收件人过滤）。
