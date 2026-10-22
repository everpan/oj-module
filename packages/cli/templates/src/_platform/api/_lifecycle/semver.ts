// semver 比较器（R25）：纯字符串解析、无依赖。
// 容错口径：允许缺省段（「1.0」=「1.0.0.0」，缺省视为 0）。
// prerelease 遵循 semver 2.0.0：数字标识符按数值、字母按字典序、数字 < 字母、
// 标识符列表前缀相等时多者大；无 prerelease > 有 prerelease。

function splitVersion(v: string): { core: number[], pre: string[] | null } {
	const hyphen = v.indexOf("-");
	const core = hyphen === -1 ? v : v.slice(0, hyphen);
	const prePart = hyphen === -1 ? null : v.slice(hyphen + 1);
	const coreParts = core.split(".");
	const pre = prePart == null ? null : prePart.split(".");
	return {
		// 容错口径：非数字段（如 "1.0.x" 的 "x"）静默归零，不抛错
		core: coreParts.map(seg => Number.parseInt(seg, 10) || 0),
		pre,
	};
}

function comparePrerelease(a: string[] | null, b: string[] | null): -1 | 0 | 1 {
	// 无 prerelease > 有 prerelease
	if (a === null || b === null) {
		return a === b ? 0 : a === null ? 1 : -1;
	}
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const ia = a[i];
		const ib = b[i];
		// 前缀相等时，标识符多者大
		if (ia === undefined)
			return -1;
		if (ib === undefined)
			return 1;
		const na = /^\d+$/.test(ia);
		const nb = /^\d+$/.test(ib);
		if (na && nb) {
			const diff = Number.parseInt(ia, 10) - Number.parseInt(ib, 10);
			if (diff !== 0)
				return diff < 0 ? -1 : 1;
		}
		else if (na !== nb) {
			// 数字 < 字母
			return na ? -1 : 1;
		}
		else if (ia !== ib) {
			return ia < ib ? -1 : 1;
		}
	}
	return 0;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
	const va = splitVersion(a);
	const vb = splitVersion(b);
	const len = Math.max(va.core.length, vb.core.length);
	for (let i = 0; i < len; i++) {
		const diff = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
		if (diff !== 0)
			return diff < 0 ? -1 : 1;
	}
	return comparePrerelease(va.pre, vb.pre);
}
