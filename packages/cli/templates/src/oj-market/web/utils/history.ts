// 操作历史的安装结论判定（2026-11-08）：market_history.status 是「这个版本装上没有」——
// done = 完整生效；partial = 产物已生效、只差宿主重启；failed / needs_trust / cancelled 都是未成功。
// 历史按 created_at 倒序返回，故「每版本首见即最近一次尝试」；失败版本不应出现在回滚候选里。

import type { MarketHistory } from "../types";

/** 版本键（方案名 + 版本；同一抽屉可能同时展示多个方案，版本号会撞） */
export function versionKey(h: Pick<MarketHistory, "solution" | "version">): string {
	return `${h.solution}@${h.version}`;
}

/** 该条安装记录是否算「装上了」（partial 仅差重启，产物已生效） */
export function installSucceeded(h: MarketHistory): boolean {
	return h.status === "done" || h.status === "partial";
}

/** 每版本最近一次 install 记录（入参须为时间倒序；首见即最新） */
export function latestInstallByVersion(rows: MarketHistory[]): Map<string, MarketHistory> {
	const map = new Map<string, MarketHistory>();
	for (const h of rows) {
		const key = versionKey(h);
		if (h.action === "install" && !map.has(key))
			map.set(key, h);
	}
	return map;
}

/**
 * 该行是否可删除（未安装成功的版本）：仅 install 动作、**该行就是该版本最近一次尝试**（按钮只出一次，
 * 不随失败次数重复）、最近一次尝试未成功、且不是当前已装版本。
 * 服务端仍会再校验（曾成功/当前生效/平台内置一律拒），前端只决定按钮是否出现。
 */
export function canPurgeHistory(h: MarketHistory, latest: Map<string, MarketHistory>, installed: string | undefined): boolean {
	if (h.action !== "install" || h.version === installed)
		return false;
	const last = latest.get(versionKey(h));
	return last !== undefined && last.id === h.id && !installSucceeded(last);
}
