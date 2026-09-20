/**
 * 最小 semver 范围判定（v1 直蒸）：覆盖 peerRuntime 形态子集——精确版、
 * "^x.y.z"、"~x.y.z"、">=a <b" 空格合取、"*"。超纲形态一律 false（拒绝加载
 * 并显式报错，比静默放行安全）。
 */

interface Semver {
	major: number
	minor: number
	patch: number
}

function parse(version: string): Semver | null {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (!match)
		return null;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function cmp(a: Semver, b: Semver): number {
	return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function satisfiesComparator(v: Semver, comparator: string): boolean {
	const match = /^(>=|<=|[><^~])?(\d+\.\d+\.\d+)$/.exec(comparator.trim());
	if (!match)
		return false;
	const [, op = "", raw] = match;
	const target = parse(raw!)!;
	switch (op) {
		case "":
			return cmp(v, target) === 0;
		case ">=":
			return cmp(v, target) >= 0;
		case "<=":
			return cmp(v, target) <= 0;
		case ">":
			return cmp(v, target) > 0;
		case "<":
			return cmp(v, target) < 0;
		case "^":
			return cmp(v, target) >= 0 && v.major === target.major;
		case "~":
			return cmp(v, target) >= 0 && v.major === target.major && v.minor === target.minor;
		default:
			return false;
	}
}

/** version 是否满足 range（空格分隔的多个比较符为合取） */
export function satisfiesSemver(version: string, range: string): boolean {
	const v = parse(version);
	if (!v)
		return false;
	const trimmed = range.trim();
	if (trimmed === "*" || trimmed === "")
		return true;
	return trimmed.split(/\s+/).every(part => satisfiesComparator(v, part));
}
