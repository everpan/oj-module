import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { checkSharedVersions, readHostVersions, validateSharedVersions } from "../../packages/cli/src/versions";
import { SHELL_DIST_DIR, TEMPLATE_DIR } from "../helpers/paths";

/**
 * P4.5 / C4 / D12：版本矩阵门禁。
 * 宿主 shell 构建时落一份 versions.json（共享表各包实际安装版本）；
 * CLI 加载模块工程前校验：硬共享依赖只能进 devDependencies，且
 * **安装后的实际版本**与宿主严格相等（范围字面量不参与比对）。
 */
describe("shell versions.json（P4.5）", () => {
	it("shell 产物含 versions.json 且共享表硬依赖有实际安装版本", () => {
		const versions = readHostVersions(SHELL_DIST_DIR);
		for (const specifier of ["react", "react-dom", "@tanstack/react-query", "antd"]) {
			expect(typeof versions[specifier], `${specifier} 无版本记录`).toBe("string");
			expect(versions[specifier].startsWith("^"), `${specifier} 应记录实际版本而非范围`).toBe(false);
		}
	});
});

describe("validateSharedVersions 纯校验（P4.5 / C4）", () => {
	const host: Record<string, string> = { react: "19.2.8", antd: "6.6.1" };

	it("devDeps 且安装版本与宿主一致 → 通过", () => {
		const errors = validateSharedVersions(
			{ devDependencies: { react: "^19.2.6", antd: "^6.4.2" } },
			host,
			spec => host[spec],
		);
		expect(errors).toEqual([]);
	});

	it("硬共享依赖出现在 dependencies → 拒绝", () => {
		const errors = validateSharedVersions(
			{ dependencies: { react: "*" } },
			host,
			() => undefined,
		);
		expect(errors.join("\n")).toMatch(/dependencies/);
	});

	it("安装版本与宿主不一致 → 拒绝并打印期望值", () => {
		const errors = validateSharedVersions(
			{ devDependencies: { react: "^18.0.0" } },
			host,
			spec => (spec === "react" ? "18.3.1" : undefined),
		);
		expect(errors.join("\n")).toMatch(/严格相等/);
		expect(errors.join("\n")).toContain("19.2.8");
	});
});

describe("checkSharedVersions 集成（P4.5）", () => {
	it("模板工程（monorepo 安装版本与宿主同源）通过", () => {
		expect(() => checkSharedVersions(TEMPLATE_DIR, SHELL_DIST_DIR)).not.toThrow();
	});

	it("宿主缺 versions.json 显式报错（防止静默跳过门禁）", () => {
		expect(() => checkSharedVersions(TEMPLATE_DIR, path.join(SHELL_DIST_DIR, "nonexistent")))
			.toThrow();
	});
});

describe("门禁与实际安装一致性（P4.5）", () => {
	it("模板工程 node_modules 中 react 实际版本与宿主一致", () => {
		const host = readHostVersions(SHELL_DIST_DIR);
		const installed = JSON.parse(
			fs.readFileSync(path.join(TEMPLATE_DIR, "node_modules/react/package.json"), "utf-8"),
		);
		expect(installed.version).toBe(host.react);
	});
});
