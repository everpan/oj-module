import type { IndexRow } from "../types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UninstallConfirm } from "../components/UninstallConfirm";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

const row: IndexRow = { name: "alpha", latest: "1.2.0", installed: "1.2.0", enabled: true, upgradable: false };

describe("uninstallConfirm 卸载二次确认（BDD）", () => {
	it("given 影响面预检返回受影响角色 When 打开 Then 展示预检清单并二次确认回调", async () => {
		const client = new InMemoryMarketClient({ impact: { name: "alpha", affectedRoles: 2, affectedUsers: 5 } });
		const onConfirmed = vi.fn();
		renderWithProviders(
			<UninstallConfirm row={row} open onClose={() => {}} onConfirmed={onConfirmed} />,
			client,
		);
		await screen.findByTestId("uninstall-impact");
		expect(screen.getByText("影响面预检")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "确认卸载" }));
		expect(onConfirmed).toHaveBeenCalledWith(row);
	});

	it("given 孤立方案（无受影响）When 打开 Then 显示空影响面提示", async () => {
		const client = new InMemoryMarketClient({ impact: { name: "alpha", affectedRoles: 0, affectedUsers: 0 } });
		renderWithProviders(<UninstallConfirm row={row} open onClose={() => {}} onConfirmed={vi.fn()} />, client);
		await screen.findByText("无受影响角色或用户（孤立方案）");
	});
});
