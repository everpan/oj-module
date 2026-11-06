-- 0004__market_drop_source_seq（pg 方言）：退役 reg_source_seq 水位表（v4 §四索引机制整建制退役）。
--
-- 定性：签名索引（catalog.yaml + shards/<n>.yaml + 代次水位防回放）随 DB 目录化退役——
-- install 解析/index 卡片/releases 历史全部直读 market_release 表，水位失去消费方。
-- DROP IF EXISTS 幂等：回填/回滚场景重复应用不炸。三方言同形（无方言差异）。
DROP TABLE IF EXISTS reg_source_seq;
