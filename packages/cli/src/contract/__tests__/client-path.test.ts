import type { ProjectLayout } from "../../layout";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientDirOf } from "../client-path";

const layout: ProjectLayout = {
	kind: "module-root",
	projectRoot: "/proj",
	modulesSrc: "/proj/src",
	distDir: "/proj/dist/web",
	apiDist: "/proj/dist/api",
	watchTarget: "/proj/src",
	moduleRoot: "/proj/src",
};

describe("clientDirOf（client 落盘目录）", () => {
	it("缺省 = 同名模块 src/<模块>/web/__client（历史口径零漂移）", () => {
		expect(clientDirOf(layout, "/proj", "system")).toBe(join("/proj/src/system/web", "__client"));
	});

	it("clientOwners 指定归属 → src/<归属>/web/<api 前缀>/__client", () => {
		expect(clientDirOf(layout, "/proj", "system", { system: "app" }))
			.toBe(join("/proj/src/app/web/system", "__client"));
	});

	it("历史布局（layout=null）同样支持归属", () => {
		expect(clientDirOf(null, "/proj", "system", { system: "app" }))
			.toBe(join("/proj/web/src/app/system", "__client"));
	});
});
