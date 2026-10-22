-- sys_setting 补 group_label_key mysql 方言覆盖（0002/0003 先例同型：TEXT 可空列与基线同语法）。
ALTER TABLE sys_setting ADD COLUMN group_label_key TEXT;
