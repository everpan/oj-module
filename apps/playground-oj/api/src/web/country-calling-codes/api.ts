// GET /api/web/country-calling-codes —— 静态常量端点（F9 演示：对齐根仓 fake/constants.ts
// 的 COUNTRIES_CODE 覆盖面，但本工程无消费方，仅作 fake→oj 迁移的对照演示）。
// 注：根仓 COUNTRIES_CODE 共 240 条；此处取常用子集（教学演示足够，形状一致 {cn,en,code}）。
const COUNTRIES_CODE = [
	{ cn: "中国", en: "China", code: 86 },
	{ cn: "中国香港", en: "Hong Kong", code: 852 },
	{ cn: "中国台湾", en: "Taiwan", code: 886 },
	{ cn: "中国澳门", en: "Macau", code: 853 },
	{ cn: "美国", en: "United States", code: 1 },
	{ cn: "日本", en: "Japan", code: 81 },
	{ cn: "新加坡", en: "Singapore", code: 65 },
	{ cn: "加拿大", en: "Canada", code: 1 },
	{ cn: "澳大利亚", en: "Australia", code: 61 },
	{ cn: "英国", en: "United Kingdom", code: 44 },
	{ cn: "马来西亚", en: "Malaysia", code: 60 },
	{ cn: "韩国", en: "South Korea", code: 82 },
	{ cn: "泰国", en: "Thailand", code: 66 },
	{ cn: "法国", en: "France", code: 33 },
	{ cn: "德国", en: "Germany", code: 49 },
	{ cn: "俄罗斯", en: "Russia", code: 7 },
	{ cn: "意大利", en: "Italy", code: 39 },
	{ cn: "西班牙", en: "Spain", code: 34 },
	{ cn: "印度", en: "India", code: 91 },
	{ cn: "巴西", en: "Brazil", code: 55 },
	{ cn: "越南", en: "Vietnam", code: 84 },
	{ cn: "菲律宾", en: "Philippines", code: 63 },
	{ cn: "印度尼西亚", en: "Indonesia", code: 62 },
	{ cn: "新西兰", en: "New Zealand", code: 64 },
	{ cn: "南非", en: "South Africa", code: 27 },
	{ cn: "墨西哥", en: "Mexico", code: 52 },
	{ cn: "土耳其", en: "Turkey", code: 90 },
	{ cn: "荷兰", en: "Netherlands", code: 31 },
	{ cn: "瑞士", en: "Switzerland", code: 41 },
	{ cn: "瑞典", en: "Sweden", code: 46 },
];

export default {
	get() {
		json.ok(COUNTRIES_CODE);
	},
};
