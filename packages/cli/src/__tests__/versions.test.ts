import { describe, expect, it } from "vitest";

import { hostArtifactFreshnessError } from "../versions";

describe("hostArtifactFreshnessError（源码形态宿主产物过期守卫）", () => {
	it("版本一致 → 通过", () => {
		expect(hostArtifactFreshnessError("0.2.11", "0.2.11")).toBeUndefined();
	});

	it("任一侧缺失 → 跳过守卫", () => {
		expect(hostArtifactFreshnessError(undefined, "0.2.11")).toBeUndefined();
		expect(hostArtifactFreshnessError("0.2.11", undefined)).toBeUndefined();
	});

	it("宿主产物落后于 workspace runtime → 报真因并指向 build:shell", () => {
		const err = hostArtifactFreshnessError("0.2.10", "0.2.11");
		expect(err).toContain("shell-dist/versions.json）过期");
		expect(err).toContain("0.2.10");
		expect(err).toContain("0.2.11");
		expect(err).toContain("build:shell");
	});

	it("宿主产物领先（跨仓消费旧版 runtime）→ 同样拦截", () => {
		expect(hostArtifactFreshnessError("0.2.12", "0.2.11")).toContain("过期");
	});
});
