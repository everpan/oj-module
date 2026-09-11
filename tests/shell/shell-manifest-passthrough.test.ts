import { describe, expect, it } from "vitest";

import { extractRuntimeVersion, toLoaderManifest } from "../../packages/cli/shell/src/manifest";

/**
 * P7.7 / 评审 F1+F2：宿主不得裁剪 modules.json 字段——enabled（US-9 下线）、
 * peerRuntime（US-5 版本门禁）、dependencies 必须原样透传给 loadAll。
 */
describe("清单字段透传（P7.7）", () => {
	it("enabled / dependencies / peerRuntime 原样保留", () => {
		const manifest = toLoaderManifest([
			{
				name: "order",
				entry: "/modules/order/1.0.0/entry.js",
				enabled: false,
				dependencies: ["system"],
				peerRuntime: "^1.0.0",
				css: ["/modules/order/1.0.0/style.css"],
				chunks: [{ url: "/modules/order/1.0.0/entry.js", integrity: "sha384-x", lazy: false }],
			},
		], "1.2.0");

		expect(manifest.runtimeVersion).toBe("1.2.0");
		expect(manifest.modules).toEqual([
			{
				name: "order",
				entry: "/modules/order/1.0.0/entry.js",
				enabled: false,
				dependencies: ["system"],
				peerRuntime: "^1.0.0",
			},
		]);
	});

	it("extractRuntimeVersion 从 versions.json 提取 runtime 版本", () => {
		expect(extractRuntimeVersion({ "@oj-module/runtime": "1.2.0", "react": "19.2.8" })).toBe("1.2.0");
		expect(extractRuntimeVersion(null)).toBeUndefined();
		expect(extractRuntimeVersion({})).toBeUndefined();
	});
});
