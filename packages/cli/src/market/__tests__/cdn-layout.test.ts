// market CDN 布局 spec（T2）：cdn 目录与 `/cdn` 基址的单一真相。
//
// 逐条钉死「不许硬编码」——config 里的主机 / 端口 / 挂载路径任一改动，解析结果必须跟随。
// 之所以值得单独一组用例：dev 形态下 `/cdn` 只在 oj 子进程（9778）上成立，
// 一旦有人图省事写相对路径或硬编码端口，市场页拿到的会是 index.html 而不是 YAML
// （设计 §3.1.1）。合规与否由这组用例兜住，而不是靠注释提醒。
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CDN_MOUNT_PREFIX, resolveCdnLayout, resolveCdnLayoutFromConfig } from "../cdn-layout";

// 绝对路径：真实调用里 configPath 是绝对的，这里不能拿相对路径假装（否则 path.resolve 会相对 cwd 解析）
const PROJECT = resolve("proj", "my-app");
const CONFIG_PATH = join(PROJECT, "api", "config.yaml");

/** 拼一份 config：默认端口与主机取自模板实际值 */
function configOf(mounts: string, server = "  host: 127.0.0.1\n  port: 9778"): string {
	return `mounts:\n${mounts}server:\n${server}\n`;
}

const STD_MOUNTS = "  - prefix: /api\n    api: src\n  - prefix: /cdn\n    web: ../cdn\n";

describe("resolveCdnLayoutFromConfig：一切取值都跟随 config", () => {
	it("given 模板默认挂载 When 解析 Then 目录在工程根 cdn/、基址无尾斜杠", () => {
		const layout = resolveCdnLayoutFromConfig(configOf(STD_MOUNTS), CONFIG_PATH);

		expect(layout.dir).toBe(join(PROJECT, "cdn"));
		expect(layout.prefix).toBe(CDN_MOUNT_PREFIX);
		expect(layout.baseUrl).toBe("http://127.0.0.1:9778/cdn");
	});

	it("given server.port 改成 9799 When 解析 Then 基址端口跟随（不硬编码 9778）", () => {
		const layout = resolveCdnLayoutFromConfig(configOf(STD_MOUNTS, "  host: 127.0.0.1\n  port: 9799"), CONFIG_PATH);

		expect(layout.baseUrl).toBe("http://127.0.0.1:9799/cdn");
	});

	it("given server.host 改成 127.0.0.2 When 解析 Then 基址主机跟随", () => {
		const layout = resolveCdnLayoutFromConfig(configOf(STD_MOUNTS, "  host: 127.0.0.2\n  port: 9778"), CONFIG_PATH);

		expect(layout.baseUrl).toBe("http://127.0.0.2:9778/cdn");
	});

	it("given 挂载的 web 改成 ../static-cdn When 解析 Then 目录跟随（单一真相在 config）", () => {
		const mounts = "  - prefix: /cdn\n    web: ../static-cdn\n";

		const layout = resolveCdnLayoutFromConfig(configOf(mounts), CONFIG_PATH);

		expect(layout.dir).toBe(join(PROJECT, "static-cdn"));
	});

	it("given 挂载前缀带尾斜杠 When 解析 Then 前缀归一化掉尾斜杠（拼接口径统一）", () => {
		const mounts = "  - prefix: /cdn/\n    web: ../cdn\n";

		const layout = resolveCdnLayoutFromConfig(configOf(mounts), CONFIG_PATH);

		expect(layout.prefix).toBe(CDN_MOUNT_PREFIX);
		expect(layout.baseUrl).toBe("http://127.0.0.1:9778/cdn");
	});
});

describe("resolveCdnLayoutFromConfig：出错要给得出手", () => {
	it("given mounts 里没有 /cdn 条目 When 解析 Then 抛错且给出要粘回 config 的两行", () => {
		const mounts = "  - prefix: /api\n    api: src\n";

		expect(() => resolveCdnLayoutFromConfig(configOf(mounts), CONFIG_PATH)).toThrow(/cdn/);

		try {
			resolveCdnLayoutFromConfig(configOf(mounts), CONFIG_PATH);
		}
		catch (error) {
			// 人话错误里必须给出可直接粘贴的挂载声明，而不是只抱怨
			expect(String(error)).toContain("prefix: /cdn");
			expect(String(error)).toContain("web: ../cdn");
		}
	});

	it("given server.port 缺失 When 解析 Then 抛人话错误（与 oj-config.readOjPort 同口径）", () => {
		expect(() => resolveCdnLayoutFromConfig(configOf(STD_MOUNTS, "  host: 127.0.0.1"), CONFIG_PATH)).toThrow(/server\.port/);
	});
});

describe("resolveCdnLayout：从工程根出发", () => {
	it("given 一个带 api/config.yaml 的工程 When 解析 Then 与文本版结果一致", () => {
		const root = mkdtempSync(join(tmpdir(), "ojm-cdn-layout-"));
		mkdirSync(join(root, "api"), { recursive: true });
		writeFileSync(join(root, "api", "config.yaml"), configOf(STD_MOUNTS), "utf-8");

		const layout = resolveCdnLayout(root);

		expect(layout.dir).toBe(join(root, "cdn"));
		expect(layout.baseUrl).toBe("http://127.0.0.1:9778/cdn");
	});
});
