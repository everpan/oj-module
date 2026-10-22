// 版本比较（镜像 oj-module _lifecycle/semver 的最小口径，前端本地副本——宿主 semver 在
// 服务端隔离层，前端不可 import；点分/连字符预发布字段逐段数值比）。返回 <0 / 0 / >0。
// 用途：双版本卡片 upgradable 对比展示 + 回滚候选过滤（候选 = 版本 < 已装版本）。
export function compareVersions(a: string, b: string): number {
	const pa = String(a).split(/[.\-]/).map(x => Number.parseInt(x, 10) || 0);
	const pb = String(b).split(/[.\-]/).map(x => Number.parseInt(x, 10) || 0);
	const n = Math.max(pa.length, pb.length);
	for (let i = 0; i < n; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0)
			return d < 0 ? -1 : 1;
	}
	return 0;
}
