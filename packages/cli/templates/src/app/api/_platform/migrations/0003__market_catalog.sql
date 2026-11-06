-- 0003__market_catalog（sqlite 方言）：market_release 扩列演化（v4 DB 目录化）。
--
-- 定性：**表演化，非新建**——market_release 已存在于 0002（四方评审共同指认的 P0 修正：
-- v3 原拟新建同名表照写必炸）。此处仅 ALTER 扩四列，把「签名索引文件派生物」升级为
-- 「签名推送直写的目录真源」：
--   · sig_alg/sig_value/sig_public_key = 上传端点验收的发布签名三字段（Ed25519，
--     与 .sig 侧车同构；canon/key_id 不列存——canonical 由 (registry_id,name,sha256)
--     服务端重算重建，key_id 已有专列）
--   · manifest = 包内嵌 manifest.yaml 抽取物（JSON 文本；安装解析/卡片字段数据源，
--     坏包被 pair 约束挡在库外，见上传端点处理顺序）
--   · published_at 两列保留语义不变；上传写入行 published_at_source='upload'
--   · syncReleases 时代旧行此四列 = NULL，由站点侧扫描回填命令补齐（计划 §六，三用命令）
--
-- 方言差异照 0002 惯例：mysql 收窄 VARCHAR / pg 全 TEXT，见同名 .mysql/.pg 文件。
ALTER TABLE market_release ADD COLUMN sig_alg TEXT;
ALTER TABLE market_release ADD COLUMN sig_value TEXT;
ALTER TABLE market_release ADD COLUMN sig_public_key TEXT;
ALTER TABLE market_release ADD COLUMN manifest TEXT;
