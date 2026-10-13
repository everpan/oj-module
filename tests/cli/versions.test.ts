import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCliVersion } from "../../packages/cli/src/versions";

describe("readCliVersion", () => {
	it("返回 cli 包的 package.json version（非负版本号串）", () => {
		const expected = JSON.parse(
			readFileSync(join(fileURLToPath(import.meta.url), "../../../packages/cli/package.json"), "utf-8"),
		).version as string;
		const got = readCliVersion();
		expect(got).toBe(expected);
		expect(got).toMatch(/^\d+\.\d+\.\d+/);
	});
});
