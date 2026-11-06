-- 0005__market_sig_registry（pg 方言）：market_release 补 sig_registry_id 列（v4 §四 A5 增补）。
--
-- 定性：**A5 实施期修正**——安装解析改走 DB 目录行（formBEntryOf 服务端合成 Form B 条目），
-- install verify 段重构包级规范串 `<registry_id>:<name>@<version>:<sha256>` 需要签发方
-- registry 身份；0003 落列时裁定「registry_id 不进合成签名」被本修正取代（DB 行即安装
-- manifest 真源，签名必须可验）。列值 = 上传 .sig 旁车第六字段（上传端点结构校验落列）。
-- 方言差异照 0003 惯例：mysql 收窄 VARCHAR / pg 全 TEXT。
ALTER TABLE market_release ADD COLUMN sig_registry_id TEXT;
