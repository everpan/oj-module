// BDD：发布管理页拆分（2026-11-10）——「离线包上传」「信任审核」独立成两个菜单页。
// 发布管理页回归单一职责（列凭证/申请/撤销）；两区各自成为 /oj-market/publish/* 独立路由，
// superadmin 专属（upload 与 trust/review 端点后端本就 403，handle.roles 只管菜单/路由可见性，
// 判权仍在服务端——同 system:menu.settings 先例）。
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PublishPage from "../publish/pages";
import { routes as publishRoutes } from "../publish/routes";
import { InMemoryMarketClient } from "./marketClient.fake";
import { renderWithProviders } from "./render";

describe("发布页拆分：两区独立成菜单页", () => {
	it("发布管理页不再内嵌「离线包上传」「信任审核」两区", () => {
		renderWithProviders(<PublishPage />, new InMemoryMarketClient());
		expect(screen.queryByTestId("offline-upload")).toBeNull();
		expect(screen.queryByTestId("trust-review")).toBeNull();
	});

	it("publish/trust-review + publish/offline-upload 独立路由：superadmin 专属（菜单同源隐藏）", () => {
		const byPath = new Map(publishRoutes.map(r => [r.path, r]));
		const tr = byPath.get("publish/trust-review");
		const ou = byPath.get("publish/offline-upload");
		expect(tr?.handle?.title).toBe("publish:menu.trustReview");
		expect(tr?.handle?.roles).toEqual(["superadmin"]);
		expect(ou?.handle?.title).toBe("publish:menu.offlineUpload");
		expect(ou?.handle?.roles).toEqual(["superadmin"]);
	});
});
