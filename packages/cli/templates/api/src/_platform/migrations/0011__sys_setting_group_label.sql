-- sys_setting 补 group_label_key：方案设置组标题（C2-22 组级 label_key）落库——
-- 前端此前只能按 <module>:settings.group.<group> 惯例推导（P1-14 备案：declOf 丢弃组级
-- label_key），声明键可与惯例不同 → 组标题真实值随注册面回填（P2-15 G7 承载③）。
ALTER TABLE sys_setting ADD COLUMN group_label_key TEXT;
