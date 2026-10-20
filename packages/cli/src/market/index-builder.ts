/**
 * Form B 索引聚合（T4）：把「一批已扫出的包」变成 bundles.yaml / manifests.yaml 的数据形状。
 *
 * 纯数据变换，不落 IO、不签名——IO 与签名归 `build-index.ts`。形状严格对齐安装侧的消费口径
 * （`market/api.ts resolveCdn`）：`file` 必须逐字 `<name>-<version>.tgz`，否则安装侧 P2-11 会
 * 判索引投毒直接 502。
 */

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

export function buildIndexData(packages: IndexedPackage[]): BuiltIndex {
	const byName = new Map<string, IndexedPackage[]>();
	for (const pkg of packages) {
		const list = byName.get(pkg.name) ?? [];
		list.push(pkg);
		byName.set(pkg.name, list);
	}

	const solutions: Array<Record<string, unknown>> = [];
	const manifests: Array<Record<string, unknown>> = [];
	for (const name of [...byName.keys()].sort()) {
		const list = [...byName.get(name)!].sort((a, b) => compareVersion(a.version, b.version));
		solutions.push({
			name,
			latest: list[list.length - 1]!.version,
			versions: list.map(v => ({ file: `${v.name}-${v.version}.tgz`, sha256: v.sha256, size: v.size, version: v.version })),
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

/** semver 数值比较（够用的子集：只比较 `x.y.z` 的数值段，非数字段按 0 计） */
export function compareVersion(a: string, b: string): number {
	const pa = numeric(a);
	const pb = numeric(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0)
			return diff;
	}
	return 0;
}

function numeric(version: string): number[] {
	return version.replace(/^v/, "").split(".").map(part => Number.parseInt(part, 10) || 0);
}
