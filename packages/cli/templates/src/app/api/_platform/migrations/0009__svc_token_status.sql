-- v0.1.132 SvcGate/rotate 契约列：status（active/superseded，缺省 active）+ grace_until（epoch 秒）。
-- 历史行无该列，回填 status='active'、grace_until=0（存量即有效、无宽限）。
-- 与 schema.yaml 列名一致（改列须三处同步：migrations/0009 / schema.yaml / domain/bot.ts）。
ALTER TABLE oj_svc_token ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE oj_svc_token ADD COLUMN grace_until INTEGER NOT NULL DEFAULT 0;
