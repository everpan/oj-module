-- 企微组织架构同步（B2）：授权模式快照 + 同步任务 / 抢锁。
--
-- auth_mode 存在 profile 上而不是部署常量：它由 get_permanent_code 在「企业授权」时刻返回，
-- 是 (suite, corp, agent) 三元组的属性。**成员授权（1）下应用无任何部门权限**，通讯录类接口
-- 一律 60011（方案 §2.3），所以它是同步入口的准入判据——400 拒绝，而不是跑成一片 60011。
--
-- 两张同步表都是**租户表**（不进 config.yaml 的 tenant.shared_allow）：同步只在调用方自己的
-- 租户内跑（§3 D7），跨租户只由 superadmin 面读元数据，且那也走显式 tenant_id 的裸 SQL。
--
-- 抢锁用「复合主键插入」：INSERT 撞唯一约束是唯一可靠的原子判据。反过来用 status='running'
-- 的读改写会留下竞态窗口，而 affected-rows 在三方言口径不一致、不能用来判成败（SKILL.md）。
ALTER TABLE wecom_app_profile ADD COLUMN auth_mode INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS wecom_sync_job (
  tenant_id TEXT NOT NULL,
  corp_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  -- idle / running / done / failed / cancelled
  status TEXT NOT NULL DEFAULT 'idle',
  -- departments / members / reconcile
  phase TEXT NOT NULL DEFAULT 'departments',
  -- 续跑游标（JSON）：BFS 队列 + 已见部门 + 本轮进度标记。isolate 无定时器，进度只能靠调用方轮询推进
  cursor_text TEXT,
  -- 计数（JSON）：departments / members / deptSkipped / memberSkipped
  stats_text TEXT,
  -- 只存脱敏后的结构化错码，绝不存异常原文（异常里可能夹带 URL 上的 token，§7）
  err_code TEXT,
  err_detail TEXT,
  started_at INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER NOT NULL DEFAULT 0,
  update_time INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
);

CREATE TABLE IF NOT EXISTS wecom_sync_lock (
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, agent_id)
);
