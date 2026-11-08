# 企微登录用户头像同步（方案 A：下载转存 data URL）

- 日期：2026-11-08
- 分支：feat/wecom-avatar-sync
- 依赖分支：fix/my-profile-username-readonly（8612ce792，已提交）

## 需求

企业微信登录/同步的用户，把企微头像同步到本地 `users.avatar_base64`，让 header 与个人中心头像有真实图源。已确认采用方案 A：服务端下载企微头像字节 → data URL 存库（与上传通道同形态，自包含不裂图）。

## 设计

- `client.ts`：`WecomMember` + `avatar`（toMember 从回包 `avatar` 字段映射）；`WecomHttp` + `getBytes`（runtimeHttp 用 fetch + 软超时实现，image/* 校验 + 5MB 上限）；client + `avatarBytes(url)`（best-effort，失败返回 null）。
- `login.ts`：`MemberDetail` + `avatar?: string | null`（undefined=没给，不写——沿用现有字段纪律）；`applyMemberDetail` opts + `fetchAvatar`，**补缺不覆盖**：仅当本地 `avatar_base64` 为空才下载写回（用户自己上传的头像不被 24h 登录同步冲掉）；写回走既有 cols 批更新，WHERE 已含 `source='wecom'`（D13 天然成立）。
- 三轨接线：selfUpdate（deps.client）/ sync.ts applyMember（补 client 参数）/ contacts.ts applyUserEvent（ctx.client）。事件轨 memberFromEvent 不带 avatar → undefined → 不写。
- base64 编码抽出共享 `_platform/_shared/base64.ts`，upload/api.ts 去本地副本（DRY）。
- user-info 原样返回 avatar 字符串，前端 Avatar src 直接渲染 data URL，无需改前端。

## 已知限制

- 补缺不覆盖：用户企微侧换头像后，若本地已有头像（含自己上传的），不会自动跟进——除非清空后等登录同步/全量同步补。accepted（避免覆盖用户自选头像）。
- 全量同步首批会为每个无头像成员各下载一次图（管理员触发、分片有 12s 预算，可续跑）。
- 头像下载失败静默跳过（best-effort，不阻塞登录/同步），当次不写节流键以外的重试——登录轨 24h 节流键照写，失败后最长等一个节流窗口或一次全量同步。

## BDD 用例（wecom-org-sync.spec.ts 追加）

| 场景 | Given | When | Then |
| --- | --- | --- | --- |
| 首次同步头像 | wecom 用户 avatar_base64 为空，userDetail 带 avatar URL | selfUpdate | avatar_base64 写为 data:image/... URL，内容=下载字节 |
| 补缺不覆盖 | 本地头像已有值（用户自己上传） | selfUpdate | fetchAvatar 不被调用，原值不动 |
| 下载失败 | fetchAvatar 返回 null | selfUpdate | 头像列保持空，登录不被打断，节流键照写 |
| 非 wecom 行不写 | source='local' 用户同名前缀行 | selfUpdate | 头像不被动（沿用 D13 守卫） |
| toMember 映射 | user/get 回包含 avatar 字段 | client.userDetail | WecomMember.avatar 取到该 URL |

## 任务

- [x] 文档
- [x] BDD 用例（先红：D-AV1 首次同步 / D-AV6 toMember 映射 两条行为用例先失败）
- [x] 实现 client.ts / login.ts / sync.ts / contacts.ts / base64 共享
- [x] 测试绿 + lint + typecheck

## 编码中发现的问题

- 反常识：测试环境 eslint 禁 `Buffer` 全局（`node/prefer-global/buffer`）。base64 期望值直接钉常量（4 字节 PNG → `iVBORw==`），比引入 require("buffer") 干净。
- `WecomHttp` 加成员是**契约级变更**：三处测试桩（org-sync/connector/timeout）必须同步补 `getBytes`，否则 typecheck 红——接口是测试缝，改它要连桩一起改。

## 总结

- 关键过程：先写 6 条 BDD 用例（2 条先红）→ client（getBytes/avatarBytes/toMember 映射）→ applyMemberDetail 补缺不覆盖分支 → 三轨接线 → base64 抽共享（upload 去本地副本）→ 全量绿。
- 验证：templates 全套 1184 passed；tsc / eslint / circular-deps 通过。
- 耗时：约 35 分钟。
