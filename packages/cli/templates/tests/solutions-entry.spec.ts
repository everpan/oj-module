// BDD：system 域「方案安装」入口（Phase B T3）——市场 UI 出厂未装，superadmin 经
// /system/solutions 首装。页面本身只做 query + 渲染，真正会回归的是状态推导：
// 目录行有无 / 装没装 / 任务终态映射，故这里测纯函数（roles-page.spec 同范式）。
import { describe, expect, it } from "vitest";

import { marketEntryOf, taskOutcomeOf } from "../src/app/web/system/pages/solutions/market-entry";

const ROW = { name: "oj-market", latest: "0.2.0", installed: null as string | null, upgradable: false };

describe("方案安装入口：市场包状态推导", () => {
	it("目录无 oj-market 行 → absent（出厂未装且目录未回填）", () => {
		expect(marketEntryOf([])).toEqual({ kind: "absent" });
		expect(marketEntryOf([{ ...ROW, name: "wiki" }])).toEqual({ kind: "absent" });
	});

	it("目录有行未装 → installable（携带目录最新版）", () => {
		expect(marketEntryOf([ROW])).toEqual({ kind: "installable", latest: "0.2.0" });
	});

	it("已装 → installed（携带已装版/目录最新版/可升级位）", () => {
		expect(marketEntryOf([{ ...ROW, installed: "0.2.0" }])).toEqual({ kind: "installed", installed: "0.2.0", latest: "0.2.0", upgradable: false });
	});

	it("已装且目录有新版 → upgradable=true（市场内升级提示）", () => {
		expect(marketEntryOf([{ ...ROW, latest: "0.3.0", installed: "0.2.0", upgradable: true }])).toEqual({ kind: "installed", installed: "0.2.0", latest: "0.3.0", upgradable: true });
	});

	it("不改入参（useQuery 缓存对象不能被就地改写）", () => {
		const list = [ROW, { ...ROW, name: "wiki" }];
		const before = list.map(r => r.name);
		marketEntryOf(list);
		expect(list.map(r => r.name)).toEqual(before);
	});
});

describe("方案安装入口：任务终态映射（needs_trust 是非成功态）", () => {
	const REC = { status: "running", progress: 40, message: "deploying" };

	it("running → running（携带进度与阶段消息）", () => {
		expect(taskOutcomeOf(REC)).toEqual({ kind: "running", progress: 40, message: "deploying" });
	});

	it("done → done", () => {
		expect(taskOutcomeOf({ ...REC, status: "done" })).toEqual({ kind: "done" });
	});

	it("needs_trust → needsTrust（发布方 key 待 TOFU 确认——不得按成功渲染）", () => {
		expect(taskOutcomeOf({ ...REC, status: "needs_trust" })).toEqual({ kind: "needsTrust" });
	});

	it("failed/partial → failed（人话取任务 message）", () => {
		expect(taskOutcomeOf({ ...REC, status: "failed", message: "验签失败" })).toEqual({ kind: "failed", message: "验签失败" });
		expect(taskOutcomeOf({ ...REC, status: "partial", message: "锁后失败" })).toEqual({ kind: "failed", message: "锁后失败" });
	});
});
