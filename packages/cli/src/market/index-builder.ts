/**
 * Form B 索引聚合（T4）：把「一批已扫出的包」变成 bundles.yaml / manifests.yaml 的数据形状。
 *
 * 纯数据变换，不落 IO、不签名——IO 与签名归 `build-index.ts`。形状严格对齐安装侧的消费口径
 * （`market/api.ts resolveCdn`）：`file` 必须逐字 `<name>-<version>.tgz`，否则安装侧 P2-11 会
 * 判索引投毒直接 502。
 */

import type { YankEntry } from "./yank-ledger";

export interface IndexedPackage {
	name: string
	version: string
	/** tgz 文件名（由 name+version 派生，逐字约束在此处一次成型） */
	file: string
	sha256: string
	size: number
	/** 包内 manifest（Form A），入 manifests.yaml 时补成 Form B */
	manifest: Record<string, unknown>
	/** 包级 detached 签名（`<tgz>.sig` 五字段）；缺则 Form B 不带 signature，安装侧按 sig_missing 拒装 */
	signature?: Record<string, unknown>
}

export interface BuiltIndex {
	bundles: { solutions: Array<Record<string, unknown>> }
	manifests: Array<Record<string, unknown>>
}

/**
 * 聚合索引数据。
 *
 * `yanked?`：yank 账本（`name@version -> 条目`，REG-CS4）。非零时：
 * - 各版本条目带 `yanked: true` + `yanked_at`（epoch 秒），安装侧 resolveCdn 据此拒精确安装；
 * - 该方案的 `latest` 跳过已下线版本（全部下线则降级取最高版，保证索引不空）。
 */
export function buildIndexData(packages: IndexedPackage[], yanked?: Map<string, YankEntry>): BuiltIndex {
	const byName = new Map<string, IndexedPackage[]>();
	for (const pkg of packages) {
		const list = byName.get(pkg.name) ?? [];
		list.push(pkg);
		byName.set(pkg.name, list);
	}

	const solutions: Array<Record<string, unknown>> = [];
	const manifests: Array<Record<string, unknown>> = [];
	for (const name of [...byName.keys()].sort()) {
		const list = [...byName.get(name)!].sort((a, b) => compareSemver(a.version, b.version));
		// latest 跳过 yanked（REG-CS4）：已下线的版本绝不成为默认升级目标；全下线降级取最高版
		const live = list.filter(v => !isYanked(yanked, name, v.version));
		const latestSource = live.length > 0 ? live : list;
		solutions.push({
			name,
			latest: latestSource[latestSource.length - 1]!.version,
			versions: list.map((v) => {
				const key = yanked !== undefined && isYanked(yanked, name, v.version)
					? { yanked: true, yanked_at: yanked.get(`${name}@${v.version}`)!.at }
					: {};
				return { file: `${v.name}-${v.version}.tgz`, sha256: v.sha256, size: v.size, version: v.version, ...key };
			}),
		});
		for (const pkg of list) {
			const file = `${name}-${pkg.version}.tgz`;
			manifests.push({
				...pkg.manifest,
				name,
				version: pkg.version,
				archive: {
					file,
					sha256: pkg.sha256,
					size: pkg.size,
					...(pkg.signature === undefined ? {} : { signature: pkg.signature }),
				},
			});
		}
	}
	return { bundles: { solutions }, manifests };
}

function isYanked(yanked: Map<string, YankEntry> | undefined, name: string, version: string): boolean {
	return yanked !== undefined && yanked.has(`${name}@${version}`);
}

/**
 * semver 比较（与模板 `_lifecycle/semver.ts` 同源算法；prerelease 遵循 semver 2.0.0）：
 * 数字标识符按数值、字母按字典序、数字 < 字母、标识符列表前缀相等时多者大；无 prerelease > 有 prerelease。
 * 取代旧版纯数值比较（旧版对 `1.0.0-rc.1` 这类预发布版本按 `1.0.0.0` 处理，latest 计算失真——
 * S2-0 红队 F 相关预发布序修复）。返回 -1|0|1，可直接作 Array.sort 比较器。
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
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

/** 兼容旧名（过渡期别名；新调用请用 compareSemver） */
export const compareVersion = compareSemver;

function splitVersion(v: string): { core: number[], pre: string[] | null } {
	const hyphen = v.indexOf("-");
	const core = hyphen === -1 ? v : v.slice(0, hyphen);
	const prePart = hyphen === -1 ? null : v.slice(hyphen + 1);
	return {
		core: core.split(".").map(seg => Number.parseInt(seg, 10) || 0),
		pre: prePart == null ? null : prePart.split("."),
	};
}

function comparePrerelease(a: string[] | null, b: string[] | null): -1 | 0 | 1 {
	if (a === null || b === null) {
		return a === b ? 0 : a === null ? 1 : -1;
	}
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const ia = a[i];
		const ib = b[i];
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
			return na ? -1 : 1;
		}
		else if (ia !== ib) {
			return ia < ib ? -1 : 1;
		}
	}
	return 0;
}
