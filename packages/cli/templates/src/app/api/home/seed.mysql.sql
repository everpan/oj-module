-- 方言覆盖（mysql）：INSERT OR IGNORE → INSERT IGNORE，语句与基础件逐条对应。
-- home 模块种子（P4-1）。按分号朴素切分（S006）。
-- home_pie：五分类（code 对齐前端 DATA_KEY），幂等 INSERT OR IGNORE。
INSERT IGNORE INTO home_pie (category, value) VALUES ('electronics', 320);
INSERT IGNORE INTO home_pie (category, value) VALUES ('home_goods', 210);
INSERT IGNORE INTO home_pie (category, value) VALUES ('apparel_accessories', 180);
INSERT IGNORE INTO home_pie (category, value) VALUES ('food_beverages', 150);
INSERT IGNORE INTO home_pie (category, value) VALUES ('beauty_skincare', 95);

-- home_line：日窗口序列（day = epoch-day，种子围绕"当前日期"生成，约 60 天窗口）。
-- 刻意缺 today-30 / today-12 两天，演示"缺哪天补哪天"——handler 在窗口内对缺失日补 0；
-- 若整个窗口无 seed（seed 随时间变旧），handler 回落确定式趋势兜底（懒补数）。
INSERT IGNORE INTO home_line (day, value) VALUES (20640, 181);
INSERT IGNORE INTO home_line (day, value) VALUES (20641, 190);
INSERT IGNORE INTO home_line (day, value) VALUES (20642, 199);
INSERT IGNORE INTO home_line (day, value) VALUES (20643, 208);
INSERT IGNORE INTO home_line (day, value) VALUES (20644, 217);
INSERT IGNORE INTO home_line (day, value) VALUES (20645, 226);
INSERT IGNORE INTO home_line (day, value) VALUES (20646, 235);
INSERT IGNORE INTO home_line (day, value) VALUES (20647, 244);
INSERT IGNORE INTO home_line (day, value) VALUES (20648, 253);
INSERT IGNORE INTO home_line (day, value) VALUES (20649, 262);
INSERT IGNORE INTO home_line (day, value) VALUES (20650, 271);
INSERT IGNORE INTO home_line (day, value) VALUES (20651, 280);
INSERT IGNORE INTO home_line (day, value) VALUES (20652, 289);
INSERT IGNORE INTO home_line (day, value) VALUES (20653, 298);
INSERT IGNORE INTO home_line (day, value) VALUES (20654, 100);
INSERT IGNORE INTO home_line (day, value) VALUES (20655, 109);
INSERT IGNORE INTO home_line (day, value) VALUES (20656, 118);
INSERT IGNORE INTO home_line (day, value) VALUES (20657, 127);
INSERT IGNORE INTO home_line (day, value) VALUES (20658, 136);
INSERT IGNORE INTO home_line (day, value) VALUES (20659, 145);
INSERT IGNORE INTO home_line (day, value) VALUES (20660, 154);
INSERT IGNORE INTO home_line (day, value) VALUES (20661, 163);
INSERT IGNORE INTO home_line (day, value) VALUES (20662, 172);
INSERT IGNORE INTO home_line (day, value) VALUES (20663, 181);
INSERT IGNORE INTO home_line (day, value) VALUES (20664, 190);
INSERT IGNORE INTO home_line (day, value) VALUES (20665, 199);
INSERT IGNORE INTO home_line (day, value) VALUES (20666, 208);
INSERT IGNORE INTO home_line (day, value) VALUES (20667, 217);
INSERT IGNORE INTO home_line (day, value) VALUES (20668, 226);
INSERT IGNORE INTO home_line (day, value) VALUES (20669, 235);
INSERT IGNORE INTO home_line (day, value) VALUES (20671, 253);
INSERT IGNORE INTO home_line (day, value) VALUES (20672, 262);
INSERT IGNORE INTO home_line (day, value) VALUES (20673, 271);
INSERT IGNORE INTO home_line (day, value) VALUES (20674, 280);
INSERT IGNORE INTO home_line (day, value) VALUES (20675, 289);
INSERT IGNORE INTO home_line (day, value) VALUES (20676, 298);
INSERT IGNORE INTO home_line (day, value) VALUES (20677, 100);
INSERT IGNORE INTO home_line (day, value) VALUES (20678, 109);
INSERT IGNORE INTO home_line (day, value) VALUES (20679, 118);
INSERT IGNORE INTO home_line (day, value) VALUES (20680, 127);
INSERT IGNORE INTO home_line (day, value) VALUES (20681, 136);
INSERT IGNORE INTO home_line (day, value) VALUES (20682, 145);
INSERT IGNORE INTO home_line (day, value) VALUES (20683, 154);
INSERT IGNORE INTO home_line (day, value) VALUES (20684, 163);
INSERT IGNORE INTO home_line (day, value) VALUES (20685, 172);
INSERT IGNORE INTO home_line (day, value) VALUES (20686, 181);
INSERT IGNORE INTO home_line (day, value) VALUES (20687, 190);
INSERT IGNORE INTO home_line (day, value) VALUES (20689, 208);
INSERT IGNORE INTO home_line (day, value) VALUES (20690, 217);
INSERT IGNORE INTO home_line (day, value) VALUES (20691, 226);
INSERT IGNORE INTO home_line (day, value) VALUES (20692, 235);
INSERT IGNORE INTO home_line (day, value) VALUES (20693, 244);
INSERT IGNORE INTO home_line (day, value) VALUES (20694, 253);
INSERT IGNORE INTO home_line (day, value) VALUES (20695, 262);
INSERT IGNORE INTO home_line (day, value) VALUES (20696, 271);
INSERT IGNORE INTO home_line (day, value) VALUES (20697, 280);
INSERT IGNORE INTO home_line (day, value) VALUES (20698, 289);
INSERT IGNORE INTO home_line (day, value) VALUES (20699, 298);
INSERT IGNORE INTO home_line (day, value) VALUES (20700, 100);
