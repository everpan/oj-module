-- 0001__publish_credential（sqlite 方言）：发布凭证表。
--
-- 定性：**共享表**（schema.yaml `tenant: false` + config.yaml `tenant.shared_allow` 双声明）。
-- 理由：兑换是 CLI 发起的，那一刻没有业务租户上下文；建成租户表会让 sql_guard: deny 给
-- 按 token_hash 的查询强加 tenant_id 过滤，换个租户头就查不到。租户归属由 owner_tenant
-- 显式承载（命名同 wecom_login_ticket：共享表出现 tenant_id 会被定性红线判为自相矛盾）。
--
-- 语义：
--   · 一次性兑换令牌：兑换成功后 used=1，再兑即拒；未兑换前可用 revoked 手动作废
--   · key_id 在**申请时**就算好落库，兑换只回读——CLI 不实现任何编码规则（单一真源）
--   · 只存 token_hash（sha256），明文只在申请响应里出现一次
--
-- 主键用自增 id 而非 token_hash：列表分页与撤销都按行 id 操作（pagedFactory 也按 id 排序），
-- 用 hash 做主键会让这两件事都得先算 hash 再反查。token_hash 仍唯一。
CREATE TABLE IF NOT EXISTS publish_credential (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  uid INTEGER NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  product TEXT NOT NULL,
  key_id TEXT NOT NULL,
  owner_tenant TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_ip TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_publish_credential_token ON publish_credential (token_hash);

-- 「发布管理」页的主查询：按租户 + 本人 + 时间倒序
CREATE INDEX IF NOT EXISTS idx_publish_credential_owner
  ON publish_credential (owner_tenant, uid, created_at);

-- 撞号检查（同 key_id 是否已属于别人）
CREATE INDEX IF NOT EXISTS idx_publish_credential_key ON publish_credential (key_id);
