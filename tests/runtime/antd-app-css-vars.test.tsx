import { cleanup, render, waitFor } from "@testing-library/react";
import { theme as antdTheme, ConfigProvider } from "antd";
import { afterEach, describe, expect, it } from "vitest";
import { AntdApp } from "#src/components/antd-app";

/**
 * 设计 [[202609112121-shell-dark-css-vars-design]] US-2 / US-3：
 * runtime AntdApp 负责把 antd token 同步为 :root 上的 `--oo-*` 变量
 * （tailwind 语义色工具类的唯一来源），并挂载 window.$message 等静态函数。
 * shell 宿主链若不用它（误用 antd 原生 App），暗黑模式下变量缺失 →
 * footer 等组件透明露白。
 */

afterEach(() => {
	cleanup();
	document.getElementById("antd-theme-tokens")?.remove();
});

function tokenStyle() {
	return document.getElementById("antd-theme-tokens")?.textContent ?? "";
}

describe("antdApp 主题变量同步（shell 暗黑 footer 修复）", () => {
	it("暗黑 algorithm 下写入暗色 --oo-colorBgContainer，亮色下为亮值", async () => {
		const dark = render(
			<ConfigProvider theme={{ algorithm: antdTheme.darkAlgorithm }}>
				<AntdApp>{null}</AntdApp>
			</ConfigProvider>,
		);
		await waitFor(() => expect(tokenStyle()).toContain("--oo-colorBgContainer:"));
		// antd 暗黑 colorBgContainer = #141414
		expect(tokenStyle()).toContain("--oo-colorBgContainer:rgb(20 20 20)");
		expect(tokenStyle()).toContain("--oo-colorTextSecondary:");
		dark.unmount();
		document.getElementById("antd-theme-tokens")?.remove();

		render(
			<ConfigProvider theme={{ algorithm: antdTheme.defaultAlgorithm }}>
				<AntdApp>{null}</AntdApp>
			</ConfigProvider>,
		);
		await waitFor(() => expect(tokenStyle()).toContain("--oo-colorBgContainer:"));
		// 亮色 colorBgContainer = #ffffff
		expect(tokenStyle()).toContain("--oo-colorBgContainer:rgb(255 255 255)");
	});

	it("挂载 window.$message / $modal / $notification（StaticAntd）", async () => {
		render(
			<ConfigProvider>
				<AntdApp>{null}</AntdApp>
			</ConfigProvider>,
		);
		await waitFor(() => expect(window.$message).toBeDefined());
		expect(window.$modal).toBeDefined();
		expect(window.$notification).toBeDefined();
	});

	it("主入口导出 AntdApp（宿主经 @oj-module/runtime 取用）", async () => {
		const Runtime = await import("#src/index");
		expect(Runtime.AntdApp).toBe(AntdApp);
	});
});
