-- 应用来源（0003）：suite = 代开发（服务商模板授权） / corp = 企业内部应用（自建应用）。
--
-- 为什么必须有这一列，而不是靠 `suite_id = ''` 推断：
--   · 查询要按来源筛（取消代开发授权不能顺手停掉同一家企业自建应用的档案）、后台要按来源展示；
--   · 空串是「主键里塞了一个隐式语义」，任何一次手写 SQL 漏判都会把两类行混在一起；
--   · 将来若做「同一企业双应用」，区分只能靠列，不能靠约定。
--
-- 现有行全部是代开发授权产生的，故 DEFAULT 'suite' 即正确的历史归属。
ALTER TABLE wecom_app_profile ADD COLUMN credential_kind TEXT NOT NULL DEFAULT 'suite';
